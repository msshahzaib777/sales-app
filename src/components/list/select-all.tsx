"use client";

/** Header checkbox that ticks or clears every `name` checkbox in the same form. */
export function SelectAll({ name, label }: { name: string; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="size-4 align-middle"
      onChange={(e) => {
        const form = e.currentTarget.form;
        if (!form) return;
        for (const box of form.querySelectorAll<HTMLInputElement>(
          `input[type=checkbox][name="${name}"]`,
        ))
          box.checked = e.currentTarget.checked;
      }}
    />
  );
}
