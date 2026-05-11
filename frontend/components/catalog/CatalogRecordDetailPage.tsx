"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import CatalogRecordDialog from "@/components/catalog/CatalogRecordDialog";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import type { CatalogKind, CatalogRecordPayload } from "@/hooks/catalog/useCatalogRecords";
import { useCatalogRecord, useCatalogRecordActions } from "@/hooks/catalog/useCatalogRecords";
import { resolveMediaUrl } from "@/lib/media";
import { formatDateTime } from "@/lib/datetime";

type Props = {
  kind: CatalogKind;
  recordId: number;
};

function formatAmount(value: number | string | null | undefined, currency: string): string {
  if (value == null || value === "") return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(numeric);
}

function stockLabel(value?: string | null) {
  if (!value) return "Untracked";
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export default function CatalogRecordDetailPage({ kind, recordId }: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const isProduct = kind === "products";
  const noun = isProduct ? "Product" : "Service";
  const listHref = `/dashboard/catalog/${kind}`;
  const recordQuery = useCatalogRecord(kind, recordId);
  const {
    updateRecord,
    uploadMedia,
    deleteRecord,
    isSaving,
    isDeleting,
  } = useCatalogRecordActions(kind);
  const record = recordQuery.data ?? null;

  async function handleSubmit(payload: CatalogRecordPayload, mediaFile: File | null) {
    await updateRecord(recordId, payload);
    if (mediaFile) {
      await uploadMedia(recordId, mediaFile);
    }
    await recordQuery.refetch();
    toast.success(`${noun} updated.`);
  }

  async function handleDelete() {
    if (!window.confirm(`Move this ${noun.toLowerCase()} to the recycle bin?`)) {
      return;
    }

    try {
      await deleteRecord(recordId);
      toast.success(`${noun} moved to recycle bin.`);
      router.push(listHref);
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : `Failed to delete ${noun.toLowerCase()}.`);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={record?.name ?? noun}
        description={record ? `${noun} catalog record` : "Loading catalog record"}
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" asChild>
              <Link href={listHref}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Link>
            </Button>
            {record ? (
              <>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(true)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                <Button type="button" variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      {recordQuery.isLoading ? (
        <div className="rounded-md border border-neutral-800 bg-neutral-950/70 px-4 py-6 text-sm text-neutral-500">
          Loading {noun.toLowerCase()}...
        </div>
      ) : recordQuery.error ? (
        <div className="rounded-md border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {recordQuery.error instanceof Error ? recordQuery.error.message : `Failed to load ${noun.toLowerCase()}.`}
        </div>
      ) : record ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-md border border-neutral-800 bg-neutral-950/70 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-neutral-100">Details</h2>
                {record.description ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-300">{record.description}</p>
                ) : (
                  <p className="mt-2 text-sm text-neutral-500">No description recorded.</p>
                )}
              </div>
              {record.is_active ? (
                <Pill bg="bg-emerald-900/30" text="text-emerald-300" border="border-emerald-700/40" className="w-20">
                  Active
                </Pill>
              ) : (
                <Pill bg="bg-neutral-800/60" text="text-neutral-400" border="border-neutral-700/50" className="w-20">
                  Inactive
                </Pill>
              )}
            </div>

            <dl className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">Public Slug</dt>
                <dd className="mt-1 font-mono text-sm text-neutral-200">{record.slug || "-"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">Website Feed</dt>
                <dd className="mt-1 text-sm text-neutral-200">{record.is_public ? "Public" : "Private"}</dd>
              </div>
              {isProduct ? (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-neutral-500">SKU</dt>
                  <dd className="mt-1 font-mono text-sm text-neutral-200">{record.sku || "-"}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">Price</dt>
                <dd className="mt-1 text-sm font-semibold text-emerald-300">
                  {formatAmount(record.public_unit_price, record.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">Currency</dt>
                <dd className="mt-1 text-sm text-neutral-200">{record.currency}</dd>
              </div>
              {isProduct ? (
                <>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-neutral-500">Stock Status</dt>
                    <dd className="mt-1 text-sm text-neutral-200">{stockLabel(record.stock_status)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-neutral-500">Stock Quantity</dt>
                    <dd className="mt-1 text-sm text-neutral-200">{record.stock_quantity ?? "Untracked"}</dd>
                  </div>
                </>
              ) : null}
              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">Created</dt>
                <dd className="mt-1 text-sm text-neutral-300">{formatDateTime(record.created_at)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">Updated</dt>
                <dd className="mt-1 text-sm text-neutral-300">{formatDateTime(record.updated_at)}</dd>
              </div>
            </dl>
          </section>

          <aside className="rounded-md border border-neutral-800 bg-neutral-950/70 p-5">
            <h2 className="text-base font-semibold text-neutral-100">Media</h2>
            {record.media_url ? (
              <div className="mt-4">
                <Image
                  src={resolveMediaUrl(record.media_url)}
                  alt=""
                  width={320}
                  height={240}
                  unoptimized
                  className="aspect-[4/3] w-full rounded-md object-cover"
                />
                {record.media_original_filename ? (
                  <p className="mt-2 truncate text-xs text-neutral-500">{record.media_original_filename}</p>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-neutral-700 text-sm text-neutral-600">
                No media uploaded
              </div>
            )}
          </aside>
        </div>
      ) : null}

      <CatalogRecordDialog
        open={dialogOpen}
        kind={kind}
        record={record}
        isSubmitting={isSaving}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
