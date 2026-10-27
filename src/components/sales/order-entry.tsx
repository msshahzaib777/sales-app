"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import { FieldError, FormMessage } from "@/components/form/form-message";
import { useRequestId } from "@/components/form/use-request-id";
import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { type ActionState, fieldError, idleState } from "@/lib/action-state";
import { formatMoney } from "@/lib/format";
import { billTotals, checkCredit, priceLineAt, type PricedLine } from "@/lib/sales";
import { formatDozens, PACKETS_PER_HALF_DOZEN, parseQuantity, quantityText } from "@/lib/units";
import { orderEntryContextAction } from "@/server/sales-actions";
import type { OrderEntryContext } from "@/server/services/sales/orders";

import { Combobox, rankText } from "./combobox";

type CustomerOption = {
  id: string;
  name: string;
  shopName: string | null;
  phone: string | null;
  area: { name: string } | null;
};
/** `rate`: a rate per dozen typed for this order (blank = the product's rate and discount). */
type Line = { productId: string; qty: string; rate?: string; rateNote?: string };
type Product = OrderEntryContext["products"][number];

const SOURCES = [
  { value: "OFFICE", label: "Office (booker call)" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "BOOKER_APP", label: "Booker app" },
];

/** A typed rate in rupees (up to 2 decimals, more than zero), or null. */
function typedRate(rate: string | undefined): string | null {
  const v = rate?.trim() ?? "";
  return /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0 ? v : null;
}

/** "3.5" or "3dz 6pk" → 42 packets; null unless a positive number of whole or half dozens. */
function halfDozens(qty: string): number | null {
  const packets = parseQuantity(qty);
  return packets && packets % PACKETS_PER_HALF_DOZEN === 0 ? packets : null;
}

/**
 * Keyboard-first order entry:
 *  1. type the customer (name, shop, phone or area) → Enter;
 *  2. type a product code or name → Enter → type dozens → Enter (back to product search);
 *  3. Ctrl+Enter books the order.
 * Prices, discounts, available stock and the credit limit update as you type; the server
 * recalculates everything when saving.
 */
