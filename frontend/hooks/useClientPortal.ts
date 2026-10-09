"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, apiFetch } from "@/lib/api";
import { downloadBlob, openBlobInNewTab } from "@/lib/browser";
import { apiUrl } from "@/lib/runtime-config";
import type { QuoteAcceptValues, QuoteDeclineValues, QuoteOptionalItem } from "@/components/quotes/QuoteResponse";

export const CLIENT_TOKEN_STORAGE_KEY = "lynk:client-access-token";

export type ClientPortalSortState = { key: string; direction: "asc" | "desc" } | null;
export type ClientAccountStatus = "pending" | "active" | "inactive";
export type ClientCatalogKind = "product" | "service";

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
  status: ClientAccountStatus;
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
  /** 13d §3.7: whether the setup link was emailed when it was made, and why not. */
  invite_sent?: boolean | null;
  invite_error?: string | null;
};

export type ClientMe = {
  id: number;
  email: string;
  tenant_id: number;
  contact_id?: number | null;
  organization_id?: number | null;
  contact_name?: string | null;
  organization_name?: string | null;
  customer_group?: CustomerGroup | null;
  /** The business whose portal this is, for the top bar. */
  company_name?: string | null;
};

export type ClientOverviewMetric = {
  key: string;
  label: string;
  value: number;
  href: string;
};

export type ClientOverviewAction = {
  key: string;
  label: string;
  description?: string | null;
  href: string;
  status?: string | null;
  created_at?: string | null;
};

export type ClientOverview = {
  account: ClientMe;
  metrics: ClientOverviewMetric[];
  next_actions: ClientOverviewAction[];
};

export type ClientCatalogItem = {
  kind: ClientCatalogKind;
  id: number;
  name: string;
  slug?: string | null;
  description?: string | null;
  sku?: string | null;
  currency: string;
  public_unit_price: string | number;
  resolved_unit_price: string | number;
  discount_type: string;
  discount_value?: string | number | null;
  availability_status: string;
  stock_quantity?: string | number | null;
  media_url?: string | null;
};

export type ClientPortalOrderLine = {
  id: number;
  catalog_product_id?: number | null;
  catalog_service_id?: number | null;
  name: string;
  quantity: string | number;
  unit_price: string | number;
  line_total: string | number;
};

/**
 * One of the account's orders (13d §3.7): confirmed orders, and the requests the client made
 * here. A request in `draft` is waiting for the team, so it has no document yet.
 */
export type ClientPortalOrder = {
  id: number;
  order_number: string;
  status: string;
  delivery_status?: string | null;
  is_request?: boolean;
  has_document?: boolean;
  currency: string;
  grand_total: string | number;
  notes?: string | null;
  created_at: string;
  line_items: ClientPortalOrderLine[];
};

export type ClientDocument = {
  id: number;
  title: string;
  description?: string | null;
  original_filename: string;
  content_type: string;
  extension: string;
  file_size_bytes: number;
  storage_provider: string;
  provider_status: "available" | "missing" | "permission_lost" | "deleted";
  created_at: string;
  updated_at: string;
  share_id: number;
  expires_at?: string | null;
};

export type ClientQuote = {
  quote_id: number;
  quote_number: string;
  title?: string | null;
  customer_name: string;
  status: string;
  issue_date?: string | null;
  expiry_date?: string | null;
  currency: string;
  subtotal_amount: string | number;
  discount_amount: string | number;
  tax_amount: string | number;
  total_amount: string | number;
  notes?: string | null;
  contact_id?: number | null;
  organization_id?: number | null;
  /** 13d §3.5: open (can be answered), pending, accepted, declined, expired or replaced. */
  state: "open" | "pending" | "accepted" | "declined" | "expired" | "replaced";
  can_respond: boolean;
  accepted_by_name?: string | null;
  accepted_at?: string | null;
  created_time: string;
  updated_at?: string | null;
  /** The quote page only: the document as issued, its optional items, the decline reasons. */
  html?: string | null;
  optional_items?: QuoteOptionalItem[];
  decline_reasons?: Array<{ key: string; label: string }>;
};

