"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { Copy, ExternalLink, Link2, Plus, Search, Send } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useClientPortalActions, useClientPortalAccounts, useClientPortalPages, useCustomerOptions, type PricingItemPayload } from "@/hooks/useClientPortal";

type LinkedType = "contact" | "organization";

type PageForm = {
  title: string;
  summary: string;
  linkedType: LinkedType;
  linkedId: string;
  itemName: string;
  itemDescription: string;
  itemQuantity: string;
  itemCurrency: string;
  itemPrice: string;
  documentIds: string;
  brandCompanyName: string;
  brandLogoUrl: string;
  brandAccentColor: string;
  proposalOverview: string;
  proposalScope: string;
  proposalTerms: string;
};

type AccountForm = {
  email: string;
  linkedType: LinkedType;
  linkedId: string;
};

const emptyPageForm: PageForm = {
  title: "",
  summary: "",
  linkedType: "contact",
  linkedId: "",
  itemName: "",
  itemDescription: "",
  itemQuantity: "1",
  itemCurrency: "USD",
  itemPrice: "",
  documentIds: "",
  brandCompanyName: "",
  brandLogoUrl: "",
  brandAccentColor: "#14b8a6",
  proposalOverview: "",
  proposalScope: "",
  proposalTerms: "",
};

const emptyAccountForm: AccountForm = {
  email: "",
  linkedType: "contact",
  linkedId: "",
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatMoney(value: string | number, currency: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${currency} 0.00`;
  return `${currency} ${amount.toFixed(2)}`;
}

function parseDocumentIds(value: string) {
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function customerLabel(item: { contact_id?: number | null; organization_id?: number | null; contact_name?: string | null; organization_name?: string | null }) {
  if (item.contact_id) return item.contact_name || `Contact #${item.contact_id}`;
  return item.organization_name || `Organization #${item.organization_id}`;
}

function proposalSectionsFromForm(form: PageForm) {
  return [
    { title: "Overview", body: form.proposalOverview.trim(), sort_order: 0 },
    { title: "Scope", body: form.proposalScope.trim(), sort_order: 1 },
    { title: "Terms", body: form.proposalTerms.trim(), sort_order: 2 },
  ].filter((section) => section.body);
}

function actionLabel(action: string) {
  return action === "request_changes" ? "Requested changes" : action === "accept" ? "Accepted" : action;
}

function CustomerSelector({
  linkedType,
  linkedId,
  onTypeChange,
  onIdChange,
}: {
  linkedType: LinkedType;
  linkedId: string;
  onTypeChange: (value: LinkedType) => void;
  onIdChange: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const optionsQuery = useCustomerOptions(linkedType, search);
  const options = optionsQuery.data ?? [];
  const selected = options.find((option) => String(option.id) === linkedId);

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-[150px_1fr] gap-2">
        <select
          value={linkedType}
          onChange={(event) => {
            onTypeChange(event.target.value as LinkedType);
            onIdChange("");
            setSearch("");
          }}
          className="rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-100"
        >
          <option value="contact">Contact</option>
          <option value="organization">Organization</option>
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={linkedType === "contact" ? "Search contacts" : "Search organizations"}
            className="pl-9"
          />
        </div>
      </div>
      <div className="max-h-44 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-950/70 p-1">
        {optionsQuery.isLoading ? (
          <div className="px-3 py-3 text-sm text-neutral-500">Loading customers...</div>
        ) : options.length ? (
          options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onIdChange(String(option.id))}
              className={
                "block w-full rounded px-3 py-2 text-left text-sm transition-colors " +
                (String(option.id) === linkedId ? "bg-white/10 text-neutral-100" : "text-neutral-300 hover:bg-white/5")
              }
            >
              <span className="block font-medium">{option.label}</span>
              {option.detail ? <span className="mt-0.5 block text-xs text-neutral-500">{option.detail}</span> : null}
            </button>
          ))
        ) : (
          <div className="px-3 py-3 text-sm text-neutral-500">No matching customers.</div>
        )}
      </div>
      <div className="text-xs text-neutral-500">
        {selected ? `Selected: ${selected.label}` : "Select a customer before submitting."}
      </div>
    </div>
  );
}

