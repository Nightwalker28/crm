"use client";

import type { StatusTone } from "@/lib/statusStyles";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Inbox, KeyRound, Link2, PlugZap, RefreshCw, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Chip } from "@/components/ui/Chip";
import { StatusValue } from "@/components/ui/StatusValue";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import SearchBar from "@/components/ui/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import { useMailActions, useMailContext, useMailMessage, useMailMessages } from "@/hooks/useMail";
import { useConfirm } from "@/hooks/useConfirm";
import type { MailConnection, MailMessage, MailProvider, OAuthMailProvider } from "@/hooks/useMail";
import { formatDateTime } from "@/lib/datetime";

const FOLDERS = [
  { key: "", label: "All" },
  { key: "inbox", label: "Inbox" },
  { key: "sent", label: "Sent" },
  { key: "archive", label: "Archive" },
];
const LINK_TARGET_MODULES = [
  { key: "sales_contacts", label: "Contact", searchPath: "/sales/contacts/search", idField: "contact_id", labelFields: ["first_name", "last_name", "primary_email"] },
  { key: "sales_opportunities", label: "Opportunity", searchPath: "/sales/opportunities/search", idField: "opportunity_id", labelFields: ["opportunity_name", "client"] },
  { key: "sales_quotes", label: "Quote", searchPath: "/sales/quotes/search", idField: "quote_id", labelFields: ["quote_number", "customer_name"] },
  { key: "finance_io", label: "Insertion Order", searchPath: "/finance/insertion-orders", idField: "id", labelFields: ["io_number", "customer_name"] },
  { key: "finance_pos", label: "POS Invoice", searchPath: "/finance/pos-invoices", idField: "id", labelFields: ["invoice_number", "customer_name"] },
] as const;

type ImapForm = {
  accountEmail: string;
  imapHost: string;
  imapPort: string;
  imapSecurity: "ssl" | "starttls" | "none";
  imapUsername: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecurity: "ssl" | "starttls" | "none";
  smtpUsername: string;
  password: string;
};
type LinkTargetModuleKey = typeof LINK_TARGET_MODULES[number]["key"];
type LinkTarget = {
  id: string;
  label: string;
  subtitle?: string;
};

const emptyImapForm: ImapForm = {
  accountEmail: "",
  imapHost: "",
  imapPort: "993",
  imapSecurity: "ssl",
  imapUsername: "",
  smtpHost: "",
  smtpPort: "587",
  smtpSecurity: "starttls",
  smtpUsername: "",
  password: "",
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function readJsonSafely(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function recipientText(recipients?: Record<string, unknown>[] | null) {
  return (recipients ?? [])
    .map((item) => {
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const email = typeof item.email === "string" ? item.email.trim() : "";
      if (name && email) return `${name} <${email}>`;
      return email || name;
    })
    .filter(Boolean)
    .join(", ");
}

function getMessageTime(message: MailMessage) {
  return message.received_at ? formatDateTime(message.received_at) : message.sent_at ? formatDateTime(message.sent_at) : formatDateTime(message.created_at);
}

function linkedRecordHref(message: MailMessage) {
  if (!message.source_module_key || !message.source_entity_id) return null;
  const id = message.source_entity_id;
  if (message.source_module_key === "sales_contacts") return `/dashboard/sales/contacts/${id}`;
  if (message.source_module_key === "sales_opportunities") return `/dashboard/sales/opportunities/${id}`;
  if (message.source_module_key === "sales_quotes") return `/dashboard/sales/quotes/${id}`;
  if (message.source_module_key === "finance_io") return `/dashboard/finance/insertion-orders/${id}`;
  if (message.source_module_key === "finance_pos") return `/dashboard/finance/pos/${id}`;
  return null;
}

function providerLabel(provider: MailProvider) {
  if (provider === "google") return "Gmail";
  if (provider === "microsoft") return "Microsoft";
  return "IMAP/SMTP";
}

function connectionStatusLabel(connection: MailConnection) {
  if (connection.health_status === "healthy") return "Ready";
  if (connection.health_status === "limited") return "Connected, limited scope";
  if (connection.health_status === "warning") return "Needs attention";
  if (connection.health_status === "error") return "Sync error";
  if (connection.health_status === "reconnect_required") return "Reconnect required";
  return connection.status;
}

function connectionStatusTone(connection: MailConnection): StatusTone {
  if (connection.health_status === "healthy") {
    return "success";
  }
  if (connection.health_status === "limited" || connection.health_status === "warning") {
    return "attention";
  }
  return "critical";
}

function splitSenderName(name?: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: null, last_name: null };
  if (parts.length === 1) return { first_name: parts[0], last_name: null };
  return { first_name: parts.slice(0, -1).join(" "), last_name: parts[parts.length - 1] };
}

async function createContactFromMessage(message: MailMessage) {
  if (!message.from_email) throw new Error("This email has no sender address.");
  const names = splitSenderName(message.from_name);
  const res = await apiFetch("/sales/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...names,
      primary_email: message.from_email,
    }),
  });
  const body = await readJsonSafely(res);
  if (!res.ok) throw new Error("We could not create a contact from this message.");
  return body as { contact_id: number };
}

