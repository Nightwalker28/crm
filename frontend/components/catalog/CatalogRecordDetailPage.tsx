"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";

import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import { ReadOnlyRecordLayout } from "@/components/forms/ReadOnlyRecordLayout";
import RecordAuditHistory from "@/components/recordActivity/RecordAuditHistory";
import RecordDeleteButton from "@/components/recordActivity/RecordDeleteButton";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import RecordTimeline from "@/components/recordActivity/RecordTimeline";
import {
  RecordWorkspace,
  recordEditHref,
} from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { InlineFieldEdit, type InlineFieldEditOption } from "@/components/ui/InlineFieldEdit";
import { PanelError, PanelLoading } from "@/components/ui/PanelStates";
import {
  RecordSpine,
  RecordSpineBlock,
  RecordSpineField,
  RecordSpineMeta,
} from "@/components/ui/RecordSpine";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusValue } from "@/components/ui/StatusValue";
import type { CatalogKind, CatalogRecord } from "@/hooks/catalog/useCatalogRecords";
import { useCatalogRecord, useCatalogRecordActions } from "@/hooks/catalog/useCatalogRecords";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import {
  useResolvedRecordLayout,
  type ResolvedRecordLayout as ResolvedRecordLayoutContract,
} from "@/hooks/useResolvedRecordLayout";
import { formatMoney } from "@/lib/currency";
import { formatDateTime } from "@/lib/datetime";
import { resolveMediaUrl } from "@/lib/media";
import {
  getCatalogActiveState,
  getCatalogStockStatus,
  getCatalogVisibility,
} from "@/lib/statusStyles";

type Props = {
  kind: CatalogKind;
  recordId: number;
};

const STOCK_STATUS_VALUES = ["untracked", "in_stock", "out_of_stock", "preorder"] as const;

const STOCK_STATUS_OPTIONS: InlineFieldEditOption[] = STOCK_STATUS_VALUES.map((value) => ({
  value,
  ...getCatalogStockStatus(value),
}));

/**
 * The two named-state booleans, as two-option sets (design.md §4.7).
 *
 * `InlineFieldEdit` holds a string, so the pair is `"true"` / `"false"` and the call site
 * converts on commit — which keeps the control's contract about a closed set of options
 * rather than growing a boolean mode for two fields.
 */
const ACTIVE_OPTIONS: InlineFieldEditOption[] = [
  { value: "true", ...getCatalogActiveState(true) },
  { value: "false", ...getCatalogActiveState(false) },
];

const VISIBILITY_OPTIONS: InlineFieldEditOption[] = [
  { value: "true", ...getCatalogVisibility(true) },
  { value: "false", ...getCatalogVisibility(false) },
];

/**
 * Fields `Details` must not draw a second time (design.md §4.7): the header owns the name,
 * and the spine owns the three State fields.
 */
const SPINE_OWNED_FIELDS = ["name", "is_active", "is_public", "stock_status"] as const;

const MONEY_FIELDS = new Set(["public_unit_price"]);

