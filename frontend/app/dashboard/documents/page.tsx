"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { FileText, HardDrive, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";

import DocumentList from "@/components/documents/DocumentList";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FieldDescription } from "@/components/ui/field";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDocumentActions, useDocuments, useDocumentStorageUsage, type DocumentSortState } from "@/hooks/useDocuments";
import { useConfirm } from "@/hooks/useConfirm";
import type { DocumentItem } from "@/hooks/useDocuments";

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
  const [search, setSearch] = useState(requestedSearch);
  const [documentFilter, setDocumentFilter] = useState<"all" | "templates" | "files">("all");
  const [sort, setSort] = useState<DocumentSortState>(null);
  const documentsQuery = useDocuments({
    search,
    isTemplate: documentFilter === "all" ? undefined : documentFilter === "templates",
    limit: 100,
    sort,
  });
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

  return (
    <div className="flex flex-col gap-4 text-copy-primary">
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

      <Card className="px-5 py-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-copy-primary">Document Library</h2>
            <FieldDescription className="mt-1">Standalone uploads and documents linked from CRM records.</FieldDescription>
          </div>
          <div className="grid gap-2 md:grid-cols-[180px_288px_auto]">
            <Select value={documentFilter} onValueChange={(value) => setDocumentFilter(value as "all" | "templates" | "files")}>
              <SelectTrigger className="w-full" aria-label="Document type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All documents</SelectItem>
                <SelectItem value="templates">Templates</SelectItem>
                <SelectItem value="files">Non-templates</SelectItem>
              </SelectContent>
            </Select>
            <SearchBar value={search} onChange={setSearch} placeholder="Search documents" className="md:w-full" />
            <Button asChild><Link href="/dashboard/documents/upload"><Upload className="h-4 w-4" />Upload</Link></Button>
          </div>
        </div>
        <div className="mt-4">
          {documentsQuery.isLoading ? (
            <div className="px-4 py-8 text-center text-sm text-copy-muted" aria-busy="true">Loading documents...</div>
          ) : documentsQuery.error ? (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
              <span>Documents could not be loaded. Check your connection and try again.</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void documentsQuery.refetch()}>Retry</Button>
            </div>
          ) : (documentsQuery.data?.results ?? []).length ? (
            <DocumentList
              documents={documentsQuery.data?.results ?? []}
              highlightedDocumentId={requestedDocumentId}
              emptyText="No documents have been uploaded yet."
              onDelete={(document) => void handleDelete(document)}
              isDeleting={isDeletingDocument}
              sort={sort}
              onSortChange={setSort}
              isRefreshing={documentsQuery.isFetching && !documentsQuery.isLoading}
            />
          ) : (
            <EmptyState
              icon={FileText}
              title="No documents found"
              description={search || documentFilter !== "all" ? "Adjust the search or document filter." : "Upload the first controlled document to this tenant library."}
              action={!search && documentFilter === "all" ? <Button asChild><Link href="/dashboard/documents/upload">Upload document</Link></Button> : undefined}
            />
          )}
        </div>
      </Card>
    </div>
  );
}
