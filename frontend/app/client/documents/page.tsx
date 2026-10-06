"use client";

import { DocumentReferenceActions } from "@/components/documents/DocumentReferenceActions";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRow, RowList } from "@/components/ui/ListRow";
import { PageShell } from "@/components/ui/PageShell";
import { resolveClientDocumentView, useClientDocuments } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";
import { formatBytes } from "@/lib/format";

export default function ClientDocumentsPage() {
  const documentsQuery = useClientDocuments();
  const documents = documentsQuery.data?.results ?? [];

  return (
    <PageShell
      title="Shared documents"
      isLoading={documentsQuery.isLoading}
      hasError={Boolean(documentsQuery.error)}
      backHref="/client"
      backLabel="Return to the portal"
      onRetry={() => documentsQuery.refetch()}
    >
      {documents.length === 0 ? (
        <EmptyState
          title="No documents yet"
          description="Files shared with your account will appear here, ready to preview or download."
        />
      ) : (
        <Card className="p-0">
          <RowList label="Shared documents" inset>
            {documents.map((document) => (
              <ListRow
                key={document.share_id}
                title={document.title}
                meta={
                  <>
                    {document.original_filename} · {formatBytes(document.file_size_bytes) ?? "Unknown size"} · Updated{" "}
                    {formatDateTime(document.updated_at)}
                    {document.expires_at ? (
                      <>
                        {" · "}
                        <span className="text-state-warning">Access expires {formatDateTime(document.expires_at)}</span>
                      </>
                    ) : null}
                  </>
                }
                actions={
                  <DocumentReferenceActions
                    document={document}
                    resolveView={() => resolveClientDocumentView(document)}
                  />
                }
              >
                {document.description ?? null}
              </ListRow>
            ))}
          </RowList>
        </Card>
      )}
    </PageShell>
  );
}
