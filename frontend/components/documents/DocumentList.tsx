"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, FileText, History, Share2, Tag, Trash2, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker, { type LinkedRecordOption } from "@/components/crm/LinkedRecordPicker";
import { DocumentReferenceActions } from "@/components/documents/DocumentReferenceActions";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/Pill";
import { RecordTable, type RecordTableColumn } from "@/components/ui/RecordTable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/hooks/useConfirm";
import {
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
  onDelete?: (document: DocumentItem) => void;
  canEdit?: boolean;
  isDeleting?: boolean;
  sort?: DocumentSortState;
  onSortChange?: (sort: DocumentSortState) => void;
  isLoading?: boolean;
  isRefreshing?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  highlightedDocumentId?: number | null;
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

function errorMessage(_error: unknown, fallback: string) {
  return fallback;
}

function DocumentTitleCell({ document, highlighted }: { document: DocumentItem; highlighted: boolean }) {
  const cellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!highlighted) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cellRef.current?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  }, [highlighted]);

  return (
    <div ref={cellRef} className="flex min-w-0 items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line-default bg-surface-muted">
        <FileText className="h-4 w-4 text-copy-secondary" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate text-sm font-semibold text-copy-primary">{document.title}</div>
          {document.is_template ? (
            <Pill bg="bg-state-success-muted" text="text-state-success" border="border-state-success/40">
              <Tag className="h-3 w-3" />
              {document.template_category || "Template"}
            </Pill>
          ) : null}
        </div>
        <div className="mt-1 text-xs text-copy-muted">
          {document.original_filename} / {document.extension.toUpperCase()} / {formatBytes(document.file_size_bytes)} / {providerLabel(document.storage_provider)}
        </div>
        {document.category || document.tags.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {document.category ? <Pill>{document.category}</Pill> : null}
            {document.tags.slice(0, 3).map((tag) => <Pill key={tag.toLocaleLowerCase()}>{tag}</Pill>)}
            {document.tags.length > 3 ? <span className="self-center text-xs text-copy-muted">+{document.tags.length - 3}</span> : null}
          </div>
        ) : null}
        {document.description ? <div className="mt-2 line-clamp-2 text-sm text-copy-secondary">{document.description}</div> : null}
      </div>
    </div>
  );
}

