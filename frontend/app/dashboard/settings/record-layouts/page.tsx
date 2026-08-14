"use client";

import { RecordLayoutBuilder } from "@/components/recordLayouts/RecordLayoutBuilder";
import { PageShell } from "@/components/ui/PageShell";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { RecordLayoutAdminError, useRecordLayoutAdminState } from "@/hooks/useRecordLayoutAdmin";

/**
 * Record layouts, bounded to the one surface the layout engine has proven: Lead Quick
 * Create. The module/surface pair is fixed on purpose — the backend only administers
 * `sales_leads` / `quick_create`, and widening it is a deliberate change on both sides
 * rather than a picker the page happens to expose.
 */
const LAYOUT_MODULE_KEY = "sales_leads";
const LAYOUT_SURFACE = "quick_create" as const;

export default function RecordLayoutsSettingsPage() {
  const { modules, isLoading: isLoadingModules } = useAccessibleModules();
  const canConfigure = Boolean(
    modules.find((module) => module.name === LAYOUT_MODULE_KEY)?.actions?.can_configure,
  );

  const layoutQuery = useRecordLayoutAdminState(LAYOUT_MODULE_KEY, LAYOUT_SURFACE, canConfigure);

  // The client check is a courtesy; the server is the boundary and can still say no.
  const isForbidden =
    (!isLoadingModules && !canConfigure)
    || (layoutQuery.error instanceof RecordLayoutAdminError && layoutQuery.error.kind === "forbidden");
  const isPending = isLoadingModules || (canConfigure && layoutQuery.isPending);
  const hasError = !isForbidden && !isPending && Boolean(layoutQuery.error || !layoutQuery.data);

  if (isForbidden || isPending || hasError || !layoutQuery.data) {
    return (
      <PageShell
        variant="settings"
        title="Record Layouts"
        description="Arrange the fields on the Lead Quick Create surface."
        isPermissionDenied={isForbidden}
        isLoading={isPending}
        hasError={hasError}
        errorDescription="Nothing has been changed. Try the request again."
        onRetry={() => void layoutQuery.refetch()}
        backHref="/dashboard/settings"
        backLabel="Back to Settings"
      >
        {null}
      </PageShell>
    );
  }

  const state = layoutQuery.data;
  // Remount the builder whenever the published layout changes, so its draft baseline is
  // always the server's own normalised copy rather than something re-synced in an effect.
  const builderKey = `${state.source}:${state.layout_id ?? "system"}:${state.expected_version ?? 0}`;

  return <RecordLayoutBuilder key={builderKey} state={state} onReload={() => void layoutQuery.refetch()} />;
}
