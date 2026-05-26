"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Inbox, KeyRound, Link2, Mail, RefreshCw, Search, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useMailActions, useMailContext, useMailMessage, useMailMessages } from "@/hooks/useMail";
import type { MailMessage, MailProvider } from "@/hooks/useMail";
import { formatDateTime } from "@/lib/datetime";

const FOLDERS = [
  { key: "", label: "All" },
  { key: "inbox", label: "Inbox" },
  { key: "sent", label: "Sent" },
  { key: "archive", label: "Archive" },
];
const VARIABLE_TOKENS = [
  "{{contact.first_name}}",
  "{{contact.last_name}}",
  "{{contact.full_name}}",
  "{{contact.email}}",
  "{{organization.name}}",
  "{{opportunity.name}}",
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
type OAuthProvider = Extract<MailProvider, "google" | "microsoft">;
type ProviderAction = {
  label: string;
  provider: OAuthProvider;
  mode: "connect" | "reconnect" | "sync";
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
  if (!res.ok) throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to create contact.");
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
  if (!res.ok) throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to search records.");
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
  const [folder, setFolder] = useState("");
  const [search, setSearch] = useState("");
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeProvider, setComposeProvider] = useState<MailProvider>("google");
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [imapFormOpen, setImapFormOpen] = useState(false);
  const [imapForm, setImapForm] = useState<ImapForm>(emptyImapForm);
  const [connectingProvider, setConnectingProvider] = useState<OAuthProvider | null>(null);
  const [linkModuleKey, setLinkModuleKey] = useState<LinkTargetModuleKey>("sales_contacts");
  const [linkSearch, setLinkSearch] = useState("");
  const [linkTargets, setLinkTargets] = useState<LinkTarget[]>([]);
  const [isSearchingLinks, setIsSearchingLinks] = useState(false);
  const [creatingContact, setCreatingContact] = useState(false);
  const deferredSearch = useDeferredValue(search);

  const contextQuery = useMailContext();
  const messagesQuery = useMailMessages(folder || undefined, deferredSearch);
  const selectedMessageQuery = useMailMessage(selectedMessageId);
  const { connectMail, connectImapSmtp, syncMail, disconnectMail, sendMail, linkMail, isConnectingMail, isSyncingMail, isDisconnectingMail, isSendingMail, isLinkingMail } = useMailActions();
  const messages = useMemo(() => messagesQuery.data?.results ?? [], [messagesQuery.data?.results]);
  const selectedMessage = selectedMessageQuery.data ?? messages.find((message) => message.id === selectedMessageId) ?? null;
  const googleConnection = contextQuery.data?.connections.find((connection) => connection.provider === "google");
  const microsoftConnection = contextQuery.data?.connections.find((connection) => connection.provider === "microsoft");
  const imapSmtpConnection = contextQuery.data?.connections.find((connection) => connection.provider === "imap_smtp");
  const hasSendProvider = Boolean(googleConnection?.can_send || microsoftConnection?.can_send || imapSmtpConnection?.can_send);
  const mailConnectStatus = searchParams.get("mailConnect");
  const defaultComposeProvider = useMemo<MailProvider>(() => {
    if (googleConnection?.can_send) return "google";
    if (microsoftConnection?.can_send) return "microsoft";
    return "imap_smtp";
  }, [googleConnection?.can_send, microsoftConnection?.can_send]);
  const googleAction = useMemo<ProviderAction>(() => {
    if (googleConnection?.can_sync) return { provider: "google", mode: "sync", label: "Sync Gmail" };
    if (googleConnection?.status === "connected") return { provider: "google", mode: "reconnect", label: "Reconnect Gmail" };
    return { provider: "google", mode: "connect", label: "Connect Gmail" };
  }, [googleConnection?.can_sync, googleConnection?.status]);
  const microsoftAction = useMemo<ProviderAction>(() => {
    if (microsoftConnection?.can_sync) return { provider: "microsoft", mode: "sync", label: "Sync Microsoft" };
    if (microsoftConnection?.status === "connected") return { provider: "microsoft", mode: "reconnect", label: "Reconnect Microsoft" };
    return { provider: "microsoft", mode: "connect", label: "Connect Microsoft" };
  }, [microsoftConnection?.can_sync, microsoftConnection?.status]);

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
    if (!messages.length) {
      setSelectedMessageId(null);
      return;
    }
    setSelectedMessageId((current) => current ?? messages[0].id);
  }, [messages]);

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

  async function handleConnectGoogle() {
    setConnectingProvider("google");
    try {
      const result = await connectMail("google");
      window.location.href = result.auth_url;
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to start Gmail connection."));
      setConnectingProvider(null);
    }
  }

  async function handleConnectMicrosoft() {
    setConnectingProvider("microsoft");
    try {
      const result = await connectMail("microsoft");
      window.location.href = result.auth_url;
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to start Microsoft mailbox connection."));
      setConnectingProvider(null);
    }
  }

  function handleProviderAction(action: ProviderAction) {
    if (action.mode === "sync") {
      return action.provider === "google" ? handleSyncGoogle() : handleSyncMicrosoft();
    }
    return action.provider === "google" ? handleConnectGoogle() : handleConnectMicrosoft();
  }

  async function handleSyncGoogle() {
    try {
      const result = await syncMail("google");
      toast.success(`Synced ${result.synced_message_count} new Gmail message${result.synced_message_count === 1 ? "" : "s"}.`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to sync Gmail."));
    }
  }

  async function handleSyncMicrosoft() {
    try {
      const result = await syncMail("microsoft");
      toast.success(`Synced ${result.synced_message_count} new Microsoft message${result.synced_message_count === 1 ? "" : "s"}.`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to sync Microsoft mailbox."));
    }
  }

  async function handleSyncImapSmtp() {
    try {
      const result = await syncMail("imap_smtp");
      toast.success(`Synced ${result.synced_message_count} new IMAP message${result.synced_message_count === 1 ? "" : "s"}.`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to sync IMAP mailbox."));
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

  async function handleDisconnectMail(provider: MailProvider) {
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

  async function handleSendMail() {
    const recipients = composeTo.split(",").map((value) => value.trim()).filter(Boolean);
    if (!recipients.length) {
      toast.error("Add at least one recipient.");
      return;
    }
    try {
      await sendMail({
        provider: composeProvider,
        to: recipients,
        subject: composeSubject,
        body_text: composeBody,
      });
      toast.success("Mail sent.");
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
      setComposeOpen(false);
      setFolder("sent");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to send mail."));
    }
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

  function toggleCompose() {
    if (!composeOpen) {
      setComposeProvider(defaultComposeProvider);
    }
    setComposeOpen((current) => !current);
  }

  function renderProviderAction(action: ProviderAction) {
    const isConnectingThisProvider = isConnectingMail && connectingProvider === action.provider;
    const isBusy = action.mode === "sync" ? isSyncingMail : isConnectingMail;
    const label = isConnectingThisProvider ? "Connecting..." : action.label;
    return (
      <Button type="button" variant="outline" onClick={() => void handleProviderAction(action)} disabled={isBusy}>
        <RefreshCw className={"h-4 w-4 " + (isBusy ? "animate-spin" : "")} />
        {label}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="Mail"
        description="Centralize user mailbox integration and CRM communication history without mixing provider scopes into normal sign-in."
        actions={
          <>
            <div className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-400">
              <ShieldCheck className="h-4 w-4 text-neutral-500" />
              {contextQuery.data?.sync_available ? "Mailbox sync connected" : "Mailbox sync not connected"}
            </div>
            {renderProviderAction(googleAction)}
            {renderProviderAction(microsoftAction)}
            {imapSmtpConnection?.can_sync ? (
              <>
                <Button type="button" variant="outline" onClick={() => void handleSyncImapSmtp()} disabled={isSyncingMail}>
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
            <Button type="button" onClick={toggleCompose} disabled={!hasSendProvider}>
              New Mail
            </Button>
          </>
        }
      />

      {composeOpen ? (
        <section className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-neutral-100">Compose Mail</h2>
                <p className="mt-1 text-sm text-neutral-500">CRM variables resolve from the linked record or matching contact recipient when mail is sent.</p>
              </div>
              <select
                value={composeProvider}
                onChange={(event) => setComposeProvider(event.target.value as MailProvider)}
                className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none"
              >
                <option value="google" disabled={!googleConnection?.can_send}>Gmail</option>
                <option value="microsoft" disabled={!microsoftConnection?.can_send}>Microsoft</option>
                <option value="imap_smtp" disabled={!imapSmtpConnection?.can_send}>IMAP/SMTP</option>
              </select>
            </div>
            <input
              value={composeTo}
              onChange={(event) => setComposeTo(event.target.value)}
              placeholder="To: name@example.com, another@example.com"
              className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
            />
            <input
              value={composeSubject}
              onChange={(event) => setComposeSubject(event.target.value)}
              placeholder="Subject"
              className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
            />
            <div className="flex flex-wrap gap-2">
              {VARIABLE_TOKENS.map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => setComposeBody((current) => `${current}${current ? " " : ""}${token}`)}
                  className="rounded-full border border-neutral-800 bg-neutral-900/70 px-3 py-1 text-xs text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                >
                  {token}
                </button>
              ))}
            </div>
            <textarea
              value={composeBody}
              onChange={(event) => setComposeBody(event.target.value)}
              placeholder="Write your message..."
              rows={8}
              className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setComposeOpen(false)}>Cancel</Button>
              <Button type="button" onClick={() => void handleSendMail()} disabled={isSendingMail}>
                {isSendingMail ? "Sending..." : "Send Mail"}
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {imapFormOpen ? (
        <section className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-base font-semibold text-neutral-100">Connect IMAP/SMTP</h2>
              <p className="mt-1 text-sm text-neutral-500">Credentials are saved per user and verified against both servers before the mailbox is marked connected. Gmail requires IMAP enabled and a Google app password.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={useGmailImapPreset}>
                Use Gmail IMAP/SMTP
              </Button>
              {imapSmtpConnection ? (
                <Button type="button" variant="outline" onClick={() => void handleDisconnectMail("imap_smtp")} disabled={isDisconnectingMail}>
                  <Trash2 className="h-4 w-4" />
                  Disconnect IMAP
                </Button>
              ) : null}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input value={imapForm.accountEmail} onChange={(event) => setImapForm((current) => ({ ...current, accountEmail: event.target.value }))} placeholder="Mailbox email" className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600" />
              <input value={imapForm.imapUsername} onChange={(event) => setImapForm((current) => ({ ...current, imapUsername: event.target.value }))} placeholder="IMAP username" className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600" />
              <input value={imapForm.imapHost} onChange={(event) => setImapForm((current) => ({ ...current, imapHost: event.target.value }))} placeholder="IMAP host" className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600" />
              <div className="grid grid-cols-[1fr_140px] gap-2">
                <input value={imapForm.imapPort} onChange={(event) => setImapForm((current) => ({ ...current, imapPort: event.target.value }))} placeholder="IMAP port" inputMode="numeric" className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600" />
                <select value={imapForm.imapSecurity} onChange={(event) => setImapForm((current) => ({ ...current, imapSecurity: event.target.value as ImapForm["imapSecurity"] }))} className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none">
                  <option value="ssl">SSL</option>
                  <option value="starttls">STARTTLS</option>
                  <option value="none">None</option>
                </select>
              </div>
              <input value={imapForm.smtpHost} onChange={(event) => setImapForm((current) => ({ ...current, smtpHost: event.target.value }))} placeholder="SMTP host" className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600" />
              <div className="grid grid-cols-[1fr_140px] gap-2">
                <input value={imapForm.smtpPort} onChange={(event) => setImapForm((current) => ({ ...current, smtpPort: event.target.value }))} placeholder="SMTP port" inputMode="numeric" className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600" />
                <select value={imapForm.smtpSecurity} onChange={(event) => setImapForm((current) => ({ ...current, smtpSecurity: event.target.value as ImapForm["smtpSecurity"] }))} className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none">
                  <option value="ssl">SSL</option>
                  <option value="starttls">STARTTLS</option>
                  <option value="none">None</option>
                </select>
              </div>
              <input value={imapForm.smtpUsername} onChange={(event) => setImapForm((current) => ({ ...current, smtpUsername: event.target.value }))} placeholder="SMTP username, defaults to IMAP username" className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600" />
              <input value={imapForm.password} onChange={(event) => setImapForm((current) => ({ ...current, password: event.target.value }))} placeholder="Mailbox password or app password" type="password" className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600" />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setImapFormOpen(false)}>Cancel</Button>
              <Button type="button" onClick={() => void handleConnectImapSmtp()} disabled={isConnectingMail}>
                {isConnectingMail ? "Verifying..." : "Save Connection"}
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5">
              <Mail className="h-5 w-5 text-neutral-300" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-neutral-100">Provider Connections</h2>
              <p className="mt-1 text-sm text-neutral-500">
                Google and Microsoft mail will connect through a dedicated mailbox authorization flow.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {(contextQuery.data?.connections.length ? contextQuery.data.connections : []).map((connection) => (
              <div key={connection.provider} className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold capitalize text-neutral-100">{connection.provider}</div>
                    <div className="mt-1 text-xs text-neutral-500">{connection.account_email || "No mailbox account connected"}</div>
                    <div className="mt-2 text-[11px] text-neutral-500">
                      {connection.can_send ? "Send enabled" : "Send not granted"} / {connection.can_sync ? "Inbox sync enabled" : "Inbox sync not enabled"}
                    </div>
                  </div>
                  <span className="rounded-full border border-neutral-700 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                    {connection.status}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {connection.provider === "imap_smtp" && connection.status === "connected" ? (
                    <Button type="button" variant="outline" onClick={() => void handleSyncImapSmtp()} disabled={isSyncingMail}>
                      <RefreshCw className={"h-4 w-4 " + (isSyncingMail ? "animate-spin" : "")} />
                      Sync
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" onClick={() => void handleDisconnectMail(connection.provider)} disabled={isDisconnectingMail}>
                    <Trash2 className="h-4 w-4" />
                    Disconnect
                  </Button>
                </div>
                {connection.last_error ? <div className="mt-3 text-xs text-red-300">{connection.last_error}</div> : null}
              </div>
            ))}

            {!contextQuery.data?.connections.length ? (
              <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 p-4 text-sm text-neutral-500">
                No mailbox provider is connected yet. Connect Gmail send, Microsoft Graph, or IMAP/SMTP for mailbox sync.
              </div>
            ) : null}
          </div>

          <div className="mt-5 rounded-xl border border-sky-900/40 bg-sky-950/20 p-4 text-sm text-sky-100">
            {contextQuery.data?.sync_note || "Mailbox sync uses an explicit opt-in provider connection per user."}
          </div>

          <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-400">
            For Gmail IMAP, use `imap.gmail.com` port `993` with SSL and `smtp.gmail.com` port `587` with STARTTLS. Use the full Gmail address as username and a Google app password.
          </div>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60">
          <div className="border-b border-neutral-800 p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-neutral-100">Messages</h2>
                <p className="mt-1 text-sm text-neutral-500">Synced provider mail and future CRM-linked communication records will appear here.</p>
              </div>
              <div className="relative w-full md:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search mail"
                  className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-950 pl-9 pr-3 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-neutral-600"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {FOLDERS.map((item) => (
                <button
                  key={item.key || "all"}
                  type="button"
                  onClick={() => setFolder(item.key)}
                  className={
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors " +
                    (folder === item.key
                      ? "border-neutral-200 bg-neutral-100 text-neutral-950"
                      : "border-neutral-800 bg-neutral-900/50 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200")
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {messagesQuery.isLoading ? (
            <div className="p-8 text-sm text-neutral-500">Loading mail messages...</div>
          ) : messagesQuery.error ? (
            <div className="p-8 text-sm text-red-300">
              {messagesQuery.error instanceof Error ? messagesQuery.error.message : "Failed to load mail messages."}
            </div>
          ) : messages.length ? (
            <div className="max-h-[28rem] overflow-y-auto divide-y divide-neutral-800">
              {messages.map((message) => (
                <article
                  key={message.id}
                  onClick={() => setSelectedMessageId(message.id)}
                  className={
                    "cursor-pointer p-5 transition-colors hover:bg-white/[0.02] " +
                    (selectedMessageId === message.id ? "bg-white/[0.04]" : "")
                  }
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-neutral-100">{message.subject || "(no subject)"}</h3>
                      <p className="mt-1 truncate text-xs text-neutral-500">
                        {message.from_name || message.from_email || "Unknown sender"}
                        {message.source_label ? ` / ${message.source_label}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-xs text-neutral-500">
                      {getMessageTime(message)}
                    </div>
                  </div>
                  {message.snippet ? <p className="mt-3 line-clamp-2 text-sm text-neutral-400">{message.snippet}</p> : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-900/70">
                <Inbox className="h-5 w-5 text-neutral-500" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-neutral-200">No mail messages yet</h3>
              <p className="mt-2 max-w-md text-sm text-neutral-500">
                Connect Gmail, Microsoft, or IMAP/SMTP to sync recent inbox messages into this view.
              </p>
            </div>
          )}

          {selectedMessage ? (
            <div className="border-t border-neutral-800 p-5">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-neutral-100">{selectedMessage.subject || "(no subject)"}</h2>
                    <div className="mt-2 space-y-1 text-xs text-neutral-500">
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
                        <a href={linkedRecordHref(selectedMessage) ?? undefined}>
                          <Link2 className="h-4 w-4" />
                          Open Linked Record
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </div>

                {selectedMessage.source_label ? (
                  <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-100">
                    Linked to {selectedMessage.source_label}
                  </div>
                ) : null}

                <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-4">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Link Mail To Record</div>
                  <div className="grid gap-3 md:grid-cols-[180px_1fr]">
                    <select
                      value={linkModuleKey}
                      onChange={(event) => {
                        setLinkModuleKey(event.target.value as LinkTargetModuleKey);
                        setLinkSearch("");
                        setLinkTargets([]);
                      }}
                      className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none"
                    >
                      {LINK_TARGET_MODULES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                    </select>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                      <input
                        value={linkSearch}
                        onChange={(event) => setLinkSearch(event.target.value)}
                        placeholder="Search records to link"
                        className="h-10 w-full rounded-xl border border-neutral-800 bg-neutral-950 pl-9 pr-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
                      />
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {isSearchingLinks ? <div className="text-sm text-neutral-500">Searching records...</div> : null}
                    {!isSearchingLinks && linkSearch.trim().length >= 2 && !linkTargets.length ? <div className="text-sm text-neutral-500">No matching records found.</div> : null}
                    {linkTargets.map((target) => (
                      <button
                        key={`${linkModuleKey}:${target.id}`}
                        type="button"
                        onClick={() => void handleLinkMessage(target)}
                        disabled={isLinkingMail}
                        className="flex w-full items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900/50 px-4 py-3 text-left text-sm text-neutral-200 hover:border-neutral-700 disabled:opacity-60"
                      >
                        <span>
                          <span className="block font-medium">{target.label}</span>
                          {target.subtitle ? <span className="mt-1 block text-xs text-neutral-500">{target.subtitle}</span> : null}
                        </span>
                        <span className="text-xs text-neutral-500">{isLinkingMail ? "Linking..." : "Link"}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="whitespace-pre-wrap rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-4 text-sm leading-6 text-neutral-200">
                  {selectedMessageQuery.isLoading ? "Loading message..." : selectedMessage.body_text || selectedMessage.snippet || "This synced message has no readable text body."}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
