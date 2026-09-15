"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { HardDrive, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";

import DocumentList from "@/components/documents/DocumentList";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import { PageShell } from "@/components/ui/PageShell";
import Pagination from "@/components/ui/Pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDocumentActions, usePagedDocuments, useDocumentStorageUsage, type DocumentSortState } from "@/hooks/useDocuments";
import { useConfirm } from "@/hooks/useConfirm";
import { usePageAddress } from "@/hooks/usePageAddress";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { LIST_ADDRESS_KEYS } from "@/lib/savedViewQuery";
import type { DocumentItem } from "@/hooks/useDocuments";

const DOCUMENT_TYPE_KEY = "type";

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export default function DocumentsPage() {
  const searchParams = useSearchParams();
  const { confirm } = useConfirm();
  const requestedSearch = searchParams.get("search") ?? "";
  const documentIdParam = searchParams.get("documentId");
  const requestedDocumentId = documentIdParam && /^\d+$/.test(documentIdParam) ? Number(documentIdParam) : null;
  const { updateAddress } = usePageAddress();
  const [search, setSearch] = useState(requestedSearch);
  /**
   * Documents has no saved views, so its draft is these two fields. They still go through
   * `usePageAddress` and the same `search` key every other list writes, so the page reads
   * and writes one vocabulary rather than inventing a second (rebuild.md 5.5).
   */
  const [documentFilter, setDocumentFilter] = useState<"all" | "templates" | "files">(() => {
    const requested = searchParams.get(DOCUMENT_TYPE_KEY);
    return requested === "templates" || requested === "files" ? requested : "all";
  });
  const [sort, setSort] = useState<DocumentSortState>(null);
  const filters = useMemo<SavedViewFilters>(
    () => ({
      search,
      ...(documentFilter === "all" ? {} : { is_template: documentFilter === "templates" }),
    }),
    [documentFilter, search],
  );
  const documentsQuery = usePagedDocuments(filters, sort);
  const storageUsageQuery = useDocumentStorageUsage();
  const { deleteDocument, isDeletingDocument } = useDocumentActions();
  const storageUsage = storageUsageQuery.data;

  useEffect(() => {
    const driveConnect = searchParams.get("driveConnect");
    const provider = searchParams.get("provider");
    const label = provider === "microsoft_onedrive" ? "Microsoft OneDrive" : "Google Drive";
    if (driveConnect === "connected") toast.success(`${label} connected.`);
    if (driveConnect === "error") toast.error(`Failed to connect ${label}.`);
  }, [searchParams]);

  useEffect(() => {
    setSearch(requestedSearch);
  }, [requestedSearch]);

  useEffect(() => {
    updateAddress((next) => {
      if (search.trim()) next.set(LIST_ADDRESS_KEYS.search, search.trim());
      else next.delete(LIST_ADDRESS_KEYS.search);
      if (documentFilter === "all") next.delete(DOCUMENT_TYPE_KEY);
      else next.set(DOCUMENT_TYPE_KEY, documentFilter);
    });
  }, [documentFilter, search, updateAddress]);

  async function handleDelete(document: DocumentItem) {
    const confirmed = await confirm({
      title: "Remove document?",
      description: `Move "${document.title}" to the recycle bin? Existing authenticated links will stop working.`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      await deleteDocument(document.id);
      toast.success("Document removed.");
    } catch {
      toast.error("We could not remove this document. Try again.");
    }
  }

  // No `description` on the shell: the library card below carries that sentence visibly,
  // and the shell's copy is sr-only, so supplying both announces it twice.
  return (
    <PageShell variant="list" title="Documents">
      <div className="grid gap-3 md:grid-cols-3">
        <Card variant="status" className="px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-copy-label"><HardDrive className="size-3.5" />Used</div>
          <div className="mt-1 text-lg font-semibold text-copy-primary">{storageUsageQuery.error ? "Unavailable" : storageUsage ? formatBytes(storageUsage.used_bytes) : "Loading"}</div>
        </Card>
        <Card variant="status" className="px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-copy-label"><HardDrive className="size-3.5" />Remaining</div>
          <div className="mt-1 text-lg font-semibold text-copy-primary">{storageUsageQuery.error ? "Unavailable" : storageUsage ? formatBytes(storageUsage.remaining_bytes) : "Loading"}</div>
        </Card>
        <Card variant="status" className="px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-copy-label"><HardDrive className="size-3.5" />Quota</div>
          <div className="mt-1 text-lg font-semibold text-copy-primary">
            {storageUsageQuery.error ? "Unavailable" : storageUsage ? `${storageUsage.usage_percent.toFixed(1)}% of ${formatBytes(storageUsage.tenant_storage_limit_bytes)}` : "Loading"}
          </div>
        </Card>
      </div>
      {storageUsageQuery.isError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-state-warning/40 bg-state-warning-muted px-4 py-3 text-sm text-copy-secondary">
          <span>Storage usage is unavailable. Upload limits are still enforced by the server.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void storageUsageQuery.refetch()}><RefreshCw />Try again</Button>
        </div>
      ) : null}

      {/* The library is a list, so it is drawn as one (design.md §4.7 archetype 1). It used
          to be a `Card` with a hand-built header row — an `h2`, a description, a `Select`, a
          bare `SearchBar` and the upload button in a three-column grid — which is the
          toolbar written again by hand, one page at a time. There is no filter group and no
          column picker: documents has no saved-view definition, so neither control has
          anything to offer and §7.9 says an empty control is not drawn. */}
      <ModuleListToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search documents"
        viewControls={
          <Select value={documentFilter} onValueChange={(value) => setDocumentFilter(value as "all" | "templates" | "files")}>
            <SelectTrigger className="w-48" aria-label="Document type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All documents</SelectItem>
              <SelectItem value="templates">Templates</SelectItem>
              <SelectItem value="files">Non-templates</SelectItem>
            </SelectContent>
          </Select>
        }
        primaryAction={<Button asChild><Link href="/dashboard/documents/upload"><Upload />Upload</Link></Button>}
      />
      {/* One data view, one set of states: the table supplies loading, empty and error
          (§7.4). This page used to draw all three itself and only mount the table once rows
          had arrived, so the same list spoke three different vocabularies. */}
      <DocumentList
        documents={documentsQuery.items}
        highlightedDocumentId={requestedDocumentId}
        emptyText={
          search || documentFilter !== "all"
            ? "Adjust the search or document filter."
            : "Upload the first controlled document to this tenant library."
        }
        onDelete={(document) => void handleDelete(document)}
        isDeleting={isDeletingDocument}
        sort={sort}
        onSortChange={setSort}
        isLoading={documentsQuery.isLoading}
        isRefreshing={documentsQuery.isFetching && !documentsQuery.isLoading}
        hasError={Boolean(documentsQuery.error)}
        onRetry={() => void documentsQuery.refresh()}
      />
      <Pagination
        page={documentsQuery.page}
        totalPages={documentsQuery.totalPages}
        totalCount={documentsQuery.totalCount}
        rangeStart={documentsQuery.rangeStart}
        rangeEnd={documentsQuery.rangeEnd}
        pageSize={documentsQuery.pageSize}
        isRefreshing={documentsQuery.isFetching && !documentsQuery.isLoading}
        onPageChange={documentsQuery.goToPage}
        onPageSizeChange={documentsQuery.onPageSizeChange}
      />
    </PageShell>
  );
}
