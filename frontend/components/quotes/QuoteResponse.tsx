"use client";

import { Check, Eraser, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/Money";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toUnits, unitsToNumber } from "@/lib/money";

/**
 * The customer's answer to a quote (13d §3.5): accept with a name, an optional drawn
 * signature and the optional items they want, or decline with a reason. The public proposal
 * page and the client portal's quote page both use these, so the two ask the same things.
 */

export type QuoteOptionalItem = {
  id: number;
  name: string;
  description?: string | null;
  quantity: string | number;
  unit?: string | null;
  line_total: string | number;
};

export type QuoteAcceptValues = {
  name: string;
  signature: string | null;
  optional_item_ids: number[];
  agree: true;
};

export type QuoteDeclineValues = { reason: string | null; note: string | null };

const NO_REASON = "__none__";

/** The total with the chosen optional items added; line totals already include their tax. */
export function totalWithOptions(total: string | number | null | undefined, items: QuoteOptionalItem[], chosen: Set<number>) {
  let units = toUnits(total);
  for (const item of items) if (chosen.has(item.id)) units += toUnits(item.line_total);
  return unitsToNumber(units);
}

export function QuoteOptionalItems({
  items,
  chosen,
  onChange,
  currency,
  disabled,
}: {
  items: QuoteOptionalItem[];
  chosen: Set<number>;
  onChange: (next: Set<number>) => void;
  currency?: string | null;
  disabled?: boolean;
}) {
  if (!items.length) return null;
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium text-copy-primary">Optional items</legend>
      {items.map((item) => (
        <label key={item.id} className="flex items-start gap-3 rounded-[var(--radius-control)] border border-line-subtle px-3 py-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={chosen.has(item.id)}
            disabled={disabled}
            onCheckedChange={(checked) => {
              const next = new Set(chosen);
              if (checked === true) next.add(item.id);
              else next.delete(item.id);
              onChange(next);
            }}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-copy-primary">{item.name}</span>
            {item.description ? <span className="block text-p-xs text-copy-muted">{item.description}</span> : null}
          </span>
          <Money amount={item.line_total} currency={currency} className="tabular-nums text-copy-primary" />
        </label>
      ))}
    </fieldset>
  );
}

/** A drawn signature, kept as a PNG `data:` URI. Pointer events, so touch and pen work too. */
export function SignaturePad({ onChange, disabled }: { onChange: (value: string | null) => void; disabled?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * scale;
    canvas.height = canvas.offsetHeight * scale;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(scale, scale);
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111827"; // design-exempt: ink colour inside the signature image, not page chrome
  }, []);

  function point(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    context.beginPath();
    context.moveTo(x, y);
  }

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const { x, y } = point(event);
    context.lineTo(x, y);
    context.stroke();
  }

  function end(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    setEmpty(false);
    onChange(event.currentTarget.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
    onChange(null);
  }

  return (
    <div className="grid gap-2">
      <canvas
        ref={canvasRef}
        aria-label="Signature: draw with a mouse, finger or pen"
        className={"h-32 w-full touch-none rounded-[var(--radius-control)] border border-line-control bg-white" /* design-exempt: a signature is ink on white paper in both themes */}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className="flex items-center justify-between gap-2 text-p-xs text-copy-muted">
        <span>{empty ? "Optional. Your typed name is your signature." : "Signature drawn."}</span>
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={disabled || empty}>
          <Eraser />
          Clear
        </Button>
      </div>
    </div>
  );
}

export function QuoteAcceptForm({
  optionalItems,
  currency,
  total,
  onSubmit,
  onCancel,
  submitting,
}: {
  optionalItems: QuoteOptionalItem[];
  currency?: string | null;
  total?: string | number | null;
  onSubmit: (values: QuoteAcceptValues) => void;
  onCancel: () => void;
  submitting?: boolean;
}) {
  const [name, setName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return setError("Enter your name to accept.");
        if (!agree) return setError("Agree to the terms to accept.");
        setError(null);
        onSubmit({ name: name.trim(), signature, optional_item_ids: [...chosen], agree: true });
      }}
    >
      <QuoteOptionalItems items={optionalItems} chosen={chosen} onChange={setChosen} currency={currency} disabled={submitting} />
      <div className="flex items-baseline justify-between gap-3 border-t border-line-subtle pt-3">
        <span className="text-sm text-copy-secondary">Total you accept</span>
        <Money amount={totalWithOptions(total, optionalItems, chosen)} currency={currency} className="text-lg font-semibold tabular-nums text-copy-primary" />
      </div>
      <Field>
        <FieldLabel htmlFor="quote-accept-name">Your full name<RequiredMark /></FieldLabel>
        <Input id="quote-accept-name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)}
          maxLength={200} disabled={submitting} aria-invalid={Boolean(error && !name.trim())} />
      </Field>
      <Field>
        <FieldLabel>Signature</FieldLabel>
        <SignaturePad onChange={setSignature} disabled={submitting} />
      </Field>
      <label className="flex items-start gap-3 text-sm text-copy-primary">
        <Checkbox className="mt-0.5" checked={agree} onCheckedChange={(checked) => setAgree(checked === true)} disabled={submitting} />
        <span>I accept this quote and its terms.</span>
      </label>
      {error ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
        <Button type="submit" disabled={submitting}>
          <Check />
          {submitting ? "Accepting…" : "Accept quote"}
        </Button>
      </div>
    </form>
  );
}

export function QuoteDeclineForm({
  reasons,
  onSubmit,
  onCancel,
  submitting,
}: {
  reasons: Array<{ key: string; label: string }>;
  onSubmit: (values: QuoteDeclineValues) => void;
  onCancel: () => void;
  submitting?: boolean;
}) {
  const [reason, setReason] = useState(NO_REASON);
  const [note, setNote] = useState("");
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ reason: reason === NO_REASON ? null : reason, note: note.trim() || null });
      }}
    >
      {reasons.length ? (
        <Field>
          <FieldLabel htmlFor="quote-decline-reason">Reason</FieldLabel>
          <Select value={reason} onValueChange={setReason} disabled={submitting}>
            <SelectTrigger id="quote-decline-reason" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_REASON}>Prefer not to say</SelectItem>
              {reasons.map((option) => <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      <Field>
        <FieldLabel htmlFor="quote-decline-note">Anything you would like us to know</FieldLabel>
        <Textarea id="quote-decline-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={3} disabled={submitting} />
        <FieldDescription>Optional.</FieldDescription>
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
        <Button type="submit" variant="destructive" disabled={submitting}>
          <X />
          {submitting ? "Declining…" : "Decline quote"}
        </Button>
      </div>
    </form>
  );
}
