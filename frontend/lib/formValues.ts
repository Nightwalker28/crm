/**
 * Form state loaded from a saved record.
 *
 * Records carry `null` for every empty optional field, but form state uses `""` (inputs and
 * `.trim()` both need a string). Spreading the record over the empty form copied those nulls
 * in, and the payload builder's `trim(null)` then threw before any request was sent: every
 * deal made by lead conversion could not be edited (13a H1).
 */
export function formValuesFromRecord<TForm extends object>(empty: TForm, record: object): TForm {
  const next = { ...empty } as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue;
    next[key] = value;
  }
  return next as TForm;
}

/**
 * A form value from a clone draft's copied fields (`useCloneDraft`, 13b Phase 5). Only keys
 * the empty form has are taken, each as the form holds it: text inputs hold strings, so a
 * copied amount `12500` becomes `"12500"`. Anything the draft leaves out stays empty.
 */
export function formValuesFromCopy<TForm extends object>(emptyForm: TForm, fields: Record<string, unknown>): TForm {
  const form = { ...emptyForm } as Record<string, unknown>;
  for (const [key, empty] of Object.entries(emptyForm)) {
    const value = fields[key];
    if (value === null || value === undefined) continue;
    form[key] = typeof empty === "string" ? String(value) : value;
  }
  return form as TForm;
}
