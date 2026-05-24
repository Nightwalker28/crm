"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import __Module__Form from "@/components/__modules__/__Module__Form";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { get__Module__, update__Module__ } from "@/hooks/__area__/use__Modules__";
import type { __Module__, __Module__CreateRequest, __Module__UpdateRequest } from "@/types/__modules__";

export default function __Module__EditPage() {
  const params = useParams<{ __id_field__: string }>();
  const router = useRouter();
  const [record, setRecord] = useState<__Module__ | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function handleSubmit(payload: __Module__CreateRequest | __Module__UpdateRequest) {
    try {
      setSaving(true);
      setError(null);
      const updated = await update__Module__(params.__id_field__, payload);
      toast.success("__Module__ updated.");
      router.push(`__route_prefix__/${updated.__id_field__}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update record");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <RecordPageHeader backHref={`__route_prefix__/${params.__id_field__}`} backLabel="Back to __Module__" title="Edit __Module__" description="Update record details." />
      {loading ? <div className="rounded-md border border-neutral-800 px-5 py-5 text-sm text-neutral-500">Loading record...</div> : null}
      {!loading && record ? <__Module__Form initialRecord={record} submitLabel="Save" isSubmitting={saving} error={error} onSubmit={handleSubmit} /> : null}
      {!loading && !record && error ? <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}
    </div>
  );
}
