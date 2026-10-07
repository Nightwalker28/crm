"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import {
  parseResolvedRecordLayout,
  type RecordLayoutRegion,
  type RecordLayoutSurface,
  type RecordLayoutWidth,
  type ResolvedRecordLayout,
} from "@/lib/contracts/recordLayouts";

/**
 * Client for the tenant layout builder (`/api/v1/admin/record-layouts`).
 *
 * The admin surface deliberately sits outside the generated runtime contract slice, so the
 * request/response shapes are declared here by hand and mirror
 * `backend/app/modules/platform/record_layout_schema.py`. The one exception is the preview
 * payload: it is the runtime `ResolvedRecordLayoutResponse`, so it is parsed with the
 * generated adapter's boundary check rather than trusted.
 *
 * Every call goes through `apiFetch`; only the GET is a retryable read.
 */

export type RecordLayoutFieldDefinition = {
  field_key: string;
  position: number;
  width: RecordLayoutWidth;
  visible: boolean;
  required_override: boolean | null;
  readonly: boolean | null;
};

export type RecordLayoutSectionDefinition = {
  id: string;
  label: string;
  position: number;
  region: RecordLayoutRegion;
  collapsed_by_default: boolean;
  fields: RecordLayoutFieldDefinition[];
};

export type RecordLayoutDefinition = {
  module_key: string;
  surface: RecordLayoutSurface;
  name: string;
  version: number;
  sections: RecordLayoutSectionDefinition[];
};

export type RecordLayoutCatalogField = {
  field_key: string;
  label: string;
  field_type: string;
  field_source: "system" | "custom_field";
  required: boolean;
  readonly: boolean;
  enabled: boolean;
  locked: boolean;
  locked_reason: string | null;
};

/** Blocking errors and advisory warnings stay separate all the way to the UI. */
export type RecordLayoutValidationReport = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type RecordLayoutAdminState = {
  module_key: string;
  surface: RecordLayoutSurface;
  layout_id: number | null;
  source: "system" | "tenant";
  version: number;
  expected_version: number | null;
  updated_at: string | null;
  definition: RecordLayoutDefinition;
  system_definition: RecordLayoutDefinition;
  available_fields: RecordLayoutCatalogField[];
  validation: RecordLayoutValidationReport;
  /** The audience (13b Phase 4c): both null = the workspace default. */
  role_id?: number | null;
  team_id?: number | null;
  /** A role or team with no override yet: where its starting copy came from. */
  inherits_from?: "tenant" | "system" | null;
};

/**
 * Who a layout is for: everyone (the workspace default), one role, or one team. An override
 * is a complete layout; a user sees their team's, else their role's, else the default.
 */
export type LayoutAudience = { kind: "default" } | { kind: "role"; id: number } | { kind: "team"; id: number };

export const DEFAULT_AUDIENCE: LayoutAudience = { kind: "default" };

export function audienceKey(audience: LayoutAudience) {
  return audience.kind === "default" ? "default" : `${audience.kind}:${audience.id}`;
}

function audienceQuery(audience: LayoutAudience) {
  if (audience.kind === "role") return `?role_id=${audience.id}`;
  if (audience.kind === "team") return `?team_id=${audience.id}`;
  return "";
}

export type RecordLayoutOverrideSummary = {
  layout_id: number;
  role_id: number | null;
  role_name: string | null;
  team_id: number | null;
  team_name: string | null;
  version: number;
  updated_at: string | null;
};

export type RecordLayoutPreview = {
  validation: RecordLayoutValidationReport;
  resolved: ResolvedRecordLayout | null;
};

export type RecordLayoutAdminErrorKind = "validation" | "conflict" | "forbidden" | "other";

/**
 * Callers branch on `kind` rather than on message text. `errors`/`warnings` are populated
 * from the structured 422 body so a rejected publish reports the same two lists the
 * validation panel already renders.
 */
export class RecordLayoutAdminError extends Error {
  readonly kind: RecordLayoutAdminErrorKind;
  readonly status: number;
  readonly errors: string[];
  readonly warnings: string[];
  readonly currentVersion: number | null;

