/**
 * Domain adapter for the generated record-layout contract.
 *
 * This is the only module allowed to import from "@/contracts/generated". Product code
 * imports the domain names below (or the hooks that wrap them) so a regenerated contract
 * shows up as a compile error here rather than as scattered churn across the UI.
 *
 * Transport rule: every call goes through `apiFetch`, which retries GET/HEAD only.
 * The generated artifacts are types, not a client, so codegen cannot introduce a second
 * HTTP path or retry a write. Adding a layout write endpoint means calling `apiFetch`
 * with an explicit method here — never generating a client that retries it.
 */

import type { components, paths } from "@/contracts/generated/record-layouts";
import { apiFetch } from "@/lib/api";

type Schemas = components["schemas"];

export type ResolvedRecordLayoutField = Schemas["ResolvedRecordLayoutField"];
export type ResolvedRecordLayoutSection = Schemas["ResolvedRecordLayoutSection"];

export type RecordLayoutSurface = Schemas["ResolvedRecordLayoutResponse"]["surface"];
export type RecordLayoutRegion = ResolvedRecordLayoutSection["region"];
export type RecordLayoutWidth = ResolvedRecordLayoutField["width"];
export type RecordLayoutSource = Schemas["ResolvedRecordLayoutResponse"]["source"];
export type RecordLayoutFieldSource = ResolvedRecordLayoutField["field_source"];

/**
 * `warnings` is optional in the contract because the backend defaults it. Renderers treat
 * it as always present, so the adapter narrows it once instead of at every call site.
 */
export type ResolvedRecordLayout = Omit<Schemas["ResolvedRecordLayoutResponse"], "warnings"> & {
  warnings: string[];
};

/**
 * Typed against the generated `paths`, so renaming or removing the backend route breaks
 * this file at compile time instead of failing at runtime.
 */
const RESOLVED_LAYOUT_TEMPLATE: keyof paths =
  "/api/v1/record-layouts/{module_key}/{surface}/resolved";

/** `apiFetch` paths are relative to the configured API base, which already ends in /api/v1. */
const API_BASE_PREFIX = "/api/v1";

/**
 * Turns a map keyed by a contract union into a runtime list. Because the key set must match
 * the union exactly, a regenerated contract that adds or drops an enum value fails to compile
 * here instead of silently slipping past the runtime checks below.
 */
function contractLiterals<T extends string>(map: Record<T, true>): readonly T[] {
  return Object.keys(map) as T[];
}

const LAYOUT_SURFACES = contractLiterals<RecordLayoutSurface>({
  quick_create: true,
  detail: true,
  full_form: true,
});
const LAYOUT_SOURCES = contractLiterals<RecordLayoutSource>({ system: true, tenant: true });
const LAYOUT_REGIONS = contractLiterals<RecordLayoutRegion>({ main: true, sidebar: true });
const LAYOUT_WIDTHS = contractLiterals<RecordLayoutWidth>({ full: true, half: true });
const LAYOUT_FIELD_SOURCES = contractLiterals<RecordLayoutFieldSource>({
  system: true,
  custom_field: true,
});

export type RecordLayoutContractErrorKind = "http" | "malformed_response";

/**
 * The error boundary for this contract family. Callers can branch on `kind`/`status`
 * instead of matching on message text.
 */
export class RecordLayoutContractError extends Error {
  readonly kind: RecordLayoutContractErrorKind;
  readonly status: number | null;

  constructor(message: string, options: { kind: RecordLayoutContractErrorKind; status?: number | null }) {
    super(message);
    this.name = "RecordLayoutContractError";
    this.kind = options.kind;
    this.status = options.status ?? null;
  }
}