/** An issued invoice of the client's account (13d §3.7). */
export type ClientInvoice = {
  id: number;
  invoice_number: string | null;
  status: "issued" | "void";
  payment_status: "unpaid" | "partial" | "paid";
  is_overdue: boolean;
  issue_date: string | null;
  due_date: string | null;
  currency: string;
  total_amount: string | number;
  amount_paid: string | number;
  balance_due: string | number;
};

export type ClientBooking = {
  id: number;
  booking_type_id: number;
  booking_type_name?: string | null;
  owner_name?: string | null;
  guest_name: string;
  guest_email: string;
  guest_note?: string | null;
  start_at: string;
  end_at: string;
  timezone: string;
  status: string;
  booked_date: string;
  meeting_url?: string | null;
  location?: string | null;
  created_at: string;
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

function appendSortParams(params: URLSearchParams, sort: ClientPortalSortState | undefined) {
  if (!sort) return;
  params.set("sort_by", sort.key);
  params.set("sort_direction", sort.direction);
}

function storedClientToken() {
  return typeof window !== "undefined" ? window.localStorage.getItem(CLIENT_TOKEN_STORAGE_KEY) : null;
}

export function clearClientToken() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(CLIENT_TOKEN_STORAGE_KEY);
  }
}

async function readJsonSafely(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

const INVALID_CLIENT_SESSION_DETAILS = new Set([
  "Invalid client token",
  "Invalid client token type",
  "Client token tenant mismatch",
  "Client account is not active",
]);

function shouldClearClientToken(status: number, body: unknown, hadToken: boolean) {
  if (status !== 401 || !hadToken || !body || typeof body !== "object" || !("detail" in body)) {
    return false;
  }
  const detail = (body as { detail?: unknown }).detail;
  return typeof detail === "string" && INVALID_CLIENT_SESSION_DETAILS.has(detail);
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
  // The status is kept so a 403 can render a permission wall rather than a fault
  // (rebuild.md 5.6 batch 3).
  if (!res.ok) throw new ApiError(res.status, fallback);
  return body as T;
}

async function publicJson<T>(path: string, init: RequestInit = {}, fallback = "Request failed."): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = storedClientToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers,
  });
  const body = await readJsonSafely(res);
  if (!res.ok) {
    if (shouldClearClientToken(res.status, body, Boolean(token))) clearClientToken();
    throw new Error(clientErrorMessage(res.status, body, fallback));
  }
  return body as T;
}

/** The server's own words for a refusal it explains (a 4xx with a sentence), else the fallback. */
function clientErrorMessage(status: number, body: unknown, fallback: string) {
  const detail = body && typeof body === "object" ? (body as { detail?: unknown }).detail : null;
  return status >= 400 && status < 500 && typeof detail === "string" && !INVALID_CLIENT_SESSION_DETAILS.has(detail) ? detail : fallback;
}

async function publicBlob(path: string, init: RequestInit = {}, fallback = "Request failed."): Promise<Blob> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "*/*");
  const token = storedClientToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers,
  });
  if (!res.ok) {
    const body = await readJsonSafely(res);
    if (shouldClearClientToken(res.status, body, Boolean(token))) clearClientToken();
    throw new Error(clientErrorMessage(res.status, body, fallback));
  }
  return res.blob();
}

/** A download and the filename its response names. */
async function publicFile(path: string, fallback: string): Promise<{ blob: Blob; filename: string | null }> {
  const headers = new Headers({ Accept: "*/*" });
  const token = storedClientToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(apiUrl(path), { credentials: "include", headers });
  if (!res.ok) {
    const body = await readJsonSafely(res);
    if (shouldClearClientToken(res.status, body, Boolean(token))) clearClientToken();
    throw new Error(clientErrorMessage(res.status, body, fallback));
  }
  const filename = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? null;
  return { blob: await res.blob(), filename };
}

export function useClientPortalPages(sort: ClientPortalSortState = null) {
  return useQuery({
    queryKey: ["client-portal", "pages", sort?.key ?? "", sort?.direction ?? ""],
    queryFn: () => {
      const params = new URLSearchParams();
      appendSortParams(params, sort);
      const suffix = params.toString();
      return crmJson<ClientPage[]>(`/client-portal/pages${suffix ? `?${suffix}` : ""}`, {}, "Failed to load client pages.");
    },
    staleTime: 30_000,
  });
}

