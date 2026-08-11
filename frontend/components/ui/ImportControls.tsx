"use client";

import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { MenuItem } from "@headlessui/react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { DataTransferJobProgress } from "@/components/ui/DataTransferJobProgress";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  type DuplicateMode,
  type ImportExecutionResponse,
  type ImportPreviewResponse,
  type ImportSummaryResponse,
} from "@/components/ui/importExportUtils";
import { useConfirm } from "@/hooks/useConfirm";
import { useJobPoller, type DataTransferJobResponse } from "@/hooks/useJobPoller";
import { apiFetch } from "@/lib/api";

type Props = {
  importEndpoint: string;
  importLabel: string;
  fileAccept: string;
  disabled?: boolean;
  onImportSuccess?: () => void;
};

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function duplicateModeLabel(mode: DuplicateMode) {
  if (mode === "overwrite") return "Overwrite duplicates";
  if (mode === "merge") return "Merge duplicates";
  return "Skip duplicates";
}

export function ImportControls({ importEndpoint, importLabel, fileAccept, disabled, onImportSuccess }: Props) {
  const { confirm } = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>("skip");
  const [importSummary, setImportSummary] = useState<ImportSummaryResponse | null>(null);
  const [importJobId, setImportJobId] = useState<number | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importJob = useJobPoller<ImportSummaryResponse>(
    importJobId,
    (job: DataTransferJobResponse<ImportSummaryResponse>) => {
      if (job.summary) setImportSummary(job.summary);
      onImportSuccess?.();
    },
    { failureMessage: "The background import could not be completed." },
  );

  const previewEndpoint = `${importEndpoint}/preview`;
  const missingRequiredTargets = useMemo(() => {
    if (!preview) return [];
    return preview.required_headers.filter((target) => !mapping[target]);
  }, [mapping, preview]);

  async function loadPreview(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    const response = await apiFetch(previewEndpoint, {
      method: "POST",
      body: formData,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error("The import preview could not be loaded.");

    const nextPreview = body as ImportPreviewResponse;
    setPreview(nextPreview);
    setMapping(nextPreview.suggested_mapping ?? {});
    setDuplicateMode(nextPreview.default_duplicate_mode ?? "skip");
    setImportSummary(null);
    setImportError(null);
  }

  function resetImportState() {
    setIsImportDialogOpen(false);
    setSelectedFile(null);
    setPreview(null);
    setMapping({});
    setImportSummary(null);
    setImportJobId(null);
    setImportError(null);
    importJob.reset();
    if (inputRef.current) inputRef.current.value = "";
  }

  async function selectImportFile(file: File) {
    if (!file.size || file.size > MAX_IMPORT_BYTES) {
      toast.error("Choose a non-empty CSV file up to 50 MB.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setIsPreviewing(true);
    try {
      setSelectedFile(file);
      await loadPreview(file);
      setIsImportDialogOpen(true);
    } catch {
      setSelectedFile(null);
      toast.error("The import preview could not be loaded. Check the file and try again.");
      if (inputRef.current) inputRef.current.value = "";
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleImportSubmit() {
    if (!selectedFile || !preview) return;
    if (missingRequiredTargets.length) {
      setImportError(`Map the required fields before importing: ${missingRequiredTargets.join(", ")}.`);
      return;
    }

    if (duplicateMode !== "skip") {
      const confirmed = await confirm({
        title: `${duplicateModeLabel(duplicateMode)}?`,
        description:
          duplicateMode === "overwrite"
            ? "Matching records may have their existing values replaced by values from this file."
            : "Values from this file may be combined with matching existing records.",
        confirmLabel: duplicateMode === "overwrite" ? "Run overwrite import" : "Run merge import",
        variant: "destructive",
      });
      if (!confirmed) return;
    }

    setIsImporting(true);
    setImportError(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("mapping_json", JSON.stringify(mapping));
      const params = new URLSearchParams({ duplicate_mode: duplicateMode });
      const response = await apiFetch(`${importEndpoint}?${params.toString()}`, {
        method: "POST",
        body: formData,
      });
      const body = (await response.json().catch(() => null)) as ImportExecutionResponse | null;
      if (!response.ok) throw new Error("The import could not be started.");

      if (body?.mode === "background" && body.job_id) {
        setImportJobId(body.job_id);
        importJob.start(body.job_status || "queued", "Import queued.");
        setImportSummary(null);
        toast.success("Import queued. You can monitor its progress here.");
        return;
      }

      const summary = body?.summary;
      if (summary) {
        setImportSummary(summary);
        setImportJobId(null);
        importJob.reset();
        toast.success("Import completed.");
        onImportSuccess?.();
      }
    } catch {
      setImportError("The import could not be started. Review the mapping and try again.");
    } finally {
      setIsImporting(false);
    }
  }

  const menuDisabled = disabled || isImporting || isPreviewing;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={fileAccept}
        className="sr-only"
        aria-label={importLabel}
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void selectImportFile(file);
        }}
      />

      <MenuItem>
        {({ focus }) => (
          <button
            type="button"
            disabled={menuDisabled}
            onClick={() => inputRef.current?.click()}
            className={`flex w-full items-center gap-2 rounded-[var(--radius-control-sm)] px-3 py-2 text-sm text-copy-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:text-copy-disabled ${
 focus ? "bg-action-primary-muted text-copy-primary" : ""
            }`}
          >
            <Upload aria-hidden="true" />
            {isPreviewing ? "Reading file..." : isImporting ? "Importing..." : importLabel}
          </button>
        )}
      </MenuItem>

      <Dialog open={isImportDialogOpen} onClose={() => { if (!isImporting) resetImportState(); }}>
        <DialogBackdrop />
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <DialogPanel size="3xl">
            <DialogHeader className="mb-4">
              <div>
                <DialogTitle className="text-lg text-copy-primary">
                  {importSummary ? "Import summary" : importJobId ? "Import progress" : "Import preview"}
                </DialogTitle>
                <DialogDescription className="mt-1 text-copy-secondary">
                  {importSummary
                    ? "Review imported rows and any records that need correction."
                    : importJobId
                      ? "The import continues as a tenant-scoped background job."
                      : "Review the detected header mapping and choose how matching records should be handled."}
                </DialogDescription>
              </div>
            </DialogHeader>

            <div className="space-y-5">
              {importError ? (
                <div role="alert" className="rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
                  {importError}
                </div>
              ) : null}

              {importSummary ? (
                <ImportSummary summary={importSummary} />
              ) : importJobId ? (
                <DataTransferJobProgress
                  operation="import"
                  jobId={importJobId}
                  status={importJob.status}
                  progress={importJob.progress}
                  message={importJob.message}
                  hasError={Boolean(importJob.error)}
                  completedDescription="Import finished."
                  failureMessage="The background import could not be completed. Review the file and try again."
                />
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field>
                      <FieldLabel>File</FieldLabel>
                      <Card variant="muted" className="flex min-h-[42px] items-center gap-3 px-3 py-2 text-sm text-copy-secondary">
                        <FileSpreadsheet className="size-4 shrink-0 text-copy-muted" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{selectedFile?.name || "No file selected"}</span>
                        {selectedFile ? <span className="shrink-0 text-xs text-copy-muted">{formatBytes(selectedFile.size)}</span> : null}
                      </Card>
                      <FieldDescription>CSV files are limited to 50 MB.</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="import-duplicate-mode">Duplicate handling</FieldLabel>
                      <Select value={duplicateMode} onValueChange={(value) => setDuplicateMode(value as DuplicateMode)}>
                        <SelectTrigger id="import-duplicate-mode" className="w-full">
                          <SelectValue placeholder="Select duplicate mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="skip">Skip duplicates</SelectItem>
                          <SelectItem value="overwrite">Overwrite duplicates</SelectItem>
                          <SelectItem value="merge">Merge duplicates</SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldDescription>Overwrite and merge require confirmation before the import starts.</FieldDescription>
                    </Field>
                  </div>

                  {preview ? <ImportMapping preview={preview} mapping={mapping} onMappingChange={(update) => {
                    setImportError(null);
                    setMapping(update);
                  }} /> : null}
                </>
              )}
            </div>

            <DialogFooter className="mt-6">
              {importSummary || importJobId ? (
                <Button type="button" onClick={resetImportState}>
                  Close
                </Button>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={resetImportState} disabled={isImporting}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={() => void handleImportSubmit()} disabled={isImporting || !preview}>
                    {isImporting ? "Starting import..." : "Run import"}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}

function ImportSummary({ summary }: { summary: ImportSummaryResponse }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard label="Total rows" value={summary.total_rows} />
        <SummaryCard label="Imported" value={summary.imported_rows} tone="success" />
        <SummaryCard label="Failed" value={summary.failed_rows} tone="danger" />
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="New" value={summary.new_rows} size="sm" />
        <SummaryCard label="Overwritten" value={summary.overwritten_rows} size="sm" />
        <SummaryCard label="Merged" value={summary.merged_rows} size="sm" />
        <SummaryCard label="Skipped" value={summary.skipped_rows} size="sm" />
      </div>
      <Card variant="muted" className="px-4 py-3 text-sm text-copy-secondary">
        {summary.message}
      </Card>
      <div>
        <h3 className="text-sm font-medium text-copy-primary">Rows requiring attention</h3>
        <div className="mt-3 max-h-[320px] overflow-y-auto pr-1">
          {summary.failures.length ? (
            <ul className="space-y-2">
              {summary.failures.map((failure, index) => (
                <li
                  key={`${failure.row_number ?? "row"}-${index}`}
                  className="rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary"
                >
                  <div className="font-medium">
                    Row {failure.row_number ?? "?"}
                    {failure.record_identifier ? ` — ${failure.record_identifier}` : ""}
                  </div>
                  <div className="mt-1 text-copy-secondary">{failure.reason}</div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-[var(--radius-control)] border border-state-success/40 bg-state-success-muted px-4 py-3 text-sm text-state-success">
              No rows require attention.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  size = "lg",
  tone = "default",
}: {
  label: string;
  value: number;
  size?: "lg" | "sm";
  tone?: "default" | "success" | "danger";
}) {
  const valueClassName =
    tone === "success" ? "text-state-success" : tone === "danger" ? "text-state-danger" : "text-copy-primary";
  return (
    <Card variant="status" className="px-4 py-3">
      <div className="text-xs font-medium text-copy-label">{label}</div>
      <div className={`mt-1 font-semibold ${size === "lg" ? "text-2xl" : "text-lg"} ${valueClassName}`}>{value}</div>
    </Card>
  );
}

function ImportMapping({
  preview,
  mapping,
  onMappingChange,
}: {
  preview: ImportPreviewResponse;
  mapping: Record<string, string | null>;
  onMappingChange: Dispatch<SetStateAction<Record<string, string | null>>>;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-copy-primary">Header mapping</h3>
        <p className="mt-1 text-sm text-copy-muted">Auto-matched fields are preselected. Adjust any mapping before importing.</p>
      </div>
      <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
        {preview.target_headers.map((targetHeader, index) => {
          const required = preview.required_headers.includes(targetHeader);
          const missing = required && !mapping[targetHeader];
          const triggerId = `import-mapping-${index}`;
          return (
            <div key={targetHeader} className="grid gap-2 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
              <FieldLabel htmlFor={triggerId}>
                {targetHeader}
                {required ? <RequiredMark /> : null}
              </FieldLabel>
              <Select
                value={mapping[targetHeader] ?? "__none__"}
                onValueChange={(value) =>
                  onMappingChange((current) => ({
                    ...current,
                    [targetHeader]: value === "__none__" ? null : value,
                  }))
                }
              >
                <SelectTrigger id={triggerId} className="w-full" aria-invalid={missing}>
                  <SelectValue placeholder="Do not import this field" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Do not import this field</SelectItem>
                  {preview.source_headers.map((sourceHeader) => (
                    <SelectItem key={sourceHeader} value={sourceHeader}>
                      {sourceHeader}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
