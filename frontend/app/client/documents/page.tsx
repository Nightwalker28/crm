"use client";

import Link from "next/link";
import { FileText } from "lucide-react";

import { DocumentReferenceActions } from "@/components/documents/DocumentReferenceActions";
import { Button } from "@/components/ui/button";
import { resolveClientDocumentView, useClientDocuments } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ClientDocumentsPage() {
  const documentsQuery = useClientDocuments();
  const documents = documentsQuery.data?.results ?? [];

  return (
    <main className="min-h-screen bg-app text-copy-primary">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line-default pb-4">
          <Link href="/client" className="font-lynk text-3xl text-copy-primary">Lynk</Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/client">Overview</Link>
          </Button>
        </header>

        <section className="mb-5">
          <div className="flex items-center gap-2 text-sm text-copy-secondary">
            <FileText className="h-4 w-4" />
            Client documents
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-copy-primary">Shared documents</h1>
        </section>

        {documentsQuery.isLoading ? (
          <div className="rounded-md border border-line-default bg-surface p-8 text-center text-sm text-copy-muted">Loading documents...</div>
        ) : documentsQuery.error ? (
          <div className="rounded-md border border-state-danger/40 bg-state-danger-muted p-5 text-sm text-state-danger">
            {documentsQuery.error instanceof Error ? documentsQuery.error.message : "Failed to load documents."}
          </div>
        ) : documents.length === 0 ? (
          <div className="rounded-md border border-line-default bg-surface p-8 text-center text-sm text-copy-muted">No documents have been shared with you yet.</div>
        ) : (
          <div className="grid gap-3">
            {documents.map((document) => (
              <div key={document.share_id} className="rounded-md border border-line-default bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs uppercase text-copy-muted">{document.extension}</div>
                    <h2 className="mt-1 truncate font-semibold text-copy-primary">{document.title}</h2>
                    <p className="mt-1 text-xs text-copy-muted">
                      {document.original_filename} / {formatBytes(document.file_size_bytes)} / Updated {formatDateTime(document.updated_at)}
                    </p>
                    {document.description ? <p className="mt-2 line-clamp-2 text-sm text-copy-secondary">{document.description}</p> : null}
                    {document.expires_at ? <p className="mt-2 text-xs text-state-warning">Access expires {formatDateTime(document.expires_at)}</p> : null}
                  </div>
                  <DocumentReferenceActions
                    document={document}
                    resolveView={() => resolveClientDocumentView(document)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
