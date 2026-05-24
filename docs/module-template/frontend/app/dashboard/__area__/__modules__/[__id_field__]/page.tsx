"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import RecordActivityTimeline from "@/components/recordActivity/RecordActivityTimeline";
import RecordCommentsPanel from "@/components/recordActivity/RecordCommentsPanel";
import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { RecordTabs } from "@/components/ui/RecordTabs";
import { delete__Module__, get__Module__ } from "@/hooks/__area__/use__Modules__";
import { formatDateTime } from "@/lib/datetime";
import type { __Module__ } from "@/types/__modules__";

export default function __Module__DetailPage() {
  const params = useParams<{ __id_field__: string }>();
  const router = useRouter();
  const [record, setRecord] = useState<__Module__ | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const next = await get__Module__(params.__id_field__);
        if (!cancelled) setRecord(next);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load record");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [params.__id_field__]);

  async function handleDelete() {
    try {
      setDeleting(true);
      await delete__Module__(params.__id_field__);
      toast.success("__Module__ deleted.");
      router.push("__route_prefix__");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete record");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <RecordPageHeader
        backHref="__route_prefix__"
        backLabel="Back to __display_name__"
        title={record?.name || "__Module__"}
        description={record?.created_time ? `Created ${formatDateTime(record.created_time)}` : "Record details"}
        primaryAction={<Button asChild><Link href={`__route_prefix__/${params.__id_field__}/edit`}>Edit</Link></Button>}
      />
      {error ? <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}
      {loading || !record ? (
        <Card className="px-5 py-5 text-sm text-neutral-500">Loading record...</Card>
      ) : (
        <>
          <Card className="px-5 py-5">
            <dl className="grid gap-4 md:grid-cols-2">
              <Field label="Name" value={record.name ?? "-"} />
              <Field label="Status" value={record.status ?? "-"} />
              <Field label="Description" value={record.description ?? "-"} />
              <Field label="Created" value={record.created_time ? formatDateTime(record.created_time) : "-"} />
            </dl>
            <div className="mt-5 flex justify-end">
              <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>{deleting ? "Deleting..." : "Delete"}</Button>
            </div>
          </Card>
          <RecordTabs
            tabs={[
              { id: "activity", label: "Activity", content: <RecordActivityTimeline moduleKey="__MODULE_KEY__" entityId={record.__id_field__} description="Record create, update, delete, restore, and note history." /> },
              { id: "notes", label: "Notes", content: <RecordCommentsPanel moduleKey="__MODULE_KEY__" entityId={record.__id_field__} /> },
              { id: "documents", label: "Documents", content: <RecordDocumentsPanel moduleKey="__MODULE_KEY__" entityId={record.__id_field__} /> },
              { id: "tasks", label: "Tasks", content: <RecordTasksPanel moduleKey="__MODULE_KEY__" entityId={record.__id_field__} /> },
            ]}
          />
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-1 text-sm text-neutral-100">{value}</dd>
    </div>
  );
}