export default function ClientPortalDashboardPage() {
  const pagesQuery = useClientPortalPages();
  const accountsQuery = useClientPortalAccounts();
  const { createPage, publishPage, createAccount, isCreatingPage, isPublishingPage, isCreatingAccount } = useClientPortalActions();
  const [pageForm, setPageForm] = useState<PageForm>(emptyPageForm);
  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccountForm);
  const [lastSetupLink, setLastSetupLink] = useState<string | null>(null);

  async function copyText(value: string | null | undefined, label: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied.`);
  }

  async function handleCreatePage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const linkedId = Number(pageForm.linkedId);
    const price = Number(pageForm.itemPrice);
    const quantity = Number(pageForm.itemQuantity || "1");
    if (!Number.isInteger(linkedId) || linkedId <= 0) {
      toast.error("Enter a valid linked customer ID.");
      return;
    }
    if (!pageForm.itemName.trim() || !Number.isFinite(price) || price < 0 || !Number.isFinite(quantity) || quantity <= 0) {
      toast.error("Enter a valid pricing item.");
      return;
    }
    const item: PricingItemPayload = {
      name: pageForm.itemName.trim(),
      description: pageForm.itemDescription.trim() || null,
      quantity,
      currency: pageForm.itemCurrency.trim().toUpperCase() || "USD",
      public_unit_price: price,
    };
    try {
      await createPage({
        title: pageForm.title.trim(),
        summary: pageForm.summary.trim() || null,
        contact_id: pageForm.linkedType === "contact" ? linkedId : null,
        organization_id: pageForm.linkedType === "organization" ? linkedId : null,
        pricing_items: [item],
        document_ids: parseDocumentIds(pageForm.documentIds),
        proposal_sections: proposalSectionsFromForm(pageForm),
        brand_settings: {
          company_name: pageForm.brandCompanyName.trim() || null,
          logo_url: pageForm.brandLogoUrl.trim() || null,
          accent_color: pageForm.brandAccentColor.trim() || null,
        },
      });
      setPageForm(emptyPageForm);
      toast.success("Client page created.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to create client page."));
    }
  }

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const linkedId = Number(accountForm.linkedId);
    if (!Number.isInteger(linkedId) || linkedId <= 0) {
      toast.error("Enter a valid linked customer ID.");
      return;
    }
    try {
      const account = await createAccount({
        email: accountForm.email.trim(),
        contact_id: accountForm.linkedType === "contact" ? linkedId : null,
        organization_id: accountForm.linkedType === "organization" ? linkedId : null,
        status: "pending",
      });
      setAccountForm(emptyAccountForm);
      setLastSetupLink(account.setup_link ?? null);
      toast.success("Client account created.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to create client account."));
    }
  }

  async function handlePublish(pageId: number) {
    try {
      const page = await publishPage({ pageId, expiresInDays: 30 });
      if (page.public_link) await copyText(page.public_link, "Client link");
      toast.success("Client page link published.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to publish client page."));
    }
  }

  const pages = pagesQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="Client Portal"
        description="Create signed client pages, share pricing snapshots, and manage client login access."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.8fr)]">
        <Card className="px-5 py-5">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-neutral-700 bg-neutral-950">
              <Plus className="h-4 w-4 text-neutral-300" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-neutral-100">New Client Page</h2>
              <FieldDescription className="mt-1">Link one customer and store the pricing shown in this shared offer.</FieldDescription>
            </div>
          </div>

          <form className="grid gap-3" onSubmit={handleCreatePage}>
            <div className="grid gap-3 md:grid-cols-2">
              <Input value={pageForm.title} onChange={(event) => setPageForm((current) => ({ ...current, title: event.target.value }))} placeholder="Page title" required />
              <CustomerSelector
                linkedType={pageForm.linkedType}
                linkedId={pageForm.linkedId}
                onTypeChange={(linkedType) => setPageForm((current) => ({ ...current, linkedType }))}
                onIdChange={(linkedId) => setPageForm((current) => ({ ...current, linkedId }))}
              />
            </div>
            <Textarea value={pageForm.summary} onChange={(event) => setPageForm((current) => ({ ...current, summary: event.target.value }))} placeholder="Short proposal or pricing summary" />
            <div className="grid gap-3 md:grid-cols-[1fr_120px_120px_160px]">
              <Input value={pageForm.itemName} onChange={(event) => setPageForm((current) => ({ ...current, itemName: event.target.value }))} placeholder="Pricing item" required />
              <Input value={pageForm.itemQuantity} onChange={(event) => setPageForm((current) => ({ ...current, itemQuantity: event.target.value }))} placeholder="Qty" inputMode="decimal" required />
              <Input value={pageForm.itemCurrency} onChange={(event) => setPageForm((current) => ({ ...current, itemCurrency: event.target.value }))} placeholder="USD" maxLength={3} required />
              <Input value={pageForm.itemPrice} onChange={(event) => setPageForm((current) => ({ ...current, itemPrice: event.target.value }))} placeholder="Public price" inputMode="decimal" required />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input value={pageForm.itemDescription} onChange={(event) => setPageForm((current) => ({ ...current, itemDescription: event.target.value }))} placeholder="Item description" />
              <Input value={pageForm.documentIds} onChange={(event) => setPageForm((current) => ({ ...current, documentIds: event.target.value }))} placeholder="Document IDs, comma separated" />
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_140px]">
              <Input value={pageForm.brandCompanyName} onChange={(event) => setPageForm((current) => ({ ...current, brandCompanyName: event.target.value }))} placeholder="Client page company name" />
              <Input value={pageForm.brandLogoUrl} onChange={(event) => setPageForm((current) => ({ ...current, brandLogoUrl: event.target.value }))} placeholder="Logo URL" />
              <Input value={pageForm.brandAccentColor} onChange={(event) => setPageForm((current) => ({ ...current, brandAccentColor: event.target.value }))} placeholder="#14b8a6" />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Textarea value={pageForm.proposalOverview} onChange={(event) => setPageForm((current) => ({ ...current, proposalOverview: event.target.value }))} placeholder="Proposal overview" />
              <Textarea value={pageForm.proposalScope} onChange={(event) => setPageForm((current) => ({ ...current, proposalScope: event.target.value }))} placeholder="Scope and deliverables" />
              <Textarea value={pageForm.proposalTerms} onChange={(event) => setPageForm((current) => ({ ...current, proposalTerms: event.target.value }))} placeholder="Terms or next steps" />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={isCreatingPage}>
                <Plus className="h-4 w-4" />
                {isCreatingPage ? "Creating..." : "Create Page"}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="px-5 py-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-neutral-100">Client Login Access</h2>
            <FieldDescription className="mt-1">Create a setup link manually linked to a contact or organization.</FieldDescription>
          </div>
          <form className="grid gap-3" onSubmit={handleCreateAccount}>
            <Input type="email" value={accountForm.email} onChange={(event) => setAccountForm((current) => ({ ...current, email: event.target.value }))} placeholder="client@example.com" required />
            <CustomerSelector
              linkedType={accountForm.linkedType}
              linkedId={accountForm.linkedId}
              onTypeChange={(linkedType) => setAccountForm((current) => ({ ...current, linkedType }))}
              onIdChange={(linkedId) => setAccountForm((current) => ({ ...current, linkedId }))}
            />
            <Button type="submit" disabled={isCreatingAccount}>
              <Send className="h-4 w-4" />
              {isCreatingAccount ? "Creating..." : "Create Setup Link"}
            </Button>
          </form>
          {lastSetupLink ? (
            <div className="mt-4 rounded-md border border-neutral-800 bg-neutral-950/60 p-3 text-sm">
              <div className="mb-2 text-xs uppercase text-neutral-500">Latest setup link</div>
              <div className="break-all text-neutral-200">{lastSetupLink}</div>
              <Button type="button" variant="outline" className="mt-3" onClick={() => void copyText(lastSetupLink, "Setup link")}>
                <Copy className="h-4 w-4" />
                Copy
              </Button>
            </div>
          ) : null}
        </Card>
      </div>

      <Card className="px-5 py-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">Shared Pages</h2>
            <FieldDescription className="mt-1">Publish a signed link after the pricing snapshot is ready.</FieldDescription>
          </div>
        </div>
        {pagesQuery.isLoading ? (
          <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-4 py-8 text-center text-sm text-neutral-500">Loading client pages...</div>
        ) : pagesQuery.error ? (
          <div className="rounded-md border border-red-900/50 bg-red-950/20 px-4 py-4 text-sm text-red-300">{errorMessage(pagesQuery.error, "Failed to load client pages.")}</div>
        ) : pages.length === 0 ? (
          <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-4 py-8 text-center text-sm text-neutral-500">No client pages yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-neutral-800 text-xs uppercase text-neutral-500">
                <tr>
                  <th className="py-3 pr-4 font-medium">Page</th>
                  <th className="py-3 pr-4 font-medium">Customer</th>
                  <th className="py-3 pr-4 font-medium">Pricing</th>
                  <th className="py-3 pr-4 font-medium">Activity</th>
                  <th className="py-3 pr-4 font-medium">Status</th>
                  <th className="py-3 pr-4 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {pages.map((page) => (
                  <tr key={page.id}>
                    <td className="py-3 pr-4">
                      <div className="font-medium text-neutral-100">{page.title}</div>
                      <div className="text-xs text-neutral-500">{page.summary || "No summary"}</div>
                    </td>
                    <td className="py-3 pr-4 text-neutral-300">
                      {customerLabel(page)}
                    </td>
                    <td className="py-3 pr-4 text-neutral-300">
                      {page.pricing_items[0] ? formatMoney(page.pricing_items[0].public_unit_price, page.pricing_items[0].currency) : "No items"}
                    </td>
                    <td className="py-3 pr-4 text-neutral-300">
                      {page.latest_action ? (
                        <div>
                          <div className="text-neutral-200">{actionLabel(page.latest_action.action)}</div>
                          <div className="text-xs text-neutral-500">{page.latest_action.actor_email || page.latest_action.actor_name || "Client response"} · {page.action_count} total</div>
                        </div>
                      ) : (
                        <span className="text-neutral-500">No responses</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 capitalize text-neutral-300">{page.status}</td>
                    <td className="py-3 pr-0">
                      <div className="flex justify-end gap-2">
                        {page.public_link ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => void copyText(page.public_link, "Client link")}>
                            <Copy className="h-4 w-4" />
                            Copy
                          </Button>
                        ) : null}
                        {page.public_link ? (
                          <Button type="button" variant="outline" size="sm" asChild>
                            <a href={page.public_link} target="_blank" rel="noreferrer">
                              <ExternalLink className="h-4 w-4" />
                              Open
                            </a>
                          </Button>
                        ) : null}
                        <Button type="button" size="sm" onClick={() => void handlePublish(page.id)} disabled={isPublishingPage}>
                          <Link2 className="h-4 w-4" />
                          Publish
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="px-5 py-5">
        <h2 className="mb-4 text-base font-semibold text-neutral-100">Client Accounts</h2>
        {accountsQuery.isLoading ? (
          <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-4 py-6 text-sm text-neutral-500">Loading accounts...</div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account) => (
              <div key={account.id} className="rounded-md border border-neutral-800 bg-neutral-950/50 p-3">
                <div className="font-medium text-neutral-100">{account.email}</div>
                <div className="mt-1 text-xs capitalize text-neutral-500">{account.status} · {customerLabel(account)}</div>
              </div>
            ))}
            {!accounts.length ? <div className="text-sm text-neutral-500">No client accounts yet.</div> : null}
          </div>
        )}
      </Card>
    </div>
  );
}
