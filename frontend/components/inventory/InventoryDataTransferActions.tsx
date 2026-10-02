"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DataTransferJobProgress } from "@/components/ui/DataTransferJobProgress";
import { useJobPoller } from "@/hooks/useJobPoller";
import { apiFetch } from "@/lib/api";
import { downloadBlob } from "@/lib/browser";

type Job = { id: number; operation: "import" | "export" };

export function InventoryDataTransferActions({ kind, canExport, canImport = false }: { kind: "levels" | "movements"; canExport: boolean; canImport?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const completedJob = useRef<number | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const poller = useJobPoller(job?.id ?? null, (result) => {
    if (completedJob.current === result.id) return;
    completedJob.current = result.id;
    if (job?.operation === "import") {
      void client.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Opening stock import completed.");
      return;
    }
    void apiFetch(`/jobs/data-transfer/${result.id}/download`).then(async (response) => {
      if (!response.ok) throw new Error("Download failed");
      downloadBlob(await response.blob(), result.result_file_name || `inventory_${kind}.csv`);
    }).catch(() => toast.error("Export finished, but the download failed. Try exporting again."));
  }, { failureMessage: "The inventory transfer failed. Check the job notification for details." });

  async function startExport() {
    setBusy(true);
    try {
      const response = await apiFetch(`/inventory/stock/export-job?kind=${kind}`, { method: "POST" });
      if (!response.ok) throw new Error("Could not start export");
      const body = await response.json() as { job_id: number };
      completedJob.current = null;
      setJob({ id: body.job_id, operation: "export" });
      poller.start();
    } catch { toast.error("Could not start inventory export."); }
    finally { setBusy(false); }
  }

  async function startImport(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv") || file.size > 2_000_000) {
      toast.error("Choose a CSV file up to 2 MB.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await apiFetch("/inventory/stock/opening-import-job", { method: "POST", body: form });
      if (!response.ok) throw new Error("Could not start import");
      const body = await response.json() as { job_id: number };
      completedJob.current = null;
      setJob({ id: body.job_id, operation: "import" });
      poller.start();
    } catch { toast.error("Could not start opening stock import."); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }

  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      {canExport ? <Button variant="outline" disabled={busy} onClick={() => void startExport()}>Export {kind}</Button> : null}
      {canImport ? <><input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Opening stock CSV" onChange={(event) => { const file = event.target.files?.[0]; if (file) void startImport(file); }} /><Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>Import opening stock</Button></> : null}
    </div>
    {job ? <DataTransferJobProgress operation={job.operation} jobId={job.id} status={poller.status} progress={poller.progress} message={poller.message} hasError={Boolean(poller.error)} completedDescription={job.operation === "import" ? "Opening stock was posted." : "Your CSV is ready."} failureMessage={poller.error || "The job failed."} /> : null}
  </div>;
}
