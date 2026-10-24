"use client";

import { useActionState, useState } from "react";

import { FormMessage } from "@/components/form/form-message";
import { useRequestId } from "@/components/form/use-request-id";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { type ActionState, fieldError, idleState } from "@/lib/action-state";
import { formatMoney } from "@/lib/format";
import { formatDozens } from "@/lib/units";

import { LoadText } from "./trip-badge";

export type PlannableOrder = {
  id: string;
  number: number;
  warehouseId: string;
  warehouseName: string;
  customerName: string;
  shopName: string | null;
  areaName: string | null;
  needsCreditApproval: boolean;
  quantity: number;
  amount: string;
};

type Bike = {
  id: string;
  name: string;
  capacity: number;
  driverId: string | null;
  warehouse: { id: string; name: string } | null;
};

/** Ticks booked orders and shows the load against the bike's capacity while you tick. */
export function OrderPicker({
  orders,
  capacity,
  name = "orderIds",
}: {
  orders: PlannableOrder[];
  capacity: number | null;
  name?: string;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const load = orders.filter((o) => checked.has(o.id)).reduce((s, o) => s + o.quantity, 0);
  const all = orders.length > 0 && checked.size === orders.length;
  const toggle = (id: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  if (orders.length === 0)
    return <p className="text-muted-foreground text-sm">No booked orders waiting for this date.</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm" aria-live="polite">
        {checked.size} {checked.size === 1 ? "order" : "orders"} ticked · load{" "}
        {capacity ? <LoadText load={load} capacity={capacity} /> : formatDozens(load)}
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Tick all orders"
                  className="size-4 align-middle"
                  checked={all}
                  onChange={(e) =>
                    setChecked(e.target.checked ? new Set(orders.map((o) => o.id)) : new Set())
                  }
                />
              </th>
              <th className="px-3 py-2 font-medium">Order</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 text-right font-medium">Dozens</th>
              <th className="px-3 py-2 text-right font-medium">Bill</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o, i) => {
              const area = o.areaName ?? "No area";
              const header = i === 0 || area !== (orders[i - 1]!.areaName ?? "No area");
              return [
                header ? (
                  <tr key={`area-${o.id}`} className="bg-muted/30">
                    <td colSpan={5} className="px-3 py-1 text-xs font-semibold">
                      {area} · {o.warehouseName}
                    </td>
                  </tr>
                ) : null,
                <tr key={o.id} className="border-t">
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      name={name}
                      value={o.id}
                      aria-label={`Order #${o.number}, ${o.customerName}`}
                      className="size-4 align-middle"
                      checked={checked.has(o.id)}
                      onChange={(e) => toggle(o.id, e.target.checked)}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    #{o.number}
                    {o.needsCreditApproval ? (
                      <span className="text-destructive ml-2 text-xs font-medium">
                        needs owner approval
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5">
                    {o.customerName}
                    {o.shopName ? (
                      <span className="text-muted-foreground"> · {o.shopName}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatDozens(o.quantity)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(o.amount)}</td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TripForm({
  action,
  date,
  bikes,
  staff,
  orders,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  date: string;
  bikes: Bike[];
  staff: { id: string; name: string; role: string }[];
  orders: PlannableOrder[];
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const withRequestId = useRequestId();
  const [bikeId, setBikeId] = useState(bikes.length === 1 ? bikes[0]!.id : "");
  const bike = bikes.find((b) => b.id === bikeId);
  const [driverId, setDriverId] = useState("");
  const visible = bike?.warehouse
    ? orders.filter((o) => o.warehouseId === bike.warehouse!.id)
    : orders;
  return (
    <form action={(fd) => formAction(withRequestId(fd))} className="space-y-6">
      <input type="hidden" name="tripDate" value={date} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="bikeId">Bike *</Label>
          <NativeSelect
            id="bikeId"
            name="bikeId"
            value={bikeId}
            autoFocus
            aria-invalid={fieldError(state, "bikeId") ? true : undefined}
            onChange={(e) => setBikeId(e.target.value)}
          >
            <option value="">Choose a bike</option>
            {bikes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} · {b.capacity / 2} dz{b.warehouse ? ` · ${b.warehouse.name}` : ""}
              </option>
            ))}
          </NativeSelect>
          {fieldError(state, "bikeId") ? (
            <p className="text-destructive text-sm">{fieldError(state, "bikeId")}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="driverId">Driver</Label>
          <NativeSelect
            id="driverId"
            name="driverId"
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
            aria-invalid={fieldError(state, "driverId") ? true : undefined}
          >
            <option value="">Not decided yet</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.role === "DRIVER" ? "" : ` (${s.role.toLowerCase()})`}
              </option>
            ))}
          </NativeSelect>
          {fieldError(state, "driverId") ? (
            <p className="text-destructive text-sm">{fieldError(state, "driverId")}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="note">Note</Label>
          <Input id="note" name="note" maxLength={300} placeholder="e.g. morning round" />
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="font-medium">Orders</legend>
        {fieldError(state, "orderIds") ? (
          <p className="text-destructive text-sm">{fieldError(state, "orderIds")}</p>
        ) : null}
        <OrderPicker key={bikeId} orders={visible} capacity={bike?.capacity ?? null} />
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Plan trip"}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

/** Adds more booked orders to a planned trip. */
export function AddOrdersForm({
  action,
  orders,
  capacity,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  orders: PlannableOrder[];
  capacity: number;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  return (
    <form action={formAction} className="space-y-3">
      <OrderPicker orders={orders} capacity={capacity} />
      {orders.length > 0 ? (
        <div className="flex items-center gap-3">
          <Button type="submit" variant="secondary" disabled={pending}>
            Add ticked orders
          </Button>
          <FormMessage state={state} />
        </div>
      ) : null}
    </form>
  );
}