export default function CatalogRecordDetailPage({ kind, recordId }: Props) {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { modules } = useAccessibleModules();
  const activeTab = searchParams.get("tab");

  const isProduct = kind === "products";
  const noun = isProduct ? "Product" : "Service";
  const moduleKey = isProduct ? "catalog_products" : "catalog_services";
  const listHref = `/dashboard/catalog/${kind}`;
  const recordHref = `${listHref}/${recordId}`;

  const moduleActions = (key: string) => modules.find((module) => module.name === key)?.actions;
  const catalogActions = moduleActions(moduleKey);
  const taskActions = moduleActions("tasks");
  const documentActions = moduleActions("documents");
  const canEdit = Boolean(catalogActions?.can_edit);
  const canDelete = Boolean(catalogActions?.can_delete);
  const canViewTasks = Boolean(taskActions?.can_view);
  const canViewDocuments = Boolean(documentActions?.can_view);

  const recordQuery = useCatalogRecord(kind, recordId);
  const { patchRecord } = useCatalogRecordActions(kind);
  const detailLayoutQuery = useResolvedRecordLayout(moduleKey, "detail");

  const record = recordQuery.data ?? null;
  const recordName = record?.name ?? noun;

  async function patch(payload: Parameters<typeof patchRecord>[1]) {
    await patchRecord(recordId, payload);
    await queryClient.invalidateQueries({
      queryKey: ["record-audit-history", moduleKey, String(recordId)],
    });
  }

  return (
    <RecordWorkspace
      title={recordName}
      description={`Review this ${noun.toLowerCase()}'s catalog listing, pricing, and activity.`}
      backHref={listHref}
      backLabel={isProduct ? "Products" : "Services"}
      isLoading={recordQuery.isLoading || (!record && !recordQuery.error)}
      hasError={Boolean(recordQuery.error)}
      onRetry={() => void recordQuery.refetch()}
      status={record ? <StatusValue status={getCatalogActiveState(record.is_active)} context="record" /> : null}
      subtitle={record ? (
        <>
          <span>{noun}</span>
          {formatMoney(record.public_unit_price, record.currency) ? (
            <span>{formatMoney(record.public_unit_price, record.currency)}</span>
          ) : null}
        </>
      ) : null}
      /*
       * No filled button: a catalog record has no workflow to advance — what changes about it
       * is whether it is active, public and in stock, and the rail owns all three (§4.7).
       */
      actions={record && canEdit ? (
        <Button asChild variant="outline">
          <Link href={recordEditHref(`${recordHref}/edit`, activeTab)}>
            <Pencil />
            Edit
          </Link>
        </Button>
      ) : null}
      overflowActions={record && canDelete ? (
        <RecordDeleteButton
          as="menuItem"
          endpoint={`/catalog/${kind}/${recordId}`}
          label={noun}
          recordName={recordName}
          redirectHref={listHref}
          queryKeys={["catalog"]}
        />
      ) : null}
      spine={
        <RecordSpine>
          {record ? (
            <>
              {/*
                No lifecycle track: a catalog record has no pipeline, only independent flags.
                And no `Connected` block — neither schema carries a relationship column, so a
                heading over nothing would promise a link the data model does not have (§4.7).
              */}
              <RecordSpineBlock title="State">
                <RecordSpineField label="Active">
                  {canEdit ? (
                    <InlineFieldEdit
                      fieldLabel="Active"
                      value={String(record.is_active)}
                      options={ACTIVE_OPTIONS}
                      onCommit={(next) => patch({ is_active: next.value === "true" })}
                    />
                  ) : (
                    <StatusValue status={getCatalogActiveState(record.is_active)} context="record" />
                  )}
                </RecordSpineField>
                <RecordSpineField label="Website feed">
                  {canEdit ? (
                    <InlineFieldEdit
                      fieldLabel="Website feed"
                      value={String(record.is_public)}
                      options={VISIBILITY_OPTIONS}
                      onCommit={(next) => patch({ is_public: next.value === "true" })}
                    />
                  ) : (
                    <StatusValue status={getCatalogVisibility(record.is_public)} context="record" />
                  )}
                </RecordSpineField>
                {isProduct ? (
                  <RecordSpineField label="Stock status">
                    {canEdit ? (
                      <InlineFieldEdit
                        fieldLabel="Stock status"
                        value={record.stock_status ?? "untracked"}
                        options={STOCK_STATUS_OPTIONS}
                        onCommit={(next) => patch({ stock_status: next.value })}
                      />
                    ) : (
                      <StatusValue
                        status={getCatalogStockStatus(record.stock_status ?? "untracked")}
                        context="record"
                      />
                    )}
                  </RecordSpineField>
                ) : null}
              </RecordSpineBlock>

              <RecordSpineMeta
                createdLabel={`Created ${formatDateTime(record.created_at)}`}
                updatedLabel={`Updated ${formatDateTime(record.updated_at)}`}
                history={<RecordAuditHistory moduleKey={moduleKey} entityId={record.id} />}
              />
            </>
          ) : null}
        </RecordSpine>
      }
      details={record ? (
        <CatalogOverview
          record={record}
          noun={noun}
          layout={detailLayoutQuery.data}
          isLayoutLoading={detailLayoutQuery.isLoading}
          layoutError={detailLayoutQuery.error}
          onRetryLayout={() => void detailLayoutQuery.refetch()}
        />
      ) : null}
      timeline={record ? (
        // Note-only: a catalog record has no follow-up endpoint. You call a person, not a SKU.
        <RecordTimeline moduleKey={moduleKey} entityId={record.id} canEdit={canEdit} />
      ) : undefined}
      tasks={record && canViewTasks ? (
        <RecordTasksPanel
          moduleKey={moduleKey}
          entityId={record.id}
          sourceLabel={recordName}
          canCreate={Boolean(taskActions?.can_create)}
          canEdit={Boolean(taskActions?.can_edit)}
          createActionVariant="outline"
        />
      ) : undefined}
      files={record && canViewDocuments ? (
        <RecordDocumentsPanel
          moduleKey={moduleKey}
          entityId={record.id}
          canUpload={Boolean(documentActions?.can_create) && canEdit}
          canEdit={Boolean(documentActions?.can_edit) && canEdit}
          canDelete={Boolean(documentActions?.can_delete) && canEdit}
        />
      ) : undefined}
    />
  );
}

