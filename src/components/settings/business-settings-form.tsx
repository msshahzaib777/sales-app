"use client";

import { useActionState, useState } from "react";

import { SelectField, TextField } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { Button } from "@/components/ui/button";
import { type ActionState, idleState, submittedValue } from "@/lib/action-state";
import { PAPER_LABEL, PAPER_SIZES, type PaperSize } from "@/lib/print";

type Values = {
  name: string;
  address: string | null;
  phone: string | null;
  billPaper: PaperSize;
  billPaperWidthMm: number | null;
  billPaperHeightMm: number | null;
  printMarginMm: number;
  printFontSizePt: number;
  twoBillsPerA4: boolean;
};

export function BusinessSettingsForm({
  action,
  values,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  values: Values;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const [paper, setPaper] = useState<string>(
    submittedValue(state, "billPaper") ?? values.billPaper,
  );
  const twoPerA4 = submittedValue(state, "twoBillsPerA4");
  return (
    <form action={formAction} className="space-y-6" noValidate>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-medium">Letterhead</legend>
        <TextField
          state={state}
          name="name"
          label="Business name"
          defaultValue={values.name}
          required
          maxLength={120}
          autoFocus
        />
        <TextField
          state={state}
          name="phone"
          label="Phone"
          type="tel"
          defaultValue={values.phone}
        />
        <TextField
          state={state}
          name="address"
          label="Address"
          defaultValue={values.address}
          maxLength={200}
          className="sm:col-span-2"
        />
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-4">
        <legend className="mb-2 font-medium">Bill printing</legend>
        <div
          className="sm:col-span-2"
          onChange={(e) => {
            const t = e.target;
            if (t instanceof HTMLSelectElement && t.name === "billPaper") setPaper(t.value);
          }}
        >
          <SelectField
            state={state}
            name="billPaper"
            label="Paper size"
            defaultValue={values.billPaper}
            options={PAPER_SIZES.map((p) => ({ value: p, label: PAPER_LABEL[p] }))}
            hint="Statements and reports always print on A4."
          />
        </div>
        {paper === "CUSTOM" ? (
          <>
            <TextField
              state={state}
              name="billPaperWidthMm"
              label="Width (mm)"
              inputMode="numeric"
              defaultValue={values.billPaperWidthMm}
              required
            />
            <TextField
              state={state}
              name="billPaperHeightMm"
              label="Height (mm)"
              inputMode="numeric"
              defaultValue={values.billPaperHeightMm}
              required
            />
          </>
        ) : null}
        <TextField
          state={state}
          name="printMarginMm"
          label="Margin (mm)"
          inputMode="numeric"
          defaultValue={values.printMarginMm}
          hint="0 to 30"
          className="sm:col-start-1"
        />
        <TextField
          state={state}
          name="printFontSizePt"
          label="Font size (pt)"
          inputMode="numeric"
          defaultValue={values.printFontSizePt}
          hint="7 to 16"
        />
        <label className="flex items-start gap-2 text-sm sm:col-span-4">
          <input
            type="checkbox"
            name="twoBillsPerA4"
            defaultChecked={state.status === "error" ? twoPerA4 === "on" : values.twoBillsPerA4}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="font-medium">Print 2 bills per A4 sheet</span>
            <span className="text-muted-foreground block">
              Two half-A4 bills on one sheet with a cut line; overrides the paper size above.
            </span>
          </span>
        </label>
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function LogoForm({
  upload,
  remove,
  logoUrl,
}: {
  upload: (state: ActionState, formData: FormData) => Promise<ActionState>;
  remove: (state: ActionState) => Promise<ActionState>;
  logoUrl: string | null;
}) {
  const [upState, uploadAction, uploading] = useActionState(upload, idleState);
  const [rmState, removeAction, removing] = useActionState(remove, idleState);
  const last =
    rmState.status !== "idle" && (upState.status === "idle" || removing) ? rmState : upState;
  return (
    <div className="space-y-3">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a stored data: URL
        <img src={logoUrl} alt="Current logo" className="h-16 w-auto rounded border bg-white p-1" />
      ) : (
        <p className="text-muted-foreground text-sm">No logo: bills show the business name only.</p>
      )}
      <form action={uploadAction} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <label htmlFor="logo" className="text-sm font-medium">
            {logoUrl ? "Replace logo" : "Upload logo"}
          </label>
          <input
            id="logo"
            name="logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="block text-sm"
            aria-describedby="logo-hint"
          />
          <p id="logo-hint" className="text-muted-foreground text-xs">
            PNG, JPEG or WebP, up to 200 KB. A dark logo on white prints best.
          </p>
        </div>
        <Button type="submit" variant="secondary" disabled={uploading}>
          {uploading ? "Uploading…" : "Upload"}
        </Button>
      </form>
      {logoUrl ? (
        <form action={removeAction}>
          <Button type="submit" variant="outline" size="sm" disabled={removing}>
            Remove logo
          </Button>
        </form>
      ) : null}
      <FormMessage state={last} />
    </div>
  );
}