export function useClientPortalAccounts(sort: ClientPortalSortState = null) {
  return useQuery({
    queryKey: ["client-portal", "accounts", sort?.key ?? "", sort?.direction ?? ""],
    queryFn: () => {
      const params = new URLSearchParams();
      appendSortParams(params, sort);
      const suffix = params.toString();
      return crmJson<ClientAccount[]>(`/client-portal/accounts${suffix ? `?${suffix}` : ""}`, {}, "Failed to load client accounts.");
    },
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

export type CustomerGroupPayload = {
  group_key?: string;
  name: string;
  description?: string | null;
  discount_type: string;
  discount_value?: number | string | null;
  is_default: boolean;
  is_active: boolean;
};

export function useCustomerGroupActions() {
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["client-portal", "customer-groups"] });
    await queryClient.invalidateQueries({ queryKey: ["client-portal"] });
  };
  const createGroup = useMutation({
    mutationFn: (payload: CustomerGroupPayload) =>
      crmJson<CustomerGroup>("/client-portal/customer-groups", { method: "POST", body: JSON.stringify(payload) }, "Failed to create customer group."),
    onSuccess: invalidate,
  });
  const updateGroup = useMutation({
    mutationFn: ({ groupId, payload }: { groupId: number; payload: Partial<CustomerGroupPayload> }) =>
      crmJson<CustomerGroup>(`/client-portal/customer-groups/${groupId}`, { method: "PUT", body: JSON.stringify(payload) }, "Failed to update customer group."),
    onSuccess: invalidate,
  });

  return {
    createGroup: createGroup.mutateAsync,
    updateGroup: updateGroup.mutateAsync,
    isSaving: createGroup.isPending || updateGroup.isPending,
  };
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

export function useClientOverview() {
  return useQuery({
    queryKey: ["client-overview"],
    queryFn: () => publicJson<ClientOverview>("/client-overview", {}, "Sign in to open your portal."),
    retry: false,
    staleTime: 30_000,
  });
}

export function useClientCatalog(search: string = "", kind: ClientCatalogKind | "all" = "all") {
  return useQuery({
    queryKey: ["client-catalog", kind, search],
    queryFn: () => {
      const params = new URLSearchParams({ kind, limit: "100" });
      const value = search.trim();
      if (value) params.set("search", value);
      return publicJson<{ results: ClientCatalogItem[] }>(`/client-catalog?${params.toString()}`, {}, "Failed to load catalog.");
    },
    staleTime: 30_000,
  });
}

export function useClientCatalogItem(kind: string, itemId: string | number) {
  return useQuery({
    queryKey: ["client-catalog", kind, String(itemId)],
    queryFn: () => publicJson<ClientCatalogItem>(`/client-catalog/${kind}/${itemId}`, {}, "Catalog item not found."),
    enabled: kind === "product" || kind === "service",
    staleTime: 30_000,
  });
}

export function useClientOrders() {
  return useQuery({
    queryKey: ["client-orders"],
    queryFn: () => publicJson<{ results: ClientPortalOrder[] }>("/client-orders", {}, "Failed to load orders."),
    staleTime: 30_000,
  });
}

export function useClientOrder(orderId: string | number) {
  return useQuery({
    queryKey: ["client-orders", String(orderId)],
    queryFn: () => publicJson<ClientPortalOrder>(`/client-orders/${orderId}`, {}, "Order not found."),
    enabled: Boolean(orderId),
    staleTime: 30_000,
  });
}

export function useClientDocuments() {
  return useQuery({
    queryKey: ["client-documents"],
    queryFn: () => publicJson<{ results: ClientDocument[] }>("/client-documents", {}, "Failed to load documents."),
    staleTime: 30_000,
  });
}

export function useClientQuotes() {
  return useQuery({
    queryKey: ["client-quotes"],
    queryFn: () => publicJson<{ results: ClientQuote[] }>("/client-quotes", {}, "Failed to load quotes."),
    staleTime: 30_000,
  });
}

export function useClientQuote(quoteId: string | number) {
  return useQuery({
    queryKey: ["client-quotes", String(quoteId)],
    queryFn: () => publicJson<ClientQuote>(`/client-quotes/${quoteId}`, {}, "Quote not found."),
    enabled: Boolean(quoteId),
    staleTime: 30_000,
  });
}

export function useClientBookings() {
  return useQuery({
    queryKey: ["client-bookings"],
    queryFn: () => publicJson<{ results: ClientBooking[] }>("/client-bookings", {}, "Failed to load bookings."),
    staleTime: 30_000,
  });
}

export function useClientBooking(bookingId: string | number) {
  return useQuery({
    queryKey: ["client-bookings", String(bookingId)],
    queryFn: () => publicJson<ClientBooking>(`/client-bookings/${bookingId}`, {}, "Booking not found."),
    enabled: Boolean(bookingId),
    staleTime: 30_000,
  });
}

export async function downloadClientDocument(document: ClientDocument) {
  const blob = await publicBlob(
    `/client-documents/${document.id}/download`,
    {},
    "Failed to download document.",
  );
  downloadBlob(blob, document.original_filename || document.title);
}

export async function resolveClientDocumentView(document: ClientDocument) {
  const blob = await publicBlob(
    `/client-documents/${document.id}/download`,
    {},
    "This shared document cannot be opened.",
  );
  return { url: URL.createObjectURL(blob) };
}

/** A quote's, order's or invoice's PDF, as the team sends it (13d §3.7). */
export async function downloadClientPdf(kind: "quotes" | "orders" | "invoices", id: number, fallbackName: string) {
  const path = kind === "quotes" ? `/client-quotes/${id}/pdf` : kind === "orders" ? `/client-orders/${id}/pdf` : `/client-invoices/${id}/pdf`;
  const { blob, filename } = await publicFile(path, "The PDF could not be downloaded. Try again in a moment.");
  downloadBlob(blob, filename ?? `${fallbackName}.pdf`);
}

/** The signed-in client, for the top bar (13d §3.7). */
export function useClientMe() {
  return useQuery({
    queryKey: ["client-auth", "me"],
    queryFn: () => publicJson<ClientMe>("/client-auth/me", {}, "Your account could not be loaded."),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useClientInvoices() {
  return useQuery({
    queryKey: ["client-invoices"],
    queryFn: () => publicJson<{ results: ClientInvoice[] }>("/client-invoices", {}, "Your invoices could not be loaded."),
    staleTime: 30_000,
  });
}

export function useClientQuoteActions() {
  const queryClient = useQueryClient();
  const invalidate = async (quoteId?: string | number) => {
    await queryClient.invalidateQueries({ queryKey: ["client-quotes"] });
    if (quoteId) await queryClient.invalidateQueries({ queryKey: ["client-quotes", String(quoteId)] });
  };
  // The proposal page's own answers (13d §3.5), signed in.
  const accept = useMutation({
    mutationFn: ({ quoteId, values }: { quoteId: number | string; values: QuoteAcceptValues }) =>
      publicJson<ClientQuote>(`/client-quotes/${quoteId}/accept`, { method: "POST", body: JSON.stringify(values) },
        "The quote could not be accepted. Try again."),
    onSuccess: (updated) => invalidate(updated.quote_id),
  });
  const decline = useMutation({
    mutationFn: ({ quoteId, values }: { quoteId: number | string; values: QuoteDeclineValues }) =>
      publicJson<ClientQuote>(`/client-quotes/${quoteId}/decline`, { method: "POST", body: JSON.stringify(values) },
        "Your answer could not be sent. Try again."),
    onSuccess: (updated) => invalidate(updated.quote_id),
  });
  return {
    acceptQuote: accept.mutateAsync,
    declineQuote: decline.mutateAsync,
    isAnswering: accept.isPending || decline.isPending,
  };
}

export function useClientCatalogRequestActions() {
  const queryClient = useQueryClient();
  const requestItem = useMutation({
    mutationFn: ({ kind, itemId, quantity, details }: { kind: ClientCatalogKind; itemId: number; quantity: number | string; details?: string | null }) =>
      publicJson<ClientPortalOrder>(
        `/client-catalog/${kind}/${itemId}/request`,
        { method: "POST", body: JSON.stringify({ quantity, details: details || null }) },
        "Failed to submit request.",
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["client-catalog"] });
      await queryClient.invalidateQueries({ queryKey: ["client-orders"] });
    },
  });
  return {
    requestItem: requestItem.mutateAsync,
    isRequestingItem: requestItem.isPending,
  };
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
  const updateAccountStatus = useMutation({
    mutationFn: ({ accountId, status }: { accountId: number; status: ClientAccountStatus }) =>
      crmJson<ClientAccount>(
        `/client-portal/accounts/${accountId}/status`,
        { method: "PUT", body: JSON.stringify({ status }) },
        "Failed to update client account access.",
      ),
    onSuccess: invalidate,
  });
  const regenerateAccountSetupLink = useMutation({
    mutationFn: (accountId: number) =>
      crmJson<ClientAccount>(
        `/client-portal/accounts/${accountId}/setup-link`,
        { method: "POST" },
        "Failed to regenerate setup link.",
      ),
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
    updateAccountStatus: updateAccountStatus.mutateAsync,
    regenerateAccountSetupLink: regenerateAccountSetupLink.mutateAsync,
    assignContactGroup: assignContactGroup.mutateAsync,
    assignOrganizationGroup: assignOrganizationGroup.mutateAsync,
    isCreatingPage: createPage.isPending,
    isPublishingPage: publishPage.isPending,
    isCreatingAccount: createAccount.isPending,
    isUpdatingAccountStatus: updateAccountStatus.isPending,
    isRegeneratingSetupLink: regenerateAccountSetupLink.isPending,
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

export async function clientLogin(payload: {
  email: string;
  password: string;
  page_token?: string | null;
  tenant_slug?: string | null;
}) {
  return publicJson<{ access_token: string; token_type: string; account: ClientAccount }>("/client-auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  }, "Failed to sign in.");
}

export async function setupClientPassword(payload: { token: string; password: string; tenant_slug?: string | null }) {
  return publicJson<ClientAccount>("/client-auth/setup", {
    method: "POST",
    body: JSON.stringify(payload),
  }, "Your password could not be set. Try again.");
}

/** Who a setup link is for: the business's name and the address it signs in with. */
export async function clientSetupInfo(payload: { token: string; tenant_slug?: string | null }) {
  return publicJson<{ company_name: string; email: string }>("/client-auth/setup-info", {
    method: "POST",
    body: JSON.stringify(payload),
  }, "This setup link is invalid or has expired.");
}

export async function forgotClientPassword(payload: { email: string; tenant_slug?: string | null }) {
  return publicJson<{ detail: string }>("/client-auth/forgot", { method: "POST", body: JSON.stringify(payload) },
    "Your request could not be sent. Try again in a moment.");
}

export async function resetClientPassword(payload: { token: string; password: string; tenant_slug?: string | null }) {
  return publicJson<{ detail: string; email: string }>("/client-auth/reset", { method: "POST", body: JSON.stringify(payload) },
    "Your password could not be changed. Try again.");
}

export async function changeClientPassword(payload: { current_password: string; new_password: string }) {
  return publicJson<null>("/client-auth/password", { method: "POST", body: JSON.stringify(payload) },
    "Your password could not be changed. Try again.");
}

export async function recordClientPageAction(token: string, action: "accept" | "request-changes", payload: { message?: string; actor_name?: string; actor_email?: string }) {
  return publicJson<{ id: number; action: string; created_at: string }>(`/client-pages/${token}/${action}`, {
    method: "POST",
    body: JSON.stringify(payload),
  }, "Failed to record response.");
}

export async function downloadPublicClientPageDocument(token: string, document: ClientPageDocument) {
  const blob = await publicBlob(
    `/client-pages/${token}/documents/${document.id}/download`,
    {},
    "Sign in to open this document.",
  );
  openBlobInNewTab(blob, document.original_filename || document.title);
}