function DocumentDetailPanel({ document, canEdit }: { document: DocumentItem; canEdit: boolean }) {
  const { confirm } = useConfirm();
  const versionInputRef = useRef<HTMLInputElement>(null);
  const [templateCategory, setTemplateCategory] = useState(document.template_category ?? "");
  const [shareTargetType, setShareTargetType] = useState<"contact" | "organization">("contact");
  const [shareTargetId, setShareTargetId] = useState<number | null>(null);
  const [shareTargetDisplay, setShareTargetDisplay] = useState("");
  const [shareExpiresAt, setShareExpiresAt] = useState("");
  const versionsQuery = useDocumentVersions(document.id, true);
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
    const confirmed = await confirm({
      title: "Share document with client?",
      description: `"${document.title}" will become available to the selected ${shareTargetType === "contact" ? "contact" : "account"} through authenticated client portal access${shareExpiresAt ? " until the selected expiry" : " without an expiry"}.`,
      confirmLabel: "Share document",
    });
    if (!confirmed) return;
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
    const confirmed = await confirm({
      title: "Revoke client document access?",
      description: `"${document.title}" will no longer be available through this client portal share. The document remains in the tenant library.`,
      confirmLabel: "Revoke access",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      await revokeDocumentClientShare({ documentId: document.id, shareId });
      toast.success("Client document access revoked.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to revoke document access."));
    }
  }

  return (
    <div className="rounded-[var(--radius-control)] border border-line-default bg-surface p-3">
      {canEdit ? (
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
          <Field>
            <FieldLabel htmlFor={`document-template-category-${document.id}`}>Template category</FieldLabel>
            <Input
              id={`document-template-category-${document.id}`}
              value={templateCategory}
              onChange={(event) => setTemplateCategory(event.target.value)}
              placeholder="Optional category"
            />
          </Field>
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
            <Input
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
      ) : null}

      <div className="mt-5 rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-3">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium text-copy-label">
          <Share2 className="h-3.5 w-3.5" />
          Client Portal Access
        </div>
        {canEdit ? (
          <div className="grid gap-3 lg:grid-cols-[160px_minmax(220px,1fr)_220px_auto] lg:items-end">
            <Field>
              <FieldLabel>Target</FieldLabel>
              <Select
                value={shareTargetType}
                onValueChange={(value) => {
                  setShareTargetType(value as "contact" | "organization");
                  setShareTargetId(null);
                  setShareTargetDisplay("");
                }}
              >
                <SelectTrigger aria-label="Client share target"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contact">Contact</SelectItem>
                  <SelectItem value="organization">Account</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`document-share-record-${document.id}`}>
                {shareTargetType === "contact" ? "Contact" : "Account"}
              </FieldLabel>
              <LinkedRecordPicker
                inputId={`document-share-record-${document.id}`}
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
            </Field>
            <Field>
              <FieldLabel htmlFor={`document-share-expires-${document.id}`}>Expires</FieldLabel>
              <Input id={`document-share-expires-${document.id}`} type="datetime-local" value={shareExpiresAt} onChange={(event) => setShareExpiresAt(event.target.value)} />
            </Field>
            <Button type="button" variant="outline" onClick={() => void handleShareDocument()} disabled={!shareTargetId || isSharingDocument}>
              <Share2 className="h-4 w-4" />
              Share
            </Button>
          </div>
        ) : null}
        <div className="mt-4 divide-y divide-line-subtle rounded-[var(--radius-control)] border border-line-default bg-surface">
          {activeShares.length ? activeShares.map((share) => (
            <div key={share.id} className="flex flex-col gap-2 px-3 py-3 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-copy-secondary">
                {share.contact_id ? `Contact #${share.contact_id}` : `Account #${share.organization_id}`}
                <span className="ml-2 text-xs text-copy-muted">
                  {share.expires_at ? `Expires ${formatDateTime(share.expires_at)}` : "No expiry"}
                </span>
              </div>
              {canEdit ? (
                <Button type="button" variant="dangerGhost" onClick={() => void handleRevokeShare(share.id)} disabled={isRevokingDocumentShare}>
                  <XCircle className="h-4 w-4" />
                  Revoke
                </Button>
              ) : null}
            </div>
          )) : <div className="px-3 py-3 text-sm text-copy-muted">Not shared with any client portal account.</div>}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-copy-label">
          <History className="h-3.5 w-3.5" />
          Version History
        </div>
        {versionsQuery.isLoading ? (
          <div className="rounded-[var(--radius-control)] border border-line-default px-3 py-3 text-sm text-copy-muted" aria-busy="true">Loading versions...</div>
        ) : versionsQuery.error ? (
          <div role="alert" className="rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-3 py-3 text-sm text-copy-secondary">
            <p>Document versions could not be loaded.</p>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void versionsQuery.refetch()}><History />Try again</Button>
          </div>
        ) : (
          <div className="divide-y divide-line-subtle rounded-[var(--radius-control)] border border-line-default bg-surface">
            {(versionsQuery.data ?? []).map((version) => (
              <div key={version.id} className="flex flex-col gap-2 px-3 py-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-medium text-copy-primary">Version {version.version_number}</div>
                  <div className="mt-1 text-xs text-copy-muted">
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
            {!versionsQuery.data?.length ? <div className="px-3 py-3 text-sm text-copy-muted">No versions recorded yet.</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DocumentList({
  documents,
  emptyText = "No documents yet.",
  onDelete,
  canEdit = true,
  isDeleting,
  sort = null,
  onSortChange,
  isLoading = false,
  isRefreshing = false,
  hasError = false,
  onRetry,
  highlightedDocumentId = null,
}: Props) {
  const [expandedIds, setExpandedIds] = useState<number[]>([]);

  const columns = useMemo<RecordTableColumn<DocumentItem>[]>(() => {
    function head(key: DocumentSortableColumn, label: string, size?: "sm" | "md" | "lg"): RecordTableColumn<DocumentItem> {
      return {
        key,
        label,
        size,
        sortable: SORTABLE_COLUMNS.has(key) && Boolean(onSortChange),
        render: () => null,
      };
    }

    return [
      {
        ...head("title", "Document", "lg"),
        render: (document) => <DocumentTitleCell document={document} highlighted={document.id === highlightedDocumentId} />,
      },
      {
        ...head("extension", "Type", "sm"),
        render: (document) => <span className="text-sm text-copy-secondary">{document.extension.toUpperCase()}</span>,
      },
      {
        ...head("file_size_bytes", "Size", "sm"),
        render: (document) => <span className="text-sm tabular-nums text-copy-secondary">{formatBytes(document.file_size_bytes)}</span>,
      },
      {
        ...head("storage_provider", "Storage"),
        render: (document) => <span className="text-sm text-copy-secondary">{providerLabel(document.storage_provider)}</span>,
      },
      {
        ...head("created_at", "Uploaded"),
        render: (document) => <span className="text-sm text-copy-muted">{formatDateTime(document.created_at)}</span>,
      },
      {
        ...head("updated_at", "Updated"),
        render: (document) => <span className="text-sm text-copy-muted">{formatDateTime(document.updated_at)}</span>,
      },
    ];
  }, [highlightedDocumentId, onSortChange]);

  return (
    <RecordTable
      label="Documents"
      columns={columns}
      rows={documents}
      rowKey={(document) => document.id}
      isRowHighlighted={(document) => document.id === highlightedDocumentId}
      rowActions={(document) => (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            aria-expanded={expandedIds.includes(document.id)}
            onClick={() =>
              setExpandedIds((current) =>
                current.includes(document.id) ? current.filter((id) => id !== document.id) : [...current, document.id],
              )
            }
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${expandedIds.includes(document.id) ? "rotate-180" : ""}`} />
            Versions
          </Button>
          <DocumentReferenceActions document={document} />
          {onDelete ? (
            <Button type="button" variant="dangerGhost" onClick={() => onDelete(document)} disabled={isDeleting}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          ) : null}
        </div>
      )}
      rowDetail={(document) =>
        expandedIds.includes(document.id) ? <DocumentDetailPanel document={document} canEdit={canEdit} /> : null
      }
      sort={sort ? { column: sort.key, direction: sort.direction } : null}
      onSortChange={
        onSortChange
          ? (next) => onSortChange({ key: next.column as DocumentSortableColumn, direction: next.direction })
          : undefined
      }
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      hasError={hasError}
      onRetry={onRetry}
      emptyState={{ icon: FileText, title: "No documents found", description: emptyText }}
    />
  );
}
