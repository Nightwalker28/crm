"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Cloud,
  ExternalLink,
  FileText,
  FileUp,
  HardDrive,
  RefreshCw,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker, { type LinkedRecordOption } from "@/components/crm/LinkedRecordPicker";
import { DocumentReferenceActions } from "@/components/documents/DocumentReferenceActions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { Pill } from "@/components/ui/Pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { type DocumentItem, useDocumentActions, useDocumentStorageConnections, useDocumentUploadLimits } from "@/hooks/useDocuments";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

const ACCEPTED_DOCUMENT_TYPES = ".pdf,.doc,.docx,.txt,.rtf,.odt";
const DEFAULT_EXTENSIONS = ["pdf", "doc", "docx", "txt", "rtf", "odt"];
const LINKABLE_MODULES = [
  "sales_leads", "sales_contacts", "sales_organizations", "sales_opportunities", "sales_quotes", "sales_orders",
  "support_cases", "finance_io", "finance_pos", "catalog_products", "catalog_services",
];
const UPLOAD_CONCURRENCY = 2;

type QueueStatus = "queued" | "invalid" | "uploading" | "processing" | "complete" | "failed";
type Association = {
  module_key: string;
  entity_id: string;
  module_label: string;
  label: string;
  description?: string | null;
  href?: string;
};
type FileOverrides = {
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  associations: Association[];
};
type QueueItem = {
  id: string;
  idempotencyKey: string;
  file: File;
  status: QueueStatus;
  progress: number;
  validationError?: string;
  error?: string;
  document?: DocumentItem;
  overrides?: FileOverrides;
};

