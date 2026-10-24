"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";

import { SelectField, TextField } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { useRequestId } from "@/components/form/use-request-id";
import { Button } from "@/components/ui/button";
import { type ActionState, idleState } from "@/lib/action-state";
import { PAYMENT_METHOD_LABEL } from "@/lib/expenses";

type Option = { value: string; label: string };

/**
 * One expense, keyboard-first: Enter moves to the next box, Ctrl+Enter saves. "Save and add next"
 * comes back to an empty form for the next slip.
 */
export function ExpenseForm({
  action,
  today,
  categories,
  warehouses,
  bikes,
  trips,
  staff,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  today: string;
  categories: Option[];
  warehouses: Option[];
  bikes: Option[];
  trips: Option[];
  staff: Option[];
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const withRequestId = useRequestId();
  const formRef = useRef<HTMLFormElement>(null);

  const onKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Enter") return;
    const target = e.target as HTMLElement;
    if (target.tagName === "BUTTON") return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const form = formRef.current;
      form?.requestSubmit(form.querySelector<HTMLButtonElement>('button[value="next"]'));
      return;
    }
    const fields = [
      ...(formRef.current?.querySelectorAll<HTMLElement>(
        "input:not([type=hidden]), select, textarea",
      ) ?? []),
    ];
    const next = fields[fields.indexOf(target) + 1];
    if (next) next.focus();
    else formRef.current?.querySelector<HTMLButtonElement>("button[type=submit]")?.focus();
  };

  return (
    <form
      ref={formRef}
      action={(fd) => formAction(withRequestId(fd))}
      onKeyDown={onKeyDown}
      className="max-w-4xl space-y-6"
    >
      <div className="grid gap-4 sm:grid-cols-4">
        <TextField
          state={state}
          name="expenseDate"
          label="Date"
          type="date"
          required
          defaultValue={today}
        />
        <SelectField
          state={state}
          name="categoryId"
          label="Category"
          required
          autoFocus
          placeholder="Choose…"
          options={categories}
        />
        <TextField
          state={state}
          name="amount"
          label="Amount (PKR)"
          required
          inputMode="decimal"
          autoComplete="off"
        />
        <SelectField
          state={state}
          name="method"
          label="Paid by"
          required
          defaultValue="CASH"
          options={Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <TextField
          state={state}
          name="paidTo"
          label="Paid to / reference"
          hint="Shop, landlord, cheque no. …"
          maxLength={120}
          className="sm:col-span-2"
        />
        <TextField
          state={state}
          name="note"
          label="Note"
          maxLength={300}
          className="sm:col-span-2"
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          For <span className="text-muted-foreground font-normal">(optional, for reports)</span>
        </legend>
        <div className="grid gap-4 sm:grid-cols-4">
          <SelectField
            state={state}
            name="warehouseId"
            label="Warehouse"
            placeholder="—"
            options={warehouses}
          />
          <SelectField state={state} name="bikeId" label="Bike" placeholder="—" options={bikes} />
          <SelectField
            state={state}
            name="tripId"
            label="Trip"
            hint="Petrol for a trip; its bike is filled in"
            placeholder="—"
            options={trips}
          />
          <SelectField
            state={state}
            name="staffId"
            label="Staff member"
            placeholder="—"
            options={staff}
          />
        </div>
      </fieldset>
      <FormMessage state={state} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" name="intent" value="next" disabled={pending}>
          {pending ? "Saving…" : "Save and add next"}
        </Button>
        <Button type="submit" variant="outline" disabled={pending}>
          Save
        </Button>
        <Button asChild variant="ghost">
          <Link href="/expenses">Cancel</Link>
        </Button>
        <span className="text-muted-foreground text-xs">
          Enter: next box · Ctrl+Enter: save and add next
        </span>
      </div>
    </form>
  );
}
