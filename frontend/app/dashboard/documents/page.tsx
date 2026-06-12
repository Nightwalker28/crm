"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Upload } from "lucide-react";
import { toast } from "sonner";

import DocumentList from "@/components/documents/DocumentList";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDocumentActions, useDocuments, useDocumentStorageConnections, useDocumentStorageUsage, type DocumentSortState } from "@/hooks/useDocuments";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export default function DocumentsPage() {
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [storageProvider, setStorageProvider] = useState("local");
  const [documentFilter, setDocumentFilter] = useState<"all" | "templates" | "files">("all");
  const [sort, setSort] = useState<DocumentSortState>(null);
  const documentsQuery = useDocuments({
    search,
    isTemplate: documentFilter === "all" ? undefined : documentFilter === "templates",
    limit: 100,
    sort,
  });
  const storageUsageQuery = useDocumentStorageUsage();
  const storageConnectionsQuery = useDocumentStorageConnections();
  const {
    uploadDocument,
    deleteDocument,
    isUploadingDocument,
    isDeletingDocument,
  } = useDocumentActions();
  const storageUsage = storageUsageQuery.data;
  const googleDriveConnection = storageConnectionsQuery.data?.find((connection) => connection.provider === "google_drive");
  const googleDriveConnected = googleDriveConnection?.status === "connected";
  const oneDriveConnection = storageConnectionsQuery.data?.find((connection) => connection.provider === "microsoft_onedrive");
  const oneDriveConnected = oneDriveConnection?.status === "connected";

  useEffect(() => {
    const driveConnect = searchParams.get("driveConnect");
    const provider = searchParams.get("provider");
    const label = provider === "microsoft_onedrive" ? "Microsoft OneDrive" : "Google Drive";
    if (driveConnect === "connected") toast.success(`${label} connected.`);
    if (driveConnect === "error") toast.error(`Failed to connect ${label}.`);
  }, [searchParams]);

  async function handleSelectedFile(file: File | undefined) {
    if (!file) return;
    if (storageProvider === "google_drive" && !googleDriveConnected) {
      toast.error("Connect Google Drive before uploading to Drive.");
      return;
    }
    if (storageProvider === "microsoft_onedrive" && !oneDriveConnected) {
      toast.error("Connect Microsoft OneDrive before uploading to OneDrive.");
      return;
    }
    try {
      await uploadDocument({
        file,
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        storage_provider: storageProvider,
      });
      setTitle("");
      setDescription("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast.success("Document uploaded.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to upload document."));
    }
  }

  async function handleDelete(documentId: number) {
    try {
      await deleteDocument(documentId);
      toast.success("Document removed.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to delete document."));
    }
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="Documents"
        description="Upload, view, and link controlled professional documents across CRM records."
        actions={
          <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploadingDocument}>
            <Upload className="h-4 w-4" />
            {isUploadingDocument ? "Uploading..." : "Upload"}
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Used</div>
          <div className="mt-1 text-lg font-semibold text-neutral-100">{formatBytes(storageUsage?.used_bytes ?? 0)}</div>
        </div>
        <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Remaining</div>
          <div className="mt-1 text-lg font-semibold text-neutral-100">{formatBytes(storageUsage?.remaining_bytes ?? 0)}</div>
        </div>
        <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Quota</div>
          <div className="mt-1 text-lg font-semibold text-neutral-100">
            {storageUsage ? `${storageUsage.usage_percent.toFixed(1)}% of ${formatBytes(storageUsage.tenant_storage_limit_bytes)}` : "Loading"}
          </div>
        </div>
      </div>

      <Card className="px-5 py-5">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_220px_auto] md:items-end">
          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-200">Title</label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional title" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-200">Description</label>
            <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-200">Storage</label>
            <Select value={storageProvider} onValueChange={setStorageProvider}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local backend</SelectItem>
                <SelectItem value="google_drive" disabled={!googleDriveConnected}>
                  Google Drive
                </SelectItem>
                <SelectItem value="microsoft_onedrive" disabled={!oneDriveConnected}>
                  Microsoft OneDrive
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt,.rtf,.odt"
              onChange={(event) => void handleSelectedFile(event.target.files?.[0])}
              className="hidden"
            />
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isUploadingDocument}>
              <Upload className="h-4 w-4" />
              Select File
            </Button>
          </div>
        </div>
        <FieldDescription className="mt-3">
          Allowed types: PDF, DOC, DOCX, TXT, RTF, and ODT. Manage Google Drive and OneDrive connections from{" "}
          <Link href="/dashboard/settings/integrations" className="text-neutral-200 underline-offset-4 hover:underline">Integrations</Link>.
        </FieldDescription>
      </Card>

      <Card className="px-5 py-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-neutral-100">Document Library</h2>
            <FieldDescription className="mt-1">Standalone uploads and documents linked from CRM records.</FieldDescription>
          </div>
          <div className="grid gap-2 md:grid-cols-[180px_288px]">
            <Select value={documentFilter} onValueChange={(value) => setDocumentFilter(value as "all" | "templates" | "files")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All documents</SelectItem>
                <SelectItem value="templates">Templates</SelectItem>
                <SelectItem value="files">Non-templates</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search documents"
            />
          </div>
        </div>
        <div className="mt-4">
          {documentsQuery.isLoading ? (
            <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-4 py-8 text-center text-sm text-neutral-500">Loading documents...</div>
          ) : documentsQuery.error ? (
            <div className="rounded-md border border-red-900/50 bg-red-950/20 px-4 py-4 text-sm text-red-300">
              {errorMessage(documentsQuery.error, "Failed to load documents.")}
            </div>
          ) : (
            <DocumentList
              documents={documentsQuery.data?.results ?? []}
              emptyText="No documents have been uploaded yet."
              onDelete={(documentId) => void handleDelete(documentId)}
              isDeleting={isDeletingDocument}
              sort={sort}
              onSortChange={setSort}
              isRefreshing={documentsQuery.isFetching && !documentsQuery.isLoading}
            />
          )}
        </div>
      </Card>
    </div>
  );
}
