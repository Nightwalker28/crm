"use client";

import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { downloadClientDocument, useClientDocuments, type ClientDocument } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ClientDocumentsPage() {
  const documentsQuery = useClientDocuments();
  const documents = documentsQuery.data?.results ?? [];

  async function handleDownload(document: ClientDocument) {
    try {
      await downloadClientDocument(document);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to download document.");
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 pb-4">
          <Link href="/client" className="font-lynk text-3xl text-white">Lynk</Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/client">Overview</Link>
          </Button>
        </header>

        <section className="mb-5">
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <FileText className="h-4 w-4" />
            Client documents
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-neutral-50">Shared documents</h1>
        </section>

        {documentsQuery.isLoading ? (
          <div className="rounded-md border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-500">Loading documents...</div>
        ) : documentsQuery.error ? (
          <div className="rounded-md border border-red-900/60 bg-red-950/20 p-5 text-sm text-red-200">
            {documentsQuery.error instanceof Error ? documentsQuery.error.message : "Failed to load documents."}
          </div>
        ) : documents.length === 0 ? (
          <div className="rounded-md border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-500">No documents have been shared with you yet.</div>
        ) : (
          <div className="grid gap-3">
            {documents.map((document) => (
              <div key={document.share_id} className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs uppercase text-neutral-500">{document.extension}</div>
                    <h2 className="mt-1 truncate font-semibold text-neutral-100">{document.title}</h2>
                    <p className="mt-1 text-xs text-neutral-500">
                      {document.original_filename} / {formatBytes(document.file_size_bytes)} / Updated {formatDateTime(document.updated_at)}
                    </p>
                    {document.description ? <p className="mt-2 line-clamp-2 text-sm text-neutral-400">{document.description}</p> : null}
                    {document.expires_at ? <p className="mt-2 text-xs text-amber-300">Access expires {formatDateTime(document.expires_at)}</p> : null}
                  </div>
                  <Button type="button" variant="outline" onClick={() => void handleDownload(document)}>
                    <Download className="h-4 w-4" />
                    Download
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
