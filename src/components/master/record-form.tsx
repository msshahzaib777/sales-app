"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";

import { SelectField, TextField } from "@/components/form/field";
import { FieldError, FormMessage } from "@/components/form/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type ActionState, fieldError, idleState } from "@/lib/action-state";
import { cn } from "@/lib/utils";

// One form component for all master records, driven by a serializable field list built on the
// server. Keyboard-first: the first field is focused, Enter saves, Tab follows the visual order.

type Option = { value: string; label: string };

export type FieldDef =
  | {
      kind: "text";
      name: string;
      label: string;
      required?: boolean;
      defaultValue?: string | number | null;
      hint?: string;
      type?: "text" | "tel" | "date" | "email";
      inputMode?: "decimal" | "numeric" | "text" | "tel";
      placeholder?: string;
      maxLength?: number;
      width?: "sm" | "md" | "full";
    }
  | {
      kind: "select";
      name: string;
      label: string;
      options: Option[];
      required?: boolean;
      defaultValue?: string | null;
      placeholder?: string;
      hint?: string;
      width?: "sm" | "md" | "full";
    }
  | { kind: "section"; title: string; description?: string }
  | {
      kind: "slabs";
      defaultValue: { fromDozens: string; value: string }[];
      discountTypeField: string;
    }
  | {
      kind: "openings";
      companies: { id: string; name: string; group?: string }[];
      defaultValue: Record<string, string>;
      hint: string;
    };

const WIDTH = { sm: "sm:col-span-1", md: "sm:col-span-2", full: "sm:col-span-4" } as const;

