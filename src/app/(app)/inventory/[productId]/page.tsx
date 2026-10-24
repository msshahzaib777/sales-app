import type { Metadata } from "next";
import Link from "next/link";

import { ReturnDamagedForm } from "@/components/inventory/return-damaged-form";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { PrintButton } from "@/components/layout/print-button";
import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { Notice } from "@/components/master/notice";
import { LinkButton, orNotFound } from "@/components/master/page-helpers";
import { StatementRangeForm } from "@/components/print/range-form";
import { businessToday, formatDate, toDateInput } from "@/lib/dates";
import { formatDozens } from "@/lib/units";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { returnDamagedStockAction } from "@/server/inventory-actions";
import { getStockCard } from "@/server/services/inventory";
import { defaultLedgerRange, parseDateRange } from "@/server/services/purchasing/filters";

export const metadata: Metadata = { title: "Stock card" };

const signed = (q: number) => `${q > 0 ? "+" : "−"}${formatDozens(Math.abs(q))}`;

/** Every movement of one product with running balances (the stock journal, SPEC §5). */
export default async function StockCardPage({
  params,
  searchParams,
}: PageProps<"/inventory/[productId]">) {
  const [{ productId }, sp] = await Promise.all([params, searchParams]);
  // Session first: it makes the page dynamic before today's date is read.
  const ctx = await requireTenantContext("operations.manage");
  const parsed = parseDateRange(sp);
  const range = parsed.from || parsed.to ? parsed : defaultLedgerRange(businessToday());
  const card = await orNotFound(getStockCard(ctx, productId, range));
  const { product } = card;
  return (
    <div className="space-y-4">
      <div>
        <BackLink href="/inventory">Inventory</BackLink>
        <PageHeader
          title={`${product.code} ${product.name}`}
          description={`${product.companyName} · ${product.warehouseName}${product.minStockLevel ? ` · minimum ${formatDozens(product.minStockLevel)}` : ""}`}
          actions={
            <>
              {can(ctx.user.role, "stock.requestAdjustment") ? (
                <LinkButton
                  href={`/inventory/adjustments/new?productId=${product.id}`}
                  variant="outline"
                >
                  Adjust stock
                </LinkButton>
              ) : null}
              <PrintButton />
            </>
          }
        />
      </div>
      <p className="text-sm">
        Now: on hand <strong>{formatDozens(card.now.onHand)}</strong> · reserved{" "}
        {formatDozens(card.now.reserved)} · available{" "}
        <strong>{formatDozens(card.now.available)}</strong>
      </p>
      <Notice notice={sp.notice} />
      {card.damagedNow > 0 ? (
        <ReturnDamagedForm
          key={card.damagedNow}
          action={returnDamagedStockAction.bind(null, productId)}
          today={toDateInput(businessToday())}
          damaged={formatDozens(card.damagedNow)}
        />
      ) : null}
      <StatementRangeForm range={range} />
      <DataTable>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Movement</Th>
            <Th>Stock</Th>
            <Th className="text-right">Quantity</Th>
            <Th className="text-right">Saleable</Th>
            <Th className="text-right">Damaged</Th>
          </tr>
        </thead>
        <tbody>
          <tr className="text-muted-foreground">
            <Td>{range.from ? formatDate(range.from) : ""}</Td>
            <Td>Opening</Td>
            <Td />
            <Td />
            <Td className="text-right tabular-nums">{formatDozens(card.opening.saleable)}</Td>
            <Td className="text-right tabular-nums">{formatDozens(card.opening.damaged)}</Td>
          </tr>
          {card.rows.length === 0 ? (
            <EmptyRow colSpan={6}>No movements in this period.</EmptyRow>
          ) : null}
          {card.rows.map((r) => (
            <tr key={r.id}>
              <Td className="whitespace-nowrap">{formatDate(r.occurredAt)}</Td>
              <Td>
                {r.href ? (
                  <Link href={r.href} className="underline-offset-4 hover:underline">
                    {r.typeLabel}
                  </Link>
                ) : (
                  r.typeLabel
                )}
                {r.note ? <div className="text-muted-foreground">{r.note}</div> : null}
              </Td>
              <Td>{r.bucket === "DAMAGED" ? "Damaged" : "Saleable"}</Td>
              <Td className="text-right tabular-nums">{signed(r.quantity)}</Td>
              <Td className="text-right tabular-nums">{formatDozens(r.saleable)}</Td>
              <Td className="text-right tabular-nums">{formatDozens(r.damaged)}</Td>
            </tr>
          ))}
          <tr className="font-medium">
            <Td>{range.to ? formatDate(range.to) : ""}</Td>
            <Td>Closing</Td>
            <Td />
            <Td />
            <Td className="text-right tabular-nums">{formatDozens(card.closing.saleable)}</Td>
            <Td className="text-right tabular-nums">{formatDozens(card.closing.damaged)}</Td>
          </tr>
        </tbody>
      </DataTable>
    </div>
  );
}
