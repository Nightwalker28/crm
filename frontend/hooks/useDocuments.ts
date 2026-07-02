"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { apiUrl } from "@/lib/runtime-config";

export type DocumentSortState = { key: string; direction: "asc" | "desc" } | null;

export type DocumentLink = {
  id: number;
  module_key: string;
  entity_id: string;
  created_at: string;
};

export type DocumentClientShare = {
  id: number;
  document_id: number;
  contact_id?: number | null;
  organization_id?: number | null;
  expires_at?: string | null;
  revoked_at?: string | null;
  created_by_user_id?: number | null;
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
  is_template: boolean;
  template_category?: string | null;
  current_version_id?: number | null;
  uploaded_by_user_id?: number | null;
  created_at: string;
  updated_at: string;
  links: DocumentLink[];
  client_shares: DocumentClientShare[];
};

export type DocumentVersion = {
  id: number;
  document_id: number;
  version_number: number;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  checksum?: string | null;
  uploaded_by_id?: number | null;
  created_at: string;
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

async function readJsonSafely(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function documentDownloadUrl(documentId: number) {
  return apiUrl(`/documents/${documentId}/download`);
}

export function documentVersionDownloadUrl(documentId: number, versionId: number) {
  return apiUrl(`/documents/${documentId}/versions/${versionId}/download`);
}

export async function fetchDocuments(params: {
  search?: string;
  moduleKey?: string;
  entityId?: string | number;
  isTemplate?: boolean;
  limit?: number;
  sort?: DocumentSortState;
} = {}): Promise<DocumentList> {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.moduleKey) query.set("module_key", params.moduleKey);
  if (params.entityId !== undefined && params.entityId !== null) query.set("entity_id", String(params.entityId));
  if (params.isTemplate !== undefined) query.set("is_template", String(params.isTemplate));
  if (params.sort) {
    query.set("sort_by", params.sort.key);
    query.set("sort_direction", params.sort.direction);
  }
  query.set("limit", String(params.limit ?? 50));
  const suffix = query.toString();
  const res = await apiFetch(`/documents${suffix ? `?${suffix}` : ""}`);
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load documents.");
  }
  return body as DocumentList;
}

export async function fetchDocumentVersions(documentId: number): Promise<DocumentVersion[]> {
  const res = await apiFetch(`/documents/${documentId}/versions`);
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load document versions.");
  }
  return (body?.results ?? []) as DocumentVersion[];
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

export async function connectGoogleDriveStorage(returnPath?: string): Promise<{ provider: string; auth_url: string }> {
  const query = returnPath ? `?return_path=${encodeURIComponent(returnPath)}` : "";
  const res = await apiFetch(`/documents/storage/connect/google-drive${query}`, { method: "POST" });
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

export async function connectMicrosoftOneDriveStorage(returnPath?: string): Promise<{ provider: string; auth_url: string }> {
  const query = returnPath ? `?return_path=${encodeURIComponent(returnPath)}` : "";
  const res = await apiFetch(`/documents/storage/connect/microsoft-onedrive${query}`, { method: "POST" });
  const body = await readJsonSafely(res);
  if (!res.ok) throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to connect Microsoft OneDrive.");
  return body as { provider: string; auth_url: string };
}

export async function disconnectMicrosoftOneDriveStorage(): Promise<DocumentStorageConnection> {
  const res = await apiFetch("/documents/storage/connect/microsoft-onedrive", { method: "DELETE" });
  const body = await readJsonSafely(res);
  if (!res.ok) throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to disconnect Microsoft OneDrive.");
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

export async function uploadDocumentVersion(documentId: number, file: File): Promise<DocumentItem> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiFetch(`/documents/${documentId}/versions`, { method: "POST", body: form });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to upload document version.");
  }
  return body as DocumentItem;
}