/**
 * `Details`: the resolved layout, then the catalog image.
 *
 * The image renders under the layout for the same reason a quote's line items do — it is the
 * record's customer-facing body rather than one of its fields, and there is no field type
 * that draws a picture. Uploading it stays on `/[id]/edit`, which is where the file input is.
 */
function CatalogOverview({
  record,
  noun,
  layout,
  isLayoutLoading,
  layoutError,
  onRetryLayout,
}: {
  record: CatalogRecord;
  noun: string;
  layout?: ResolvedRecordLayoutContract;
  isLayoutLoading: boolean;
  layoutError: Error | null;
  onRetryLayout: () => void;
}) {
  if (isLayoutLoading || !layout) {
    return (
      <Card className="px-5 py-5">
        {layoutError ? (
          <PanelError
            message={`The ${noun.toLowerCase()} details layout could not be loaded.`}
            onRetry={onRetryLayout}
          />
        ) : (
          <PanelLoading label={`Loading ${noun.toLowerCase()} details…`} />
        )}
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <ReadOnlyRecordLayout
        layout={layout}
        values={record as unknown as Record<string, unknown>}
        omitFieldKeys={SPINE_OWNED_FIELDS}
        renderValue={(field, value) =>
          MONEY_FIELDS.has(field.field_key)
            ? formatMoney(value as string | number | null, record.currency, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
              }) ?? undefined
            : undefined
        }
      />
      <Card className="px-5 py-5">
        <SectionHeading>Catalog image</SectionHeading>
        <div className="mt-4 max-w-xs">
          {record.media_url ? (
            <>
              <Image
                src={resolveMediaUrl(record.media_url)}
                alt={`${record.name} catalog image`}
                width={320}
                height={240}
                unoptimized
                className="aspect-[4/3] w-full rounded-[var(--radius-control)] object-cover"
              />
              {record.media_original_filename ? (
                <p className="mt-2 truncate text-p-xs text-copy-muted" title={record.media_original_filename}>
                  {record.media_original_filename}
                </p>
              ) : null}
            </>
          ) : (
            <div className="flex aspect-[4/3] w-full items-center justify-center rounded-[var(--radius-control)] border border-dashed border-line-strong bg-surface-muted text-sm text-copy-muted">
              No image uploaded
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
