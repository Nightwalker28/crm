import type { StatusDescriptor, StatusTone } from "@/lib/statusStyles";
import { cn } from "@/lib/utils";

/**
 * Where the value is being read. The **renderer** decides the treatment from this; the call
 * site supplies only the value (R5, and the same shape as the empty-value ruling in 3.6).
 *
 * - `list` — a table cell. Plain ink for everything except attention and critical. An
 *   operator scanning a list is looking for problems, not for normal.
 * - `record` — a record header or a spine's State block. One instance on the surface, so the
 *   colour budget reads and a `success` can take its semantic colour.
 */
export type StatusContext = "list" | "record";

const TONE_INK: Record<StatusTone, string> = {
  neutral: "text-copy-primary",
  success: "text-state-success",
  attention: "text-state-warning",
  critical: "text-state-danger",
};

/**
 * In a list, only deviation is painted. `neutral` and `success` read as plain ink — a green
 * "Paid" on 90% of rows is 90% noise, and it makes the 5% that need attention harder to find,
 * which is the opposite of what status colour is for.
 */
const PAINTED_IN_LIST: ReadonlySet<StatusTone> = new Set<StatusTone>(["attention", "critical"]);

type StatusValueProps = {
  status: StatusDescriptor;
  context?: StatusContext;
  /**
   * A tone computed by the caller from a condition rather than looked up from the value.
   *
   * Required by the AR list and by nothing else so far: `unpaid` and `partial` are the normal
   * state of a recent invoice, so classifying them as attention would make the list mostly
   * amber. What actually deserves attention is **overdue** — `due_date < today && status !==
   * "paid"` — which no enum value can express. Overrides the descriptor's own tone.
   */
  tone?: StatusTone;
  className?: string;
};

/**
 * A status, rendered as ink.
 *
 * **`Pill` is deleted, not restyled.** It was `rounded-full` + border + tinted fill +
 * `text-xs font-medium` + `backdrop-blur-sm` *plus a noise-texture overlay div* — decoration
 * carrying no information, rendered once per chip and hundreds of times per table. 1.3 is
 * explicit that hierarchy comes from ink rather than boxes, and a capsule in every row of
 * every list was the clearest violation of it in the app.
 *
 * Two live bugs go with it: `sent` / `issued` / `imported` mapped to `bg-action-primary-muted`
 * + `text-primary`, and 11 records that `--color-primary` was neutralised and
 * `bg-action-primary` was a dead class emitting no CSS. Those chips were rendering wrong at
 * HEAD and nobody noticed, because a pill looks plausible either way.
 *
 * If plain ink reads as flat rather than calm on a real list with real data, the named
 * fallback is a 6px tone-coloured dot before the label — per-state differentiation at a
 * fraction of a pill's weight. That is a change to this component and nowhere else.
 */
export function StatusValue({ status, context = "list", tone, className }: StatusValueProps) {
  const effective = tone ?? status.tone;

  // A category is never painted: no value is better than another, so colour would be saying
  // something untrue about the data.
  const ink =
    effective === null
      ? "text-copy-primary"
      : context === "list" && !PAINTED_IN_LIST.has(effective)
        ? "text-copy-primary"
        : TONE_INK[effective];

  return (
    <span
      data-slot="status-value"
      data-tone={effective ?? "category"}
      className={cn("text-sm", ink, className)}
    >
      {status.label}
    </span>
  );
}