export async function updateDocumentTemplateStatus(
  documentId: number,
  payload: { is_template: boolean; template_category?: string | null },
): Promise<DocumentItem> {
  const res = await apiFetch(`/documents/${documentId}/template`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to update document template status.");
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

export async function shareDocumentWithClient(
  documentId: number,
  payload: { contact_id?: number | null; organization_id?: number | null; expires_at?: string | null },
): Promise<DocumentClientShare> {
  const res = await apiFetch(`/documents/${documentId}/client-shares`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to share document.");
  }
  return body as DocumentClientShare;
}

export async function revokeDocumentClientShare(documentId: number, shareId: number): Promise<DocumentClientShare> {
  const res = await apiFetch(`/documents/${documentId}/client-shares/${shareId}`, { method: "DELETE" });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to revoke document access.");
  }
  return body as DocumentClientShare;
}

export function useDocuments(params: { search?: string; moduleKey?: string; entityId?: string | number; isTemplate?: boolean; limit?: number; sort?: DocumentSortState } = {}) {
  return useQuery({
    queryKey: [
      "documents",
      "list",
      params.moduleKey ?? "all",
      params.entityId == null ? "all" : String(params.entityId),
      params.isTemplate === undefined ? "all" : String(params.isTemplate),
      params.search ?? "",
      params.limit ?? 50,
      params.sort?.key ?? "",
      params.sort?.direction ?? "",
    ],
    queryFn: () => fetchDocuments(params),
    staleTime: 30_000,
  });
}

export function useDocumentVersions(documentId: number | null, enabled = true) {
  return useQuery({
    queryKey: ["documents", "versions", documentId],
    queryFn: () => fetchDocumentVersions(documentId as number),
    enabled: enabled && documentId !== null,
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
    const invalidations = [
      queryClient.invalidateQueries({ queryKey: ["documents", "list"] }),
      queryClient.invalidateQueries({ queryKey: ["documents", "storage-usage"] }),
      queryClient.invalidateQueries({ queryKey: ["documents", "storage-connections"] }),
    ];
    if (scope?.moduleKey && scope.entityId !== undefined) {
      invalidations.push(queryClient.invalidateQueries({ queryKey: ["documents", "list", scope.moduleKey, String(scope.entityId)] }));
    }
    await Promise.all(invalidations);
  };
  const uploadMutation = useMutation({
    mutationFn: uploadDocument,
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: deleteDocument,
    onSuccess: invalidate,
  });
  const uploadVersionMutation = useMutation({
    mutationFn: ({ documentId, file }: { documentId: number; file: File }) => uploadDocumentVersion(documentId, file),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: ["documents", "versions", variables.documentId] }),
      ]);
    },
  });
  const templateMutation = useMutation({
    mutationFn: ({ documentId, isTemplate, templateCategory }: { documentId: number; isTemplate: boolean; templateCategory?: string | null }) =>
      updateDocumentTemplateStatus(documentId, { is_template: isTemplate, template_category: templateCategory }),
    onSuccess: invalidate,
  });
  const shareMutation = useMutation({
    mutationFn: ({ documentId, payload }: { documentId: number; payload: { contact_id?: number | null; organization_id?: number | null; expires_at?: string | null } }) =>
      shareDocumentWithClient(documentId, payload),
    onSuccess: invalidate,
  });
  const revokeShareMutation = useMutation({
    mutationFn: ({ documentId, shareId }: { documentId: number; shareId: number }) => revokeDocumentClientShare(documentId, shareId),
    onSuccess: invalidate,
  });
  const connectDriveMutation = useMutation({
    mutationFn: () => connectGoogleDriveStorage(),
  });
  const disconnectDriveMutation = useMutation({
    mutationFn: disconnectGoogleDriveStorage,
    onSuccess: invalidate,
  });
  const connectOneDriveMutation = useMutation({ mutationFn: () => connectMicrosoftOneDriveStorage() });
  const disconnectOneDriveMutation = useMutation({ mutationFn: disconnectMicrosoftOneDriveStorage, onSuccess: invalidate });

  return {
    uploadDocument: uploadMutation.mutateAsync,
    uploadDocumentVersion: uploadVersionMutation.mutateAsync,
    updateDocumentTemplateStatus: templateMutation.mutateAsync,
    shareDocumentWithClient: shareMutation.mutateAsync,
    revokeDocumentClientShare: revokeShareMutation.mutateAsync,
    deleteDocument: deleteMutation.mutateAsync,
    connectGoogleDriveStorage: connectDriveMutation.mutateAsync,
    disconnectGoogleDriveStorage: disconnectDriveMutation.mutateAsync,
    connectMicrosoftOneDriveStorage: connectOneDriveMutation.mutateAsync,
    disconnectMicrosoftOneDriveStorage: disconnectOneDriveMutation.mutateAsync,
    isUploadingDocument: uploadMutation.isPending,
    isUploadingDocumentVersion: uploadVersionMutation.isPending,
    isUpdatingDocumentTemplate: templateMutation.isPending,
    isSharingDocument: shareMutation.isPending,
    isRevokingDocumentShare: revokeShareMutation.isPending,
    isDeletingDocument: deleteMutation.isPending,
    isConnectingGoogleDrive: connectDriveMutation.isPending,
    isDisconnectingGoogleDrive: disconnectDriveMutation.isPending,
    isConnectingMicrosoftOneDrive: connectOneDriveMutation.isPending,
    isDisconnectingMicrosoftOneDrive: disconnectOneDriveMutation.isPending,
  };
}
