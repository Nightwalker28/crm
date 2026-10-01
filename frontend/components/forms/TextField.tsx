"use client";

import type { ReactNode } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/RequiredMark";

type TextFieldProps = {
  /**
   * Required, and that is the point.
   *
   * Four private copies of this component existed and one of them — the lead form's — took
   * no `id` at all, so `FieldLabel` rendered a `<label>` with no `htmlFor` beside an `Input`
   * with no `id`. On screen it was indistinguishable from the other three; in the
   * accessibility tree the input had no name, and clicking the label did nothing. Every
   * guard passed. Making the prop required is the only thing that stops the fourth copy
   * being written again (design.md §7.5).
   */
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  /**
   * Draws `RequiredMark` and sets `aria-required`. The mark is `aria-hidden` — it is the
   * visual half — so without the attribute the requirement reaches sighted operators only.
   */
  required?: boolean;
  /** Renders under the field and flips the input to its invalid state (§7.5). */
  error?: string | null;
  description?: ReactNode;
  maxLength?: number;
  min?: string;
  max?: string;
  step?: string;
  disabled?: boolean;
  /** Spans both columns of a `FieldGroup columns={2}` — `md:col-span-2`. */
  className?: string;
};

/**
 * A labelled single-line input — the form's most repeated three lines, once.
 *
 * It lives in `components/forms/` rather than `components/ui/`: `Field`, `FieldLabel` and
 * `Input` are the primitives, and this is the product's standard composition of them. A form
 * that needs something this cannot express (a prefix, a picker, a unit, a linked record)
 * composes the three directly rather than growing a prop here.
 */
export function TextField({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  inputMode,
  required = false,
  error,
  description,
  maxLength,
  min,
  max,
  step,
  disabled,
  className,
}: TextFieldProps) {
  const errorId = error ? `${id}-error` : undefined;
  return (
    <Field data-invalid={Boolean(error)} className={className}>
      <FieldLabel htmlFor={id}>
        {label}
        {required ? <RequiredMark /> : null}
      </FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-required={required || undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={errorId}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  );
}
