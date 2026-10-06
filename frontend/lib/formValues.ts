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
