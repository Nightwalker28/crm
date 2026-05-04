export type DuplicateMode = "skip" | "overwrite" | "merge";
export type ExportMode = "all" | "current" | "selected";

export type ImportPreviewResponse = {
  source_headers: string[];
  target_headers: string[];
  required_headers: string[];
  default_duplicate_mode?: DuplicateMode;
  suggested_mapping: Record<string, string | null>;
};

export type ImportFailure = {
  row_number?: number | null;
  record_identifier?: string | null;
  reason: string;
};

export type ImportSummaryResponse = {
  message: string;
  total_rows: number;
  processed_rows: number;
  imported_rows: number;
  new_rows: number;
  skipped_rows: number;
  overwritten_rows: number;
  merged_rows: number;
  failed_rows: number;
  failures: ImportFailure[];
};

export type ImportExecutionResponse = {
  mode: "inline" | "background";
  message: string;
  summary?: ImportSummaryResponse | null;
  job_id?: number | null;
  job_status?: string | null;
};

export function getFilenameFromDisposition(header: string | null, fallback: string) {
  if (!header) return fallback;
  const match = header.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallback;
}

export function getErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object") {
    const detail = "detail" in body ? body.detail : undefined;
    const message = "message" in body ? body.message : undefined;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") {
      return detail.message;
    }
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}
