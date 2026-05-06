"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
export const CLIENT_TOKEN_STORAGE_KEY = "lynk:client-access-token";

export type CustomerGroup = {
  id: number;
  group_key: string;
  name: string;
  description?: string | null;
  discount_type: string;
  discount_value?: string | number | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ClientAccount = {
  id: number;
  email: string;
  status: string;
  contact_id?: number | null;
  organization_id?: number | null;
  contact_name?: string | null;
  organization_name?: string | null;
  has_password: boolean;
  setup_link?: string | null;
  setup_token_expires_at?: string | null;
  last_login_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type PricingItemPayload = {
  sku?: string | null;
  name: string;
  description?: string | null;
  quantity: number | string;
  currency: string;
  public_unit_price: number | string;
};

export type PricingItem = PricingItemPayload & {
  resolved_unit_price: string | number;
  public_total: string | number;
  resolved_total: string | number;
  discount_type: string;
  discount_value?: string | number | null;
};

export type ClientPageDocument = {
  id: number;
  title: string;
  original_filename: string;
  content_type: string;
  extension: string;
  file_size_bytes: number;
};

export type ClientPageProposalSection = {
  title: string;
  body: string;
  sort_order: number;
};

export type ClientPageBrandSettings = {
  company_name?: string | null;
  logo_url?: string | null;
  accent_color?: string | null;
};

export type ClientPageActionSummary = {
  id: number;
  action: string;
  message?: string | null;
  actor_name?: string | null;
  actor_email?: string | null;
  client_account_id?: number | null;
  created_at: string;
};

export type ClientPage = {
  id: number;
  title: string;
  summary?: string | null;
  status: string;
  contact_id?: number | null;
  organization_id?: number | null;
  contact_name?: string | null;
  organization_name?: string | null;
  source_module_key?: string | null;
  source_entity_id?: string | null;
  document_ids: number[];
  documents: ClientPageDocument[];
  proposal_sections: ClientPageProposalSection[];
  brand_settings?: ClientPageBrandSettings | null;
  pricing_items: PricingItem[];
  customer_group?: CustomerGroup | null;
  pricing_mode: string;
  action_count: number;
  latest_action?: ClientPageActionSummary | null;
  recent_actions: ClientPageActionSummary[];
  public_link?: string | null;
  public_token_expires_at?: string | null;
  published_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type PublicClientPage = {
  title: string;
  summary?: string | null;
  pricing_items: PricingItem[];
  customer_group?: CustomerGroup | null;
  pricing_mode: string;
  document_ids: number[];
  documents: ClientPageDocument[];
  proposal_sections: ClientPageProposalSection[];
  brand_settings?: ClientPageBrandSettings | null;
};

export type ClientPagePayload = {
  title: string;
  summary?: string | null;
  contact_id?: number | null;
  organization_id?: number | null;
  pricing_items: PricingItemPayload[];
  document_ids?: number[];
  proposal_sections?: ClientPageProposalSection[];
  brand_settings?: ClientPageBrandSettings | null;
  source_module_key?: string | null;
  source_entity_id?: string | null;
  status?: string;
};

export type CustomerOption = {
  id: number;
  label: string;
  detail?: string | null;
};

async function readJsonSafely(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function detailMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && "message" in detail && typeof (detail as { message?: unknown }).message === "string") {
      return (detail as { message: string }).message;
    }
  }
  return fallback;
}

async function crmJson<T>(path: string, init: RequestInit = {}, fallback = "Request failed."): Promise<T> {
  const res = await apiFetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await readJsonSafely(res);
  if (!res.ok) throw new Error(detailMessage(body, fallback));
  return body as T;
}

async function publicJson<T>(path: string, init: RequestInit = {}, fallback = "Request failed."): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = typeof window !== "undefined" ? window.localStorage.getItem(CLIENT_TOKEN_STORAGE_KEY) : null;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  const body = await readJsonSafely(res);
  if (!res.ok) throw new Error(detailMessage(body, fallback));
  return body as T;
}

export function useClientPortalPages() {
  return useQuery({
    queryKey: ["client-portal", "pages"],
    queryFn: () => crmJson<ClientPage[]>("/client-portal/pages", {}, "Failed to load client pages."),
    staleTime: 30_000,
  });
}

export function useClientPortalAccounts() {
  return useQuery({
    queryKey: ["client-portal", "accounts"],
    queryFn: () => crmJson<ClientAccount[]>("/client-portal/accounts", {}, "Failed to load client accounts."),
    staleTime: 30_000,
  });
}

export function useCustomerGroups() {
  return useQuery({
    queryKey: ["client-portal", "customer-groups"],
    queryFn: () => crmJson<CustomerGroup[]>("/client-portal/customer-groups", {}, "Failed to load customer groups."),
    staleTime: 5 * 60_000,
  });
}

