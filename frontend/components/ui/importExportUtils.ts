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
  const encodedMatch = header.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
  const filenameMatch = header.match(/filename\s*=\s*(?:\"([^\"]+)\"|([^;]+))/i);
  const raw = encodedMatch?.[1] ?? filenameMatch?.[1] ?? filenameMatch?.[2];
  if (!raw) return fallback;

  let decoded = raw.trim().replace(/^["']|["']$/g, "");
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep a malformed encoded filename usable without exposing it as an error.
  }
  const basename = decoded.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return basename || fallback;
}