export function RecordForm({
  action,
  fields,
  isNew,
  cancelHref,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fields: FieldDef[];
  isNew: boolean;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  // Idempotency (CLAUDE.md rule 7): one id per new record, created on first submit and reused when
  // the user presses Save again (e.g. after a timeout). The page remounts the form after a save.
  const requestId = useRef<string | null>(null);
  const submit = (formData: FormData) => {
    if (isNew) {
      requestId.current ??= crypto.randomUUID();
      formData.set("requestId", requestId.current);
    }
    formAction(formData);
  };
  const slabsField = fields.find((f) => f.kind === "slabs");
  const discountTypeDefault = slabsField
    ? (
        fields.find((f) => f.kind === "select" && f.name === slabsField.discountTypeField) as
          { defaultValue?: string } | undefined
      )?.defaultValue
    : undefined;
  const [discountType, setDiscountType] = useState(discountTypeDefault ?? "NONE");
  const firstInput = fields.findIndex((f) => f.kind === "text" || f.kind === "select");

  return (
    <form
      action={submit}
      className="max-w-4xl space-y-6"
      onChange={(event) => {
        const target = event.target;
        if (
          slabsField &&
          target instanceof HTMLSelectElement &&
          target.name === slabsField.discountTypeField
        ) {
          setDiscountType(target.value);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-4">
        {fields.map((field, i) => {
          if (field.kind === "section") {
            return (
              <div key={`section-${i}`} className="pt-2 sm:col-span-4">
                <h2 className="font-medium">{field.title}</h2>
                {field.description ? (
                  <p className="text-muted-foreground text-sm">{field.description}</p>
                ) : null}
              </div>
            );
          }
          if (field.kind === "slabs") {
            return (
              <SlabsEditor
                key="slabs"
                state={state}
                defaultValue={field.defaultValue}
                unit={discountType === "PERCENT" ? "%" : "Rs per dozen"}
                disabled={discountType === "NONE"}
              />
            );
          }
          if (field.kind === "openings") {
            return <OpeningBalances key="openings" state={state} {...field} />;
          }
          const autoFocus = i === firstInput;
          const className = WIDTH[field.width ?? "md"];
          if (field.kind === "select") {
            return (
              <SelectField
                key={field.name}
                state={state}
                name={field.name}
                label={field.label}
                options={field.options}
                defaultValue={field.defaultValue}
                placeholder={field.placeholder}
                required={field.required}
                hint={field.hint}
                autoFocus={autoFocus}
                className={className}
              />
            );
          }
          return (
            <TextField
              key={field.name}
              state={state}
              name={field.name}
              label={field.label}
              required={field.required}
              defaultValue={field.defaultValue}
              hint={field.hint}
              type={field.type ?? "text"}
              inputMode={field.inputMode}
              placeholder={field.placeholder}
              maxLength={field.maxLength}
              autoFocus={autoFocus}
              className={className}
            />
          );
        })}
      </div>

      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {isNew ? (
          <Button type="submit" name="intent" value="new" variant="outline" disabled={pending}>
            Save and add another
          </Button>
        ) : null}
        <Button asChild variant="ghost">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

const SLAB_ROWS = 4;

function SlabsEditor({
  state,
  defaultValue,
  unit,
  disabled,
}: {
  state: ActionState;
  defaultValue: { fromDozens: string; value: string }[];
  unit: string;
  disabled: boolean;
}) {
  const echoed = (field: string, i: number) =>
    state.status === "error" ? state.values?.[`${field}.${i}`] : undefined;
  const rows = Math.max(SLAB_ROWS, defaultValue.length + 1);
  return (
    <fieldset className="space-y-2 sm:col-span-4" disabled={disabled}>
      <legend className="text-sm font-medium">Quantity slabs</legend>
      <p className="text-muted-foreground text-xs">
        {disabled
          ? "Choose a discount type above to add slabs."
          : `From this many dozen in one order line, this discount (${unit}) replaces the normal one for the whole line. Leave rows blank if not needed.`}
      </p>
      <div className="grid max-w-md grid-cols-2 gap-2">
        <span className="text-muted-foreground text-xs">From (dozens)</span>
        <span className="text-muted-foreground text-xs">Discount ({unit})</span>
        {Array.from({ length: rows }, (_, i) => {
          const fromError = fieldError(state, `slabs.${i}.fromDozens`);
          const valueError = fieldError(state, `slabs.${i}.value`);
          return (
            <div key={i} className="contents">
              <div>
                <Input
                  name="slabFrom"
                  inputMode="decimal"
                  aria-label={`Slab ${i + 1} from dozens`}
                  defaultValue={echoed("slabFrom", i) ?? defaultValue[i]?.fromDozens ?? ""}
                  aria-invalid={fromError ? true : undefined}
                />
                <FieldError id={`slab-${i}-from-error`} message={fromError} />
              </div>
              <div>
                <Input
                  name="slabValue"
                  inputMode="decimal"
                  aria-label={`Slab ${i + 1} discount`}
                  defaultValue={echoed("slabValue", i) ?? defaultValue[i]?.value ?? ""}
                  aria-invalid={valueError ? true : undefined}
                />
                <FieldError id={`slab-${i}-value-error`} message={valueError} />
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function OpeningBalances({
  state,
  companies,
  defaultValue,
  hint,
}: {
  state: ActionState;
  companies: { id: string; name: string; group?: string }[];
  defaultValue: Record<string, string>;
  hint: string;
}) {
  if (companies.length === 0) {
    return (
      <p className="text-muted-foreground text-sm sm:col-span-4">
        Add companies first to enter opening balances.
      </p>
    );
  }
  return (
    <fieldset className="space-y-2 sm:col-span-4">
      <legend className="text-sm font-medium">Opening balance per company (PKR)</legend>
      <p className="text-muted-foreground text-xs">{hint}</p>
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {companies.map((company) => {
          const name = `opening:${company.id}`;
          const error = fieldError(state, `openingBalances.${company.id}`);
          const echoed = state.status === "error" ? state.values?.[name] : undefined;
          return (
            <div key={company.id} className={cn("grid grid-cols-[1fr_9rem] items-center gap-2")}>
              <label htmlFor={name} className="text-sm">
                {company.name}
                {company.group ? (
                  <span className="text-muted-foreground"> · {company.group}</span>
                ) : null}
              </label>
              <Input
                id={name}
                name={name}
                inputMode="decimal"
                defaultValue={echoed ?? defaultValue[company.id] ?? ""}
                placeholder="0"
                aria-invalid={error ? true : undefined}
              />
              <FieldError id={`${name}-error`} message={error} />
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
