"use client";

import { useId } from "react";

import RecordTimeline from "@/components/recordActivity/RecordTimeline";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type { RecordModuleKey } from "@/types/record-activity";

type Props = {
  moduleKey: RecordModuleKey;
  entityId: string | number;
  /** The module's `edit` action: notes need it, as on every other record. */
  canEdit?: boolean;
};

/**
 * An ERP document's notes and history, at the foot of its page (13c §3.1).
 *
 * The major players put both in one place on every document — Odoo's chatter, Zoho's
 * *Comments & History* — so this is the same `RecordTimeline` the record workspaces use, fed
 * by the backend's `note` and `document` sources only. A document has no calls, emails or
 * follow-ups; the backend does not report them, so the filter strip is *All · Notes · History*.
 *
 * It is not `RecordWorkspace`'s tab: document pages are one column read top to bottom, and
 * the history is what comes after the lines and the documents that follow from them.
 */
export function DocumentHistory({ moduleKey, entityId, canEdit = false }: Props) {
  const headingId = useId();
  return (
    <section className="flex flex-col gap-3" aria-labelledby={headingId}>
      <SectionHeading id={headingId} description="Notes from your team, and every change made to this document.">
        History
      </SectionHeading>
      <RecordTimeline
        moduleKey={moduleKey}
        entityId={entityId}
        canEdit={canEdit}
        emptyDescription={canEdit ? "Add a note above. Changes to this document appear here too." : "Changes to this document appear here."}
      />
    </section>
  );
}