export function useCustomerOptions(type: "contact" | "organization", search: string) {
  return useQuery({
    queryKey: ["client-portal", "customer-options", type, search],
    queryFn: async () => {
      const value = search.trim();
      if (type === "contact") {
        const params = new URLSearchParams({ page: "1", page_size: "8" });
        const path = value ? `/sales/contacts/search?query=${encodeURIComponent(value)}&${params.toString()}` : `/sales/contacts?${params.toString()}`;
        const body = await crmJson<{ results: Array<{ contact_id: number; first_name?: string | null; last_name?: string | null; primary_email?: string | null; organization_name?: string | null }> }>(
          path,
          {},
          "Failed to load contacts.",
        );
        return body.results.map((contact) => {
          const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim();
          return {
            id: contact.contact_id,
            label: fullName || contact.primary_email || `Contact #${contact.contact_id}`,
            detail: [contact.primary_email, contact.organization_name].filter(Boolean).join(" · ") || null,
          };
        });
      }

      const params = new URLSearchParams({ page: "1", page_size: "8" });
      if (value) params.set("search", value);
      const body = await crmJson<{ results: Array<{ org_id?: number; org_name?: string | null; primary_email?: string | null; website?: string | null }> }>(
        `/sales/organizations?${params.toString()}`,
        {},
        "Failed to load organizations.",
      );
      return body.results
        .filter((organization) => organization.org_id)
        .map((organization) => ({
          id: organization.org_id as number,
          label: organization.org_name || `Organization #${organization.org_id}`,
          detail: [organization.primary_email, organization.website].filter(Boolean).join(" · ") || null,
        }));
    },
    staleTime: 30_000,
  });
}

export function useClientPortalActions() {
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["client-portal"] });
  };
  const createPage = useMutation({
    mutationFn: (payload: ClientPagePayload) => crmJson<ClientPage>("/client-portal/pages", { method: "POST", body: JSON.stringify(payload) }, "Failed to create client page."),
    onSuccess: invalidate,
  });
  const publishPage = useMutation({
    mutationFn: ({ pageId, expiresInDays }: { pageId: number; expiresInDays: number }) =>
      crmJson<ClientPage>(`/client-portal/pages/${pageId}/publish-link`, {
        method: "POST",
        body: JSON.stringify({ expires_in_days: expiresInDays }),
      }, "Failed to publish client page link."),
    onSuccess: invalidate,
  });
  const createAccount = useMutation({
    mutationFn: (payload: { email: string; contact_id?: number | null; organization_id?: number | null; status?: string }) =>
      crmJson<ClientAccount>("/client-portal/accounts", { method: "POST", body: JSON.stringify(payload) }, "Failed to create client account."),
    onSuccess: invalidate,
  });
  const assignContactGroup = useMutation({
    mutationFn: ({ contactId, customerGroupId }: { contactId: number; customerGroupId: number | null }) =>
      crmJson<{ contact_id: number; customer_group_id: number | null }>(
        `/client-portal/contacts/${contactId}/customer-group`,
        { method: "PUT", body: JSON.stringify({ customer_group_id: customerGroupId }) },
        "Failed to assign customer group.",
      ),
    onSuccess: invalidate,
  });
  const assignOrganizationGroup = useMutation({
    mutationFn: ({ organizationId, customerGroupId }: { organizationId: number; customerGroupId: number | null }) =>
      crmJson<{ organization_id: number; customer_group_id: number | null }>(
        `/client-portal/organizations/${organizationId}/customer-group`,
        { method: "PUT", body: JSON.stringify({ customer_group_id: customerGroupId }) },
        "Failed to assign customer group.",
      ),
    onSuccess: invalidate,
  });

  return {
    createPage: createPage.mutateAsync,
    publishPage: publishPage.mutateAsync,
    createAccount: createAccount.mutateAsync,
    assignContactGroup: assignContactGroup.mutateAsync,
    assignOrganizationGroup: assignOrganizationGroup.mutateAsync,
    isCreatingPage: createPage.isPending,
    isPublishingPage: publishPage.isPending,
    isCreatingAccount: createAccount.isPending,
    isAssigningCustomerGroup: assignContactGroup.isPending || assignOrganizationGroup.isPending,
  };
}

export function usePublicClientPage(token: string) {
  return useQuery({
    queryKey: ["public-client-page", token],
    queryFn: () => publicJson<PublicClientPage>(`/client-pages/${token}`, {}, "Failed to load client page."),
    enabled: Boolean(token),
    staleTime: 15_000,
  });
}

export async function clientLogin(payload: { email: string; password: string }) {
  return publicJson<{ access_token: string; token_type: string; account: ClientAccount }>("/client-auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  }, "Failed to sign in.");
}

export async function setupClientPassword(payload: { token: string; password: string }) {
  return publicJson<ClientAccount>("/client-auth/setup", {
    method: "POST",
    body: JSON.stringify(payload),
  }, "Failed to set password.");
}

export async function recordClientPageAction(token: string, action: "accept" | "request-changes", payload: { message?: string; actor_name?: string; actor_email?: string }) {
  return publicJson<{ id: number; action: string; created_at: string }>(`/client-pages/${token}/${action}`, {
    method: "POST",
    body: JSON.stringify(payload),
  }, "Failed to record response.");
}

export function publicClientPageDocumentUrl(token: string, documentId: number) {
  return `${API_BASE}/client-pages/${token}/documents/${documentId}/download`;
}
