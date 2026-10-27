import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { counterSaleSchema } from "@/lib/validation/sales";

import { writeAudit } from "../../audit";
import { assertCan } from "../../auth/permissions";
import type { ServiceCtx } from "../master/common";
import { postCustomerPayment } from "../payments/customer-payments";
import { bookOrder } from "./orders";
import { assertStockOnHand, postOrderBill, stockOut } from "./post-bill";

// Counter sales: a customer (always a real customer record) collects the goods at the warehouse.
// One transaction does what booking, dispatch and day-end do for a delivery:
//  - books the order and its bill (same pricing, discounts and credit check as an order; going
//    past the credit limit needs the owner, since there is no later approval step);
//  - takes the stock out (refused if the warehouse is short) and posts the bill to the customer
//    ledger, one entry per company;
//  - records what was paid at the counter as a customer payment (oldest debt first, like money
//    collected on delivery); the rest stays on the customer's account;
//  - marks the order Delivered, with no trip and no day-end.

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

export async function createCounterSale(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "operations.manage");
  const data = counterSaleSchema.parse(input);
  const paid = data.paidAmount ? D(data.paidAmount) : D(0);
  return ctx.db.$transaction(
    async (tx) => {
      if (data.requestId) {
        const existing = await tx.salesOrder.findUnique({
          where: { tenantId_requestId: { tenantId: ctx.user.tenantId, requestId: data.requestId } },
          select: { id: true, number: true },
        });
        if (existing) return { ...existing, repeated: true };
      }
      const { order, bill, customer, warehouseId, lines, total, names } = await bookOrder(
        tx,
        ctx,
        {
          customerId: data.customerId,
          warehouseId: data.warehouseId,
          orderDate: data.saleDate,
          deliveryDate: data.saleDate,
          source: "OFFICE",
          note: data.note,
          requestId: data.requestId,
          allowOverCredit: data.allowOverCredit,
          lines: data.lines,
        },
        { fulfilment: "COUNTER", paidNow: paid },
      );

      const saleLines = lines.map((l) => ({
        productId: l.productId,
        companyId: l.companyId,
        quantity: l.quantity,
        netAmount: D(l.netAmount.toString()),
        product: { name: names.get(l.productId)! },
      }));
      await assertStockOnHand(tx, warehouseId, saleLines);
      const batchLeft = new Map<string, { id: string; available: number }[]>();
      for (const l of saleLines)
        await stockOut(
          tx,
          ctx,
          {
            productId: l.productId,
            warehouseId,
            quantity: l.quantity,
            orderId: order.id,
            at: data.saleDate,
          },
          batchLeft,
        );
      await postOrderBill(tx, ctx, { ...order, lines: saleLines, bill }, data.saleDate);
      await tx.salesOrder.update({
        where: { id: order.id },
        data: { status: "DELIVERED", reconciledAt: new Date(), reconciledById: ctx.user.id },
      });

      const payment = paid.gt(0)
        ? (
            await postCustomerPayment(tx, ctx, {
              customerId: customer.id,
              paymentDate: data.saleDate,
              method: data.method,
              amount: paid,
              reference: data.method === "ONLINE" ? data.reference : null,
              cheque:
                data.method === "CHEQUE"
                  ? {
                      chequeNo: data.chequeNo!,
                      bankName: data.bankName!,
                      chequeDate: data.chequeDate!,
                    }
                  : undefined,
              collectedVia: "OFFICE",
              salesOrderId: order.id,
              note: `At the counter, order #${order.number}`,
              // An overpayment is an advance for this sale's companies.
              fallbackCompanies: saleLines.map((l) => [l.companyId, l.netAmount]),
            })
          ).payment
        : null;

      await writeAudit(tx, ctx.user, {
        action: "POST",
        entityType: "SalesOrder",
        entityId: order.id,
        oldValue: { status: "BOOKED" },
        newValue: {
          status: "DELIVERED",
          fulfilment: "COUNTER",
          bill: total.netAmount,
          paid: payment ? { number: payment.number, amount: paid, method: data.method } : null,
        },
        requestId: data.requestId,
      });
      return { id: order.id, number: order.number, repeated: false };
    },
    // Serializable: like dispatch, two sales at once must not both take the same stock.
    { timeout: 60_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