async function searchLinkTargets(moduleKey: LinkTargetModuleKey, query: string): Promise<LinkTarget[]> {
  const moduleConfig = LINK_TARGET_MODULES.find((item) => item.key === moduleKey);
  if (!moduleConfig || query.trim().length < 2) return [];
  const params = new URLSearchParams({ page: "1", page_size: "8" });
  if (moduleConfig.searchPath.includes("/search")) {
    params.set("query", query.trim());
  } else {
    params.set("search", query.trim());
  }
  const res = await apiFetch(`${moduleConfig.searchPath}?${params.toString()}`);
  const body = await readJsonSafely(res);
  if (!res.ok) throw new Error("We could not search records to link.");
  const results = Array.isArray(body?.results) ? body.results : [];
  return results.map((record: Record<string, unknown>) => {
    const id = String(record[moduleConfig.idField] ?? "");
    const labelParts = moduleConfig.labelFields.map((field) => record[field]).filter((value) => typeof value === "string" && value.trim());
    return {
      id,
      label: labelParts.length ? labelParts.join(" / ") : `${moduleConfig.label} #${id}`,
      subtitle: moduleConfig.label,
    };
  }).filter((item: LinkTarget) => item.id);
}

export default function MailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { confirm } = useConfirm();
  const [folder, setFolder] = useState("");
  const [search, setSearch] = useState("");
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [imapFormOpen, setImapFormOpen] = useState(false);
  const [imapForm, setImapForm] = useState<ImapForm>(emptyImapForm);
  const [linkModuleKey, setLinkModuleKey] = useState<LinkTargetModuleKey>("sales_contacts");
  const [linkSearch, setLinkSearch] = useState("");
  const [linkTargets, setLinkTargets] = useState<LinkTarget[]>([]);
  const [isSearchingLinks, setIsSearchingLinks] = useState(false);
  const [creatingContact, setCreatingContact] = useState(false);
  const deferredSearch = useDeferredValue(search);

  const contextQuery = useMailContext();
  const messagesQuery = useMailMessages(folder || undefined, deferredSearch);
  const selectedMessageQuery = useMailMessage(selectedMessageId);
  const { connectMail, connectImapSmtp, syncMail, disconnectMail, linkMail, isConnectingMail, isSyncingMail, isDisconnectingMail, isLinkingMail } = useMailActions();
  const messages = useMemo(() => messagesQuery.data?.results ?? [], [messagesQuery.data?.results]);
  const selectedMessage = selectedMessageQuery.data ?? messages.find((message) => message.id === selectedMessageId) ?? null;
  const googleConnection = contextQuery.data?.connections.find((connection) => connection.provider === "google");
  const microsoftConnection = contextQuery.data?.connections.find((connection) => connection.provider === "microsoft");
  const imapSmtpConnection = contextQuery.data?.connections.find((connection) => connection.provider === "imap_smtp");
  const hasSendProvider = Boolean(googleConnection?.can_send || microsoftConnection?.can_send || imapSmtpConnection?.can_send);
  const mailConnectStatus = searchParams.get("mailConnect");
  const messageIdParam = searchParams.get("messageId");
  const requestedMessageId = messageIdParam && /^\d+$/.test(messageIdParam) ? Number(messageIdParam) : null;
  useEffect(() => {
    if (mailConnectStatus === "connected") {
      toast.success("Gmail inbox connected.");
      router.replace("/dashboard/mail");
    }
    if (mailConnectStatus === "error") {
      toast.error("Failed to connect Gmail inbox.");
      router.replace("/dashboard/mail");
    }
  }, [mailConnectStatus, router]);

  useEffect(() => {
    if (requestedMessageId) {
      setSelectedMessageId(requestedMessageId);
    }
  }, [requestedMessageId]);

  useEffect(() => {
    if (!messages.length) {
      if (!requestedMessageId) setSelectedMessageId(null);
      return;
    }
    setSelectedMessageId((current) => current ?? messages[0].id);
  }, [messages, requestedMessageId]);

  useEffect(() => {
    let cancelled = false;
    const trimmed = linkSearch.trim();
    if (trimmed.length < 2) {
      setLinkTargets([]);
      return;
    }
    setIsSearchingLinks(true);
    searchLinkTargets(linkModuleKey, trimmed)
      .then((targets) => {
        if (!cancelled) setLinkTargets(targets);
      })
      .catch((error) => {
        if (!cancelled) {
          setLinkTargets([]);
          toast.error(getErrorMessage(error, "Failed to search records."));
        }
      })
      .finally(() => {
        if (!cancelled) setIsSearchingLinks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [linkModuleKey, linkSearch]);

  async function handleSyncProvider(provider: MailProvider) {
    try {
      const result = await syncMail(provider);
      toast.success(`Synced ${result.synced_message_count} new ${providerLabel(provider)} message${result.synced_message_count === 1 ? "" : "s"}.`);
    } catch (error) {
      toast.error(getErrorMessage(error, `Failed to sync ${providerLabel(provider)} mailbox.`));
    }
  }

  async function handleConnectImapSmtp() {
    if (!imapForm.accountEmail.trim() || !imapForm.imapHost.trim() || !imapForm.imapUsername.trim() || !imapForm.smtpHost.trim() || !imapForm.password) {
      toast.error("Fill in the IMAP/SMTP account, server, username, and password fields.");
      return;
    }
    const parsedImapPort = Number(imapForm.imapPort);
    const parsedSmtpPort = Number(imapForm.smtpPort);
    if (!Number.isInteger(parsedImapPort) || parsedImapPort < 1 || parsedImapPort > 65535 || !Number.isInteger(parsedSmtpPort) || parsedSmtpPort < 1 || parsedSmtpPort > 65535) {
      toast.error("Use valid IMAP and SMTP ports.");
      return;
    }
    try {
      await connectImapSmtp({
        account_email: imapForm.accountEmail.trim(),
        imap_host: imapForm.imapHost.trim(),
        imap_port: parsedImapPort,
        imap_security: imapForm.imapSecurity,
        imap_username: imapForm.imapUsername.trim(),
        smtp_host: imapForm.smtpHost.trim(),
        smtp_port: parsedSmtpPort,
        smtp_security: imapForm.smtpSecurity,
        smtp_username: imapForm.smtpUsername.trim() || null,
        password: imapForm.password,
      });
      toast.success("IMAP/SMTP mailbox connected.");
      setImapFormOpen(false);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to connect IMAP/SMTP mailbox."));
    } finally {
      setImapForm((current) => ({ ...current, password: "" }));
    }
  }

  async function handleManageConnection(provider: MailProvider) {
    if (provider === "imap_smtp") {
      setImapFormOpen(true);
      return;
    }
    try {
      const result = await connectMail(provider as OAuthMailProvider);
      window.location.href = result.auth_url;
    } catch (error) {
      toast.error(getErrorMessage(error, `Failed to connect ${providerLabel(provider)}.`));
    }
  }

  async function handleDisconnectMail(provider: MailProvider) {
    const confirmed = await confirm({
      title: `Disconnect ${providerLabel(provider)}?`,
      description: "New messages will stop syncing and this mailbox will no longer be available for sending. Existing CRM mail history is retained.",
      confirmLabel: "Disconnect mailbox",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      await disconnectMail(provider);
      toast.success("Mailbox disconnected.");
      if (provider === "imap_smtp") {
        setImapFormOpen(false);
        setImapForm(emptyImapForm);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to disconnect mailbox."));
    }
  }

  function useGmailImapPreset() {
    setImapForm((current) => ({
      ...current,
      imapHost: "imap.gmail.com",
      imapPort: "993",
      imapSecurity: "ssl",
      imapUsername: current.imapUsername || current.accountEmail.trim(),
      smtpHost: "smtp.gmail.com",
      smtpPort: "587",
      smtpSecurity: "starttls",
      smtpUsername: current.smtpUsername || current.imapUsername.trim() || current.accountEmail.trim(),
    }));
  }

  async function handleCreateContactFromSelectedMessage() {
    if (!selectedMessage) return;
    try {
      setCreatingContact(true);
      const contact = await createContactFromMessage(selectedMessage);
      await linkMail(selectedMessage.id, {
        source_module_key: "sales_contacts",
        source_entity_id: String(contact.contact_id),
      });
      toast.success("Contact created and mail linked.");
      setLinkModuleKey("sales_contacts");
      setLinkSearch(selectedMessage.from_email ?? "");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to create contact from this email."));
    } finally {
      setCreatingContact(false);
    }
  }

  async function handleLinkMessage(target: LinkTarget) {
    if (!selectedMessage) return;
    try {
      await linkMail(selectedMessage.id, {
        source_module_key: linkModuleKey,
        source_entity_id: target.id,
      });
      toast.success(`Mail linked to ${target.label}.`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to link mail."));
    }
  }

  return (
    <PageShell
      title="Mail"
      actions={(
        <>
          <Button type="button" variant="outline" asChild>
            <Link href="/dashboard/settings/integrations">Manage Integrations</Link>
          </Button>
          {imapSmtpConnection?.can_sync ? (
            <>
              <Button type="button" variant="outline" onClick={() => void handleSyncProvider("imap_smtp")} disabled={isSyncingMail}>
                <RefreshCw className={"h-4 w-4 " + (isSyncingMail ? "animate-spin" : "")} />
                Sync IMAP
              </Button>
              <Button type="button" variant="outline" onClick={() => setImapFormOpen((current) => !current)} disabled={isConnectingMail}>
                <KeyRound className="h-4 w-4" />
                Reconfigure IMAP
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={() => setImapFormOpen((current) => !current)} disabled={isConnectingMail}>
              <KeyRound className="h-4 w-4" />
              IMAP/SMTP
            </Button>
          )}
          {hasSendProvider ? (
            <Button asChild><Link href="/dashboard/mail/compose">New Mail</Link></Button>
          ) : (
            <Button type="button" disabled>New Mail</Button>
          )}
        </>
      )}
    >

      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-copy-primary">Mail Connections</h2>
            <p className="mt-1 text-sm text-copy-muted">{contextQuery.data?.sync_note || "Mailbox sync state will appear here."}</p>
          </div>
          <PlugZap className="h-4 w-4 text-copy-muted" />
        </div>
        <div className="grid gap-3 p-4 lg:grid-cols-3">
          {contextQuery.isLoading ? (
            <div className="py-8 text-center text-sm text-copy-muted lg:col-span-3" aria-busy="true">Loading mail connections...</div>
          ) : contextQuery.isError ? (
            <div role="alert" className="rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted p-4 text-sm text-copy-secondary lg:col-span-3">
              <p>Mail connection details could not be loaded.</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void contextQuery.refetch()}>
                <RefreshCw />Try again
              </Button>
            </div>
          ) : contextQuery.data?.connections.length ? (
            contextQuery.data.connections.map((connection) => (
              <div key={connection.provider} className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-copy-primary">{providerLabel(connection.provider)}</div>
                    <div className="mt-1 text-xs text-copy-muted">{connection.account_email || "No account email"}</div>
                  </div>
                  <StatusValue status={{ tone: connectionStatusTone(connection), label: connectionStatusLabel(connection) }} context="record" />
                </div>
                <div className="mt-3 space-y-2 text-xs text-copy-secondary">
                  <div>
                    <span className="text-copy-muted">Mailbox</span>
                    <div className="mt-0.5 truncate text-copy-secondary">
                      {connection.provider_mailbox_name || connection.provider_mailbox_id || connection.account_email || "Not selected"}
                    </div>
                  </div>
                  <div>
                    <span className="text-copy-muted">Last sync</span>
                    <div className="mt-0.5 text-copy-secondary">
                      {connection.last_successful_sync_at ? formatDateTime(connection.last_successful_sync_at) : "No successful sync yet"}
                    </div>
                  </div>
                </div>
                {connection.last_failure_reason || connection.sync_unavailable_reason ? (
                  <div className="mt-3 flex gap-2 rounded-[var(--radius-control-sm)] border border-state-warning/40 bg-state-warning-muted px-3 py-2 text-xs text-state-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>The provider needs attention. Reconnect it, then try syncing again.</span>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2 rounded-[var(--radius-control-sm)] border border-state-success/40 bg-state-success-muted px-3 py-2 text-xs text-state-success">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{connection.can_sync ? "Inbox sync is available." : "Sending is available."}</span>
                  </div>
                )}
                {connection.scopes.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {connection.scopes.slice(0, 3).map((scope) => (
                      <Chip key={scope} className="max-w-full">{scope}</Chip>
                    ))}
                    {connection.scopes.length > 3 ? (
                      <Chip>
                        +{connection.scopes.length - 3}
                      </Chip>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => void handleManageConnection(connection.provider)} disabled={isConnectingMail}>
                    {connection.reconnect_label || "Manage"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!connection.can_sync || isSyncingMail}
                    onClick={() => void handleSyncProvider(connection.provider)}
                  >
                    <RefreshCw className={"h-3.5 w-3.5 " + (isSyncingMail ? "animate-spin" : "")} />
                    Sync
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <EmptyState
              icon={PlugZap}
              title="No mailbox provider connected"
              description="Connect Gmail, Microsoft, or IMAP/SMTP to send and sync mail."
              className="lg:col-span-3"
            />
          )}
        </div>
      </Card>

      {imapFormOpen ? (
        <Card className="p-5">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-base font-semibold text-copy-primary">Connect IMAP/SMTP</h2>
              <p className="mt-1 text-sm text-copy-muted">Credentials are saved per user and verified against both servers before the mailbox is marked connected. Gmail requires IMAP enabled and a Google app password.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={useGmailImapPreset}>
                Use Gmail IMAP/SMTP
              </Button>
              {imapSmtpConnection ? (
                <Button type="button" variant="destructiveGhost" onClick={() => void handleDisconnectMail("imap_smtp")} disabled={isDisconnectingMail}>
                  <Trash2 className="h-4 w-4" />
                  Disconnect IMAP
                </Button>
              ) : null}
            </div>
            <FieldGroup className="grid gap-3 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="imap-account-email">Mailbox email</FieldLabel>
                <Input id="imap-account-email" type="email" autoComplete="email" value={imapForm.accountEmail} onChange={(event) => setImapForm((current) => ({ ...current, accountEmail: event.target.value }))} placeholder="name@example.com" />
              </Field>
              <Field>
                <FieldLabel htmlFor="imap-username">IMAP username</FieldLabel>
                <Input id="imap-username" autoComplete="username" value={imapForm.imapUsername} onChange={(event) => setImapForm((current) => ({ ...current, imapUsername: event.target.value }))} placeholder="IMAP username" />
              </Field>
              <Field>
                <FieldLabel htmlFor="imap-host">IMAP host</FieldLabel>
                <Input id="imap-host" value={imapForm.imapHost} onChange={(event) => setImapForm((current) => ({ ...current, imapHost: event.target.value }))} placeholder="imap.example.com" />
              </Field>
              <div className="grid grid-cols-[1fr_140px] gap-2">
                <Field>
                  <FieldLabel htmlFor="imap-port">IMAP port</FieldLabel>
                  <Input id="imap-port" value={imapForm.imapPort} onChange={(event) => setImapForm((current) => ({ ...current, imapPort: event.target.value }))} inputMode="numeric" />
                </Field>
                <Field>
                  <FieldLabel>Security</FieldLabel>
                  <Select value={imapForm.imapSecurity} onValueChange={(value) => setImapForm((current) => ({ ...current, imapSecurity: value as ImapForm["imapSecurity"] }))}>
                    <SelectTrigger aria-label="IMAP security"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ssl">SSL</SelectItem>
                      <SelectItem value="starttls">STARTTLS</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="smtp-host">SMTP host</FieldLabel>
                <Input id="smtp-host" value={imapForm.smtpHost} onChange={(event) => setImapForm((current) => ({ ...current, smtpHost: event.target.value }))} placeholder="smtp.example.com" />
              </Field>
              <div className="grid grid-cols-[1fr_140px] gap-2">
                <Field>
                  <FieldLabel htmlFor="smtp-port">SMTP port</FieldLabel>
                  <Input id="smtp-port" value={imapForm.smtpPort} onChange={(event) => setImapForm((current) => ({ ...current, smtpPort: event.target.value }))} inputMode="numeric" />
                </Field>
                <Field>
                  <FieldLabel>Security</FieldLabel>
                  <Select value={imapForm.smtpSecurity} onValueChange={(value) => setImapForm((current) => ({ ...current, smtpSecurity: value as ImapForm["smtpSecurity"] }))}>
                    <SelectTrigger aria-label="SMTP security"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ssl">SSL</SelectItem>
                      <SelectItem value="starttls">STARTTLS</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="smtp-username">SMTP username</FieldLabel>
                <Input id="smtp-username" autoComplete="username" value={imapForm.smtpUsername} onChange={(event) => setImapForm((current) => ({ ...current, smtpUsername: event.target.value }))} placeholder="Defaults to IMAP username" />
              </Field>
              <Field>
                <FieldLabel htmlFor="mailbox-password">Mailbox password</FieldLabel>
                <Input id="mailbox-password" autoComplete="current-password" value={imapForm.password} onChange={(event) => setImapForm((current) => ({ ...current, password: event.target.value }))} placeholder="Password or app password" type="password" />
              </Field>
            </FieldGroup>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setImapFormOpen(false)}>Cancel</Button>
              <Button type="button" onClick={() => void handleConnectImapSmtp()} disabled={isConnectingMail}>
                {isConnectingMail ? "Verifying..." : "Save Connection"}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <section className="grid gap-4">
        <Card>
          <div className="border-b border-line-subtle p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-copy-primary">Messages</h2>
                <p className="mt-1 text-sm text-copy-muted">Synced provider mail and future CRM-linked communication records will appear here.</p>
              </div>
              <SearchBar value={search} onChange={setSearch} placeholder="Search mail" className="md:w-72" />
            </div>

            <SegmentedControl aria-label="Mail folder" value={folder} onValueChange={setFolder} className="mt-4">
              {FOLDERS.map((item) => (
                <SegmentedItem key={item.key || "all"} value={item.key}>{item.label}</SegmentedItem>
              ))}
            </SegmentedControl>
          </div>

          {messagesQuery.isLoading ? (
            <div className="p-8 text-sm text-copy-muted" aria-busy="true">Loading mail messages...</div>
          ) : messagesQuery.error ? (
            <div role="alert" className="m-5 rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted p-4 text-sm text-copy-secondary">
              <p>We could not load mail messages.</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void messagesQuery.refetch()}>
                <RefreshCw />Try again
              </Button>
            </div>
          ) : messages.length ? (
            <div className="divide-y divide-line-subtle">
              {messages.map((message) => (
                <Button
                  key={message.id}
                  type="button"
                  variant="ghost"
                  onClick={() => setSelectedMessageId(message.id)}
                  className={
                    "h-auto w-full justify-start rounded-none p-5 text-left whitespace-normal " +
                    (selectedMessageId === message.id ? "bg-action-primary-muted" : "")
                  }
                  aria-pressed={selectedMessageId === message.id}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-copy-primary">{message.subject || "(no subject)"}</h3>
                      <p className="mt-1 truncate text-xs text-copy-muted">
                        {message.from_name || message.from_email || "Unknown sender"}
                        {message.source_label ? ` / ${message.source_label}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-xs text-copy-muted">
                      {getMessageTime(message)}
                    </div>
                  </div>
                  {message.snippet ? <p className="mt-3 line-clamp-2 text-sm text-copy-secondary">{message.snippet}</p> : null}
                </Button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Inbox}
              title="No mail messages yet"
              description="Connect Gmail, Microsoft, or IMAP/SMTP to sync recent inbox messages into this view."
              className="min-h-72"
            />
          )}

          {selectedMessage ? (
            <div className="border-t border-line-subtle p-5">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-copy-primary">{selectedMessage.subject || "(no subject)"}</h2>
                    <div className="mt-2 space-y-1 text-xs text-copy-muted">
                      <div>From: {selectedMessage.from_name || selectedMessage.from_email || "Unknown sender"}</div>
                      {recipientText(selectedMessage.to_recipients) ? <div>To: {recipientText(selectedMessage.to_recipients)}</div> : null}
                      <div>{getMessageTime(selectedMessage)}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {selectedMessage.from_email ? (
                      <Button type="button" variant="outline" onClick={() => void handleCreateContactFromSelectedMessage()} disabled={creatingContact || isLinkingMail}>
                        <UserPlus className="h-4 w-4" />
                        {creatingContact ? "Creating..." : "Create Contact"}
                      </Button>
                    ) : null}
                    {linkedRecordHref(selectedMessage) ? (
                      <Button type="button" variant="outline" asChild>
                        <Link href={linkedRecordHref(selectedMessage) ?? "/dashboard/mail"}>
                          <Link2 className="h-4 w-4" />
                          Open Linked Record
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </div>

                {selectedMessage.source_label ? (
                  <div className="rounded-[var(--radius-control)] border border-state-success/40 bg-state-success-muted px-4 py-3 text-sm text-state-success">
                    Linked to {selectedMessage.source_label}
                  </div>
                ) : null}

                <div className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-4">
                  <div className="mb-3 text-xs font-semibold text-copy-label">Link Mail To Record</div>
                  <div className="grid gap-3 md:grid-cols-[180px_1fr]">
                    <Select
                      value={linkModuleKey}
                      onValueChange={(value) => {
                        setLinkModuleKey(value as LinkTargetModuleKey);
                        setLinkSearch("");
                        setLinkTargets([]);
                      }}
                    >
                      <SelectTrigger aria-label="Record type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LINK_TARGET_MODULES.map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <SearchBar value={linkSearch} onChange={setLinkSearch} placeholder="Search records to link" className="md:w-full" />
                  </div>
                  <div className="mt-3 space-y-2">
                    {isSearchingLinks ? <div className="text-sm text-copy-muted">Searching records...</div> : null}
                    {!isSearchingLinks && linkSearch.trim().length >= 2 && !linkTargets.length ? <div className="text-sm text-copy-muted">No matching records found.</div> : null}
                    {linkTargets.map((target) => (
                      <Button
                        key={`${linkModuleKey}:${target.id}`}
                        type="button"
                        variant="outline"
                        onClick={() => void handleLinkMessage(target)}
                        disabled={isLinkingMail}
                        className="h-auto w-full justify-between whitespace-normal px-4 py-3 text-left"
                      >
                        <span>
                          <span className="block font-medium">{target.label}</span>
                          {target.subtitle ? <span className="mt-1 block text-xs text-copy-muted">{target.subtitle}</span> : null}
                        </span>
                        <span className="text-xs text-copy-muted">{isLinkingMail ? "Linking..." : "Link"}</span>
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="whitespace-pre-wrap rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-4 text-p-sm text-copy-secondary">
                  {selectedMessageQuery.isLoading ? "Loading message..." : selectedMessage.body_text || selectedMessage.snippet || "This synced message has no readable text body."}
                </div>
              </div>
            </div>
          ) : null}
        </Card>
      </section>
    </PageShell>
  );
}
