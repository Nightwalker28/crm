"use client";

import { useMemo, useState } from "react";

import { FormSection } from "@/components/forms/RecordFormLayout";
import { RecordLayoutBuilder } from "@/components/recordLayouts/RecordLayoutBuilder";
import { RecordLayoutPreview } from "@/components/recordLayouts/RecordLayoutPreview";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { PageShell } from "@/components/ui/PageShell";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import type { RecordLayoutSurface } from "@/lib/contracts/recordLayouts";
import { RECORD_LAYOUT_SURFACE_LABELS, RECORD_LAYOUT_TARGETS, recordLayoutTarget } from "@/lib/recordLayoutTargets";
import {
  DEFAULT_AUDIENCE,
  RecordLayoutAdminError,
  audienceKey,
  useLayoutAudiences,
  useRecordLayoutAdminState,
  useRecordLayoutOverrides,
  useRecordLayoutResolvedAs,
  type LayoutAudience,
} from "@/hooks/useRecordLayoutAdmin";

/**
 * Record layouts for every module and surface (13b Phase 4 slice 4d): quick create, the full
 * form and the details of the CRM records, and the full form and details header of quotes,
 * orders, catalog items and every ERP document. Line editors stay fixed.
 *
 * Each layout is for an audience (slice 4c): the workspace default, one role or one team.
 * An override is a complete layout; a user sees their team's, else their role's, else the
 * workspace default (13b §5 decision 10).
 */

function parseAudience(value: string): LayoutAudience {
  const [kind, id] = value.split(":");
  if ((kind === "role" || kind === "team") && Number(id) > 0) return { kind, id: Number(id) };
  return DEFAULT_AUDIENCE;
}

