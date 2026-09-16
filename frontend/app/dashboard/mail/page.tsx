"use client";

import type { StatusTone } from "@/lib/statusStyles";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Inbox, KeyRound, PlugZap, RefreshCw, Trash2, TriangleAlert, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { ActionBar } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { Fact, FactList } from "@/components/ui/Fact";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ListRow, RowList } from "@/components/ui/ListRow";
import { PageShell } from "@/components/ui/PageShell";
import { PanelEmpty, PanelError, PanelHeader, PanelLoading } from "@/components/ui/PanelStates";
import SearchBar from "@/components/ui/SearchBar";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusValue } from "@/components/ui/StatusValue";
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

  function closeImapPanel() {
    setImapFormOpen(false);
    setImapForm((current) => ({ ...current, password: "" }));
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

  const linkedHref = selectedMessage ? linkedRecordHref(selectedMessage) : null;
  const recipients = selectedMessage ? recipientText(selectedMessage.to_recipients) : "";
  const isFiltered = Boolean(folder || deferredSearch.trim());

  return (
    <PageShell
      title="Mail"
      // The header carried four controls: *Manage Integrations*, *Sync IMAP*, *Reconfigure IMAP*
      // and *New Mail*. The middle two were the IMAP row's own actions a second time; the first is
      // the connections panel's empty state. The page's action is writing mail (5.7 ruling 3).
      actions={hasSendProvider ? (
        <Button asChild><Link href="/dashboard/mail/compose">New mail</Link></Button>
      ) : (
        <Button type="button" disabled>New mail</Button>
      )}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="@container min-w-0">
          <div className="space-y-4 border-b border-line-subtle p-4">
            <PanelHeader
              title="Messages"
              description="Synced provider mail and mail sent from the CRM."
              action={<SearchBar value={search} onChange={setSearch} placeholder="Search mail" className="w-56" />}
            />
            <SegmentedControl aria-label="Mail folder" value={folder} onValueChange={setFolder}>
              {FOLDERS.map((item) => (
                <SegmentedItem key={item.key || "all"} value={item.key}>{item.label}</SegmentedItem>
              ))}
            </SegmentedControl>
          </div>

          {/* The list and the open message side by side once the card itself is 48rem — beside
              the rail that is a 1440 viewport, not a breakpoint (§7.14's reasoning). Narrower,
              the message follows the list as it always did. */}
          <div className="grid min-w-0 @3xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] @3xl:divide-x @3xl:divide-line-subtle">
            <div className="min-w-0">
              {messagesQuery.isLoading ? (
                <PanelLoading label="Loading mail…" />
              ) : messagesQuery.error ? (
                <div className="p-4">
                  <PanelError message="We could not load mail messages." onRetry={() => void messagesQuery.refetch()} />
                </div>
              ) : messages.length ? (
                <RowList inset label="Mail messages">
                  {messages.map((message) => (
                    <ListRow
                      key={message.id}
                      title={message.subject || "(no subject)"}
                      onSelect={() => setSelectedMessageId(message.id)}
                      selected={selectedMessageId === message.id}
                      trailing={getMessageTime(message)}
                      meta={`${message.from_name || message.from_email || "Unknown sender"}${message.source_label ? ` · ${message.source_label}` : ""}`}
                    >
                      {message.snippet ? <p className="line-clamp-2">{message.snippet}</p> : null}
                    </ListRow>
                  ))}
                </RowList>
              ) : isFiltered ? (
                <PanelEmpty icon={Inbox} title="No messages match" description="Try another folder or search." />
              ) : (
                <PanelEmpty
                  icon={Inbox}
                  title="No mail messages yet"
                  description="Connect Gmail, Microsoft, or IMAP/SMTP to sync recent inbox messages into this view."
                />
              )}
            </div>

            {selectedMessage ? (
              <article aria-labelledby="mail-message-subject" className="min-w-0 space-y-6 border-t border-line-subtle p-4 @3xl:border-t-0">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h3 id="mail-message-subject" className="min-w-0 break-words text-base font-semibold text-copy-primary">
                      {selectedMessage.subject || "(no subject)"}
                    </h3>
                    {selectedMessage.from_email ? (
                      <ActionBar size="sm">
                        <Button type="button" variant="outline" onClick={() => void handleCreateContactFromSelectedMessage()} disabled={creatingContact || isLinkingMail}>
                          <UserPlus />
                          {creatingContact ? "Creating…" : "Create contact"}
                        </Button>
                      </ActionBar>
                    ) : null}
                  </div>
                  <FactList className="grid-cols-1 @xl:grid-cols-3">
                    <Fact label="From">{selectedMessage.from_name || selectedMessage.from_email || "Unknown sender"}</Fact>
                    {recipients ? <Fact label="To">{recipients}</Fact> : null}
                    <Fact label={selectedMessage.received_at ? "Received" : "Sent"}>{getMessageTime(selectedMessage)}</Fact>
                    {/* The link was a green box saying *Linked to …* over an *Open Linked Record*
                        button: success tint on a property, and two ways to say one thing (R5). */}
                    {selectedMessage.source_label ? (
                      <Fact label="Linked record">
                        {linkedHref ? (
                          <Link href={linkedHref} className="underline underline-offset-4 hover:text-copy-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                            {selectedMessage.source_label}
                          </Link>
                        ) : selectedMessage.source_label}
                      </Fact>
                    ) : null}
                  </FactList>
                </div>

                {/* The body was a bordered, recessed box inside the card: the third level (§1.3).
                    It is what the operator opened, so it now comes before linking. */}
                {selectedMessageQuery.isLoading ? (
                  <PanelLoading label="Loading message…" />
                ) : (
                  <div className="whitespace-pre-wrap break-words border-t border-line-subtle pt-4 text-p-sm text-copy-secondary">
                    {selectedMessage.body_text || selectedMessage.snippet || "This synced message has no readable text body."}
                  </div>
                )}

                <section aria-labelledby="mail-link-heading" className="space-y-3 border-t border-line-subtle pt-4">
                  <SectionHeading as="h4" id="mail-link-heading">Link to a record</SectionHeading>
                  <div className="grid gap-3 @xl:grid-cols-[11rem_minmax(0,1fr)]">
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
                    <SearchBar value={linkSearch} onChange={setLinkSearch} placeholder="Search records to link" className="w-full" />
                  </div>
                  {isSearchingLinks ? (
                    <p className="text-sm text-copy-muted" role="status">Searching records…</p>
                  ) : linkSearch.trim().length >= 2 && !linkTargets.length ? (
                    <p className="text-sm text-copy-muted">No matching records found.</p>
                  ) : null}
                  {/* Each result was a full-width outline button with *Link* printed inside it —
                      a box per row. They are rows with the action beside them (§7.15). */}
                  {!isSearchingLinks && linkTargets.length ? (
                    <RowList label="Records to link">
                      {linkTargets.map((target) => (
                        <ListRow
                          key={`${linkModuleKey}:${target.id}`}
                          title={target.label}
                          meta={target.subtitle}
                          actions={
                            <Button type="button" variant="outline" onClick={() => void handleLinkMessage(target)} disabled={isLinkingMail} aria-label={`Link to ${target.label}`}>
                              {isLinkingMail ? "Linking…" : "Link"}
                            </Button>
                          }
                        />
                      ))}
                    </RowList>
                  ) : null}
                </section>
              </article>
            ) : null}
          </div>
        </Card>

        <Card className="h-fit p-4">
          <PanelHeader
            title="Mail connections"
            description={contextQuery.data?.sync_note || "Mailboxes you can send and sync from."}
          />
          <div className="mt-3">
            {contextQuery.isLoading ? (
              <PanelLoading label="Loading mail connections…" />
            ) : contextQuery.isError ? (
              <PanelError message="Mail connection details could not be loaded." onRetry={() => void contextQuery.refetch()} />
            ) : contextQuery.data?.connections.length ? (
              <RowList label="Mail connections">
                {contextQuery.data.connections.map((connection) => {
                  const provider = providerLabel(connection.provider);
                  const manageLabel = connection.reconnect_label || "Manage";
                  return (
                    <ListRow
                      key={connection.provider}
                      title={provider}
                      meta={connection.account_email || "No account email"}
                      trailing={<StatusValue status={{ tone: connectionStatusTone(connection), label: connectionStatusLabel(connection) }} />}
                      actions={
                        <>
                          <Button type="button" variant="outline" onClick={() => void handleManageConnection(connection.provider)} disabled={isConnectingMail} aria-label={`${manageLabel} ${provider}`}>
                            {manageLabel}
                          </Button>
                          {/* Drawn only where it can run (§7.9); it was a disabled *Sync* on every
                              send-only mailbox. */}
                          {connection.can_sync ? (
                            <Button type="button" variant="outline" disabled={isSyncingMail} onClick={() => void handleSyncProvider(connection.provider)} aria-label={`Sync ${provider}`}>
                              <RefreshCw className={isSyncingMail ? "animate-spin" : undefined} />
                              Sync
                            </Button>
                          ) : null}
                        </>
                      }
                    >
                      <FactList className="grid-cols-2">
                        <Fact label="Mailbox">
                          {connection.provider_mailbox_name || connection.provider_mailbox_id || connection.account_email || "Not selected"}
                        </Fact>
                        <Fact label="Last sync">
                          {connection.last_successful_sync_at ? formatDateTime(connection.last_successful_sync_at) : "No successful sync yet"}
                        </Fact>
                      </FactList>
                      {connection.last_failure_reason || connection.sync_unavailable_reason ? (
                        <p className="mt-3 flex gap-2 text-xs text-state-warning">
                          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                          The provider needs attention. Reconnect it, then try syncing again.
                        </p>
                      ) : null}
                    </ListRow>
                  );
                })}
              </RowList>
            ) : (
              <PanelEmpty
                icon={PlugZap}
                title="No mailbox connected"
                description="Connect Gmail or Microsoft from integrations, or add an IMAP/SMTP mailbox."
                action={(
                  <Button type="button" variant="outline" asChild>
                    <Link href="/dashboard/settings/integrations">Manage integrations</Link>
                  </Button>
                )}
              />
            )}
            {!contextQuery.isLoading && !contextQuery.isError && !imapSmtpConnection ? (
              <ActionBar size="sm" align="start" className="mt-3">
                <Button type="button" variant="outline" onClick={() => setImapFormOpen(true)} disabled={isConnectingMail}>
                  <KeyRound />
                  Connect IMAP/SMTP
                </Button>
              </ActionBar>
            ) : null}
          </div>
        </Card>
      </div>

      {/* It was a card that opened between the connections and the inbox and pushed the inbox
          down a screen. A credential form over the page is `EditorPanel` (§7.11). */}
      <EditorPanel
        open={imapFormOpen}
        onOpenChange={(open) => (open ? setImapFormOpen(true) : closeImapPanel())}
        title={imapSmtpConnection ? "Reconfigure IMAP/SMTP" : "Connect IMAP/SMTP"}
        description="Credentials are saved for you and checked against both servers before the mailbox is marked connected. Gmail needs IMAP turned on and a Google app password."
        closeLabel="Close IMAP/SMTP settings"
        size="wide"
        onSubmit={() => void handleConnectImapSmtp()}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={closeImapPanel}>Cancel</Button>
            <Button type="submit" disabled={isConnectingMail}>
              {isConnectingMail ? "Verifying…" : "Save connection"}
            </Button>
          </>
        )}
      >
        <div className="space-y-6">
          <ActionBar size="sm" align="start">
            <Button type="button" variant="outline" onClick={useGmailImapPreset}>
              Use Gmail IMAP/SMTP
            </Button>
            {imapSmtpConnection ? (
              <Button type="button" variant="destructiveGhost" onClick={() => void handleDisconnectMail("imap_smtp")} disabled={isDisconnectingMail}>
                <Trash2 />
                Disconnect IMAP
              </Button>
            ) : null}
          </ActionBar>
          <FieldGroup className="grid gap-4 md:grid-cols-2">
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
            <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-2">
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
            <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-2">
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
        </div>
      </EditorPanel>
    </PageShell>
  );
}