export function OrderEntry({
  action,
  customers,
  warehouses,
  canOverrideCredit,
  initial,
  mode = "order",
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  customers: CustomerOption[];
  warehouses: { id: string; name: string }[];
  canOverrideCredit: boolean;
  initial: {
    orderId?: string;
    customerId?: string;
    warehouseId?: string;
    orderDate: string;
    deliveryDate: string;
    source?: string;
    note?: string;
    lines?: Line[];
  };
  /** "counter": a sale collected at the warehouse, posted when saved, with payment taken now. */
  mode?: "order" | "counter";
}) {
  const counter = mode === "counter";
  const isNew = !initial.orderId;
  const [state, formAction, saving] = useActionState(action, idleState);
  const withRequestId = useRequestId();
  const [customerId, setCustomerId] = useState(initial.customerId ?? "");
  const [warehouseId, setWarehouseId] = useState(initial.warehouseId ?? "");
  const [context, setContext] = useState<OrderEntryContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [lines, setLines] = useState<Line[]>(initial.lines ?? []);
  const [allowOver, setAllowOver] = useState(false);
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState("CASH");
  const productSearch = useRef<HTMLInputElement>(null);
  const qtyInputs = useRef(new Map<string, HTMLInputElement>());
  // After picking a customer, the product search appears once their products have loaded.
  const focusSearchWhenLoaded = useRef(false);
  useEffect(() => {
    if (context && focusSearchWhenLoaded.current) {
      focusSearchWhenLoaded.current = false;
      productSearch.current?.focus();
    }
  }, [context]);

  // Product whose quantity box should get focus once its new line has rendered.
  const pendingFocus = useRef<string | null>(null);

  // Load the customer panel and product list whenever the customer (or warehouse) changes.
  useEffect(() => {
    if (!customerId) return;
    startLoading(async () => {
      const result = await orderEntryContextAction(customerId, {
        warehouseId: warehouseId || undefined,
        excludeOrderId: initial.orderId,
      });
      if ("error" in result) {
        setContextError(result.error);
        setContext(null);
      } else {
        setContextError(null);
        setContext(result);
      }
    });
  }, [customerId, warehouseId, initial.orderId]);

  useEffect(() => {
    if (pendingFocus.current) {
      qtyInputs.current.get(pendingFocus.current)?.select();
      pendingFocus.current = null;
    }
  }, [lines]);

  const products = context?.products ?? [];
  const productById = new Map(products.map((p) => [p.id, p]));
  const priced: (PricedLine & { product: Product })[] = [];
  for (const line of lines) {
    const product = productById.get(line.productId);
    const qty = halfDozens(line.qty);
    if (product && qty)
      priced.push({ ...priceLineAt(product, qty, typedRate(line.rate)), product });
  }
  const { total, byCompany } = billTotals(priced);
  const paidNow = /^\d+(\.\d{1,2})?$/.test(paid.trim()) ? Number(paid) : 0;
  // What a counter sale leaves on the customer's account.
  const onAccount = Math.max(Number(total.netAmount.toString()) - paidNow, 0);
  const credit = context
    ? checkCredit({
        creditLimit: context.customer.creditLimit,
        pending: context.pending,
        openOrders: context.openOrders,
        thisOrder: counter ? onAccount : total.netAmount,
      })
    : null;

  const chooseCustomer = (c: CustomerOption) => {
    focusSearchWhenLoaded.current = true;
    setCustomerId(c.id);
    setLines([]);
    setAllowOver(false);
  };

  const addProduct = (p: Product) => {
    if (lines.some((l) => l.productId === p.id)) {
      // Already on the order: jump to its quantity.
      qtyInputs.current.get(p.id)?.select();
      return;
    }
    pendingFocus.current = p.id;
    setLines((ls) => [...ls, { productId: p.id, qty: "" }]);
  };

  const repeatLastOrder = () => {
    if (!context?.lastOrder) return;
    setLines(
      context.lastOrder.lines
        .filter((l) => productById.has(l.productId))
        .map((l) => ({ productId: l.productId, qty: quantityText(l.quantity) })),
    );
  };

  const customer = customers.find((c) => c.id === customerId);
  const needsWarehouse = Boolean(context && !context.warehouseId);

  return (
    <form
      action={(fd) => formAction(isNew ? withRequestId(fd) : fd)}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.currentTarget.requestSubmit();
        } else if (
          e.key === "Enter" &&
          target instanceof HTMLInputElement &&
          target.type !== "checkbox"
        ) {
          // Plain Enter never submits by accident; in a quantity box it goes back to product search.
          e.preventDefault();
          if (target.name === "quantity") productSearch.current?.focus();
        }
      }}
      className="space-y-6"
    >
      <input type="hidden" name="customerId" value={customerId} />
      {needsWarehouse || initial.warehouseId ? (
        <input type="hidden" name="warehouseId" value={warehouseId} />
      ) : null}
      <input type="hidden" name="allowOverCredit" value={allowOver ? "true" : "false"} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          {isNew ? (
            <Combobox
              label="Customer"
              items={customers}
              getKey={(c) => c.id}
              rank={(c, q) => rankText(q, null, c.name, c.shopName, c.phone, c.area?.name)}
              render={(c) => (
                <span>
                  <span className="font-medium">{c.name}</span>
                  {c.shopName ? ` · ${c.shopName}` : ""}
                  <span className="text-muted-foreground">
                    {c.area ? ` · ${c.area.name}` : ""}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </span>
                </span>
              )}
              onSelect={chooseCustomer}
              placeholder="Name, shop, phone or area"
              autoFocus={!customerId}
              hint={
                customer
                  ? `Selected: ${customer.name}${customer.shopName ? `, ${customer.shopName}` : ""}`
                  : undefined
              }
            />
          ) : (
            <div>
              <p className="text-sm font-medium">Customer</p>
              <p className="mt-1">
                {customer
                  ? `${customer.name}${customer.shopName ? `, ${customer.shopName}` : ""}`
                  : ""}
              </p>
            </div>
          )}
          {needsWarehouse ? (
            <div className="space-y-1.5">
              <Label htmlFor="order-warehouse">Deliver from (customer has no area)</Label>
              <NativeSelect
                id="order-warehouse"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                <option value="">Choose a warehouse</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-4">
            {counter ? (
              <div className="space-y-1.5">
                <Label htmlFor="saleDate">Sale date</Label>
                <Input
                  id="saleDate"
                  name="saleDate"
                  type="date"
                  defaultValue={initial.orderDate}
                  required
                />
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="orderDate">Order date</Label>
                  <Input
                    id="orderDate"
                    name="orderDate"
                    type="date"
                    defaultValue={initial.orderDate}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="deliveryDate">Delivery date</Label>
                  <Input
                    id="deliveryDate"
                    name="deliveryDate"
                    type="date"
                    defaultValue={initial.deliveryDate}
                    required
                    aria-invalid={fieldError(state, "deliveryDate") ? true : undefined}
                  />
                  <FieldError id="deliveryDate-error" message={fieldError(state, "deliveryDate")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="source">Taken via</Label>
                  <NativeSelect id="source" name="source" defaultValue={initial.source ?? "OFFICE"}>
                    {SOURCES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="note">Note</Label>
              <Input id="note" name="note" defaultValue={initial.note} maxLength={500} />
            </div>
          </div>
        </div>

        <CustomerPanel
          context={context}
          loading={loading}
          error={contextError}
          credit={credit}
          byCompany={byCompany}
          counter={counter}
        />
      </div>

      {context && context.warehouseId ? (
        <section aria-labelledby="lines-heading" className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-72 flex-1">
              <Combobox
                label="Add product"
                items={products}
                getKey={(p) => p.id}
                rank={(p, q) => rankText(q, p.code, p.name, p.companyName)}
                render={(p) => (
                  <span className="flex justify-between gap-3">
                    <span>
                      <span className="font-mono">{p.code}</span> {p.name}
                      <span className="text-muted-foreground"> · {p.companyName}</span>
                    </span>
                    <span
                      className={
                        p.available <= 0 ? "text-destructive font-medium" : "text-muted-foreground"
                      }
                    >
                      {formatDozens(p.available)} free
                    </span>
                  </span>
                )}
                onSelect={addProduct}
                inputRef={productSearch}
                placeholder="Code or name, then Enter"
                hint="Enter adds the product; type dozens (e.g. 3.5) and Enter again for the next product. Ctrl+Enter books the order."
              />
            </div>
            {context.lastOrder ? (
              <Button type="button" variant="outline" onClick={repeatLastOrder}>
                Repeat last order (#{context.lastOrder.number})
              </Button>
            ) : null}
          </div>

          <h2 id="lines-heading" className="sr-only">
            Order lines
          </h2>
          <DataTable>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Product</Th>
                <Th>Company</Th>
                <Th className="text-right">Available</Th>
                <Th className="w-28">Dozens</Th>
                <Th className="text-right">Rate / dz</Th>
                <Th className="text-right">Discount</Th>
                <Th className="text-right">Amount</Th>
                <Th>
                  <span className="sr-only">Remove</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <EmptyRow colSpan={9}>
                  No products yet. Search above, or repeat the last order.
                </EmptyRow>
              ) : null}
              {lines.map((line, i) => {
                const product = productById.get(line.productId);
                if (!product) return null;
                const qty = halfDozens(line.qty);
                const p = priced.find((x) => x.productId === line.productId);
                const short = qty !== null && qty > product.available;
                const error =
                  fieldError(state, `lines.${i}.quantity`) ??
                  (line.qty && qty === null
                    ? "Whole or half dozens: 2, 2.5 or 2dz 6pk"
                    : undefined);
                return (
                  <tr key={line.productId}>
                    <Td className="font-mono">{product.code}</Td>
                    <Td>
                      <label htmlFor={`qty-${product.id}`}>{product.name}</label>
                      <input type="hidden" name="productId" value={product.id} />
                    </Td>
                    <Td className="text-muted-foreground">{product.companyName}</Td>
                    <Td className="text-right tabular-nums">
                      {formatDozens(product.available)}
                      {short ? (
                        <Badge variant="destructive" className="ml-1">
                          Short {formatDozens(qty! - product.available)}
                        </Badge>
                      ) : null}
                    </Td>
                    <Td>
                      <Input
                        id={`qty-${product.id}`}
                        name="quantity"
                        inputMode="decimal"
                        autoComplete="off"
                        className="h-8"
                        ref={(el) => {
                          if (el) qtyInputs.current.set(product.id, el);
                          else qtyInputs.current.delete(product.id);
                        }}
                        value={line.qty}
                        onChange={(e) =>
                          setLines((ls) =>
                            ls.map((l) =>
                              l.productId === line.productId ? { ...l, qty: e.target.value } : l,
                            ),
                          )
                        }
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `qty-${product.id}-error` : undefined}
                      />
                      <FieldError id={`qty-${product.id}-error`} message={error} />
                    </Td>
                    <Td className="text-right">
                      <RateCell
                        line={line}
                        product={product}
                        special={Boolean(p?.standardRate)}
                        error={fieldError(state, `lines.${i}.rate`)}
                        onChange={(change) =>
                          setLines((ls) =>
                            ls.map((l) =>
                              l.productId === line.productId ? { ...l, ...change } : l,
                            ),
                          )
                        }
                      />
                    </Td>
                    <Td className="text-right tabular-nums">
                      {p && p.discountAmount.gt(0) ? `−${formatMoney(p.discountAmount)}` : "—"}
                    </Td>
                    <Td className="text-right font-medium tabular-nums">
                      {p ? formatMoney(p.netAmount) : ""}
                    </Td>
                    <Td>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${product.name}`}
                        onClick={() =>
                          setLines((ls) => ls.filter((l) => l.productId !== line.productId))
                        }
                      >
                        ✕
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-medium">
                <Td>Total</Td>
                <Td />
                <Td />
                <Td />
                <Td className="tabular-nums">
                  {total.quantity ? formatDozens(total.quantity) : ""}
                </Td>
                <Td />
                <Td className="text-right tabular-nums">
                  {total.discountAmount.gt(0) ? `−${formatMoney(total.discountAmount)}` : ""}
                </Td>
                <Td className="text-right tabular-nums">{formatMoney(total.netAmount)}</Td>
                <Td />
              </tr>
            </tfoot>
          </DataTable>
        </section>
      ) : null}

      {counter && context && context.warehouseId ? (
        <PaidNow
          state={state}
          paid={paid}
          setPaid={setPaid}
          method={method}
          setMethod={setMethod}
          total={total.netAmount.toString()}
          onAccount={onAccount}
        />
      ) : null}

      {credit?.over ? (
        <div
          role="alert"
          className="border-destructive max-w-2xl space-y-2 rounded-md border-2 p-3 text-sm"
        >
          <p className="font-medium">
            This {counter ? "sale" : "order"} takes the customer {formatMoney(credit.over)} past
            their credit limit of {formatMoney(credit.limit)}.
          </p>
          {canOverrideCredit ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allowOver}
                onChange={(e) => setAllowOver(e.target.checked)}
              />
              Allow past the credit limit
            </label>
          ) : counter ? (
            <p>Take more payment now, or ask the owner to allow it.</p>
          ) : (
            <p>
              You can still book it; it will wait for the owner&apos;s approval before dispatch.
            </p>
          )}
        </div>
      ) : null}

      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving || !context || lines.length === 0}>
          {saving ? "Saving…" : counter ? "Save sale" : isNew ? "Book order" : "Save changes"}
        </Button>
        {isNew ? (
          <Button
            type="submit"
            name="intent"
            value="next"
            variant="outline"
            disabled={saving || !context || lines.length === 0}
          >
            {counter ? "Save and enter next" : "Book and enter next"}
          </Button>
        ) : null}
        <Button asChild variant="ghost">
          <Link href={initial.orderId ? `/orders/${initial.orderId}` : "/orders"}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

/**
 * Rate / dz of one line: blank uses the product's rate (shown as the placeholder). A typed rate
 * is the final price for this order, with no discount, and asks for a reason. The customer's last
 * special rate for the product is offered as a hint only.
 */
function RateCell({
  line,
  product,
  special,
  error,
  onChange,
}: {
  line: Line;
  product: Product;
  special: boolean;
  error?: string;
  onChange: (change: Partial<Line>) => void;
}) {
  const id = `rate-${product.id}`;
  const last = product.lastSpecialRate;
  return (
    <div className="ml-auto w-32 space-y-1 text-left">
      <label htmlFor={id} className="sr-only">
        Rate per dozen for {product.name}
      </label>
      <Input
        id={id}
        name="rate"
        inputMode="decimal"
        autoComplete="off"
        className="h-8 text-right tabular-nums"
        placeholder={product.saleRate}
        value={line.rate ?? ""}
        onChange={(e) => onChange({ rate: e.target.value })}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <FieldError id={`${id}-error`} message={error} />
      {special ? (
        <>
          <p className="text-xs">
            <Badge variant="secondary">Special rate</Badge>{" "}
            <span className="text-muted-foreground line-through">
              {formatMoney(product.saleRate)}
            </span>
          </p>
          <Input
            name="rateNote"
            aria-label={`Reason for the rate of ${product.name}`}
            placeholder="Reason (optional)"
            maxLength={100}
            className="h-7 text-xs"
            value={line.rateNote ?? ""}
            onChange={(e) => onChange({ rateNote: e.target.value })}
          />
        </>
      ) : (
        <input type="hidden" name="rateNote" value="" />
      )}
      {last && !line.rate ? (
        <button
          type="button"
          className="text-muted-foreground text-xs underline underline-offset-2"
          onClick={() => onChange({ rate: last.rate })}
          title="Use this rate on this order"
        >
          Last time {formatMoney(last.rate)} ({last.date})
        </button>
      ) : null}
    </div>
  );
}

const METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "ONLINE", label: "Online" },
];

/** Counter sale: what the customer pays now; the rest goes on their account. */
function PaidNow({
  state,
  paid,
  setPaid,
  method,
  setMethod,
  total,
  onAccount,
}: {
  state: ActionState;
  paid: string;
  setPaid: (v: string) => void;
  method: string;
  setMethod: (v: string) => void;
  total: string;
  onAccount: number;
}) {
  const field = (name: string, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`counter-${name}`}>{label}</Label>
      <Input
        id={`counter-${name}`}
        name={name}
        aria-invalid={fieldError(state, name) ? true : undefined}
        {...props}
      />
      <FieldError id={`counter-${name}-error`} message={fieldError(state, name)} />
    </div>
  );
  return (
    <fieldset className="max-w-4xl space-y-3 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium">Paid now</legend>
      <div className="grid gap-4 sm:grid-cols-4">
        {field("paidAmount", "Amount paid", {
          inputMode: "decimal",
          autoComplete: "off",
          value: paid,
          onChange: (e) => setPaid(e.target.value),
          placeholder: "0",
        })}
        <div className="space-y-1.5">
          <Label htmlFor="counter-method">How</Label>
          <NativeSelect
            id="counter-method"
            name="method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        {method === "CHEQUE" ? (
          <>
            {field("chequeNo", "Cheque no.", { maxLength: 30 })}
            {field("bankName", "Bank", { maxLength: 60 })}
            {field("chequeDate", "Cheque date", { type: "date" })}
          </>
        ) : method === "ONLINE" ? (
          field("reference", "Reference", { maxLength: 80 })
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <Button type="button" size="sm" variant="outline" onClick={() => setPaid(total)}>
          Paid in full ({formatMoney(total)})
        </Button>
        <p className="self-center" aria-live="polite">
          On the customer&apos;s account:{" "}
          <span className="font-medium tabular-nums">{formatMoney(onAccount)}</span>
        </p>
      </div>
    </fieldset>
  );
}

function CustomerPanel({
  context,
  loading,
  error,
  credit,
  byCompany,
  counter,
}: {
  counter: boolean;
  context: OrderEntryContext | null;
  loading: boolean;
  error: string | null;
  credit: ReturnType<typeof checkCredit> | null;
  byCompany: Map<string, { netAmount: { toString(): string } }>;
}) {
  if (error)
    return (
      <p role="alert" className="text-destructive text-sm">
        {error}
      </p>
    );
  if (!context) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
        {loading ? "Loading…" : "Pick a customer to see their balance and credit limit."}
      </div>
    );
  }
  const c = context.customer;
  return (
    <aside
      aria-label="Customer balance"
      className="space-y-3 rounded-lg border p-4 text-sm"
      aria-busy={loading}
    >
      <div>
        <p className="font-medium">{c.name}</p>
        <p className="text-muted-foreground">
          {[c.shopName, c.areaName].filter(Boolean).join(" · ") || "No area"}
        </p>
        {c.isFlagged ? (
          <Badge variant="destructive" className="mt-1">
            Flagged{c.flagReason ? `: ${c.flagReason}` : ""}
          </Badge>
        ) : null}
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
        <dt>Pending now</dt>
        <dd className="text-right font-medium tabular-nums">{formatMoney(context.pending)}</dd>
        {context.pendingByCompany.map((p) => (
          <div key={p.companyId} className="text-muted-foreground contents">
            <dt className="pl-3">{p.companyName}</dt>
            <dd className="text-right tabular-nums">{formatMoney(p.amount)}</dd>
          </div>
        ))}
        <dt>Other open orders</dt>
        <dd className="text-right tabular-nums">{formatMoney(context.openOrders)}</dd>
        <dt>This order{counter ? " (on account)" : ""}</dt>
        <dd className="text-right tabular-nums">{formatMoney(credit?.thisOrder ?? "0")}</dd>
        {[...byCompany].length > 1
          ? [...byCompany].map(([companyId, t]) => (
              <div key={companyId} className="text-muted-foreground contents">
                <dt className="pl-3">
                  {context.products.find((p) => p.companyId === companyId)?.companyName}
                </dt>
                <dd className="text-right tabular-nums">{formatMoney(t.netAmount)}</dd>
              </div>
            ))
          : null}
        <dt className="font-medium">After this order</dt>
        <dd className="text-right font-medium tabular-nums">
          {formatMoney(credit?.exposure ?? context.pending)}
        </dd>
        <dt>Credit limit</dt>
        <dd className="text-right tabular-nums">
          {c.creditLimit === null ? "No limit" : formatMoney(c.creditLimit)}
        </dd>
      </dl>
      {credit?.over ? (
        <Badge variant="destructive">Over limit by {formatMoney(credit.over)}</Badge>
      ) : null}
    </aside>
  );
}
