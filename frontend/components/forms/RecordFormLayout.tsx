import type { ReactNode } from "react";

import { Card } from "@/components/ui/Card";
import { FormFooter } from "@/components/ui/ActionBar";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { cn } from "@/lib/utils";

/**
 * Archetype 3 (design.md §4.7): the form's title, its two columns, and its action bar.
 *
 * The title and the footer are drawn here rather than passed in, because both were slots
 * before and both were then written by hand at all seventeen call sites — the §4.4 failure
 * again, where a rule exists and no primitive supplies it. There is deliberately no `footer`
 * prop to put an eighteenth recipe in.
 */
export function RecordFormLayout({
  title,
  children,
  sidebar,
  status,
  actions,
}: {
  /**
   * The visible heading — the record's name on `/[id]/edit`, the noun on `/new`
   * (`Pavithra Nanayakkara` / `New contact`). `PageHeader`'s h1 is `sr-only` by §8 and
   * archetype 2 draws its own name for the same reason: the operator came for a specific
   * record, and two edit tabs side by side were otherwise indistinguishable.
   */
  title: string;
  children: ReactNode;
  sidebar: ReactNode;
  /** The dirty-state line, an error, a `SaveStateIndicator`. Sits left in the footer. */
  status?: ReactNode;
  /** Cancel and the commit. `FormFooter` supplies the `ActionBar`, so R4's height holds. */
  actions: ReactNode;
}) {
  return (
    <div data-slot="record-form-layout" className="flex min-w-0 flex-col gap-6">
      {/* R7: the surface title is the one thing on the page allowed above the 14px body,
          and it is the same role and the same class string as the record header's name. */}
      <h2
        data-slot="form-title"
        className="truncate text-lg font-semibold text-copy-primary"
      >
        {title}
      </h2>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,23.75rem)]">
        <div className="grid min-w-0 gap-6">{children}</div>
        <aside className="grid gap-6 lg:sticky lg:top-6">{sidebar}</aside>
      </div>
      {/* R3: this was `sticky bottom-0 ... backdrop-blur` and is now an ordinary flex
          sibling at the end of the document. It was also the string `MessageTemplate`
          copied verbatim, which is what a sticky bar being a layout detail rather than a
          primitive costs. */}
      <FormFooter status={status}>{actions}</FormFooter>
    </div>
  );
}

export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("p-5 md:p-6", className)}>
      {/* R7: `text-base font-semibold text-copy-primary` was the pre-ruling heading, one
          step *louder* than the values under it. `SectionHeading` is the role. */}
      <SectionHeading description={description} className="mb-5">
        {title}
      </SectionHeading>
      {children}
    </Card>
  );
}
