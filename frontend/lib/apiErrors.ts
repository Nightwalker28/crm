/**
 * One reading of a failed response, for every form (13 §7 Step 3, H2).
 *
 * Forms used to throw the response away: the deal form replaced every failure with one
 * generic line, lead quick create showed nothing useful on a 422, and the bill form put a
 * field's error in its footer. Each form had its own `errorDetail` copy, and none of them
 * read FastAPI's validation list, which already says which field is wrong.
 *
 * The rules, in order:
 * - a 5xx never shows its `detail`: it is the server's, not the operator's (the `*-revamp`
 *   specs assert this redaction with a planted secret);
 * - a 422 list maps each entry onto its field by `loc`, with a message that names the fix
 *   (design.md §7.5), never pydantic's own wording;
 * - a 4xx string `detail` is the domain's own sentence ("This vendor's invoice … is already
 *   on BILL-…") and is shown as written. A form that knows which field such a sentence is
 *   about passes `fieldFor` to put it there.
 */

export type FieldErrors = Record<string, string>;

/**
 * A failed response, with the status kept.
 *
 * Every read path in `hooks/admin/` threw a bare `new Error("Failed to fetch …")`, which
 * discarded the one fact the page needed: **403 is not a broken page** (rebuild.md 5.6
 * batch 3). Since H2 it also carries the server's field errors, so a form can put them on
 * the fields they belong to.
 */
export class ApiError extends Error {
  readonly status: number;
  /** Server messages keyed by the payload's field path (`primary_email`, `lines.0.quantity`). */
  readonly fieldErrors: FieldErrors;

  constructor(status: number, message: string, fieldErrors: FieldErrors = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }

  get hasFieldErrors() {
    return Object.keys(this.fieldErrors).length > 0;
  }
}

/** A request that got no answer in time (`apiFetch`'s timeout, H23). */
export class RequestTimeoutError extends Error {
  readonly isWrite: boolean;

  constructor(isWrite: boolean) {
    super(
      isWrite
        ? "The server did not answer in time. Check whether the change was saved before trying again."
        : "The server did not answer in time. Try again.",
    );
    this.name = "RequestTimeoutError";
    this.isWrite = isWrite;
  }
}

type ValidationEntry = { loc?: unknown; msg?: unknown; type?: unknown; ctx?: unknown };

/** The payload path of a validation entry: `["body", "lines", 0, "quantity"]` → `lines.0.quantity`. */
function fieldPath(loc: unknown): string | null {
  if (!Array.isArray(loc) || loc.length === 0) return null;
  const [where, ...rest] = loc;
  // Path and query parameters are not form fields; the banner carries those.
  if (where !== "body" || rest.length === 0) return null;
  return rest.map(String).join(".");
}

function limit(ctx: unknown, key: string): string | null {
  if (!ctx || typeof ctx !== "object") return null;
  const value = (ctx as Record<string, unknown>)[key];
  return value === undefined || value === null ? null : String(value);
}

/** A validation entry, in words that name the fix (design.md §7.5). */
export function describeValidationEntry(entry: ValidationEntry): string {
  const type = typeof entry.type === "string" ? entry.type : "";
  const msg = typeof entry.msg === "string" ? entry.msg : "";
  const ctx = entry.ctx;
  if (type === "missing") return "Fill in this field.";
  if (type === "string_too_short") {
    const min = limit(ctx, "min_length");
    return !min || min === "1" ? "Fill in this field." : `Use at least ${min} characters.`;
  }
  if (type === "string_too_long") {
    const max = limit(ctx, "max_length");
    return max ? `Use ${max} characters or fewer.` : "Shorten this value.";
  }
  if (type === "too_short") return "Add at least one entry.";
  if (type === "too_long") return "Remove some entries.";
  if (type === "greater_than") return `Enter a number above ${limit(ctx, "gt") ?? "the minimum"}.`;
  if (type === "greater_than_equal") return `Enter ${limit(ctx, "ge") ?? "the minimum"} or more.`;
  if (type === "less_than") return `Enter a number below ${limit(ctx, "lt") ?? "the maximum"}.`;
  if (type === "less_than_equal") return `Enter ${limit(ctx, "le") ?? "the maximum"} or less.`;
  if (/^(int|float|decimal)_/.test(type) || type === "finite_number") return "Enter a number.";
  if (/^(date|datetime|time)_/.test(type)) return "Enter a valid date.";
  if (type === "bool_parsing" || type === "bool_type") return "Choose yes or no.";
  if (type === "enum" || type === "literal_error") return "Choose one of the listed options.";
  if (type.startsWith("url_")) return "Enter a full web address, starting with https://.";
  if (type === "string_pattern_mismatch") return "Check the format of this value.";
  if (type === "value_error") {
    if (/email/i.test(msg)) return "Enter a valid email address.";
    // Our own validators raise `ValueError("…")`; pydantic prefixes it.
    const own = msg.replace(/^Value error,\s*/i, "").trim();
    if (own) return own.endsWith(".") ? own : `${own}.`;
  }
  // `type: "domain"` is the backend's `field_error()` — a sentence written for the operator.
  if (type === "domain" && msg) return msg;
  return "Check this value.";
}

