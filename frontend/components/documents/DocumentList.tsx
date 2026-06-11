"use client";

import { Fragment, useRef, useState } from "react";
import { ChevronDown, Download, ExternalLink, FileText, History, Share2, Tag, Trash2, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker, { type LinkedRecordOption } from "@/components/crm/LinkedRecordPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { SortableHead, Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import {
  documentDownloadUrl,
  documentVersionDownloadUrl,
  DocumentItem,
  type DocumentSortState,
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
  if (provider === "microsoft_onedrive") return "Microsoft OneDrive";
  return "Local backend";
}

type Props = {
  documents: DocumentItem[];
  emptyText?: string;
  onDelete?: (documentId: number) => void;
  isDeleting?: boolean;
  sort?: DocumentSortState;
  onSortChange?: (sort: DocumentSortState) => void;
  isRefreshing?: boolean;
};

type DocumentSortableColumn = NonNullable<DocumentSortState>["key"];

const SORTABLE_COLUMNS = new Set<DocumentSortableColumn>([
  "title",
  "original_filename",
  "extension",
  "file_size_bytes",
  "storage_provider",
  "is_template",
  "created_at",
  "updated_at",
]);

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function DocumentRow({ document, onDelete, isDeleting }: { document: DocumentItem; onDelete?: (documentId: number) => void; isDeleting?: boolean }) {
  const versionInputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [templateCategory, setTemplateCategory] = useState(document.template_category ?? "");
  const [shareTargetType, setShareTargetType] = useState<"contact" | "organization">("contact");
  const [shareTargetId, setShareTargetId] = useState<number | null>(null);
  const [shareTargetDisplay, setShareTargetDisplay] = useState("");
  const [shareExpiresAt, setShareExpiresAt] = useState("");
  const versionsQuery = useDocumentVersions(document.id, expanded);
  const {
    uploadDocumentVersion,
    updateDocumentTemplateStatus,
    shareDocumentWithClient,
    revokeDocumentClientShare,
    isUploadingDocumentVersion,
    isUpdatingDocumentTemplate,
    isSharingDocument,
    isRevokingDocumentShare,
  } = useDocumentActions();
  const activeShares = (document.client_shares ?? []).filter(
    (share) => !share.revoked_at && (!share.expires_at || new Date(share.expires_at) > new Date()),
  );

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

  function handleShareSelect(option: LinkedRecordOption) {
    setShareTargetId(shareTargetType === "contact" ? option.contact_id ?? option.id : option.organization_id ?? option.id);
    setShareTargetDisplay(option.label);
  }

  async function handleShareDocument() {
    if (!shareTargetId) return;
    try {
      await shareDocumentWithClient({
        documentId: document.id,
        payload: {
          contact_id: shareTargetType === "contact" ? shareTargetId : null,
          organization_id: shareTargetType === "organization" ? shareTargetId : null,
          expires_at: shareExpiresAt ? new Date(shareExpiresAt).toISOString() : null,
        },
      });
      setShareTargetId(null);
      setShareTargetDisplay("");
      setShareExpiresAt("");
      toast.success("Document shared with client portal.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to share document."));
    }
  }

  async function handleRevokeShare(shareId: number) {
    try {
      await revokeDocumentClientShare({ documentId: document.id, shareId });
      toast.success("Client document access revoked.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to revoke document access."));
    }
  }

  return (
    <Fragment>
      <TableRow>
        <TableCell>
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
              {document.description ? <div className="mt-2 line-clamp-2 text-sm text-neutral-400">{document.description}</div> : null}
            </div>
          </div>
        </TableCell>
        <TableCell><span className="text-sm text-neutral-300">{document.extension.toUpperCase()}</span></TableCell>
        <TableCell><span className="text-sm tabular-nums text-neutral-300">{formatBytes(document.file_size_bytes)}</span></TableCell>
        <TableCell><span className="text-sm text-neutral-300">{providerLabel(document.storage_provider)}</span></TableCell>
        <TableCell><span className="text-sm text-neutral-400">{formatDateTime(document.created_at)}</span></TableCell>
        <TableCell><span className="text-sm text-neutral-400">{formatDateTime(document.updated_at)}</span></TableCell>
        <TableCell>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
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
        </TableCell>
      </TableRow>

      {expanded ? (
        <TableRow>
          <TableCell colSpan={7} className="bg-neutral-950/80">
            <div className="rounded-md border border-neutral-800 bg-neutral-950/50 p-3">
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

              <div className="mt-5 rounded-md border border-neutral-800 bg-neutral-950/60 p-3">
                <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                  <Share2 className="h-3.5 w-3.5" />
                  Client Portal Access
                </div>
                <div className="grid gap-3 lg:grid-cols-[160px_minmax(220px,1fr)_220px_auto] lg:items-end">
                  <div>
                    <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">Target</label>
                    <select
                      value={shareTargetType}
                      onChange={(event) => {
                        setShareTargetType(event.target.value as "contact" | "organization");
                        setShareTargetId(null);
                        setShareTargetDisplay("");
                      }}
                      className="h-9 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100"
                    >
                      <option value="contact">Contact</option>
                      <option value="organization">Account</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">{shareTargetType === "contact" ? "Contact" : "Account"}</label>
                    <LinkedRecordPicker
                      recordType={shareTargetType}
                      valueId={shareTargetId}
                      displayValue={shareTargetDisplay}
                      onDisplayValueChange={(value) => {
                        setShareTargetDisplay(value);
                        setShareTargetId(null);
                      }}
                      onSelect={handleShareSelect}
                      onClear={() => {
                        setShareTargetId(null);
                        setShareTargetDisplay("");
                      }}
                      placeholder={shareTargetType === "contact" ? "Search contacts" : "Search accounts"}
                      queryKeyPrefix={`document-client-share-${document.id}-${shareTargetType}`}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">Expires</label>
                    <Input type="datetime-local" value={shareExpiresAt} onChange={(event) => setShareExpiresAt(event.target.value)} className="h-9" />
                  </div>
                  <Button type="button" variant="outline" onClick={() => void handleShareDocument()} disabled={!shareTargetId || isSharingDocument}>
                    <Share2 className="h-4 w-4" />
                    Share
                  </Button>
                </div>
                <div className="mt-4 divide-y divide-neutral-800 rounded-md border border-neutral-800">
                  {activeShares.length ? activeShares.map((share) => (
                    <div key={share.id} className="flex flex-col gap-2 px-3 py-3 md:flex-row md:items-center md:justify-between">
                      <div className="text-sm text-neutral-300">
                        {share.contact_id ? `Contact #${share.contact_id}` : `Account #${share.organization_id}`}
                        <span className="ml-2 text-xs text-neutral-500">
                          {share.expires_at ? `Expires ${formatDateTime(share.expires_at)}` : "No expiry"}
                        </span>
                      </div>
                      <Button type="button" variant="outline" onClick={() => void handleRevokeShare(share.id)} disabled={isRevokingDocumentShare}>
                        <XCircle className="h-4 w-4" />
                        Revoke
                      </Button>
                    </div>
                  )) : <div className="px-3 py-3 text-sm text-neutral-500">Not shared with any client portal account.</div>}
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
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
}

export default function DocumentList({ documents, emptyText = "No documents yet.", onDelete, isDeleting, sort = null, onSortChange, isRefreshing = false }: Props) {
  function toggleSort(column: DocumentSortableColumn) {
    const nextSort: DocumentSortState = sort?.key === column
      ? { key: column, direction: sort.direction === "asc" ? "desc" : "asc" }
      : { key: column, direction: "asc" };
    onSortChange?.(nextSort);
  }

  function renderHead(column: DocumentSortableColumn, label: string, className?: string) {
    return SORTABLE_COLUMNS.has(column) && onSortChange ? (
      <SortableHead className={className} sorted={sort?.key === column} direction={sort?.key === column ? sort.direction : "asc"} onClick={() => toggleSort(column)}>
        {label}
      </SortableHead>
    ) : (
      <TableHead className={className}>{label}</TableHead>
    );
  }

  if (!documents.length) {
    return (
      <div className="rounded-md border border-dashed border-neutral-800 bg-neutral-950/40 px-4 py-8 text-center text-sm text-neutral-500">
        {emptyText}
      </div>
    );
  }

  return (
    <ModuleTableShell className="min-h-[34rem] max-h-[44rem]" isRefreshing={isRefreshing}>
      <Table className="min-w-[1120px]">
        <TableHeader>
          <TableHeaderRow>
            {renderHead("title", "Document")}
            {renderHead("extension", "Type")}
            {renderHead("file_size_bytes", "Size")}
            {renderHead("storage_provider", "Storage")}
            {renderHead("created_at", "Uploaded")}
            {renderHead("updated_at", "Updated")}
            <TableHead className="text-right">Actions</TableHead>
          </TableHeaderRow>
        </TableHeader>
        <TableBody>
          {documents.map((document) => (
            <DocumentRow key={document.id} document={document} onDelete={onDelete} isDeleting={isDeleting} />
          ))}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
