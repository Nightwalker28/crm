"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { apiFetch } from "@/lib/api";
import { getModuleDisplayName } from "@/lib/module-display";

type GenericRecord = {
  id: number;
  module_key: string;
  title: string;
  status?: string | null;
  data?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export default function GenericSystemModulePage() {
  const params = useParams<{ moduleKey: string }>();
  const moduleKey = params.moduleKey;
  const moduleName = useMemo(() => getModuleDisplayName(moduleKey), [moduleKey]);
  const [records, setRecords] = useState<GenericRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");

  async function loadRecords() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/generic-system-modules/${moduleKey}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.detail || "Failed to load records.");
      setRecords(Array.isArray(body.results) ? body.results : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load records.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleKey]);

  async function createRecord() {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const res = await apiFetch(`/generic-system-modules/${moduleKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: nextTitle,
        status: status.trim() || null,
        data: {},
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body?.detail || "Failed to create record.");
      return;
    }
    setTitle("");
    setStatus("");
    setRecords((current) => [body, ...current]);
  }

  async function deleteRecord(recordId: number) {
    const res = await apiFetch(`/generic-system-modules/${moduleKey}/${recordId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.detail || "Failed to delete record.");
      return;
    }
    setRecords((current) => current.filter((record) => record.id !== recordId));
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-neutral-100">{moduleName}</h1>
        <p className="text-sm text-neutral-400">{moduleKey}</p>
      </header>

      <section className="grid gap-3 border-y border-neutral-800 py-4 md:grid-cols-[1fr_180px_auto]">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" />
        <Input value={status} onChange={(event) => setStatus(event.target.value)} placeholder="Status" />
        <Button type="button" onClick={createRecord} disabled={!title.trim()}>
          <Plus className="h-4 w-4" />
          Create
        </Button>
      </section>

      {error ? <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}

      <div className="overflow-hidden rounded-md border border-neutral-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-neutral-400">Loading...</TableCell>
              </TableRow>
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-neutral-400">No records yet.</TableCell>
              </TableRow>
            ) : (
              records.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="font-medium text-neutral-100">{record.title}</TableCell>
                  <TableCell className="text-neutral-300">{record.status || "None"}</TableCell>
                  <TableCell className="text-neutral-400">{new Date(record.updated_at).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <Button type="button" variant="ghost" size="sm" onClick={() => void deleteRecord(record.id)} aria-label={`Delete ${record.title}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </main>
  );
}