/**
 * Reads a failed response's body into an `ApiError`.
 *
 * `fallback` is the form's own sentence for when the server gave nothing safe to show.
 * `fieldFor` puts a 4xx domain sentence on a field when the form knows which one it is about.
 */
export function apiErrorFromBody(
  status: number,
  body: unknown,
  fallback: string,
  fieldFor?: (detail: string, status: number) => string | null | undefined,
): ApiError {
  const detail = body && typeof body === "object" && "detail" in body ? (body as { detail?: unknown }).detail : undefined;
  if (status >= 500) return new ApiError(status, fallback);

  if (Array.isArray(detail)) {
    const fieldErrors: FieldErrors = {};
    const unplaced: string[] = [];
    for (const entry of detail as ValidationEntry[]) {
      const path = fieldPath(entry?.loc);
      const message = describeValidationEntry(entry ?? {});
      if (path && !fieldErrors[path]) fieldErrors[path] = message;
      else if (!path) unplaced.push(message);
    }
    const placed = Object.keys(fieldErrors).length;
    const message = placed
      ? placed === 1 ? "Check the highlighted field." : `Check the ${placed} highlighted fields.`
      : unplaced[0] ?? fallback;
    return new ApiError(status, message, fieldErrors);
  }

  if (typeof detail === "string" && detail.trim()) {
    const field = fieldFor?.(detail, status);
    return new ApiError(status, detail, field ? { [field]: detail } : {});
  }
  return new ApiError(status, fallback);
}

export async function apiErrorFromResponse(
  response: Response,
  fallback: string,
  fieldFor?: (detail: string, status: number) => string | null | undefined,
): Promise<ApiError> {
  const body = await response.json().catch(() => null);
  return apiErrorFromBody(response.status, body, fallback, fieldFor);
}

/**
 * The message a form's banner shows for any thrown failure: the server's when it is safe,
 * the timeout's own when the request got no answer, otherwise the form's fallback.
 */
export function formErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "You do not have permission to do this. Ask an administrator to restore access.";
    return error.status >= 500 ? fallback : error.message || fallback;
  }
  if (error instanceof RequestTimeoutError) return error.message;
  if (error instanceof TypeError) return "We could not reach the server. Your entries are still here. Try again.";
  return fallback;
}

/** Field errors of any thrown failure; empty for anything that is not an `ApiError`. */
export function formFieldErrors(error: unknown): FieldErrors {
  return error instanceof ApiError ? error.fieldErrors : {};
}

/** Focuses the first field with an error, given a map from field path to input id. */
export function focusFirstFieldError(fieldErrors: FieldErrors, inputId: (field: string) => string | null | undefined) {
  if (typeof window === "undefined") return;
  for (const field of Object.keys(fieldErrors)) {
    const id = inputId(field);
    const element = id ? document.getElementById(id) : null;
    if (element) {
      window.requestAnimationFrame(() => element.focus());
      return;
    }
  }
}

/**
 * A record write that failed. `detail` keeps the domain's own 4xx sentence for callers that
 * branch on it (a duplicate email, a rejected owner); 5xx details are never kept.
 */
export class RecordMutationError extends ApiError {
  readonly detail: string | null;

  constructor(status: number, body: unknown, fallback: string) {
    const parsed = apiErrorFromBody(status, body, fallback);
    super(status, parsed.message, parsed.fieldErrors);
    this.name = "RecordMutationError";
    const raw = body && typeof body === "object" && "detail" in body ? (body as { detail?: unknown }).detail : undefined;
    this.detail = status < 500 && typeof raw === "string" ? raw : null;
  }
}
