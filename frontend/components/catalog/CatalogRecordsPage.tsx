"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import CatalogRecordDialog from "@/components/catalog/CatalogRecordDialog";
import CatalogRecordsTable from "@/components/catalog/CatalogRecordsTable";
import { Button } from "@/components/ui/button";
import Pagination from "@/components/ui/Pagination";
import { PageHeader } from "@/components/ui/PageHeader";
import SearchBar from "@/components/ui/SearchBar";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import type { CatalogKind, CatalogRecord, CatalogRecordPayload } from "@/hooks/catalog/useCatalogRecords";
import { useCatalogRecords } from "@/hooks/catalog/useCatalogRecords";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS } from "@/lib/moduleViewConfigs";

type Props = {
  kind: CatalogKind;
};

export default function CatalogRecordsPage({ kind }: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const isProduct = kind === "products";
  const title = isProduct ? "Products" : "Services";
  const lowerTitle = title.toLowerCase();
  const moduleKey = isProduct ? "catalog_products" : "catalog_services";
  const definition = useMemo(() => buildModuleViewDefinition(moduleKey), [moduleKey]);
  const defaultConfig = MODULE_VIEW_DEFAULTS[moduleKey];
  const {
    views,
    selectedViewId,
    setSelectedViewId,
    draftConfig,
    setDraftConfig,
  } = useSavedViews(moduleKey, defaultConfig);
  const visibleColumns = draftConfig.visible_columns?.length ? draftConfig.visible_columns : defaultConfig.visible_columns;

  const {
    records,
    page,
    pageSize,
    totalPages,
    totalCount,
    rangeStart,
    rangeEnd,
    isLoading,
    isFetching,
    error,
    goToPage,
    onPageSizeChange,
    refresh,
    createRecord,
    uploadMedia,
    isSaving,
  } = useCatalogRecords(kind, visibleColumns, draftConfig.filters);

  const searchValue = useMemo(() => (typeof draftConfig.filters.search === "string" ? draftConfig.filters.search : ""), [draftConfig.filters.search]);

  async function handleSubmit(payload: CatalogRecordPayload, mediaFile: File | null) {
    const created = await createRecord(payload);
    if (mediaFile) {
      await uploadMedia(created.id, mediaFile);
    }
    toast.success(`${isProduct ? "Product" : "Service"} created.`);
  }

  function handleRowClick(record: CatalogRecord) {
    router.push(`/dashboard/catalog/${kind}/${record.id}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        description={`Manage first-class catalog ${lowerTitle}.`}
        actions={
          <>
            <SavedViewSelector
              moduleKey={moduleKey}
              views={views}
              selectedViewId={selectedViewId}
              onSelect={setSelectedViewId}
            />
            <Button type="button" onClick={() => setDialogOpen(true)}>
              New {isProduct ? "Product" : "Service"}
            </Button>
          </>
        }
      />

      <SearchBar
        value={searchValue}
        onChange={(value) =>
          setDraftConfig((current) => ({
            ...current,
            filters: {
              ...current.filters,
              search: value,
            },
          }))
        }
        placeholder={`Search ${lowerTitle}`}
      />

      {error ? (
        <div className="flex items-center justify-between rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
          <span>{error}</span>
          <button
            type="button"
            onClick={refresh}
            className="text-red-100 underline underline-offset-2 hover:text-red-50"
          >
            Retry
          </button>
        </div>
      ) : null}

      <CatalogRecordsTable
        kind={kind}
        records={records}
        isLoading={isLoading}
        isRefreshing={isFetching && !isLoading}
        visibleColumns={visibleColumns}
        columnOptions={definition?.columns ?? []}
        onRowClick={handleRowClick}
      />

      <Pagination
        page={page}
        totalPages={totalPages}
        totalCount={totalCount}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        pageSize={pageSize}
        isRefreshing={isFetching && !isLoading}
        onPageChange={goToPage}
        onPageSizeChange={onPageSizeChange}
      />

      <CatalogRecordDialog
        open={dialogOpen}
        kind={kind}
        record={null}
        isSubmitting={isSaving}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
