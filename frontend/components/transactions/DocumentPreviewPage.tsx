"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { DocumentPdfButton } from "@/components/transactions/DocumentPdfButton";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/PageShell";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { isForbiddenError } from "@/lib/api";
import { fetchDocumentPreview, type PrintableModuleKey } from "@/lib/documentPdf";

/**
 * The document as the customer or vendor receives it (13d §3.3): the server's HTML, the same
 * the PDF is made from, in a sandboxed frame. It replaces the browser print views; printing is
 * the PDF's job now.
 */
export function DocumentPreviewPage({
  moduleKey,
  recordId,
  title,
  backHref,
  backLabel,
}: {
  moduleKey: PrintableModuleKey;
  recordId: number;
  title: string;
  backHref: string;
  backLabel: string;
}) {
  const valid = Number.isFinite(recordId) && recordId > 0;
  const preview = useQuery({
    queryKey: ["document-preview", moduleKey, recordId],
    queryFn: () => fetchDocumentPreview(moduleKey, recordId),
    enabled: valid,
    staleTime: 0,
  });
  if (preview.error) {
    return (
      <RouteErrorState
        title={isForbiddenError(preview.error) ? "You cannot open this document" : "The document could not be loaded"}
        backHref={backHref}
        backLabel={backLabel}
        reset={() => void preview.refetch()}
      />
    );
  }
  if (!preview.data) return <RouteLoadingState />;
  return (
    <PageShell
      title={title}
      description="This is the document as it is sent: the PDF is made from the same page."
      actions={(
        <>
          <Button asChild variant="outline"><Link href={backHref}><ArrowLeft />{backLabel}</Link></Button>
          <DocumentPdfButton moduleKey={moduleKey} recordId={recordId} variant="default" />
        </>
      )}
    >
      {/* A blank sandbox: the document's HTML runs no script and reaches nothing. */}
      <iframe
        title={title}
        sandbox=""
        srcDoc={preview.data}
        className="h-[80vh] w-full rounded-[var(--radius-card)] border border-line-default bg-surface"
      />
    </PageShell>
  );
}
