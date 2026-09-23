"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { Copy, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";

import { ClientAccountsTable } from "@/components/client-portal/ClientAccountsTable";
import { ClientPagesTable } from "@/components/client-portal/ClientPagesTable";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { SectionHeading } from "@/components/ui/SectionHeading";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useClientPortalActions, useClientPortalAccounts, useClientPortalPages, useCustomerOptions, type ClientAccountStatus, type ClientPortalSortState } from "@/hooks/useClientPortal";
import { useConfirm } from "@/hooks/useConfirm";

type LinkedType = "contact" | "organization";

type AccountForm = {
  email: string;
  linkedType: LinkedType;
  linkedId: string;
};

const emptyAccountForm: AccountForm = {
  email: "",
  linkedType: "contact",
  linkedId: "",
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function customerLabel(item: { contact_id?: number | null; organization_id?: number | null; contact_name?: string | null; organization_name?: string | null }) {
  if (item.contact_id) return item.contact_name || `Contact #${item.contact_id}`;
  return item.organization_name || `Organization #${item.organization_id}`;
}

function nextSort(current: ClientPortalSortState, column: string): ClientPortalSortState {
  return current?.key === column
    ? { key: column, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key: column, direction: "asc" };
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
        <Select
          value={linkedType}
          onValueChange={(value) => {
            onTypeChange(value as LinkedType);
            onIdChange("");
            setSearch("");
          }}
        >
          <SelectTrigger aria-label="Customer type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="contact">Contact</SelectItem>
            <SelectItem value="organization">Organization</SelectItem>
          </SelectContent>
        </Select>
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder={linkedType === "contact" ? "Search contacts" : "Search organizations"}
          className="md:w-full"
        />
      </div>
      {/* Bounded on purpose: this is a search-filtered picker, not page content. An
          uncapped customer list would push the rest of the form off screen. The marker
          declares the intent - see docs/design/design.md 4.5. */}
      <div
        data-bounded-list
        role="group"
        aria-label="Customer search results"
        className="max-h-44 overflow-y-auto rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-1"
      >
        {optionsQuery.isLoading ? (
          <div className="px-3 py-3 text-sm text-copy-muted" aria-busy="true">Loading customers…</div>
        ) : optionsQuery.isError ? (
          <div role="alert" className="px-3 py-3 text-sm text-copy-secondary">
            <p>Customers could not be loaded.</p>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void optionsQuery.refetch()}>
              <RefreshCw />Try again
            </Button>
          </div>
        ) : options.length ? (
          options.map((option) => (
            <Button
              key={option.id}
              type="button"
              variant="ghost"
              onClick={() => onIdChange(String(option.id))}
              className={
                "h-auto w-full justify-start whitespace-normal px-3 py-2 text-left " +
                (String(option.id) === linkedId ? "bg-action-primary-muted text-copy-primary" : "")
              }
              aria-pressed={String(option.id) === linkedId}
            >
              <span className="block font-medium">{option.label}</span>
              {option.detail ? <span className="mt-0.5 block text-xs text-copy-muted">{option.detail}</span> : null}
            </Button>
          ))
        ) : (
          <div className="px-3 py-3 text-sm text-copy-muted">No matching customers.</div>
        )}
      </div>
      <div className="text-xs text-copy-muted">
        {selected ? `Selected: ${selected.label}` : "Select a customer before submitting."}
      </div>
    </div>
  );
}

