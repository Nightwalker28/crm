"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import __Module__Form from "@/components/__modules__/__Module__Form";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { create__Module__ } from "@/hooks/__area__/use__Modules__";
import type { __Module__CreateRequest, __Module__UpdateRequest } from "@/types/__modules__";

export default function __Module__CreatePage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(payload: __Module__CreateRequest | __Module__UpdateRequest) {
    try {
      setSaving(true);
      setError(null);
      const record = await create__Module__(payload as __Module__CreateRequest);
      router.push(`__route_prefix__/${record.__id_field__}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create __display_name__");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <RecordPageHeader backHref="__route_prefix__" backLabel="Back to __display_name__" title="Create __Module__" description="Create a new record." />
      <__Module__Form submitLabel="Create" isSubmitting={saving} error={error} onSubmit={handleSubmit} />
    </div>
  );
}