export default function RecordLayoutsSettingsPage() {
  const { modules, isLoading: isLoadingModules } = useAccessibleModules();
  // Only modules this user may configure (the `configure` action); the server checks again.
  const configurable = useMemo(
    () =>
      RECORD_LAYOUT_TARGETS.filter((item) =>
        modules.some((module) => module.name === item.moduleKey && module.actions?.can_configure),
      ),
    [modules],
  );
  const [preferredModule, setPreferredModule] = useState<string | null>(null);
  const [preferredSurface, setPreferredSurface] = useState<RecordLayoutSurface>("quick_create");
  // Derived, not stored: a module the user cannot configure, or a surface the module lacks,
  // falls back to the first one that works.
  const target = configurable.find((item) => item.moduleKey === preferredModule) ?? configurable[0] ?? recordLayoutTarget("");
  const moduleKey = target.moduleKey;
  const surface = target.surfaces.includes(preferredSurface) ? preferredSurface : target.surfaces[0];
  const canConfigure = configurable.length > 0;
  const [audience, setAudience] = useState<LayoutAudience>(DEFAULT_AUDIENCE);
  const [previewRoleId, setPreviewRoleId] = useState("");
  const [previewTeamId, setPreviewTeamId] = useState("");

  const layoutQuery = useRecordLayoutAdminState(moduleKey, surface, canConfigure, audience);
  const overridesQuery = useRecordLayoutOverrides(moduleKey, surface, canConfigure);
  const { roles, teams } = useLayoutAudiences(canConfigure);
  const resolvedAs = useRecordLayoutResolvedAs(
    moduleKey,
    surface,
    { roleId: previewRoleId ? Number(previewRoleId) : null, teamId: previewTeamId ? Number(previewTeamId) : null },
    canConfigure && Boolean(previewRoleId || previewTeamId),
  );

  const overridden = useMemo(() => {
    const keys = new Set<string>();
    for (const row of overridesQuery.data ?? []) {
      if (row.role_id) keys.add(`role:${row.role_id}`);
      if (row.team_id) keys.add(`team:${row.team_id}`);
    }
    return keys;
  }, [overridesQuery.data]);

  const audienceOptions = useMemo(
    () => [
      { value: "default", label: "Everyone (workspace layout)" },
      ...teams.map((team) => ({
        value: `team:${team.id}`,
        label: `Team: ${team.name}${overridden.has(`team:${team.id}`) ? " · own layout" : ""}`,
      })),
      ...roles.map((role) => ({
        value: `role:${role.id}`,
        label: `Role: ${role.name}${overridden.has(`role:${role.id}`) ? " · own layout" : ""}`,
      })),
    ],
    [overridden, roles, teams],
  );
  const audienceLabel = audienceOptions.find((option) => option.value === audienceKey(audience))?.label
    .replace(/ · own layout$/, "")
    .replace(/^(Team|Role): /, "") ?? "Everyone";

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
        title="Record layouts"
        description="Arrange the fields of each module's forms and details."
        isPermissionDenied={isForbidden}
        isLoading={isPending}
        hasError={hasError}
        errorDescription="Nothing has been changed. Try the request again."
        onRetry={() => void layoutQuery.refetch()}
        backHref="/dashboard/settings"
        backLabel="Back to settings"
      >
        {null}
      </PageShell>
    );
  }

  const state = layoutQuery.data;
  // Remount the builder whenever the published layout or the audience changes, so its draft
  // baseline is always the server's own normalised copy rather than something re-synced in
  // an effect.
  const builderKey = `${moduleKey}:${surface}:${audienceKey(audience)}:${state.source}:${state.layout_id ?? "system"}:${state.expected_version ?? 0}`;

  const toolbar = (
    <FieldGroup columns={3}>
    <Field>
      <FieldLabel htmlFor="record-layout-module">Module</FieldLabel>
      <SearchableSelect
        id="record-layout-module"
        label="Module"
        value={moduleKey}
        options={configurable.map((item) => ({ value: item.moduleKey, label: item.label }))}
        onValueChange={setPreferredModule}
      />
    </Field>
    <Field>
      <FieldLabel htmlFor="record-layout-surface">Layout</FieldLabel>
      <SearchableSelect
        id="record-layout-surface"
        label="Layout"
        value={surface}
        options={target.surfaces.map((item) => ({ value: item, label: RECORD_LAYOUT_SURFACE_LABELS[item] }))}
        onValueChange={(value) => setPreferredSurface(value as RecordLayoutSurface)}
      />
    </Field>
    <Field>
      <FieldLabel htmlFor="record-layout-audience">Layout for</FieldLabel>
      <SearchableSelect
        id="record-layout-audience"
        label="Layout for"
        value={audienceKey(audience)}
        options={audienceOptions}
        onValueChange={(value) => setAudience(parseAudience(value))}
      />
      <FieldDescription>
        A team&apos;s layout comes first, then a role&apos;s, then the workspace layout. A new one starts as a copy of the
        workspace layout.
      </FieldDescription>
    </Field>
    </FieldGroup>
  );

  const footer = (
    <FormSection
      title="Preview as"
      description="What someone with this role and team sees today, from published layouts only."
    >
      <FieldGroup columns={2}>
        <Field>
          <FieldLabel htmlFor="record-layout-preview-role">Role</FieldLabel>
          <SearchableSelect
            id="record-layout-preview-role"
            label="Role"
            value={previewRoleId}
            options={[{ value: "", label: "Any role" }, ...roles.map((role) => ({ value: String(role.id), label: role.name }))]}
            onValueChange={setPreviewRoleId}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="record-layout-preview-team">Team</FieldLabel>
          <SearchableSelect
            id="record-layout-preview-team"
            label="Team"
            value={previewTeamId}
            options={[{ value: "", label: "No team" }, ...teams.map((team) => ({ value: String(team.id), label: team.name }))]}
            onValueChange={setPreviewTeamId}
          />
        </Field>
      </FieldGroup>
      {previewRoleId || previewTeamId ? (
        <div className="mt-4">
          <RecordLayoutPreview layout={resolvedAs.data ?? null} isStale={resolvedAs.isFetching} />
        </div>
      ) : null}
    </FormSection>
  );

  return (
    <RecordLayoutBuilder
      key={builderKey}
      state={state}
      onReload={() => void layoutQuery.refetch()}
      audience={audience}
      audienceLabel={audienceLabel}
      toolbar={toolbar}
      footer={footer}
    />
  );
}
