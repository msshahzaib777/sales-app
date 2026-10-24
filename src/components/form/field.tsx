import { FieldError } from "@/components/form/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { type ActionState, fieldError, submittedValue } from "@/lib/action-state";
import { cn } from "@/lib/utils";

type Common = {
  state: ActionState<unknown>;
  name: string;
  label: string;
  hint?: string;
  className?: string;
};

/** Label + input + hint + error, wired for screen readers. Re-shows typed values after an error. */
export function TextField({
  state,
  name,
  label,
  hint,
  className,
  defaultValue,
  ...input
}: Common &
  Omit<React.ComponentProps<"input">, "name" | "defaultValue"> & {
    defaultValue?: string | number | null;
  }) {
  const error = fieldError(state, name);
  const id = `field-${name}`;
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") ||
    undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {input.required ? <span className="text-muted-foreground"> *</span> : null}
      </Label>
      <Input
        id={id}
        name={name}
        defaultValue={
          submittedValue(state, name) ??
          (defaultValue === null || defaultValue === undefined ? "" : String(defaultValue))
        }
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...input}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

export function SelectField({
  state,
  name,
  label,
  hint,
  className,
  defaultValue,
  options,
  placeholder,
  required,
  autoFocus,
}: Common & {
  defaultValue?: string | null;
  options: readonly { value: string; label: string }[];
  /** Adds an empty first option, e.g. "No area". */
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const error = fieldError(state, name);
  const id = `field-${name}`;
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") ||
    undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? <span className="text-muted-foreground"> *</span> : null}
      </Label>
      <NativeSelect
        id={id}
        name={name}
        defaultValue={submittedValue(state, name) ?? defaultValue ?? ""}
        required={required}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
      {hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}
