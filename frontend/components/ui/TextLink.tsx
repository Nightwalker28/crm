import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * A link that sits in text — a sentence, a hint, a value on a record (design.md §2.2).
 *
 * Rebuild 5.9 counted five recipes for this one thing, and four of them were
 * `text-action-primary hover:underline`. That token resolves to the same ink as
 * `copy-primary`, so those links were indistinguishable from the words around them until the
 * pointer happened to cross one. What marks a link here is the **underline, always drawn** —
 * ink cannot do it without a colour (§2.2 rules that out), and a link that shows itself only
 * on hover is invisible to anyone reading rather than pointing.
 *
 * Not this: a record's name that opens it from a row or a card. That is the row's open
 * gesture (§7.15), takes `hover:underline` from `ListRow` / `Board`, and is not text.
 *
 * `external` opens a new tab with `noopener noreferrer`. A URI that is not a page (the MFA
 * `otpauth://` link) needs nothing: `next/link` hands a non-local URL to the browser.
 */
export function TextLink({
  className,
  external = false,
  ...props
}: ComponentProps<typeof Link> & { external?: boolean }) {
  return (
    <Link
      data-slot="text-link"
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      {...props}
      className={cn(
        "rounded-[var(--radius-control-sm)] text-copy-primary underline underline-offset-4",
        "decoration-line-strong hover:decoration-current",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        className,
      )}
    />
  );
}
