"use client";

import { useRef, useState } from "react";
import { ChevronDown, Download, ExternalLink, FileText, History, Tag, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  documentDownloadUrl,
  documentVersionDownloadUrl,
  DocumentItem,
  useDocumentActions,
  useDocumentVersions,
} from "@/hooks/useDocuments";
import { formatDateTime } from "@/lib/datetime";

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function providerLabel(provider: string) {
  if (provider === "google_drive") return "Google Drive";
  return "Local backend";
}

type Props = {
  documents: DocumentItem[];
  emptyText?: string;
  onDelete?: (documentId: number) => void;
  isDeleting?: boolean;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function DocumentRow({ document, onDelete, isDeleting }: { document: DocumentItem; onDelete?: (documentId: number) => void; isDeleting?: boolean }) {
  const versionInputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [templateCategory, setTemplateCategory] = useState(document.template_category ?? "");
  const versionsQuery = useDocumentVersions(document.id, expanded);
  const { uploadDocumentVersion, updateDocumentTemplateStatus, isUploadingDocumentVersion, isUpdatingDocumentTemplate } = useDocumentActions();

  async function handleVersionFile(file: File | undefined) {
    if (!file) return;
    try {
      await uploadDocumentVersion({ documentId: document.id, file });
      if (versionInputRef.current) versionInputRef.current.value = "";
      toast.success("Document version uploaded.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to upload document version."));
    }
  }

  async function handleTemplateUpdate(nextTemplate: boolean) {
    try {
      await updateDocumentTemplateStatus({
        documentId: document.id,
        isTemplate: nextTemplate,
        templateCategory: nextTemplate ? templateCategory.trim() || null : null,
      });
      toast.success(nextTemplate ? "Document marked as template." : "Template flag removed.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to update template status."));
    }
  }

  return (
    <div className="px-4 py-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-800 bg-neutral-900">
            <FileText className="h-4 w-4 text-neutral-400" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="truncate text-sm font-semibold text-neutral-100">{document.title}</div>
              {document.is_template ? (
                <span className="inline-flex items-center gap-1 rounded-sm border border-emerald-900/60 bg-emerald-950/30 px-2 py-0.5 text-xs text-emerald-300">
                  <Tag className="h-3 w-3" />
                  {document.template_category || "Template"}
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              {document.original_filename} / {document.extension.toUpperCase()} / {formatBytes(document.file_size_bytes)} / {providerLabel(document.storage_provider)}
            </div>
            <div className="mt-1 text-xs text-neutral-600">Uploaded {formatDateTime(document.created_at)}</div>
            {document.description ? <div className="mt-2 line-clamp-2 text-sm text-neutral-400">{document.description}</div> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => setExpanded((value) => !value)}>
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
            Versions
          </Button>
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

      {expanded ? (
        <div className="mt-4 rounded-md border border-neutral-800 bg-neutral-950/50 p-3">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">Template category</label>
              <Input
                value={templateCategory}
                onChange={(event) => setTemplateCategory(event.target.value)}
                placeholder="Optional category"
                className="h-9"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleTemplateUpdate(!document.is_template)}
              disabled={isUpdatingDocumentTemplate}
            >
              <Tag className="h-4 w-4" />
              {document.is_template ? "Remove Template" : "Mark Template"}
            </Button>
            <div>
              <input
                ref={versionInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.txt,.rtf,.odt"
                onChange={(event) => void handleVersionFile(event.target.files?.[0])}
                className="hidden"
              />
              <Button type="button" variant="outline" onClick={() => versionInputRef.current?.click()} disabled={isUploadingDocumentVersion}>
                <Upload className="h-4 w-4" />
                New Version
              </Button>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
              <History className="h-3.5 w-3.5" />
              Version History
            </div>
            {versionsQuery.isLoading ? (
              <div className="rounded-md border border-neutral-800 px-3 py-3 text-sm text-neutral-500">Loading versions...</div>
            ) : versionsQuery.error ? (
              <div className="rounded-md border border-red-900/50 bg-red-950/20 px-3 py-3 text-sm text-red-300">
                {errorMessage(versionsQuery.error, "Failed to load versions.")}
              </div>
            ) : (
              <div className="divide-y divide-neutral-800 rounded-md border border-neutral-800">
                {(versionsQuery.data ?? []).map((version) => (
                  <div key={version.id} className="flex flex-col gap-2 px-3 py-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-medium text-neutral-200">Version {version.version_number}</div>
                      <div className="mt-1 text-xs text-neutral-500">
                        {version.file_name} / {formatBytes(version.size_bytes)} / {formatDateTime(version.created_at)}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => window.open(documentVersionDownloadUrl(document.id, version.id), "_blank", "noopener,noreferrer")}
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </Button>
                  </div>
                ))}
                {!versionsQuery.data?.length ? <div className="px-3 py-3 text-sm text-neutral-500">No versions recorded yet.</div> : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
        <DocumentRow key={document.id} document={document} onDelete={onDelete} isDeleting={isDeleting} />
      ))}
    </div>
  );
}
