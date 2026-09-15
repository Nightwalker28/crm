/**
 * The single byte-size formatter.
 *
 * `lib/currency.ts` and `lib/datetime.ts` own money and time; file size never had an owner,
 * so four local copies accumulated and each answered the question differently:
 *
 * | Where | Absent or zero | Largest unit |
 * |---|---|---|
 * | `settings/backups` | `-` | MB |
 * | `dashboard/documents` | `0 B` | TB |
 * | `client/documents` | *unguarded* | MB |
 * | `client/pages/[token]` | `Unknown size` | MB |
 *
 * The largest-unit column is the one that matters: a 3 GB backup read as `3072.0 MB` on the
 * backups page and `3.0 GB` on the documents page, which is the same drift `Intl.NumberFormat`
 * produced for money. Units scale through TB here, once.
 *
 * **Absent returns `null` rather than a string.** §3.6 makes the absent value `EmptyValue` —
 * `Not set` in a field, `—` in a cell — and a formatter that picks one of them for its caller
 * is how four different placeholders happened in the first place.
 */

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), UNITS.length - 1);
  // Bytes are whole; everything above them reads better at one decimal.
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${UNITS[index]}`;
}