  constructor(
    message: string,
    options: {
      kind: RecordLayoutAdminErrorKind;
      status: number;
      errors?: string[];
      warnings?: string[];
      currentVersion?: number | null;
    },
  ) {
    super(message);
    this.name = "RecordLayoutAdminError";
    this.kind = options.kind;
    this.status = options.status;
    this.errors = options.errors ?? [];
    this.warnings = options.warnings ?? [];
    this.currentVersion = options.currentVersion ?? null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function adminError(status: number, body: unknown): RecordLayoutAdminError {
  const detail = isRecord(body) ? body.detail : null;

  if (status === 409) {
    const message = isRecord(detail) && typeof detail.message === "string"
      ? detail.message
      : "This layout changed since you opened it. Reload to see the current version.";
    return new RecordLayoutAdminError(message, {
      kind: "conflict",
      status,
      currentVersion: isRecord(detail) && typeof detail.current_version === "number" ? detail.current_version : null,
    });
  }

  if (status === 422 && isRecord(detail)) {
    return new RecordLayoutAdminError(
      typeof detail.message === "string" ? detail.message : "This layout cannot be published.",
      { kind: "validation", status, errors: stringList(detail.errors), warnings: stringList(detail.warnings) },
    );
  }

  if (status === 401 || status === 403) {
    return new RecordLayoutAdminError("You do not have permission to configure this layout.", {
      kind: "forbidden",
      status,
    });
  }

  return new RecordLayoutAdminError(
    typeof detail === "string" ? detail : "The layout could not be saved. Please try again.",
    { kind: "other", status },
  );
}

function adminPath(moduleKey: string, surface: RecordLayoutSurface, suffix = "") {
  return `/admin/record-layouts/${encodeURIComponent(moduleKey)}/${encodeURIComponent(surface)}${suffix}`;
}

async function readJson(response: Response) {
  return response.json().catch(() => null);
}

async function request(path: string, init?: RequestInit) {
  const response = await apiFetch(path, init);
  const body = await readJson(response);
  if (!response.ok) throw adminError(response.status, body);
  return body;
}

export async function fetchRecordLayoutAdminState(
  moduleKey: string,
  surface: RecordLayoutSurface,
  audience: LayoutAudience = DEFAULT_AUDIENCE,
) {
  return (await request(adminPath(moduleKey, surface, audienceQuery(audience)))) as RecordLayoutAdminState;
}

export async function previewRecordLayout(
  moduleKey: string,
  surface: RecordLayoutSurface,
  definition: RecordLayoutDefinition,
  audience: LayoutAudience = DEFAULT_AUDIENCE,
): Promise<RecordLayoutPreview> {
  const body = (await request(adminPath(moduleKey, surface, `/preview${audienceQuery(audience)}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ definition }),
  })) as { validation: RecordLayoutValidationReport; resolved: unknown };

  return {
    validation: body.validation,
    // The preview payload is the runtime contract shape, so it clears the same check the
    // runtime renderer relies on before it reaches the same renderer.
    resolved: body.resolved ? parseResolvedRecordLayout(body.resolved) : null,
  };
}

export function useRecordLayoutAdminState(
  moduleKey: string,
  surface: RecordLayoutSurface,
  enabled = true,
  audience: LayoutAudience = DEFAULT_AUDIENCE,
) {
  return useQuery({
    queryKey: ["record-layout-admin", moduleKey, surface, audienceKey(audience)],
    queryFn: () => fetchRecordLayoutAdminState(moduleKey, surface, audience),
    enabled: Boolean(moduleKey) && enabled,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/**
 * Publishing replaces the tenant default for everyone immediately, so the resolved-layout
 * cache used by the runtime surfaces is invalidated alongside the builder's own state.
 */
export function useRecordLayoutMutations(
  moduleKey: string,
  surface: RecordLayoutSurface,
  audience: LayoutAudience = DEFAULT_AUDIENCE,
) {
  const queryClient = useQueryClient();

  function applyState(state: RecordLayoutAdminState) {
    queryClient.setQueryData(["record-layout-admin", moduleKey, surface, audienceKey(audience)], state);
    void queryClient.invalidateQueries({ queryKey: ["record-layout", moduleKey, surface] });
    void queryClient.invalidateQueries({ queryKey: ["record-layout-overrides", moduleKey, surface] });
    void queryClient.invalidateQueries({ queryKey: ["record-layout-resolved-as", moduleKey, surface] });
    return state;
  }

  const publish = useMutation({
    mutationFn: async (input: { definition: RecordLayoutDefinition; expectedVersion: number | null }) =>
      (await request(adminPath(moduleKey, surface, audienceQuery(audience)), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition: input.definition, expected_version: input.expectedVersion }),
      })) as RecordLayoutAdminState,
    onSuccess: applyState,
  });

  const reset = useMutation({
    mutationFn: async () =>
      (await request(adminPath(moduleKey, surface, audienceQuery(audience)), { method: "DELETE" })) as RecordLayoutAdminState,
    onSuccess: applyState,
  });

  return { publish, reset };
}

/** The role and team overrides a surface has, for the audience picker. */
export function useRecordLayoutOverrides(moduleKey: string, surface: RecordLayoutSurface, enabled = true) {
  return useQuery({
    queryKey: ["record-layout-overrides", moduleKey, surface],
    queryFn: async () => (await request(adminPath(moduleKey, surface, "/overrides"))) as RecordLayoutOverrideSummary[],
    enabled: Boolean(moduleKey) && enabled,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/**
 * *Preview as*: the published layout a user with this role and team sees (team wins). Not
 * the draft — the builder's own preview shows that.
 */
export function useRecordLayoutResolvedAs(
  moduleKey: string,
  surface: RecordLayoutSurface,
  as: { roleId: number | null; teamId: number | null },
  enabled = true,
) {
  return useQuery({
    queryKey: ["record-layout-resolved-as", moduleKey, surface, as.roleId, as.teamId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (as.roleId) params.set("role_id", String(as.roleId));
      if (as.teamId) params.set("team_id", String(as.teamId));
      const query = params.toString();
      return parseResolvedRecordLayout(await request(adminPath(moduleKey, surface, `/resolved-as${query ? `?${query}` : ""}`)));
    },
    enabled: Boolean(moduleKey) && enabled,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export type LayoutAudienceOption = { id: number; name: string };

/**
 * Roles and teams to pick an audience from. Both lists are administration reads; someone who
 * may configure layouts but not read them sees only the workspace default.
 */
export function useLayoutAudiences(enabled = true) {
  const roles = useQuery({
    queryKey: ["record-layout-audience-roles"],
    queryFn: async () => {
      const res = await apiFetch("/admin/users/roles/permissions");
      if (!res.ok) return [] as LayoutAudienceOption[];
      const body = (await res.json()) as { roles?: LayoutAudienceOption[] };
      return (body.roles ?? []).map((role) => ({ id: role.id, name: role.name }));
    },
    enabled,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const teams = useQuery({
    queryKey: ["record-layout-audience-teams"],
    queryFn: async () => {
      const res = await apiFetch("/admin/users/teams");
      if (!res.ok) return [] as LayoutAudienceOption[];
      return ((await res.json()) as LayoutAudienceOption[]).map((team) => ({ id: team.id, name: team.name }));
    },
    enabled,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return { roles: roles.data ?? [], teams: teams.data ?? [], isLoading: roles.isLoading || teams.isLoading };
}
