"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import CrmRecordActivitySection from "@/components/recordActivity/CrmRecordActivitySection";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import type { CatalogKind } from "@/hooks/catalog/useCatalogRecords";
import { useCatalogRecord, useCatalogRecordActions } from "@/hooks/catalog/useCatalogRecords";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
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
  const { confirm } = useConfirm();
  const isProduct = kind === "products";
  const noun = isProduct ? "Product" : "Service";
  const moduleKey = isProduct ? "catalog_products" : "catalog_services";
  const listHref = `/dashboard/catalog/${kind}`;
  const { modules } = useAccessibleModules();
  const recordQuery = useCatalogRecord(kind, recordId);
  const { deleteRecord, isDeleting } = useCatalogRecordActions(kind);
  const record = recordQuery.data ?? null;
  const moduleActions = modules.find((module) => module.name === moduleKey)?.actions;
  const canEdit = Boolean(moduleActions?.can_edit);
  const canDelete = Boolean(moduleActions?.can_delete);

  async function handleDelete() {
    const confirmed = await confirm({
      title: `Delete ${noun.toLowerCase()}?`,
      description: record?.name
        ? `Move "${record.name}" to the Recycle Bin? It can be restored by an administrator.`
        : "Move this catalog record to the Recycle Bin? It can be restored by an administrator.",
      confirmLabel: "Move to Recycle Bin",
      variant: "destructive",
    });
    if (!confirmed) return;

    try {
      await deleteRecord(recordId);
      toast.success(`${noun} moved to the Recycle Bin.`);
      router.push(listHref);
    } catch {
      toast.error(`We could not delete this ${noun.toLowerCase()}. Try again.`);
    }
  }

  if (recordQuery.isLoading) return <RouteLoadingState label={noun.toLowerCase()} />;
  if (recordQuery.error || !record) {
    return (
      <RouteErrorState
        title={`Unable to load ${noun.toLowerCase()}`}
        reset={() => void recordQuery.refetch()}
        backHref={listHref}
        backLabel={`Back to ${kind}`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={record?.name ?? noun}
        description={record ? `${noun} catalog record` : "Loading catalog record"}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" asChild>
              <Link href={listHref}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Link>
            </Button>
            {canEdit ? (
              <Button type="button" variant="outline" asChild>
                <Link href={`${listHref}/${recordId}/edit`}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit {noun.toLowerCase()}
                </Link>
              </Button>
            ) : null}
            {canDelete ? (
              <Button type="button" variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete {noun.toLowerCase()}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="catalog-details-heading">
          <Card>
            <CardHeader>
              <div className="min-w-0">
                <h2 id="catalog-details-heading" className="text-base font-semibold text-copy-primary">Details</h2>
                {record.description ? (
                  <p className="mt-2 whitespace-pre-wrap text-p-sm text-copy-secondary">{record.description}</p>
                ) : (
                  <p className="mt-2 text-sm text-copy-muted">No description recorded.</p>
                )}
              </div>
              {record.is_active ? (
                <Pill bg="bg-state-success-muted" text="text-state-success" border="border-state-success/40">
                  Active
                </Pill>
              ) : (
                <Pill>Inactive</Pill>
              )}
            </CardHeader>
            <CardBody>
              <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                <DetailField label="Public slug" value={record.slug || "Not set"} />
                <div>
                  <dt className="text-xs font-medium text-copy-label">Website feed</dt>
                  <dd className="mt-1.5">
                    {record.is_public ? (
                      <Pill bg="bg-state-success-muted" text="text-state-success" border="border-state-success/40">
                        Public
                      </Pill>
                    ) : (
                      <Pill>Private</Pill>
                    )}
                  </dd>
                </div>
                {isProduct ? <DetailField label="SKU" value={record.sku || "Not set"} /> : null}
                <div>
                  <dt className="text-xs font-medium text-copy-label">Public base price</dt>
                  <dd className="mt-1 text-sm font-semibold text-copy-primary">
                    {formatAmount(record.public_unit_price, record.currency)}
                  </dd>
                  <p className="mt-1 text-p-xs text-copy-muted">
                    Customer-specific pricing is resolved separately for authenticated customers.
                  </p>
                </div>
                <DetailField label="Currency" value={record.currency} />
                {isProduct ? (
                  <>
                    <DetailField label="Stock status" value={stockLabel(record.stock_status)} />
                    <DetailField label="Stock quantity" value={record.stock_quantity ?? "Untracked"} />
                  </>
                ) : null}
                <DetailField label="Created" value={formatDateTime(record.created_at)} />
                <DetailField label="Updated" value={formatDateTime(record.updated_at)} />
              </dl>
            </CardBody>
          </Card>
        </section>

        <aside aria-labelledby="catalog-media-heading">
          <Card>
            <CardHeader>
              <div>
                <h2 id="catalog-media-heading" className="text-base font-semibold text-copy-primary">Media</h2>
                <p className="mt-1 text-sm text-copy-muted">Customer-facing catalog image</p>
              </div>
            </CardHeader>
            <CardBody className="pt-4">
              {record.media_url ? (
                <div>
                  <Image
                    src={resolveMediaUrl(record.media_url)}
                    alt={`${record.name} catalog image`}
                    width={320}
                    height={240}
                    unoptimized
                    className="aspect-[4/3] w-full rounded-[var(--radius-control)] object-cover"
                  />
                  {record.media_original_filename ? (
                    <p className="mt-2 truncate text-xs text-copy-muted" title={record.media_original_filename}>
                      {record.media_original_filename}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center rounded-[var(--radius-control)] border border-dashed border-line-strong bg-surface-muted text-sm text-copy-muted">
                  No media uploaded
                </div>
              )}
            </CardBody>
          </Card>
        </aside>

        <CrmRecordActivitySection
          className="xl:col-span-2"
          moduleKey={moduleKey}
          entityId={record.id}
          recordLabel={noun}
          taskSourceLabel={record.name}
        />
      </div>
    </div>
  );
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-copy-muted">{label}</dt>
      <dd className="mt-1 text-sm text-copy-primary">{value}</dd>
    </div>
  );
}
