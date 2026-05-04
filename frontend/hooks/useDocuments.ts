"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

export type DocumentLink = {
  id: number;
  module_key: string;
  entity_id: string;
  created_at: string;
};

export type DocumentItem = {
  id: number;
  title: string;
  description?: string | null;
  original_filename: string;
  content_type: string;
  extension: string;
  file_size_bytes: number;
  storage_provider: string;
  uploaded_by_user_id?: number | null;
  created_at: string;
  updated_at: string;
  links: DocumentLink[];
};

export type DocumentList = {
  results: DocumentItem[];
  total: number;
};

export type DocumentStorageUsage = {
  used_bytes: number;
  tenant_storage_limit_bytes: number;
  remaining_bytes: number;
  usage_percent: number;
};

export type DocumentStorageConnection = {
  provider: string;
  status: string;
  account_email?: string | null;
  provider_root_id?: string | null;
  provider_root_name?: string | null;
  last_error?: string | null;
  updated_at: string;
};

export type DocumentUploadPayload = {
  file: File;
  title?: string;
  description?: string;
  linked_module_key?: string;
  linked_entity_id?: string | number;
  storage_provider?: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

async function readJsonSafely(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function documentDownloadUrl(documentId: number) {
  return `${API_BASE}/documents/${documentId}/download`;
}

export async function fetchDocuments(params: {
  search?: string;
  moduleKey?: string;
  entityId?: string | number;
  limit?: number;
} = {}): Promise<DocumentList> {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.moduleKey) query.set("module_key", params.moduleKey);
  if (params.entityId !== undefined && params.entityId !== null) query.set("entity_id", String(params.entityId));
  query.set("limit", String(params.limit ?? 50));
  const suffix = query.toString();
  const res = await apiFetch(`/documents${suffix ? `?${suffix}` : ""}`);
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load documents.");
  }
  return body as DocumentList;
}

export async function fetchDocumentStorageUsage(): Promise<DocumentStorageUsage> {
  const res = await apiFetch("/documents/storage/usage");
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load document storage usage.");
  }
  return body as DocumentStorageUsage;
}

export async function fetchDocumentStorageConnections(): Promise<DocumentStorageConnection[]> {
  const res = await apiFetch("/documents/storage/connections");
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load document storage connections.");
  }
  return body as DocumentStorageConnection[];
}

export async function connectGoogleDriveStorage(): Promise<{ provider: string; auth_url: string }> {
  const res = await apiFetch("/documents/storage/connect/google-drive", { method: "POST" });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to connect Google Drive.");
  }
  return body as { provider: string; auth_url: string };
}

export async function disconnectGoogleDriveStorage(): Promise<DocumentStorageConnection> {
  const res = await apiFetch("/documents/storage/connect/google-drive", { method: "DELETE" });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to disconnect Google Drive.");
  }
  return body as DocumentStorageConnection;
}

export async function uploadDocument(payload: DocumentUploadPayload): Promise<DocumentItem> {
  const form = new FormData();
  form.append("file", payload.file);
  if (payload.title?.trim()) form.append("title", payload.title.trim());
  if (payload.description?.trim()) form.append("description", payload.description.trim());
  if (payload.linked_module_key) form.append("linked_module_key", payload.linked_module_key);
  if (payload.linked_entity_id !== undefined && payload.linked_entity_id !== null) {
    form.append("linked_entity_id", String(payload.linked_entity_id));
  }
  if (payload.storage_provider) form.append("storage_provider", payload.storage_provider);
  const res = await apiFetch("/documents", { method: "POST", body: form });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to upload document.");
  }
  return body as DocumentItem;
}

export async function deleteDocument(documentId: number): Promise<DocumentItem> {
  const res = await apiFetch(`/documents/${documentId}`, { method: "DELETE" });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to delete document.");
  }
  return body as DocumentItem;
}

export function useDocuments(params: { search?: string; moduleKey?: string; entityId?: string | number; limit?: number } = {}) {
  return useQuery({
    queryKey: ["documents", params.moduleKey ?? "all", params.entityId == null ? "all" : String(params.entityId), params.search ?? "", params.limit ?? 50],
    queryFn: () => fetchDocuments(params),
    staleTime: 30_000,
  });
}

export function useDocumentStorageUsage() {
  return useQuery({
    queryKey: ["documents", "storage-usage"],
    queryFn: fetchDocumentStorageUsage,
    staleTime: 30_000,
  });
}

export function useDocumentStorageConnections() {
  return useQuery({
    queryKey: ["documents", "storage-connections"],
    queryFn: fetchDocumentStorageConnections,
    staleTime: 30_000,
  });
}

export function useDocumentActions(scope?: { moduleKey?: string; entityId?: string | number }) {
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["documents"] });
    await queryClient.invalidateQueries({ queryKey: ["documents", "storage-usage"] });
    await queryClient.invalidateQueries({ queryKey: ["documents", "storage-connections"] });
    if (scope?.moduleKey && scope.entityId !== undefined) {
      await queryClient.invalidateQueries({ queryKey: ["documents", scope.moduleKey, String(scope.entityId)] });
    }
  };
  const uploadMutation = useMutation({
    mutationFn: uploadDocument,
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: deleteDocument,
    onSuccess: invalidate,
  });
  const connectDriveMutation = useMutation({
    mutationFn: connectGoogleDriveStorage,
  });
  const disconnectDriveMutation = useMutation({
    mutationFn: disconnectGoogleDriveStorage,
    onSuccess: invalidate,
  });

  return {
    uploadDocument: uploadMutation.mutateAsync,
    deleteDocument: deleteMutation.mutateAsync,
    connectGoogleDriveStorage: connectDriveMutation.mutateAsync,
    disconnectGoogleDriveStorage: disconnectDriveMutation.mutateAsync,
    isUploadingDocument: uploadMutation.isPending,
    isDeletingDocument: deleteMutation.isPending,
    isConnectingGoogleDrive: connectDriveMutation.isPending,
    isDisconnectingGoogleDrive: disconnectDriveMutation.isPending,
  };
}