export default function ClientPortalDashboardPage() {
  const { confirm } = useConfirm();
  const [pageSort, setPageSort] = useState<ClientPortalSortState>(null);
  const [accountSort, setAccountSort] = useState<ClientPortalSortState>(null);
  const pagesQuery = useClientPortalPages(pageSort);
  const accountsQuery = useClientPortalAccounts(accountSort);
  const {
    publishPage,
    createAccount,
    updateAccountStatus,
    regenerateAccountSetupLink,
    isPublishingPage,
    isCreatingAccount,
    isUpdatingAccountStatus,
    isRegeneratingSetupLink,
  } = useClientPortalActions();
  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccountForm);
  const [lastSetupLink, setLastSetupLink] = useState<string | null>(null);

  async function copyText(value: string | null | undefined, label: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied.`);
  }

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const linkedId = Number(accountForm.linkedId);
    if (!Number.isInteger(linkedId) || linkedId <= 0) {
      toast.error("Select a customer before creating the setup link.");
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

  async function handleUpdateAccountStatus(accountId: number, status: ClientAccountStatus) {
    const account = accountsQuery.data?.find((item) => item.id === accountId);
    const confirmed = await confirm({
      title: status === "active" ? "Activate client access?" : status === "inactive" ? "Deactivate client access?" : "Set client access to pending?",
      description: status === "active"
        ? `${account?.email ?? "This client"} will be able to sign in to the authenticated client portal.`
        : status === "inactive"
          ? `${account?.email ?? "This client"} will lose authenticated portal access. Existing records and audit history are retained.`
          : `${account?.email ?? "This client"} will need to complete account setup before signing in.`,
      confirmLabel: status === "active" ? "Activate access" : status === "inactive" ? "Deactivate access" : "Set pending",
      variant: status === "inactive" ? "destructive" : "default",
    });
    if (!confirmed) return;
    try {
      const updated = await updateAccountStatus({ accountId, status });
      toast.success(`Client access set to ${updated.status}.`);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to update client access."));
    }
  }

  async function handleRegenerateSetupLink(accountId: number) {
    const account = accountsQuery.data?.find((item) => item.id === accountId);
    const confirmed = await confirm({
      title: "Regenerate setup link?",
      description: `The previous setup link for ${account?.email ?? "this client"} will stop working. The new link is shown once for secure sharing.`,
      confirmLabel: "Regenerate link",
    });
    if (!confirmed) return;
    try {
      const account = await regenerateAccountSetupLink(accountId);
      setLastSetupLink(account.setup_link ?? null);
      if (account.setup_link) await copyText(account.setup_link, "Setup link");
      toast.success("Setup link regenerated.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to regenerate setup link."));
    }
  }

  async function handlePublish(pageId: number) {
    const clientPage = pagesQuery.data?.find((item) => item.id === pageId);
    const confirmed = await confirm({
      title: "Publish client page?",
      description: `"${clientPage?.title ?? "This page"}" will receive a scoped link that exposes its customer-specific pricing snapshot and attached documents until the link expires in 30 days.`,
      confirmLabel: "Publish page",
    });
    if (!confirmed) return;
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
    <PageShell
      title="Client portal"
      description="Provision authenticated client access and publish scoped customer pages."
      actions={<Button asChild><Link href="/dashboard/client-portal/pages/new">Create client page</Link></Button>}
    >

      <div className="grid gap-4">
        <Card className="px-5 py-5">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-copy-primary">Client login access</h2>
            <FieldDescription className="mt-1">Create a setup link manually linked to a contact or organization.</FieldDescription>
          </div>
          <form className="grid gap-4" onSubmit={handleCreateAccount}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="client-account-email">Client email <RequiredMark /></FieldLabel>
                <Input id="client-account-email" type="email" autoComplete="email" value={accountForm.email} onChange={(event) => setAccountForm((current) => ({ ...current, email: event.target.value }))} placeholder="client@example.com" required />
              </Field>
              <Field>
                <FieldLabel>Linked customer <RequiredMark /></FieldLabel>
                <CustomerSelector
                  linkedType={accountForm.linkedType}
                  linkedId={accountForm.linkedId}
                  onTypeChange={(linkedType) => setAccountForm((current) => ({ ...current, linkedType }))}
                  onIdChange={(linkedId) => setAccountForm((current) => ({ ...current, linkedId }))}
                />
              </Field>
            </FieldGroup>
            <Button type="submit" disabled={isCreatingAccount}>
              <Send className="h-4 w-4" />
              {isCreatingAccount ? "Creating…" : "Create setup link"}
            </Button>
          </form>
          {lastSetupLink ? (
            <div className="mt-4 rounded-[var(--radius-control)] border border-state-info/40 bg-state-info-muted p-3 text-sm">
              <div className="mb-2 text-xs font-medium text-copy-label">Latest setup link</div>
              <div className="break-all text-copy-primary">{lastSetupLink}</div>
              <p className="mt-2 text-xs text-copy-muted">Share this link securely. Regenerating it invalidates the previous link.</p>
              <Button type="button" variant="outline" className="mt-3" onClick={() => void copyText(lastSetupLink, "Setup link")}>
                <Copy className="h-4 w-4" />
                Copy
              </Button>
            </div>
          ) : null}
        </Card>
      </div>

      <Card className="px-5 py-5">
        <SectionHeading description="Publish a signed link after the pricing snapshot is ready." className="mb-4">
          Shared pages
        </SectionHeading>
        <ClientPagesTable
          pages={pages}
          customerLabel={customerLabel}
          sort={pageSort}
          onSortChange={(column) => setPageSort((current) => nextSort(current, column))}
          isLoading={pagesQuery.isLoading}
          isRefreshing={pagesQuery.isFetching && !pagesQuery.isLoading}
          hasError={Boolean(pagesQuery.error)}
          onRetry={() => void pagesQuery.refetch()}
          onCopyLink={(link) => void copyText(link, "Client link")}
          onPublish={(pageId) => void handlePublish(pageId)}
          isPublishing={isPublishingPage}
        />
      </Card>

      <Card className="px-5 py-5">
        <SectionHeading className="mb-4">Client accounts</SectionHeading>
        <ClientAccountsTable
          accounts={accounts}
          customerLabel={customerLabel}
          sort={accountSort}
          onSortChange={(column) => setAccountSort((current) => nextSort(current, column))}
          isLoading={accountsQuery.isLoading}
          isRefreshing={accountsQuery.isFetching && !accountsQuery.isLoading}
          hasError={Boolean(accountsQuery.error)}
          onRetry={() => void accountsQuery.refetch()}
          onStatusChange={(accountId, status) => void handleUpdateAccountStatus(accountId, status)}
          isUpdatingStatus={isUpdatingAccountStatus}
          onRegenerateSetupLink={(accountId) => void handleRegenerateSetupLink(accountId)}
          isRegeneratingSetupLink={isRegeneratingSetupLink}
        />
      </Card>
    </PageShell>
  );
}
