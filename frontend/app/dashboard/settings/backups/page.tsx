"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Download, Play, RotateCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { FormSection } from "@/components/forms/RecordFormLayout";
import { Fact, FactList } from "@/components/ui/Fact";
import { ActionBar, FormFooter } from "@/components/ui/ActionBar";
import { StatusValue } from "@/components/ui/StatusValue";
import { SegmentedBoolean } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmptyValue } from "@/components/ui/EmptyValue";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { Skeleton } from "@/components/ui/skeleton";
import { RecordTable } from "@/components/ui/RecordTable";
import { useModulesAdmin } from "@/hooks/admin/useModulesAdmin";
import { useConfirm } from "@/hooks/useConfirm";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { ApiError, apiFetch, isForbiddenError } from "@/lib/api";
import { downloadBlob } from "@/lib/browser";
import { getFilenameFromDisposition } from "@/components/ui/importExportUtils";
import { formatBytes } from "@/lib/format";
import { formatDateTime } from "@/lib/datetime";
import { formatSnakeCaseLabel, getModuleDisplayName } from "@/lib/module-display";

type TenantBackupSettings = {
  id: number;
  tenant_id: number;
  enabled: boolean;
  frequency: "manual" | "daily" | "weekly" | "monthly";
  scope: "full_tenant" | "selected_modules";
  selected_modules: string[];
  retention_count: 3 | 7 | 14 | 30;
  destination: "local_download" | "google_drive" | "onedrive";
  include_documents: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  updated_at: string;
};

type BackupSettingsDraft = Pick<
  TenantBackupSettings,
  "enabled" | "frequency" | "scope" | "selected_modules" | "retention_count" | "destination" | "include_documents"
>;

type TenantBackupRun = {
  id: number;
  requested_by_user_id: number | null;
  settings_id: number | null;
  backup_type: "tenant";
  scope: "full_tenant" | "selected_modules";
  modules_included: string[];
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  started_at: string | null;
  completed_at: string | null;
  storage_ref: string | null;
  size_bytes: number | null;
  error_message: string | null;
  destination: "local_download" | "google_drive" | "onedrive";
  destination_upload_status: string;
  metadata_json: {
    record_counts?: Record<string, number>;
  };
  created_at: string;
  updated_at: string;
};

type TenantBackupRunList = {
  results: TenantBackupRun[];
};

type TenantRestoreRun = {
  id: number;
  source_backup_run_id: number | null;
  restore_type: "tenant_module" | "tenant_whole";
  module_key: string;
  mode: string;
  status: "previewed" | "running" | "completed" | "failed";
  summary: Record<string, number | string | null>;
  error_message: string | null;
  created_at: string;
};

type TenantRestorePreview = {
  run: TenantRestoreRun;
  metadata: {
    record_counts?: Record<string, number>;
  };
  summary: Record<string, number | string | null>;
};

type TenantBackupDestinationConnection = {
  destination: "google_drive" | "onedrive";
  provider: "google_drive" | "microsoft_onedrive";
  status: string;
  account_email: string | null;
  provider_root_name: string | null;
  last_error: string | null;
  updated_at: string;
};

const DEFAULT_DRAFT: BackupSettingsDraft = {
  enabled: false,
  frequency: "manual",
  scope: "full_tenant",
  selected_modules: [],
  retention_count: 3,
  destination: "local_download",
  include_documents: true,
};

