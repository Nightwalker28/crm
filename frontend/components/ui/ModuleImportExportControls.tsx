"use client";

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

type Props = {
  importEndpoint?: string;
  exportEndpoint?: string;
  exportMethod?: "GET" | "POST";
  exportBody?: unknown;
  importLabel?: string;
  exportLabel?: string;
  fileAccept?: string;
  onImportSuccess?: () => void;
};

function getFilenameFromDisposition(header: string | null, fallback: string) {
  if (!header) return fallback;
  const match = header.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallback;
}

function getErrorMessage(body: unknown, fallback: string) {
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

export function ModuleImportExportControls({
  importEndpoint,
  exportEndpoint,
  exportMethod = "GET",
  exportBody,
  importLabel = "Import",
  exportLabel = "Export",
  fileAccept = ".csv",
  onImportSuccess,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  async function handleImport(file: File) {
    if (!importEndpoint) return;
    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiFetch(importEndpoint, {
        method: "POST",
        body: formData,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(getErrorMessage(body, `Import failed with ${res.status}`));
      }
      toast.success(getErrorMessage(body, "Import completed."));
      onImportSuccess?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setIsImporting(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  async function handleExport() {
    if (!exportEndpoint) return;
    setIsExporting(true);
    try {
      const res = await apiFetch(exportEndpoint, {
        method: exportMethod,
        headers: exportMethod === "POST" ? { "Content-Type": "application/json" } : undefined,
        body: exportMethod === "POST" && exportBody !== undefined ? JSON.stringify(exportBody) : undefined,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(getErrorMessage(body, `Export failed with ${res.status}`));
      }
      const blob = await res.blob();
      const filename = getFilenameFromDisposition(res.headers.get("Content-Disposition"), "export.csv");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {importEndpoint ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={fileAccept}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleImport(file);
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={isImporting}
          >
            <Upload />
            <span className="hidden sm:inline">{isImporting ? "Importing..." : importLabel}</span>
          </Button>
        </>
      ) : null}
      {exportEndpoint ? (
        <Button type="button" variant="outline" onClick={() => void handleExport()} disabled={isExporting}>
          <Download />
          <span className="hidden sm:inline">{isExporting ? "Exporting..." : exportLabel}</span>
        </Button>
      ) : null}
    </div>
  );
}
