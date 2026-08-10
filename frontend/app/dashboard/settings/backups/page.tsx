"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CalendarClock, Download, Play, RotateCcw, Save, SlidersHorizontal, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageToolbar } from "@/components/ui/PageToolbar";
import { Pill } from "@/components/ui/Pill";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { useModulesAdmin } from "@/hooks/admin/useModulesAdmin";
import { useConfirm } from "@/hooks/useConfirm";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { apiFetch } from "@/lib/api";
import { downloadBlob } from "@/lib/browser";
import { getFilenameFromDisposition } from "@/components/ui/importExportUtils";
import { formatDateTime } from "@/lib/datetime";
import { getModuleDisplayName } from "@/lib/module-display";

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
  if (!res.ok) throw new Error("Backup settings could not be loaded.");
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
  if (!res.ok) throw new Error("Recent backup runs could not be loaded.");
  return ((body as TenantBackupRunList).results ?? []) as TenantBackupRun[];
}

async function fetchDestinationConnections(): Promise<TenantBackupDestinationConnection[]> {
  const res = await apiFetch("/admin/tenant-backup-settings/destinations/connections");
  const body = await readJson(res);
  if (!res.ok) throw new Error("Storage connections could not be loaded.");
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

function formatBytes(value: number | null) {
  if (!value) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
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
  const [settingsEditorOpen, setSettingsEditorOpen] = useState(false);
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
      setSettingsEditorOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tenant-backup-settings"] }),
        queryClient.invalidateQueries({ queryKey: ["activity-log"] }),
      ]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to save backup settings."),
  });
  useUnsavedChangesGuard(settingsEditorOpen && isSettingsDirty, saveMutation.isPending);

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
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to create tenant backup."),
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
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to preview restore."),
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
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to restore module."),
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
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to preview whole-tenant restore."),
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
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to restore tenant."),
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
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to delete backup artifact."),
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

  async function closeSettingsEditor() {
    if (isSettingsDirty) {
      const confirmed = await confirm({
        title: "Discard backup setting changes?",
        description: "Your unsaved schedule, scope, retention, and destination changes will be lost.",
        confirmLabel: "Discard changes",
        variant: "destructive",
      });
      if (!confirmed) return;
    }
    setDraftOverride(null);
    setSettingsEditorOpen(false);
  }

  function handleSettingsEditorOpenChange(open: boolean) {
    if (open) {
      setSettingsEditorOpen(true);
      return;
    }
    void closeSettingsEditor();
  }

  if (settingsQuery.isLoading) return <RouteLoadingState label="backup settings" />;
  if (settingsQuery.isError) {
    return (
      <RouteErrorState
        title="Unable to load backup settings"
        description="Backup settings are unavailable right now. No backup or restore action has been started."
        reset={() => void settingsQuery.refetch()}
        backHref="/dashboard/settings"
        backLabel="Back to settings"
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 text-copy-primary">
      <PageToolbar>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setSettingsEditorOpen(true)}><SlidersHorizontal />Configure</Button>
            <Button type="button" onClick={() => manualRunMutation.mutate()} disabled={manualRunMutation.isPending || settingsQuery.isLoading}>
              <Play />{manualRunMutation.isPending ? "Running..." : "Run Backup"}
            </Button>
          </div>
      </PageToolbar>

      <Sheet open={settingsEditorOpen} onOpenChange={handleSettingsEditorOpenChange}>
        <SheetPortal>
          <SheetOverlay className="fixed inset-0 z-40 bg-overlay" />
          <SheetContent side="right" className="z-50 flex h-full w-full max-w-[38rem] flex-col border-l border-line-default bg-surface-raised shadow-2xl outline-none">
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); saveMutation.mutate(); }}>
              <SheetHeader className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
                <div>
                  <SheetTitle className="text-lg font-semibold text-copy-primary">Configure backups</SheetTitle>
                  <SheetDescription className="mt-1 text-sm text-copy-muted">Set the tenant schedule, retention, scope, and storage destination.</SheetDescription>
                </div>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Close backup settings" onClick={() => void closeSettingsEditor()}><X /></Button>
              </SheetHeader>

              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
                <Field>
                  <FieldLabel>Backup schedule</FieldLabel>
                  <div className="grid grid-cols-2 gap-2" role="group" aria-label="Backup schedule">
                    <Button
                      type="button"
                      variant={draft.enabled ? "secondary" : "outline"}
                      aria-pressed={draft.enabled}
                      onClick={() => setDraft((current) => ({ ...current, enabled: true }))}
                    >
                      Scheduled
                    </Button>
                    <Button
                      type="button"
                      variant={!draft.enabled ? "secondary" : "outline"}
                      aria-pressed={!draft.enabled}
                      onClick={() => setDraft((current) => ({ ...current, enabled: false }))}
                    >
                      Manual only
                    </Button>
                  </div>
                  <FieldDescription>Scheduled backups run automatically using the frequency and retention settings below.</FieldDescription>
                </Field>

                <FieldGroup>
                  <Field>
                    <FieldLabel>Frequency</FieldLabel>
                    <Select value={draft.frequency} onValueChange={(value) => setDraft((current) => ({ ...current, frequency: value as BackupSettingsDraft["frequency"] }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{frequencies.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>Retention</FieldLabel>
                    <Select value={String(draft.retention_count)} onValueChange={(value) => setDraft((current) => ({ ...current, retention_count: Number(value) as BackupSettingsDraft["retention_count"] }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{retentionOptions.map((option) => <SelectItem key={option} value={String(option)}>Keep {option}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>Scope</FieldLabel>
                    <Select value={draft.scope} onValueChange={(value) => setDraft((current) => ({ ...current, scope: value as BackupSettingsDraft["scope"] }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full_tenant">Full tenant</SelectItem>
                        <SelectItem value="selected_modules">Selected modules</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>Destination</FieldLabel>
                    <Select value={draft.destination} onValueChange={(value) => setDraft((current) => ({ ...current, destination: value as BackupSettingsDraft["destination"] }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="local_download">Local download</SelectItem>
                        <SelectItem value="google_drive" disabled={!googleDriveConnected}>Google Drive</SelectItem>
                        <SelectItem value="onedrive" disabled={!oneDriveConnected}>Microsoft OneDrive</SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldDescription>Cloud options require a connected storage account for this admin.</FieldDescription>
                  </Field>
                </FieldGroup>

                <Field>
                  <FieldLabel>Document files</FieldLabel>
                  <div className="grid grid-cols-2 gap-2" role="group" aria-label="Document files">
                    <Button
                      type="button"
                      variant={draft.include_documents ? "secondary" : "outline"}
                      aria-pressed={draft.include_documents}
                      onClick={() => setDraft((current) => ({ ...current, include_documents: true }))}
                    >
                      Include
                    </Button>
                    <Button
                      type="button"
                      variant={!draft.include_documents ? "secondary" : "outline"}
                      aria-pressed={!draft.include_documents}
                      onClick={() => setDraft((current) => ({ ...current, include_documents: false }))}
                    >
                      Exclude
                    </Button>
                  </div>
                  <FieldDescription>Choose whether tenant documents are included in backup artifacts.</FieldDescription>
                </Field>

                <div className="border-t border-line-subtle pt-5">
                  <div className="mb-4 flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line-default bg-surface-muted text-copy-secondary"><Archive className="h-4 w-4" /></span>
                    <div>
                      <h3 className="text-sm font-semibold text-copy-primary">Module selection</h3>
                      <p className="mt-1 text-sm text-copy-muted">Used only when scope is set to selected modules.</p>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {modulesLoading ? (
                      Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-12 rounded-[var(--radius-control)]" />)
                    ) : moduleOptions.length ? (
                      moduleOptions.map((module) => {
                        const checked = draft.selected_modules.includes(module.value);
                        const disabled = draft.scope !== "selected_modules";
                        return (
                          <label key={module.value} className={`flex items-center gap-3 rounded-[var(--radius-control)] border px-4 py-3 text-sm transition-colors ${checked ? "border-action-primary bg-action-primary-muted text-copy-primary" : "border-line-default bg-surface-muted text-copy-secondary hover:border-line-strong"} ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
                            <Checkbox checked={checked} disabled={disabled} onCheckedChange={() => toggleModule(module.value)} className="flex size-4 shrink-0 items-center justify-center rounded border border-line-strong bg-surface-raised text-primary">
                              <CheckboxIndicator className="size-3" />
                            </Checkbox>
                            {module.label}
                          </label>
                        );
                      })
                    ) : (
                      <EmptyState icon={Archive} title="No enabled modules available" description="Enable a supported module before using selected-module backups." className="sm:col-span-2" />
                    )}
                  </div>
                </div>
              </div>

              <SheetFooter className="flex flex-col gap-3 border-t border-line-subtle bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <span className={`text-sm ${isSettingsDirty ? "text-state-warning" : "text-state-success"}`}>{isSettingsDirty ? "Unsaved changes" : "All changes saved"}</span>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => void closeSettingsEditor()} disabled={saveMutation.isPending}>Cancel</Button>
                  <Button type="submit" disabled={saveMutation.isPending || !isSettingsDirty}><Save />{saveMutation.isPending ? "Saving..." : "Save Settings"}</Button>
                </div>
              </SheetFooter>
            </form>
          </SheetContent>
        </SheetPortal>
      </Sheet>

      <Card className="px-5 py-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-line-default bg-surface-muted text-copy-secondary"><CalendarClock className="h-4 w-4" /></span>
          <div>
            <h2 className="text-lg font-semibold text-copy-primary">Backup status</h2>
            <p className="mt-1 text-sm text-copy-muted">Current saved schedule and recent execution state.</p>
          </div>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[var(--radius-control)] border border-line-subtle px-3 py-3">
            <dt className="text-copy-muted">Schedule</dt>
            <dd className="mt-2"><Pill bg={settings?.enabled ? "bg-state-success-muted" : "bg-surface-muted"} text={settings?.enabled ? "text-state-success" : "text-copy-muted"} border={settings?.enabled ? "border-state-success/40" : "border-line-default"}>{settings?.enabled ? "Enabled" : "Disabled"}</Pill></dd>
          </div>
          <div className="rounded-[var(--radius-control)] border border-line-subtle px-3 py-3"><dt className="text-copy-muted">Last run</dt><dd className="mt-2 text-copy-secondary">{settings?.last_run_at ? formatDateTime(settings.last_run_at) : "Never"}</dd></div>
          <div className="rounded-[var(--radius-control)] border border-line-subtle px-3 py-3"><dt className="text-copy-muted">Next run</dt><dd className="mt-2 text-copy-secondary">{settings?.next_run_at ? formatDateTime(settings.next_run_at) : "Manual"}</dd></div>
          <div className="rounded-[var(--radius-control)] border border-line-subtle px-3 py-3"><dt className="text-copy-muted">Updated</dt><dd className="mt-2 text-copy-secondary">{settings?.updated_at ? formatDateTime(settings.updated_at) : "Not saved"}</dd></div>
        </dl>
      </Card>

      <Card className="px-5 py-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-line-default bg-surface-muted text-copy-secondary">
            <RotateCcw className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-copy-primary">Module Restore</h2>
            <p className="mt-1 text-sm text-copy-muted">Preview and restore one module from a tenant backup artifact.</p>
          </div>
        </div>

        <FieldGroup className="grid max-w-4xl gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel>Backup Run</FieldLabel>
            <Select
              value={restoreRunId}
              onValueChange={(value) => {
                setRestoreRunId(value);
                setRestoreModule("");
                setRestorePreview(null);
                setWholeRestorePreview(null);
              }}
            >
              <SelectTrigger><SelectValue placeholder="Select a run" /></SelectTrigger>
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
              <SelectTrigger><SelectValue placeholder="Select a module" /></SelectTrigger>
              <SelectContent>
                {restoreModuleOptions.map((module) => <SelectItem key={module.value} value={module.value}>{module.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>Strategy</FieldLabel>
            <Select value={restoreMode} onValueChange={(value) => setRestoreMode(value as typeof restoreMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {restoreModes.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          {restoreMode === "replace_module_data" ? (
            <Field className="md:col-span-3">
              <FieldLabel>Confirmation</FieldLabel>
              <Input
                value={restoreConfirmation}
                onChange={(event) => setRestoreConfirmation(event.target.value)}
                placeholder={restoreModule ? `REPLACE ${restoreModule}` : "REPLACE module_key"}
              />
              <FieldDescription>Replace mode updates backup rows and soft-deletes current rows that are not in the backup.</FieldDescription>
            </Field>
          ) : null}
        </FieldGroup>

        {restorePreview ? (
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-[var(--radius-control)] border border-line-subtle bg-surface-muted px-3 py-2">
              <dt className="text-copy-muted">Rows</dt>
              <dd className="mt-1 text-copy-primary">{restorePreview.summary.total_rows ?? 0}</dd>
            </div>
            <div className="rounded-[var(--radius-control)] border border-line-subtle bg-surface-muted px-3 py-2">
              <dt className="text-copy-muted">Existing</dt>
              <dd className="mt-1 text-copy-primary">{restorePreview.summary.existing_matches ?? 0}</dd>
            </div>
            <div className="rounded-[var(--radius-control)] border border-line-subtle bg-surface-muted px-3 py-2">
              <dt className="text-copy-muted">Missing</dt>
              <dd className="mt-1 text-copy-primary">{restorePreview.summary.missing_rows ?? 0}</dd>
            </div>
            <div className="rounded-[var(--radius-control)] border border-line-subtle bg-surface-muted px-3 py-2">
              <dt className="text-copy-muted">Invalid</dt>
              <dd className="mt-1 text-copy-primary">{restorePreview.summary.invalid_rows ?? 0}</dd>
            </div>
          </dl>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => previewRestoreMutation.mutate()} disabled={previewRestoreMutation.isPending || !restoreRunId || !restoreModule}>
            {previewRestoreMutation.isPending ? "Previewing..." : "Preview"}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => executeRestoreMutation.mutate()}
            disabled={executeRestoreMutation.isPending || !restoreRunId || !restoreModule || (restoreMode === "replace_module_data" && restoreConfirmation !== `REPLACE ${restoreModule}`)}
          >
            <RotateCcw />{executeRestoreMutation.isPending ? "Restoring..." : "Restore Module"}
          </Button>
        </div>

        <div className="mt-6 border-t border-line-subtle pt-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-copy-primary">Whole-Tenant Restore</h3>
            <p className="mt-1 text-sm text-copy-muted">Creates a safety backup first, then replaces supported modules from a full-tenant backup.</p>
          </div>

          {wholeRestorePreview ? (
            <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-[var(--radius-control)] border border-line-subtle bg-surface-muted px-3 py-2">
                <dt className="text-copy-muted">Modules</dt>
                <dd className="mt-1 text-copy-primary">{wholeRestorePreview.summary.total_modules ?? 0}</dd>
              </div>
              <div className="rounded-[var(--radius-control)] border border-line-subtle bg-surface-muted px-3 py-2">
                <dt className="text-copy-muted">Rows</dt>
                <dd className="mt-1 text-copy-primary">{wholeRestorePreview.summary.total_rows ?? 0}</dd>
              </div>
              <div className="rounded-[var(--radius-control)] border border-line-subtle bg-surface-muted px-3 py-2">
                <dt className="text-copy-muted">Backup Type</dt>
                <dd className="mt-1 text-copy-primary">{wholeRestorePreview.metadata.record_counts ? "Tenant" : "-"}</dd>
              </div>
            </dl>
          ) : null}

          <Field className="mb-4">
            <FieldLabel>Whole-tenant confirmation</FieldLabel>
            <Input
              value={wholeRestoreConfirmation}
              onChange={(event) => setWholeRestoreConfirmation(event.target.value)}
              placeholder={wholeRestoreConfirmationText || "RESTORE TENANT tenant_id"}
            />
            <FieldDescription>Whole-tenant restore is destructive and creates a safety backup before changes.</FieldDescription>
          </Field>

          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => previewWholeRestoreMutation.mutate()} disabled={previewWholeRestoreMutation.isPending || !restoreRunId}>
              {previewWholeRestoreMutation.isPending ? "Previewing..." : "Preview Whole Tenant"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => executeWholeRestoreMutation.mutate()}
              disabled={executeWholeRestoreMutation.isPending || !restoreRunId || !wholeRestoreConfirmationText || wholeRestoreConfirmation !== wholeRestoreConfirmationText}
            >
              <RotateCcw />{executeWholeRestoreMutation.isPending ? "Restoring..." : "Restore Whole Tenant"}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="px-5 py-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-copy-primary">Recent Backup Runs</h2>
          <p className="mt-1 text-sm text-copy-muted">Tenant backup artifacts are separate from platform backups.</p>
        </div>
        <div className="overflow-x-auto rounded-[var(--radius-control)] border border-line-subtle">
        <Table className="min-w-[880px]">
          <TableHeader>
            <TableHeaderRow>
              <TableHead>Run</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Modules</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Upload</TableHead>
              <TableHead>Completed</TableHead>
              <TableHead>Action</TableHead>
            </TableHeaderRow>
          </TableHeader>
          <TableBody>
            {runsQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-copy-muted" aria-busy="true">Loading backup runs...</TableCell>
              </TableRow>
            ) : runsQuery.isError ? (
              <TableRow>
                <TableCell colSpan={8} className="py-6 text-center">
                  <div role="alert" className="mx-auto max-w-lg text-sm text-copy-secondary">
                    <p>Recent backup runs could not be loaded.</p>
                    <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void runsQuery.refetch()}>
                      <RotateCcw />Try again
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (runsQuery.data ?? []).length ? (
              (runsQuery.data ?? []).map((run) => (
                <TableRow key={run.id}>
                  <TableCell>#{run.id}</TableCell>
                  <TableCell>
                    <Pill
                      bg={run.status === "completed" ? "bg-state-success-muted" : run.status === "failed" ? "bg-state-danger-muted" : "bg-state-warning-muted"}
                      text={run.status === "completed" ? "text-state-success" : run.status === "failed" ? "text-state-danger" : "text-state-warning"}
                      border={run.status === "completed" ? "border-state-success/40" : run.status === "failed" ? "border-state-danger/40" : "border-state-warning/40"}
                    >
                      {run.status}
                    </Pill>
                  </TableCell>
                  <TableCell>{run.scope === "full_tenant" ? "Full tenant" : "Selected"}</TableCell>
                  <TableCell>{run.modules_included.length}</TableCell>
                  <TableCell>{formatBytes(run.size_bytes)}</TableCell>
                  <TableCell>
                    <Pill
                      bg={run.destination_upload_status === "failed" ? "bg-state-danger-muted" : run.destination_upload_status === "uploaded" ? "bg-state-success-muted" : "bg-surface-muted"}
                      text={run.destination_upload_status === "failed" ? "text-state-danger" : run.destination_upload_status === "uploaded" ? "text-state-success" : "text-copy-muted"}
                      border={run.destination_upload_status === "failed" ? "border-state-danger/40" : run.destination_upload_status === "uploaded" ? "border-state-success/40" : "border-line-default"}
                    >
                      {run.destination_upload_status.replaceAll("_", " ")}
                    </Pill>
                  </TableCell>
                  <TableCell>{run.completed_at ? formatDateTime(run.completed_at) : "-"}</TableCell>
                  <TableCell>
                    {run.status === "completed" && run.storage_ref ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            void downloadRun(run).catch((error) => toast.error(error instanceof Error ? error.message : "Download failed."));
                          }}
                        >
                          <Download />Download
                        </Button>
                        <Button
                          type="button"
                          variant="dangerGhost"
                          size="sm"
                          onClick={() => void confirmDeleteRun(run)}
                          disabled={deleteRunMutation.isPending}
                        >
                          <Trash2 />Delete
                        </Button>
                      </div>
                    ) : run.error_message ? (
                      <span className="text-xs text-state-danger">Backup failed. Try again or review the destination.</span>
                    ) : (
                      <span className="text-xs text-copy-muted">Unavailable</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="p-0">
                  <EmptyState
                    icon={Archive}
                    title="No tenant backup runs yet"
                    description="Run a backup to create the first tenant-scoped artifact."
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>
      </Card>
    </div>
  );
}
