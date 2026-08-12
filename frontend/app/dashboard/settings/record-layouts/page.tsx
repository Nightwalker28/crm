"use client";

import { RecordLayoutBuilder } from "@/components/recordLayouts/RecordLayoutBuilder";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { PermissionDeniedState } from "@/components/ui/PermissionDeniedState";
import { RouteLoadingState } from "@/components/ui/RouteStates";
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

  if (isLoadingModules) return <RouteLoadingState label="record layouts" />;
  if (!canConfigure) return <PermissionDeniedState />;
  // The client check is a courtesy; the server is the boundary and can still say no.
  if (layoutQuery.error instanceof RecordLayoutAdminError && layoutQuery.error.kind === "forbidden") {
    return <PermissionDeniedState />;
  }

  if (layoutQuery.isPending) return <RouteLoadingState label="record layouts" />;

  if (layoutQuery.error || !layoutQuery.data) {
    return (
      <Card className="p-6" role="alert">
        <h1 className="font-semibold text-copy-primary">The layout could not be loaded</h1>
        <p className="mt-1 text-p-sm text-copy-secondary">
          Nothing has been changed. Try the request again.
        </p>
        <Button className="mt-4" variant="outline" onClick={() => void layoutQuery.refetch()}>Try again</Button>
      </Card>
    );
  }

  const state = layoutQuery.data;
  // Remount the builder whenever the published layout changes, so its draft baseline is
  // always the server's own normalised copy rather than something re-synced in an effect.
  const builderKey = `${state.source}:${state.layout_id ?? "system"}:${state.expected_version ?? 0}`;

  return <RecordLayoutBuilder key={builderKey} state={state} onReload={() => void layoutQuery.refetch()} />;
}
