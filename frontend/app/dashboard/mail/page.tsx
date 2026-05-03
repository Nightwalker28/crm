"use client";

import { useDeferredValue, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Inbox, KeyRound, Mail, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { useMailActions, useMailContext, useMailMessages } from "@/hooks/useMail";
import type { MailProvider } from "@/hooks/useMail";
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

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function MailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [folder, setFolder] = useState("");
  const [search, setSearch] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeProvider, setComposeProvider] = useState<MailProvider>("google");
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [imapFormOpen, setImapFormOpen] = useState(false);
  const [imapAccountEmail, setImapAccountEmail] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [imapSecurity, setImapSecurity] = useState<"ssl" | "starttls" | "none">("ssl");
  const [imapUsername, setImapUsername] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpSecurity, setSmtpSecurity] = useState<"ssl" | "starttls" | "none">("starttls");
  const [smtpUsername, setSmtpUsername] = useState("");
  const [mailPassword, setMailPassword] = useState("");
  const deferredSearch = useDeferredValue(search);

  const contextQuery = useMailContext();
  const messagesQuery = useMailMessages(folder || undefined, deferredSearch);
  const { connectMail, connectImapSmtp, syncMail, disconnectMail, sendMail, isConnectingMail, isSyncingMail, isDisconnectingMail, isSendingMail } = useMailActions();
  const messages = messagesQuery.data?.results ?? [];
  const googleConnection = contextQuery.data?.connections.find((connection) => connection.provider === "google");
  const microsoftConnection = contextQuery.data?.connections.find((connection) => connection.provider === "microsoft");
  const imapSmtpConnection = contextQuery.data?.connections.find((connection) => connection.provider === "imap_smtp");
  const hasSendProvider = Boolean(googleConnection?.can_send || microsoftConnection?.can_send || imapSmtpConnection?.can_send);

  useEffect(() => {
    const status = searchParams.get("mailConnect");
    if (status === "connected") {
      toast.success("Gmail inbox connected.");
      router.replace("/dashboard/mail");
    }
    if (status === "error") {
      toast.error("Failed to connect Gmail inbox.");
      router.replace("/dashboard/mail");
    }
  }, [router, searchParams]);

  async function handleConnectGoogle() {
    try {
      const result = await connectMail("google");
      window.location.href = result.auth_url;
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to start Gmail connection."));
    }
  }

  async function handleConnectMicrosoft() {
    try {
      const result = await connectMail("microsoft");
      window.location.href = result.auth_url;
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to start Microsoft mailbox connection."));
    }
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
    if (!imapAccountEmail.trim() || !imapHost.trim() || !imapUsername.trim() || !smtpHost.trim() || !mailPassword) {
      toast.error("Fill in the IMAP/SMTP account, server, username, and password fields.");
      return;
    }
    const parsedImapPort = Number(imapPort);
    const parsedSmtpPort = Number(smtpPort);
    if (!Number.isInteger(parsedImapPort) || parsedImapPort < 1 || parsedImapPort > 65535 || !Number.isInteger(parsedSmtpPort) || parsedSmtpPort < 1 || parsedSmtpPort > 65535) {
      toast.error("Use valid IMAP and SMTP ports.");
      return;
    }
    try {
      await connectImapSmtp({
        account_email: imapAccountEmail.trim(),
        imap_host: imapHost.trim(),
        imap_port: parsedImapPort,
        imap_security: imapSecurity,
        imap_username: imapUsername.trim(),
        smtp_host: smtpHost.trim(),
        smtp_port: parsedSmtpPort,
        smtp_security: smtpSecurity,
        smtp_username: smtpUsername.trim() || null,
        password: mailPassword,
      });
      toast.success("IMAP/SMTP mailbox connected.");
      setMailPassword("");
      setImapFormOpen(false);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to connect IMAP/SMTP mailbox."));
    }
  }

  async function handleDisconnectMail(provider: MailProvider) {
    try {
      await disconnectMail(provider);
      toast.success("Mailbox disconnected.");
      if (provider === "imap_smtp") {
        setImapFormOpen(false);
        setMailPassword("");
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to disconnect mailbox."));
    }
  }

  function useGmailImapPreset() {
    setImapHost("imap.gmail.com");
    setImapPort("993");
    setImapSecurity("ssl");
    setSmtpHost("smtp.gmail.com");
    setSmtpPort("587");
    setSmtpSecurity("starttls");
    if (imapAccountEmail.trim() && !imapUsername.trim()) {
      setImapUsername(imapAccountEmail.trim());
    }
    if (imapAccountEmail.trim() && !smtpUsername.trim()) {
      setSmtpUsername(imapAccountEmail.trim());
    }
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

  function toggleCompose() {
    if (!composeOpen) {
      if (!googleConnection?.can_send && microsoftConnection?.can_send) {
        setComposeProvider("microsoft");
      } else if (!googleConnection?.can_send && !microsoftConnection?.can_send && imapSmtpConnection?.can_send) {
        setComposeProvider("imap_smtp");
      } else if (googleConnection?.can_send) {
        setComposeProvider("google");
      }
    }
    setComposeOpen((current) => !current);
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
            {googleConnection?.can_sync ? (
              <Button type="button" variant="outline" onClick={() => void handleSyncGoogle()} disabled={isSyncingMail}>
                <RefreshCw className={"h-4 w-4 " + (isSyncingMail ? "animate-spin" : "")} />
                Sync Gmail
              </Button>
            ) : googleConnection?.status === "connected" && !googleConnection.can_send ? (
              <Button type="button" variant="outline" onClick={() => void handleConnectGoogle()} disabled={isConnectingMail}>
                Reconnect Gmail for Send
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => void handleConnectGoogle()} disabled={isConnectingMail}>
                {isConnectingMail ? "Connecting..." : "Connect Gmail"}
              </Button>
            )}
            {microsoftConnection?.can_sync ? (
              <Button type="button" variant="outline" onClick={() => void handleSyncMicrosoft()} disabled={isSyncingMail}>
                <RefreshCw className={"h-4 w-4 " + (isSyncingMail ? "animate-spin" : "")} />
                Sync Microsoft
              </Button>
            ) : microsoftConnection?.status === "connected" && !microsoftConnection.can_send ? (
              <Button type="button" variant="outline" onClick={() => void handleConnectMicrosoft()} disabled={isConnectingMail}>
                Reconnect Microsoft
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => void handleConnectMicrosoft()} disabled={isConnectingMail}>
                Connect Microsoft
              </Button>
            )}
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
                <p className="mt-1 text-sm text-neutral-500">Use CRM variable tokens now; merge resolution and record-linked templates can build on this.</p>
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
              <input value={imapAccountEmail} onChange={(event) => setImapAccountEmail(event.target.value)} placeholder="Mailbox email" className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600" />
              <input value={imapUsername} onChange={(event) => setImapUsername(event.target.value)} placeholder="IMAP username" className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600" />
              <input value={imapHost} onChange={(event) => setImapHost(event.target.value)} placeholder="IMAP host" className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600" />
              <div className="grid grid-cols-[1fr_140px] gap-2">
                <input value={imapPort} onChange={(event) => setImapPort(event.target.value)} placeholder="IMAP port" inputMode="numeric" className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600" />
                <select value={imapSecurity} onChange={(event) => setImapSecurity(event.target.value as "ssl" | "starttls" | "none")} className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none">
                  <option value="ssl">SSL</option>
                  <option value="starttls">STARTTLS</option>
                  <option value="none">None</option>
                </select>
              </div>
              <input value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} placeholder="SMTP host" className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600" />
              <div className="grid grid-cols-[1fr_140px] gap-2">
                <input value={smtpPort} onChange={(event) => setSmtpPort(event.target.value)} placeholder="SMTP port" inputMode="numeric" className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600" />
                <select value={smtpSecurity} onChange={(event) => setSmtpSecurity(event.target.value as "ssl" | "starttls" | "none")} className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none">
                  <option value="ssl">SSL</option>
                  <option value="starttls">STARTTLS</option>
                  <option value="none">None</option>
                </select>
              </div>
              <input value={smtpUsername} onChange={(event) => setSmtpUsername(event.target.value)} placeholder="SMTP username, defaults to IMAP username" className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600" />
              <input value={mailPassword} onChange={(event) => setMailPassword(event.target.value)} placeholder="Mailbox password or app password" type="password" className="h-10 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600" />
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
            <div className="divide-y divide-neutral-800">
              {messages.map((message) => (
                <article key={message.id} className="p-5 transition-colors hover:bg-white/[0.02]">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-neutral-100">{message.subject || "(no subject)"}</h3>
                      <p className="mt-1 truncate text-xs text-neutral-500">
                        {message.from_name || message.from_email || "Unknown sender"}
                        {message.source_label ? ` / ${message.source_label}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-xs text-neutral-500">
                      {message.received_at ? formatDateTime(message.received_at) : message.sent_at ? formatDateTime(message.sent_at) : formatDateTime(message.created_at)}
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
        </div>
      </section>
    </div>
  );
}