const frequencies = [
  { value: "manual", label: "Manual" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
] as const;

const retentionOptions = [3, 7, 14, 30] as const;
const restoreModes = [
  { value: "create_missing", label: "Create missing" },
  { value: "update_existing", label: "Update existing" },
  { value: "skip_duplicates", label: "Skip duplicates" },
  { value: "replace_module_data", label: "Replace module data" },
] as const;
const supportedBackupModules = new Set([
  "sales_leads",
  "sales_contacts",
  "sales_organizations",
  "sales_opportunities",
  "sales_quotes",
  "sales_orders",
  "tasks",
  "documents",
  "support_cases",
  "contracts",
]);

async function readJson(res: Response) {
  return res.json().catch(() => null);
}

async function fetchBackupSettings(): Promise<TenantBackupSettings> {
  const res = await apiFetch("/admin/tenant-backup-settings");
  const body = await readJson(res);
  if (!res.ok) throw new ApiError(res.status, "Backup settings could not be loaded.");
  return body as TenantBackupSettings;
}

async function saveBackupSettings(payload: BackupSettingsDraft): Promise<TenantBackupSettings> {
  const res = await apiFetch("/admin/tenant-backup-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error("Backup settings could not be saved.");
  return body as TenantBackupSettings;
}

async function fetchBackupRuns(): Promise<TenantBackupRun[]> {
  const res = await apiFetch("/admin/tenant-backup-runs?page=1&page_size=10");
  const body = await readJson(res);
  if (!res.ok) throw new ApiError(res.status, "Recent backup runs could not be loaded.");
  return ((body as TenantBackupRunList).results ?? []) as TenantBackupRun[];
}

async function fetchDestinationConnections(): Promise<TenantBackupDestinationConnection[]> {
  const res = await apiFetch("/admin/tenant-backup-settings/destinations/connections");
  const body = await readJson(res);
  if (!res.ok) throw new ApiError(res.status, "Storage connections could not be loaded.");
  return body as TenantBackupDestinationConnection[];
}

async function previewRestore(payload: { source_backup_run_id: number; module_key: string }): Promise<TenantRestorePreview> {
  const res = await apiFetch("/admin/tenant-restore-runs/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error("The module restore could not be previewed.");
  return body as TenantRestorePreview;
}

async function executeRestore(payload: { source_backup_run_id: number; module_key: string; mode: string; confirmation?: string }): Promise<{ run: TenantRestoreRun; message: string }> {
  const res = await apiFetch("/admin/tenant-restore-runs/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error("The module restore could not be completed.");
  return body as { run: TenantRestoreRun; message: string };
}

async function previewWholeRestore(payload: { source_backup_run_id: number }): Promise<TenantRestorePreview> {
  const res = await apiFetch("/admin/tenant-restore-runs/whole/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error("The whole-tenant restore could not be previewed.");
  return body as TenantRestorePreview;
}

async function executeWholeRestore(payload: { source_backup_run_id: number; confirmation: string }): Promise<{ run: TenantRestoreRun; message: string }> {
  const res = await apiFetch("/admin/tenant-restore-runs/whole/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error("The whole-tenant restore could not be completed.");
  return body as { run: TenantRestoreRun; message: string };
}

async function deleteBackupRun(runId: number): Promise<{ run: TenantBackupRun; message: string }> {
  const res = await apiFetch(`/admin/tenant-backup-runs/${runId}`, { method: "DELETE" });
  const body = await readJson(res);
  if (!res.ok) throw new Error("The backup artifact could not be deleted.");
  return body as { run: TenantBackupRun; message: string };
}

function toDraft(settings?: TenantBackupSettings): BackupSettingsDraft {
  if (!settings) return DEFAULT_DRAFT;
  return {
    enabled: settings.enabled,
    frequency: settings.frequency,
    scope: settings.scope,
    selected_modules: settings.selected_modules ?? [],
    retention_count: settings.retention_count,
    destination: settings.destination,
    include_documents: settings.include_documents,
  };
}

function connectionFor(connections: TenantBackupDestinationConnection[] | undefined, destination: string) {
  return connections?.find((connection) => connection.destination === destination);
}

export default function BackupSettingsPage() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const settingsQuery = useQuery({ queryKey: ["tenant-backup-settings"], queryFn: fetchBackupSettings });
  const runsQuery = useQuery({ queryKey: ["tenant-backup-runs"], queryFn: fetchBackupRuns });
  const storageConnectionsQuery = useQuery({ queryKey: ["tenant-backup-destination-connections"], queryFn: fetchDestinationConnections });
  const { modules, isLoading: modulesLoading } = useModulesAdmin();
  const [draftOverride, setDraftOverride] = useState<BackupSettingsDraft | null>(null);
  const [restoreRunId, setRestoreRunId] = useState<string>("");
  const [restoreModule, setRestoreModule] = useState<string>("");
  const [restoreMode, setRestoreMode] = useState<(typeof restoreModes)[number]["value"]>("create_missing");
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const [restorePreview, setRestorePreview] = useState<TenantRestorePreview | null>(null);
  const [wholeRestoreConfirmation, setWholeRestoreConfirmation] = useState("");
  const [wholeRestorePreview, setWholeRestorePreview] = useState<TenantRestorePreview | null>(null);
  const draft = draftOverride ?? toDraft(settingsQuery.data);
  const isSettingsDirty = Boolean(
    settingsQuery.data && JSON.stringify(draft) !== JSON.stringify(toDraft(settingsQuery.data)),
  );
  const setDraft = (updater: BackupSettingsDraft | ((current: BackupSettingsDraft) => BackupSettingsDraft)) => {
    setDraftOverride((current) => {
      const base = current ?? toDraft(settingsQuery.data);
      return typeof updater === "function" ? updater(base) : updater;
    });
  };

  const moduleOptions = useMemo(
    () =>
      modules
        .filter((module) => module.is_enabled && supportedBackupModules.has(module.name))
        .map((module) => ({
          value: module.name,
          label: getModuleDisplayName(module.name, module.description ?? undefined),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [modules],
  );
  const googleDriveConnection = connectionFor(storageConnectionsQuery.data, "google_drive");
  const oneDriveConnection = connectionFor(storageConnectionsQuery.data, "onedrive");
  const googleDriveConnected = googleDriveConnection?.status === "connected";
  const oneDriveConnected = oneDriveConnection?.status === "connected";
  const settings = settingsQuery.data;
  const completedRuns = (runsQuery.data ?? []).filter((run) => run.status === "completed" && run.storage_ref);
  const selectedRestoreRun = completedRuns.find((run) => String(run.id) === restoreRunId);
  const wholeRestoreConfirmationText = settings?.tenant_id ? `RESTORE TENANT ${settings.tenant_id}` : "";
  const restoreModuleOptions = (selectedRestoreRun?.modules_included ?? [])
    .filter((moduleKey) => supportedBackupModules.has(moduleKey))
    .map((moduleKey) => ({ value: moduleKey, label: getModuleDisplayName(moduleKey) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const driveConnect = searchParams.get("driveConnect");
    if (!driveConnect) return;
    const provider = searchParams.get("provider");
    const label = provider === "microsoft_onedrive" ? "Microsoft OneDrive" : "Google Drive";
    if (driveConnect === "connected") toast.success(`${label} connected.`);
    if (driveConnect === "error") toast.error(`Failed to connect ${label}.`);
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: BackupSettingsDraft = {
        ...draft,
        selected_modules: draft.scope === "selected_modules" ? draft.selected_modules : [],
      };
      if (payload.scope === "selected_modules" && payload.selected_modules.length === 0) {
        throw new Error("Select at least one module.");
      }
      return saveBackupSettings(payload);
    },
    onSuccess: async (settings) => {
      toast.success("Backup settings saved.");
      setDraftOverride(toDraft(settings));
      // The response *is* the new record, so it is written into the cache rather than waiting
      // on the invalidation's refetch. Without this the footer reports the page dirty for the
      // length of that round trip — the draft has moved and the query's copy has not — which
      // is a save that says it did not happen.
      queryClient.setQueryData(["tenant-backup-settings"], settings);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tenant-backup-settings"] }),
        queryClient.invalidateQueries({ queryKey: ["activity-log"] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Backup settings could not be saved. Check the destination and try again."),
  });
  useUnsavedChangesGuard(isSettingsDirty, saveMutation.isPending);

  const manualRunMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/admin/tenant-backup-runs/manual", { method: "POST" });
      const body = await readJson(res);
      if (!res.ok) throw new Error("The tenant backup could not be created.");
      return body as { run: TenantBackupRun; message: string };
    },
    onSuccess: async (result) => {
      if (result.run.status === "completed") {
        toast.success("Tenant backup completed.");
      } else {
        toast.error("Tenant backup failed. Review the destination and try again.");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tenant-backup-settings"] }),
        queryClient.invalidateQueries({ queryKey: ["tenant-backup-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["activity-log"] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The backup could not be started. Check the destination and try again."),
  });

  const previewRestoreMutation = useMutation({
    mutationFn: async () => {
      if (!restoreRunId || !restoreModule) throw new Error("Choose a backup run and module first.");
      return previewRestore({ source_backup_run_id: Number(restoreRunId), module_key: restoreModule });
    },
    onSuccess: (result) => {
      setRestorePreview(result);
      toast.success("Restore preview ready.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The restore preview could not be prepared. Choose the backup again and retry."),
  });

  const executeRestoreMutation = useMutation({
    mutationFn: async () => {
      if (!restoreRunId || !restoreModule) throw new Error("Choose a backup run and module first.");
      return executeRestore({
        source_backup_run_id: Number(restoreRunId),
        module_key: restoreModule,
        mode: restoreMode,
        confirmation: restoreMode === "replace_module_data" ? restoreConfirmation : undefined,
      });
    },
    onSuccess: async (result) => {
      if (result.run.status === "completed") {
        toast.success("Module restore completed.");
      } else {
        toast.error("Module restore failed. No technical error details were exposed.");
      }
      await queryClient.invalidateQueries({ queryKey: ["activity-log"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The module could not be restored. Review the preview and try again."),
  });

  const previewWholeRestoreMutation = useMutation({
    mutationFn: async () => {
      if (!restoreRunId) throw new Error("Choose a backup run first.");
      return previewWholeRestore({ source_backup_run_id: Number(restoreRunId) });
    },
    onSuccess: (result) => {
      setWholeRestorePreview(result);
      toast.success("Whole-tenant restore preview ready.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The restore preview could not be prepared. Choose the backup again and retry."),
  });

  const executeWholeRestoreMutation = useMutation({
    mutationFn: async () => {
      if (!restoreRunId) throw new Error("Choose a backup run first.");
      return executeWholeRestore({ source_backup_run_id: Number(restoreRunId), confirmation: wholeRestoreConfirmation });
    },
    onSuccess: async (result) => {
      if (result.run.status === "completed") {
        toast.success("Whole-tenant restore completed.");
      } else {
        toast.error("Whole-tenant restore failed. Review the preview and try again.");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tenant-backup-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["activity-log"] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The workspace could not be restored. Review the preview and try again."),
  });

  const deleteRunMutation = useMutation({
    mutationFn: deleteBackupRun,
    onSuccess: async () => {
      toast.success("Backup artifact deleted.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tenant-backup-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["activity-log"] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The backup could not be deleted. Try again."),
  });

  async function downloadRun(run: TenantBackupRun) {
    const res = await apiFetch(`/admin/tenant-backup-runs/${run.id}/download`);
    if (!res.ok) {
      throw new Error("The backup artifact could not be downloaded.");
    }
    const blob = await res.blob();
    const filename = getFilenameFromDisposition(
      res.headers.get("Content-Disposition"),
      `lynk-workspace-backup-${run.id}.zip`,
    );
    downloadBlob(blob, filename);
  }

  function toggleModule(moduleKey: string) {
    setDraft((current) => {
      const exists = current.selected_modules.includes(moduleKey);
      return {
        ...current,
        selected_modules: exists
          ? current.selected_modules.filter((value) => value !== moduleKey)
          : [...current.selected_modules, moduleKey],
      };
    });
  }

  async function confirmDeleteRun(run: TenantBackupRun) {
    const confirmed = await confirm({
      title: "Delete backup artifact?",
      description: `Backup #${run.id} will no longer be available for download or restore. This action cannot be undone.`,
      confirmLabel: "Delete backup",
      variant: "destructive",
    });
    if (confirmed) deleteRunMutation.mutate(run.id);
  }

  if (settingsQuery.isLoading || settingsQuery.isError) {
    return (
      <PageShell
        variant="settings"
        title="Backups"
        description="Schedule tenant backups and restore a module from one."
        isLoading={settingsQuery.isLoading}
        isPermissionDenied={isForbiddenError(settingsQuery.error)}
        hasError={settingsQuery.isError}
        errorDescription="Backup settings are unavailable right now. No backup or restore action has been started."
        onRetry={() => void settingsQuery.refetch()}
        backHref="/dashboard/settings"
        backLabel="Back to settings"
      >
        {null}
      </PageShell>
    );
  }

  return (
    <PageShell
      variant="settings"
      title="Backups"
      description="Schedule tenant backups and restore a module from one."
      context={isSettingsDirty ? "Unsaved schedule changes" : undefined}
      actions={(
        <Button type="button" onClick={() => manualRunMutation.mutate()} disabled={manualRunMutation.isPending}>
          <Play />{manualRunMutation.isPending ? "Running…" : "Run backup"}
        </Button>
      )}
    >
      <FormSection title="Status" description="The saved schedule and its most recent run.">
        <FactList className="sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="Schedule">
            <StatusValue status={{ tone: settings?.enabled ? "success" : "neutral", label: settings?.enabled ? "Enabled" : "Disabled" }} context="record" />
          </Fact>
          <Fact label="Last run">{settings?.last_run_at ? formatDateTime(settings.last_run_at) : "Never"}</Fact>
          <Fact label="Next run">{settings?.next_run_at ? formatDateTime(settings.next_run_at) : "Manual"}</Fact>
          <Fact label="Updated">{settings?.updated_at ? formatDateTime(settings.updated_at) : "Not saved"}</Fact>
        </FactList>
      </FormSection>

      {/* The schedule was behind a `Configure` drawer — half the page's subject hidden from
          the page, with its own dirty banner and its own Cancel. Archetype 4 puts settings on
          the settings page. It stays a **configuration record** (R1): the frequency, the
          scope, the retention and the destination validate together — a selected-module
          scope with no modules is refused, and a cloud destination needs a connected
          account — so it commits through one footer rather than field by field. */}
      <FormSection
        title="Schedule"
        description="Frequency, retention, scope and destination are validated together, so they save as a set."
      >
        <div className="flex flex-col gap-6">
          <SettingsRow label="Backups" description="Scheduled backups run automatically on the frequency and retention below.">
            <SegmentedBoolean
              aria-label="Backup schedule"
              value={draft.enabled}
              onValueChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
              trueLabel="Scheduled"
              falseLabel="Manual only"
            />
          </SettingsRow>

          <div className="grid gap-3 md:grid-cols-2">
            <Field>
              <FieldLabel>Frequency</FieldLabel>
              <Select value={draft.frequency} onValueChange={(value) => setDraft((current) => ({ ...current, frequency: value as BackupSettingsDraft["frequency"] }))}>
                <SelectTrigger aria-label="Frequency"><SelectValue /></SelectTrigger>
                <SelectContent>{frequencies.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Retention</FieldLabel>
              <Select value={String(draft.retention_count)} onValueChange={(value) => setDraft((current) => ({ ...current, retention_count: Number(value) as BackupSettingsDraft["retention_count"] }))}>
                <SelectTrigger aria-label="Retention"><SelectValue /></SelectTrigger>
                <SelectContent>{retentionOptions.map((option) => <SelectItem key={option} value={String(option)}>Keep {option}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Scope</FieldLabel>
              <Select value={draft.scope} onValueChange={(value) => setDraft((current) => ({ ...current, scope: value as BackupSettingsDraft["scope"] }))}>
                <SelectTrigger aria-label="Scope"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_tenant">Full tenant</SelectItem>
                  <SelectItem value="selected_modules">Selected modules</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Destination</FieldLabel>
              <Select value={draft.destination} onValueChange={(value) => setDraft((current) => ({ ...current, destination: value as BackupSettingsDraft["destination"] }))}>
                <SelectTrigger aria-label="Destination"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="local_download">Local download</SelectItem>
                  <SelectItem value="google_drive" disabled={!googleDriveConnected}>Google Drive</SelectItem>
                  <SelectItem value="onedrive" disabled={!oneDriveConnected}>Microsoft OneDrive</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>Cloud options require a connected storage account for this admin.</FieldDescription>
            </Field>
          </div>

          <SettingsRow label="Document files" description="Whether tenant documents are included in the backup artifact.">
            <SegmentedBoolean
              aria-label="Document files"
              value={draft.include_documents}
              onValueChange={(include_documents) => setDraft((current) => ({ ...current, include_documents }))}
              trueLabel="Include"
              falseLabel="Exclude"
            />
          </SettingsRow>

          {draft.scope === "selected_modules" ? (
            <div>
              <SectionHeading as="h3" className="mb-3" description="At least one module is required while the scope is set to selected modules.">
                Modules
              </SectionHeading>
              {/* Ruling 4 keeps `Checkbox` for *many from a set*, which is exactly this. What
                  went is the disabled-but-drawn grid: the whole block used to render greyed
                  out whenever the scope was Full tenant, which is a control the backend will
                  ignore (§7.9). */}
              <div className="grid gap-2 sm:grid-cols-2">
                {modulesLoading ? (
                  Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-10 rounded-[var(--radius-control)]" />)
                ) : moduleOptions.length ? (
                  moduleOptions.map((module) => (
                    <label key={module.value} className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-2 text-sm text-copy-secondary transition-colors hover:border-line-strong">
                      <Checkbox checked={draft.selected_modules.includes(module.value)} onCheckedChange={() => toggleModule(module.value)} className="shrink-0" />
                      {module.label}
                    </label>
                  ))
                ) : (
                  <EmptyState icon={Archive} title="No enabled modules available" description="Enable a supported module before using selected-module backups." className="sm:col-span-2" />
                )}
              </div>
            </div>
          ) : null}

          <FormFooter status={isSettingsDirty ? "Unsaved changes" : "All changes saved"}>
            <Button type="button" variant="ghost" onClick={() => setDraftOverride(null)} disabled={!isSettingsDirty || saveMutation.isPending}>Discard changes</Button>
            <Button type="button" onClick={() => saveMutation.mutate()} disabled={!isSettingsDirty || saveMutation.isPending}>
              <Save />{saveMutation.isPending ? "Saving…" : "Save schedule"}
            </Button>
          </FormFooter>
        </div>
      </FormSection>

      <FormSection
        title="Restore"
        description="Preview a backup artifact before it is applied. Every restore writes to live tenant data."
      >
        <div className="flex flex-col gap-6">
          <div className="grid gap-3 md:grid-cols-3">
            <Field>
              <FieldLabel>Backup run</FieldLabel>
              <Select
                value={restoreRunId}
                onValueChange={(value) => {
                  setRestoreRunId(value);
                  setRestoreModule("");
                  setRestorePreview(null);
                  setWholeRestorePreview(null);
                }}
              >
                <SelectTrigger aria-label="Backup run"><SelectValue placeholder="Select a run" /></SelectTrigger>
                <SelectContent>
                  {completedRuns.map((run) => (
                    <SelectItem key={run.id} value={String(run.id)}>#{run.id} · {run.completed_at ? formatDateTime(run.completed_at) : "Completed"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Module</FieldLabel>
              <Select
                value={restoreModule}
                onValueChange={(value) => {
                  setRestoreModule(value);
                  setRestorePreview(null);
                }}
                disabled={!selectedRestoreRun}
              >
                <SelectTrigger aria-label="Module"><SelectValue placeholder="Select a module" /></SelectTrigger>
                <SelectContent>
                  {restoreModuleOptions.map((module) => <SelectItem key={module.value} value={module.value}>{module.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Strategy</FieldLabel>
              <Select value={restoreMode} onValueChange={(value) => setRestoreMode(value as typeof restoreMode)}>
                <SelectTrigger aria-label="Strategy"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {restoreModes.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {restoreMode === "replace_module_data" ? (
            <Field>
              <FieldLabel htmlFor="restore-confirmation">Confirmation</FieldLabel>
              <Input
                id="restore-confirmation"
                className="max-w-md"
                value={restoreConfirmation}
                onChange={(event) => setRestoreConfirmation(event.target.value)}
                placeholder={restoreModule ? `REPLACE ${restoreModule}` : "REPLACE module_key"}
              />
              <FieldDescription>Replace mode updates backup rows and soft-deletes current rows that are not in the backup.</FieldDescription>
            </Field>
          ) : null}

          {restorePreview ? (
            <FactList className="sm:grid-cols-4">
              <Fact label="Rows">{restorePreview.summary.total_rows ?? 0}</Fact>
              <Fact label="Existing">{restorePreview.summary.existing_matches ?? 0}</Fact>
              <Fact label="Missing">{restorePreview.summary.missing_rows ?? 0}</Fact>
              <Fact label="Invalid">{restorePreview.summary.invalid_rows ?? 0}</Fact>
            </FactList>
          ) : null}

          <ActionBar>
            <Button type="button" variant="outline" onClick={() => previewRestoreMutation.mutate()} disabled={previewRestoreMutation.isPending || !restoreRunId || !restoreModule}>
              {previewRestoreMutation.isPending ? "Previewing…" : "Preview module"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => executeRestoreMutation.mutate()}
              disabled={executeRestoreMutation.isPending || !restoreRunId || !restoreModule || (restoreMode === "replace_module_data" && restoreConfirmation !== `REPLACE ${restoreModule}`)}
            >
              <RotateCcw />{executeRestoreMutation.isPending ? "Restoring…" : "Restore module"}
            </Button>
          </ActionBar>

          <div className="border-t border-line-subtle pt-6">
            <SectionHeading as="h3" className="mb-3" description="Creates a safety backup first, then replaces every supported module from a full-tenant backup.">
              Whole tenant
            </SectionHeading>

            {wholeRestorePreview ? (
              <FactList className="mb-4 sm:grid-cols-3">
                <Fact label="Modules">{wholeRestorePreview.summary.total_modules ?? 0}</Fact>
                <Fact label="Rows">{wholeRestorePreview.summary.total_rows ?? 0}</Fact>
                <Fact label="Backup type">{wholeRestorePreview.metadata.record_counts ? "Tenant" : "—"}</Fact>
              </FactList>
            ) : null}

            <Field className="mb-4 max-w-md">
              <FieldLabel htmlFor="whole-restore-confirmation">Confirmation</FieldLabel>
              <Input
                id="whole-restore-confirmation"
                value={wholeRestoreConfirmation}
                onChange={(event) => setWholeRestoreConfirmation(event.target.value)}
                placeholder={wholeRestoreConfirmationText || "RESTORE TENANT tenant_id"}
              />
              <FieldDescription>A whole-tenant restore is destructive. A safety backup is taken before anything changes.</FieldDescription>
            </Field>

            <ActionBar>
              <Button type="button" variant="outline" onClick={() => previewWholeRestoreMutation.mutate()} disabled={previewWholeRestoreMutation.isPending || !restoreRunId}>
                {previewWholeRestoreMutation.isPending ? "Previewing…" : "Preview whole tenant"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => executeWholeRestoreMutation.mutate()}
                disabled={executeWholeRestoreMutation.isPending || !restoreRunId || !wholeRestoreConfirmationText || wholeRestoreConfirmation !== wholeRestoreConfirmationText}
              >
                <RotateCcw />{executeWholeRestoreMutation.isPending ? "Restoring…" : "Restore whole tenant"}
              </Button>
            </ActionBar>
          </div>
        </div>
      </FormSection>

      <FormSection title="Recent runs" description="Tenant backup artifacts, which are separate from platform backups.">
        <RecordTable
          label="Backup runs"
          columns={[
            { key: "id", label: "Run", size: "sm", render: (run) => <span className="tabular-nums text-copy-secondary">#{run.id}</span> },
            {
              key: "status",
              label: "Status",
              size: "sm",
              render: (run) => (
                <StatusValue status={{ tone: run.status === "completed" ? "success" : run.status === "failed" ? "critical" : "attention", label: formatSnakeCaseLabel(run.status) }} />
              ),
            },
            { key: "scope", label: "Scope", size: "sm", render: (run) => <span className="text-copy-secondary">{run.scope === "full_tenant" ? "Full tenant" : "Selected"}</span> },
            { key: "modules", label: "Modules", size: "sm", render: (run) => <span className="tabular-nums text-copy-secondary">{run.modules_included.length}</span> },
            { key: "size", label: "Size", size: "sm", render: (run) => <span className="text-copy-secondary">{formatBytes(run.size_bytes) ?? <EmptyValue context="cell" />}</span> },
            {
              key: "upload",
              label: "Upload",
              render: (run) => (
                <StatusValue status={{ tone: run.destination_upload_status === "failed" ? "critical" : run.destination_upload_status === "uploaded" ? "success" : "neutral", label: formatSnakeCaseLabel(run.destination_upload_status) }} />
              ),
            },
            { key: "completed_at", label: "Completed", render: (run) => <span className="text-copy-muted">{run.completed_at ? formatDateTime(run.completed_at) : "Not finished"}</span> },
          ]}
          rows={runsQuery.data ?? []}
          rowKey={(run) => run.id}
          shellVariant="nested"
          isLoading={runsQuery.isLoading}
          isRefreshing={runsQuery.isFetching && !runsQuery.isLoading}
          hasError={runsQuery.isError}
          onRetry={() => void runsQuery.refetch()}
          errorState={{ title: "Recent backup runs could not be loaded" }}
          emptyState={{
            icon: Archive,
            title: "No tenant backup runs yet",
            description: "Run a backup to create the first tenant-scoped artifact.",
          }}
          rowActions={(run) => (
            run.status === "completed" && run.storage_ref ? (
              <ActionBar size="sm">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void downloadRun(run).catch((error) => toast.error(error instanceof Error ? error.message : "Download failed."));
                  }}
                >
                  <Download />Download
                </Button>
                <Button
                  type="button"
                  variant="destructiveGhost"
                  onClick={() => void confirmDeleteRun(run)}
                  disabled={deleteRunMutation.isPending}
                >
                  <Trash2 />Delete
                </Button>
              </ActionBar>
            ) : run.error_message ? (
              <span className="text-xs text-state-danger">Backup failed. Try again or review the destination.</span>
            ) : (
              <span className="text-xs text-copy-muted">Unavailable</span>
            )
          )}
        />
      </FormSection>
    </PageShell>
  );
}

