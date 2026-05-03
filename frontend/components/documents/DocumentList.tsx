"use client";

import { ExternalLink, FileText, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { documentDownloadUrl, DocumentItem } from "@/hooks/useDocuments";
import { formatDateTime } from "@/lib/datetime";

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  documents: DocumentItem[];
  emptyText?: string;
  onDelete?: (documentId: number) => void;
  isDeleting?: boolean;
};

export default function DocumentList({ documents, emptyText = "No documents yet.", onDelete, isDeleting }: Props) {
  if (!documents.length) {
    return (
      <div className="rounded-md border border-dashed border-neutral-800 bg-neutral-950/40 px-4 py-8 text-center text-sm text-neutral-500">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="divide-y divide-neutral-800 rounded-md border border-neutral-800 bg-neutral-950/40">
      {documents.map((document) => (
        <div key={document.id} className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-800 bg-neutral-900">
              <FileText className="h-4 w-4 text-neutral-400" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-neutral-100">{document.title}</div>
              <div className="mt-1 text-xs text-neutral-500">
                {document.original_filename} / {document.extension.toUpperCase()} / {formatBytes(document.file_size_bytes)}
              </div>
              <div className="mt-1 text-xs text-neutral-600">Uploaded {formatDateTime(document.created_at)}</div>
              {document.description ? <div className="mt-2 line-clamp-2 text-sm text-neutral-400">{document.description}</div> : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" onClick={() => window.open(documentDownloadUrl(document.id), "_blank", "noopener,noreferrer")}>
              <ExternalLink className="h-4 w-4" />
              View
            </Button>
            {onDelete ? (
              <Button type="button" variant="outline" onClick={() => onDelete(document.id)} disabled={isDeleting}>
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