function resolvedLayoutPath(moduleKey: string, surface: RecordLayoutSurface) {
  const path = RESOLVED_LAYOUT_TEMPLATE.replace("{module_key}", encodeURIComponent(moduleKey)).replace(
    "{surface}",
    encodeURIComponent(surface),
  );
  return path.startsWith(API_BASE_PREFIX) ? path.slice(API_BASE_PREFIX.length) : path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function malformed(detail: string): never {
  throw new RecordLayoutContractError(`The record layout response did not match the contract: ${detail}`, {
    kind: "malformed_response",
  });
}

/**
 * Generated types are erased at runtime, so the payload is checked here before it reaches
 * the renderer. A backend contract change that slips past the CI drift check fails loudly
 * at the boundary rather than rendering a half-built layout.
 */
function parseResolvedRecordLayout(body: unknown): ResolvedRecordLayout {
  if (!isRecord(body)) malformed("the body was not an object");
  if (typeof body.module_key !== "string") malformed("module_key was missing");
  if (typeof body.name !== "string") malformed("name was missing");
  if (typeof body.version !== "number") malformed("version was missing");
  if (typeof body.can_customize !== "boolean") malformed("can_customize was missing");
  if (!oneOf(body.surface, LAYOUT_SURFACES)) malformed(`surface was ${String(body.surface)}`);
  if (!oneOf(body.source, LAYOUT_SOURCES)) malformed(`source was ${String(body.source)}`);
  if (!Array.isArray(body.sections)) malformed("sections was not an array");

  const sections = body.sections.map((section): ResolvedRecordLayoutSection => {
    if (!isRecord(section)) malformed("a section was not an object");
    if (typeof section.id !== "string") malformed("a section was missing id");
    if (typeof section.label !== "string") malformed(`section ${section.id} was missing label`);
    if (typeof section.position !== "number") malformed(`section ${section.id} was missing position`);
    if (typeof section.collapsed_by_default !== "boolean") {
      malformed(`section ${section.id} was missing collapsed_by_default`);
    }
    if (!oneOf(section.region, LAYOUT_REGIONS)) malformed(`section ${section.id} had region ${String(section.region)}`);
    if (!Array.isArray(section.fields)) malformed(`section ${section.id} had no field list`);

    const fields = section.fields.map((field): ResolvedRecordLayoutField => {
      if (!isRecord(field)) malformed(`section ${section.id} contained a non-object field`);
      if (typeof field.field_key !== "string") malformed(`section ${section.id} contained a field without a key`);
      const key = field.field_key;
      if (typeof field.label !== "string") malformed(`field ${key} was missing label`);
      if (typeof field.field_type !== "string") malformed(`field ${key} was missing field_type`);
      if (typeof field.position !== "number") malformed(`field ${key} was missing position`);
      if (typeof field.visible !== "boolean") malformed(`field ${key} was missing visible`);
      if (typeof field.required !== "boolean") malformed(`field ${key} was missing required`);
      if (typeof field.readonly !== "boolean") malformed(`field ${key} was missing readonly`);
      if (!oneOf(field.width, LAYOUT_WIDTHS)) malformed(`field ${key} had width ${String(field.width)}`);
      if (!oneOf(field.field_source, LAYOUT_FIELD_SOURCES)) {
        malformed(`field ${key} had field_source ${String(field.field_source)}`);
      }
      return {
        field_key: key,
        label: field.label,
        field_type: field.field_type,
        field_source: field.field_source,
        position: field.position,
        width: field.width,
        visible: field.visible,
        required: field.required,
        readonly: field.readonly,
        placeholder: typeof field.placeholder === "string" ? field.placeholder : null,
        help_text: typeof field.help_text === "string" ? field.help_text : null,
      };
    });

    return {
      id: section.id,
      label: section.label,
      position: section.position,
      region: section.region,
      collapsed_by_default: section.collapsed_by_default,
      fields,
    };
  });

  return {
    layout_id: typeof body.layout_id === "number" ? body.layout_id : null,
    module_key: body.module_key,
    surface: body.surface,
    name: body.name,
    source: body.source,
    version: body.version,
    can_customize: body.can_customize,
    sections,
    warnings: Array.isArray(body.warnings) ? body.warnings.filter((item): item is string => typeof item === "string") : [],
  };
}

function errorDetail(body: unknown) {
  if (isRecord(body) && typeof body.detail === "string") return body.detail;
  return "The record layout could not be loaded.";
}

/** Reads a resolved layout. GET only — see the transport rule at the top of this file. */
export async function fetchResolvedRecordLayout(
  moduleKey: string,
  surface: RecordLayoutSurface,
): Promise<ResolvedRecordLayout> {
  const response = await apiFetch(resolvedLayoutPath(moduleKey, surface));
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new RecordLayoutContractError(errorDetail(body), { kind: "http", status: response.status });
  }
  return parseResolvedRecordLayout(body);
}
