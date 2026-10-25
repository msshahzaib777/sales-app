"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { SelectField, TextField } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { useRequestId } from "@/components/form/use-request-id";
import { Button } from "@/components/ui/button";
import { type ActionState, idleState } from "@/lib/action-state";
import { formatDozens, parseQuantity } from "@/lib/units";

type Kind = "SHORT" | "EXTRA" | "DAMAGED";

const KINDS: { value: Kind; label: string; help: string }[] = [
  { value: "SHORT", label: "Short", help: "Fewer on the shelf than the app shows." },
  { value: "EXTRA", label: "Extra found", help: "More on the shelf than the app shows." },
  {
    value: "DAMAGED",
    label: "Damaged in warehouse",
    help: "Torn or spoiled: moved to damaged stock (it can still be sent back to the company).",
  },
];
const REASONS = [
  { value: "COUNTING_ERROR", label: "Counting error" },
  { value: "THEFT", label: "Theft" },
  { value: "OTHER", label: "Other (say what)" },
];

/** Records a stock adjustment; quantity in dozens or packets, shown back as you type. */
export function AdjustmentForm({
  action,
  products,
  productId,
  approvesOwn,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  products: { id: string; code: string; name: string; onHand: number; damaged: number }[];
  productId?: string;
  /** The owner's adjustments apply at once; others wait for approval. */
  approvesOwn: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const withRequestId = useRequestId();
  const [kind, setKind] = useState<Kind>("SHORT");
  const [chosen, setChosen] = useState(productId ?? "");
  const [qty, setQty] = useState("");
  const product = products.find((p) => p.id === chosen);
  const packets = parseQuantity(qty);
  const after =
    product && packets ? product.onHand + (kind === "EXTRA" ? packets : -packets) : null;

  return (
    <form
      action={(fd) => formAction(withRequestId(fd))}
      className="max-w-3xl space-y-6"
      onChange={(e) => {
        const el = e.target as EventTarget as HTMLInputElement;
        if (el.name === "productId") setChosen(el.value);
        if (el.name === "quantity") setQty(el.value);
      }}
    >
      <SelectField
        state={state}
        name="productId"
        label="Product"
        required
        autoFocus={!productId}
        placeholder="Choose…"
        defaultValue={productId}
        options={products.map((p) => ({
          value: p.id,
          label: `${p.code} · ${p.name} · in stock ${formatDozens(p.onHand)}`,
        }))}
      />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What happened? *</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {KINDS.map((k) => (
            <label
              key={k.value}
              className="has-[:checked]:border-primary has-[:checked]:bg-muted/50 flex cursor-pointer gap-2 rounded-md border p-3 text-sm"
            >
              <input
                type="radio"
                name="kind"
                value={k.value}
                checked={kind === k.value}
                onChange={() => setKind(k.value)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{k.label}</span>
                <span className="text-muted-foreground block text-xs">{k.help}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          state={state}
          name="quantity"
          label="Quantity"
          hint={
            packets
              ? `= ${formatDozens(packets)}`
              : "Dozens (2, 2.5) or with packets (2dz 5pk, 5pk)"
          }
          required

          autoComplete="off"
          autoFocus={Boolean(productId)}
        />
        {kind === "DAMAGED" ? null : (
          <SelectField
            key={kind}
            state={state}
            name="reason"
            label="Reason"
            required
            placeholder="Choose…"
            options={kind === "EXTRA" ? REASONS.filter((r) => r.value !== "THEFT") : REASONS}
          />
        )}
        <TextField state={state} name="note" label="Note" maxLength={300} />
      </div>
      {product && after !== null ? (
        <p className="text-sm" aria-live="polite">
          In stock now <strong className="tabular-nums">{formatDozens(product.onHand)}</strong> →
          after{" "}
          <strong className={`tabular-nums ${after < 0 ? "text-destructive" : ""}`}>
            {formatDozens(after)}
          </strong>
          {kind === "DAMAGED" ? (
            <>
              {" "}
              · damaged stock {formatDozens(product.damaged)} →{" "}
              <strong className="tabular-nums">{formatDozens(product.damaged + packets!)}</strong>
            </>
          ) : null}
          {after < 0 ? <span className="text-destructive"> · more than is in stock</span> : null}
        </p>
      ) : null}
      <p className="text-muted-foreground text-sm">
        {approvesOwn
          ? "Stock changes as soon as you save."
          : "The owner approves it before the stock changes."}
      </p>
      <FormMessage state={state} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : approvesOwn ? "Save adjustment" : "Send for approval"}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/inventory/adjustments">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