function fileExtension(file: File) {
  const parts = file.name.toLowerCase().split(".");
  return parts.length > 1 ? parts.at(-1) ?? "" : "";
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function providerLabel(provider: string) {
  if (provider === "google_drive") return "Google Drive";
  if (provider === "microsoft_onedrive") return "Microsoft OneDrive";
  return "MAAD-CRM storage";
}

function ProviderIcon({ provider }: { provider: string }) {
  return provider === "local" ? <HardDrive className="h-4 w-4" aria-hidden="true" /> : <Cloud className="h-4 w-4" aria-hidden="true" />;
}

function statusLabel(status: QueueStatus) {
  if (status === "invalid") return "Needs attention";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function StatusPill({ status }: { status: QueueStatus }) {
  const failed = status === "failed" || status === "invalid";
  const complete = status === "complete";
  return (
    <Pill
      bg={complete ? "bg-state-success-muted" : failed ? "bg-state-danger-muted" : "bg-surface-muted"}
      text={complete ? "text-state-success" : failed ? "text-state-danger" : "text-copy-secondary"}
      border="border-line-default"
    >
      {statusLabel(status)}
    </Pill>
  );
}

function AssociationPicker({
  value,
  onChange,
  disabled = false,
  queryKeyPrefix,
}: {
  value: Association[];
  onChange: (value: Association[]) => void;
  disabled?: boolean;
  queryKeyPrefix: string;
}) {
  const [search, setSearch] = useState("");

  function add(option: LinkedRecordOption) {
    if (!option.module_key || !option.entity_id) return;
    if (value.some((item) => item.module_key === option.module_key && item.entity_id === option.entity_id)) {
      setSearch("");
      return;
    }
    onChange([...value, {
      module_key: option.module_key,
      entity_id: option.entity_id,
      module_label: option.module_label || option.module_key.replaceAll("_", " "),
      label: option.label,
      description: option.description,
      href: option.href,
    }]);
    setSearch("");
  }

  return (
    <div className="space-y-3">
      <LinkedRecordPicker
        recordType="global"
        valueId={null}
        displayValue={search}
        onDisplayValueChange={setSearch}
        onSelect={add}
        onClear={() => setSearch("")}
        placeholder="Search records by module or name"
        queryKeyPrefix={queryKeyPrefix}
        allowedModuleKeys={LINKABLE_MODULES}
        disabled={disabled}
      />
      {value.length ? (
        <div className="grid gap-2" aria-label="Selected CRM records">
          {value.map((item) => (
            <div key={`${item.module_key}:${item.entity_id}`} className="flex items-start justify-between gap-2 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-2">
              <div className="min-w-0 text-sm">
                <div className="truncate font-medium text-copy-primary">{item.module_label} · {item.label}</div>
                {item.description ? <div className="truncate text-xs text-copy-muted">{item.description}</div> : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                disabled={disabled}
                onClick={() => onChange(value.filter((entry) => entry.module_key !== item.module_key || entry.entity_id !== item.entity_id))}
                aria-label={`Remove ${item.module_label} ${item.label}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TagsInput({ value, onChange, disabled = false, inputId }: { value: string[]; onChange: (value: string[]) => void; disabled?: boolean; inputId: string }) {
  const [draft, setDraft] = useState("");

  function addTag() {
    const tag = draft.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!tag || value.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, tag].slice(0, 20));
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" && event.key !== ",") return;
    event.preventDefault();
    addTag();
  }

  return (
    <div className="space-y-2">
      {value.length ? <div className="flex flex-wrap gap-2" aria-label="Document tags">{value.map((tag) => (
        <span key={tag.toLocaleLowerCase()} className="inline-flex items-center gap-1 rounded-full border border-line-default bg-surface-muted px-2.5 py-1 text-xs text-copy-primary">
          {tag}
          <button type="button" disabled={disabled} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onClick={() => onChange(value.filter((item) => item !== tag))} aria-label={`Remove ${tag} tag`}><X className="h-3 w-3" /></button>
        </span>
      ))}</div> : null}
      <Input id={inputId} value={draft} disabled={disabled || value.length >= 20} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} onBlur={addTag} placeholder="Type a tag and press Enter" />
    </div>
  );
}

export default function DocumentUploadFormPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectionStatusRef = useRef<HTMLDivElement>(null);
  const connectionsQuery = useDocumentStorageConnections();
  const limitsQuery = useDocumentUploadLimits();
  const { uploadDocument, isUploadingDocument } = useDocumentActions();
  const [storageProvider, setStorageProvider] = useState("local");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [associations, setAssociations] = useState<Association[]>([]);
  const [sharedDirty, setSharedDirty] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const allowedExtensions = limitsQuery.data?.allowed_extensions ?? DEFAULT_EXTENSIONS;
  const maxBytes = limitsQuery.data?.max_upload_bytes;
  const selectedConnection = connectionsQuery.data?.find((connection) => connection.provider === storageProvider && connection.status === "connected");
  const googleDriveConnected = connectionsQuery.data?.some((connection) => connection.provider === "google_drive" && connection.status === "connected") ?? false;
  const oneDriveConnected = connectionsQuery.data?.some((connection) => connection.provider === "microsoft_onedrive" && connection.status === "connected") ?? false;
  const active = queue.some((item) => item.status === "uploading" || item.status === "processing");
  const isBusy = active || isUploadingDocument;
  const destinationLocked = queue.some((item) => !["queued", "invalid"].includes(item.status));
  const pending = queue.filter((item) => item.status === "queued");
  const failed = queue.filter((item) => item.status === "failed");
  const complete = queue.filter((item) => item.status === "complete");
  const uploadableBytes = queue.filter((item) => item.status === "queued" || item.status === "failed").reduce((total, item) => total + item.file.size, 0);
  const dirty = queue.some((item) => item.status !== "complete") || sharedDirty;

  useUnsavedChangesGuard(dirty, isBusy);

  function touchShared() {
    setSharedDirty(true);
  }

  function addFiles(files: File[]) {
    const items = files.map((file): QueueItem => {
      let validationError: string | undefined;
      if (file.size === 0) validationError = "This file is empty.";
      else if (!allowedExtensions.includes(fileExtension(file))) validationError = "This file type is not supported.";
      else if (maxBytes && file.size > maxBytes) validationError = `This file exceeds the ${formatBytes(maxBytes)} limit.`;
      return {
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        file,
        status: validationError ? "invalid" : "queued",
        progress: 0,
        validationError,
      };
    });
    if (!items.length) return;
    setQueue((current) => [...current, ...items]);
    window.setTimeout(() => selectionStatusRef.current?.focus(), 0);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  function updateQueueItem(id: string, update: Partial<QueueItem>) {
    setQueue((current) => current.map((item) => item.id === id ? { ...item, ...update } : item));
  }

  function enableOverrides(item: QueueItem) {
    updateQueueItem(item.id, {
      overrides: {
        displayName: item.file.name,
        description,
        category,
        tags: [...tags],
        associations: [...associations],
      },
    });
  }

  async function uploadOne(target: QueueItem) {
    updateQueueItem(target.id, { status: "uploading", progress: 35, error: undefined });
    const values = target.overrides ?? {
      displayName: target.file.name,
      description,
      category,
      tags,
      associations,
    };
    try {
      const document = await uploadDocument({
        file: target.file,
        display_name: values.displayName.trim() || target.file.name,
        description: values.description.trim() || undefined,
        category: values.category.trim() || undefined,
        tags: values.tags,
        associations: values.associations.map(({ module_key, entity_id }) => ({ module_key, entity_id })),
        idempotency_key: target.idempotencyKey,
        storage_provider: storageProvider,
      });
      updateQueueItem(target.id, { status: "processing", progress: 80 });
      const failedLinks = document.association_failures?.length ?? 0;
      updateQueueItem(target.id, {
        status: "complete",
        progress: 100,
        document,
        error: failedLinks ? `Uploaded, but ${failedLinks} ${failedLinks === 1 ? "link" : "links"} could not be created.` : undefined,
      });
      return true;
    } catch {
      updateQueueItem(target.id, { status: "failed", progress: 0, error: "Upload could not be completed. Check the destination and try again." });
      return false;
    }
  }

  async function uploadItems(statuses: QueueStatus[]) {
    const targets = queue.filter((item) => statuses.includes(item.status));
    let nextIndex = 0;
    let failures = 0;
    async function worker() {
      while (nextIndex < targets.length) {
        const target = targets[nextIndex++];
        if (!await uploadOne(target)) failures += 1;
      }
    }
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, targets.length) }, () => worker()));
    if (failures) toast.error(`${failures} ${failures === 1 ? "file" : "files"} could not be uploaded.`);
    else {
      setSharedDirty(false);
      toast.success(`${targets.length} ${targets.length === 1 ? "file" : "files"} uploaded.`);
    }
  }

  const footerSummary = useMemo(() => {
    if (complete.length && failed.length) return `${complete.length} complete · ${failed.length} failed`;
    if (complete.length && !pending.length) return `${complete.length} ${complete.length === 1 ? "file" : "files"} complete`;
    if (pending.length || failed.length) return `${pending.length + failed.length} files ready · ${formatBytes(uploadableBytes)}`;
    return "No files ready";
  }, [complete.length, failed.length, pending.length, uploadableBytes]);

  const dropZone = (
    <div
      role="button"
      tabIndex={0}
      aria-label={queue.length ? "Add more document files" : "Choose document files or drag and drop them here"}
      className={`${queue.length ? "flex min-h-16 items-center justify-between gap-4 px-4 py-3 text-left" : "flex min-h-44 flex-col items-center justify-center px-6 py-6 text-center"} rounded-[var(--radius-card)] border border-dashed ${isDragging ? "border-primary bg-action-primary-muted" : "border-line-control bg-surface-muted"} cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus`}
      onClick={() => fileInputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          fileInputRef.current?.click();
        }
      }}
      onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <div className={queue.length ? "flex min-w-0 items-center gap-3" : ""}>
        <FileUp className={`${queue.length ? "h-5 w-5" : "mx-auto h-8 w-8"} text-copy-muted`} aria-hidden="true" />
        <div>
          <p className={`${queue.length ? "text-sm" : "mt-3"} font-medium text-copy-primary`}>{queue.length ? "Add more files" : "Drag and drop files here"}</p>
          <p className="mt-1 text-xs text-copy-muted">{allowedExtensions.map((value) => value.toUpperCase()).join(", ")}{maxBytes ? ` · up to ${formatBytes(maxBytes)} each` : ""}</p>
        </div>
      </div>
      <span className={queue.length ? "text-sm font-medium text-action-primary" : "mt-4 inline-flex h-[38px] items-center rounded-[var(--radius-control)] border border-line-default bg-surface px-4 text-sm font-semibold text-copy-secondary"}>Choose files</span>
      <input ref={fileInputRef} className="sr-only" type="file" multiple accept={ACCEPTED_DOCUMENT_TYPES} onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    </div>
  );

  return (
    <PageShell
      title="Upload documents"
      description="Upload a batch to CRM storage or a connected cloud account and link it to the records that use it."
      actions={<Button asChild variant="ghost" size="sm"><Link href="/dashboard/documents"><ArrowLeft />Back to documents</Link></Button>}
    >
      <Card className="mx-auto w-full max-w-6xl">
        <section>
          <div className="border-b border-line-subtle px-4 py-4 md:px-5">
            <h2 className="font-semibold text-copy-primary">Choose files</h2>
            <p className="mt-1 text-sm text-copy-muted">Add one document or a batch. You can review every file before uploading.</p>
          </div>
          <div className="p-4 md:p-5">
            {dropZone}
            <div ref={selectionStatusRef} tabIndex={-1} className="sr-only" aria-live="polite">{queue.length ? `${queue.length} files in the upload queue.` : "No files selected."}</div>

          {queue.length ? (
            <div className="mt-4 overflow-hidden rounded-[var(--radius-card)] border border-line-default" aria-label="Upload queue">
              <div className="hidden grid-cols-[minmax(0,1fr)_8rem_5.5rem_7rem] gap-3 border-b border-line-default bg-surface-muted px-4 py-2 text-xs font-medium text-copy-label md:grid">
                <span>File</span><span>Destination</span><span>Links</span><span className="text-right">Status</span>
              </div>
              <div className="divide-y divide-line-default">
                {queue.map((item) => {
                  const canEdit = item.status === "queued" || item.status === "failed" || item.status === "invalid";
                  const itemAssociations = item.overrides?.associations ?? associations;
                  const resolvedProvider = item.document?.storage_provider ?? storageProvider;
                  return (
                    <div key={item.id} className="px-4 py-3">
                      <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1fr)_8rem_5.5rem_7rem]">
                        <div className="flex min-w-0 items-start gap-3">
                          {item.status === "complete" ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-state-success" aria-hidden="true" /> : <FileText className="mt-0.5 h-5 w-5 shrink-0 text-copy-muted" aria-hidden="true" />}
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-copy-primary">{item.overrides?.displayName || item.file.name}</div>
                            <div className="mt-0.5 text-xs text-copy-muted">{formatBytes(item.file.size)} · {fileExtension(item.file).toUpperCase() || "FILE"}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-copy-secondary"><ProviderIcon provider={resolvedProvider} />{providerLabel(resolvedProvider)}</div>
                        <div className="text-xs text-copy-secondary">{itemAssociations.length} {itemAssociations.length === 1 ? "record" : "records"}</div>
                        <div className="flex justify-start md:justify-end"><StatusPill status={item.status} /></div>
                      </div>

                      {item.status === "uploading" ? <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-label={`Uploading ${item.file.name}`} aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-primary motion-safe:transition-[width] motion-reduce:transition-none" style={{ width: `${item.progress}%` }} /></div> : null}
                      {item.validationError ? <p role="alert" className="mt-2 text-sm text-state-danger">{item.validationError}</p> : null}
                      {item.error ? <p role="alert" className={`mt-2 text-sm ${item.status === "complete" ? "text-state-warning" : "text-state-danger"}`}>{item.error}</p> : null}

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {item.status === "queued" || item.status === "invalid" ? <Button variant="ghost" size="sm" onClick={() => setQueue((current) => current.filter((entry) => entry.id !== item.id))}><X />Remove</Button> : null}
                        {item.status === "failed" ? <Button variant="outline" size="sm" onClick={() => void uploadItemsForRow(item)} disabled={isBusy}><RotateCcw />Retry</Button> : null}
                        {item.document ? <DocumentReferenceActions document={item.document} showCopy /> : null}
                        {item.document && itemAssociations[0]?.href ? <Button asChild variant="outline" size="sm"><Link href={itemAssociations[0].href}>Open related record</Link></Button> : null}
                        {canEdit && item.status !== "invalid" ? (
                          <details className="group w-full">
                            <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-[var(--radius-control)] px-2 py-1 text-xs font-medium text-action-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                              {item.overrides ? "Edit file overrides" : "Add file overrides"}<ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                            </summary>
                            <div className="mt-3 rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-4">
                              {!item.overrides ? <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-copy-secondary">This file currently inherits shared metadata and associations.</p><Button type="button" variant="outline" size="sm" onClick={() => enableOverrides(item)}>Customize this file</Button></div> : (
                                <div className="grid gap-4">
                                  <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs font-medium text-copy-label">Per-file override</p><Button type="button" variant="ghost" size="sm" onClick={() => updateQueueItem(item.id, { overrides: undefined })}>Use shared values</Button></div>
                                  <div className="grid gap-4 sm:grid-cols-2">
                                    <Field><FieldLabel htmlFor={`title-${item.id}`}>Display title</FieldLabel><Input id={`title-${item.id}`} value={item.overrides.displayName} onChange={(event) => updateQueueItem(item.id, { overrides: { ...item.overrides!, displayName: event.target.value } })} /></Field>
                                    <Field><FieldLabel htmlFor={`category-${item.id}`}>Category</FieldLabel><Input id={`category-${item.id}`} value={item.overrides.category} onChange={(event) => updateQueueItem(item.id, { overrides: { ...item.overrides!, category: event.target.value } })} /></Field>
                                  </div>
                                  <Field><FieldLabel htmlFor={`tags-${item.id}`}>Tags</FieldLabel><TagsInput inputId={`tags-${item.id}`} value={item.overrides.tags} onChange={(value) => updateQueueItem(item.id, { overrides: { ...item.overrides!, tags: value } })} /></Field>
                                  <Field><FieldLabel htmlFor={`description-${item.id}`}>Description</FieldLabel><Textarea id={`description-${item.id}`} rows={2} value={item.overrides.description} onChange={(event) => updateQueueItem(item.id, { overrides: { ...item.overrides!, description: event.target.value } })} /></Field>
                                  <Field><FieldLabel>CRM associations</FieldLabel><AssociationPicker value={item.overrides.associations} onChange={(value) => updateQueueItem(item.id, { overrides: { ...item.overrides!, associations: value } })} queryKeyPrefix={`document-file-${item.id}-associations`} /></Field>
                                </div>
                              )}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            ) : null}
          </div>
        </section>

        <section className="border-t border-line-subtle">
          <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] md:items-start md:p-5">
            <div>
              <h2 className="font-semibold text-copy-primary">Upload destination</h2>
              <p className="mt-1 text-sm text-copy-muted">Files stay private and require authenticated document access.</p>
              <div className="mt-3 flex items-start gap-3 text-sm">
                <ProviderIcon provider={storageProvider} />
                <div className="min-w-0">
                  <div className="font-medium text-copy-primary">{providerLabel(storageProvider)}</div>
                  <div className="mt-0.5 text-xs text-copy-muted">
                    {storageProvider === "local" ? "Secure tenant document storage" : selectedConnection ? `${selectedConnection.account_email || "Connected account"} · ${selectedConnection.provider_root_name || "Provider app folder"}` : "No connected account available"}
                  </div>
                </div>
              </div>
            </div>
            <Field>
              <FieldLabel>Storage destination</FieldLabel>
              <Select value={storageProvider} onValueChange={(value) => { setStorageProvider(value); touchShared(); }} disabled={destinationLocked}>
                <SelectTrigger aria-label="Storage destination"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">MAAD-CRM storage</SelectItem>
                  <SelectItem value="google_drive" disabled={!googleDriveConnected}>Google Drive</SelectItem>
                  <SelectItem value="microsoft_onedrive" disabled={!oneDriveConnected}>Microsoft OneDrive</SelectItem>
                </SelectContent>
              </Select>
              {destinationLocked ? <FieldDescription>Finish or clear uploaded and failed rows before changing destination.</FieldDescription> : null}
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle px-4 py-3 text-xs md:px-5">
            <Link className="text-action-primary hover:underline" href="/dashboard/settings/integrations">Manage cloud connections <ExternalLink className="inline h-3 w-3" /></Link>
            {connectionsQuery.isError ? <Button variant="ghost" size="sm" onClick={() => void connectionsQuery.refetch()}><RefreshCw />Retry connection check</Button> : null}
          </div>
          {connectionsQuery.isError ? <p role="alert" className="border-t border-line-subtle px-4 py-3 text-xs text-state-warning md:px-5">Cloud connections could not be checked. Local storage remains available.</p> : null}
        </section>

        <section className="border-t border-line-subtle">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus md:px-5">
              <div>
                <h2 className="font-semibold text-copy-primary">Details and CRM links <span className="font-normal text-copy-muted">(optional)</span></h2>
                <p className="mt-1 text-sm text-copy-muted">Apply the same category, tags, description, and related records to every pending file.</p>
              </div>
              <ChevronDown className="h-5 w-5 shrink-0 text-copy-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
            </summary>
            <div className="border-t border-line-subtle p-4 md:p-5">
              <div className="grid max-w-3xl gap-5">
                <Field><FieldLabel>CRM associations</FieldLabel><FieldDescription className="mb-2">Link these files to the records that use them.</FieldDescription><AssociationPicker value={associations} onChange={(value) => { setAssociations(value); touchShared(); }} disabled={isBusy} queryKeyPrefix="document-upload-associations" /></Field>
                <Field><FieldLabel htmlFor="document-category">Category</FieldLabel><Input id="document-category" value={category} disabled={isBusy} onChange={(event) => { setCategory(event.target.value); touchShared(); }} placeholder="Contract, proposal, specification…" /></Field>
                <Field><FieldLabel htmlFor="document-tags">Tags</FieldLabel><TagsInput inputId="document-tags" value={tags} disabled={isBusy} onChange={(value) => { setTags(value); touchShared(); }} /></Field>
                <Field><FieldLabel htmlFor="document-description">Description</FieldLabel><Textarea id="document-description" value={description} disabled={isBusy} onChange={(event) => { setDescription(event.target.value); touchShared(); }} rows={3} placeholder="Optional description for this batch" /></Field>
              </div>
            </div>
          </details>
        </section>

        <div className="border-t border-line-subtle p-4 md:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" aria-live="polite">
            <span className="text-sm text-copy-muted">{footerSummary}</span>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {complete.length ? <Button variant="ghost" onClick={() => setQueue((current) => current.filter((item) => item.status !== "complete"))} disabled={isBusy}>Clear completed</Button> : null}
              <Button asChild variant="outline"><Link href="/dashboard/documents">{queue.some((item) => item.status !== "complete") ? "Cancel" : "Back to documents"}</Link></Button>
              {failed.length ? <Button variant="outline" onClick={() => void uploadItems(["failed"])} disabled={isBusy}><RotateCcw />Retry failed</Button> : null}
              {pending.length ? <Button onClick={() => void uploadItems(["queued"])} disabled={isBusy}><Upload />{isBusy ? "Uploading…" : "Upload files"}</Button> : null}
            </div>
          </div>
        </div>
      </Card>
    </PageShell>
  );

  async function uploadItemsForRow(item: QueueItem) {
    await uploadOne(item);
  }
}
