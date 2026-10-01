"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PanelError, PanelLoading } from "@/components/ui/PanelStates";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/api";

type MailSettings = { configured: boolean; sender_email: string | null; smtp_host: string | null; smtp_port: number | null; smtp_security: string | null; smtp_username: string | null };
type MailDraft = { sender_email: string; smtp_host: string; smtp_port: number; smtp_security: string; smtp_username: string; password: string };
const EMPTY: MailDraft = { sender_email: "", smtp_host: "", smtp_port: 587, smtp_security: "starttls", smtp_username: "", password: "" };

async function fetchSettings(): Promise<MailSettings> {
  const response = await apiFetch("/admin/tenant-mail");
  if (!response.ok) throw new Error("Workspace sender unavailable");
  return response.json();
}

export function TenantMailSettingsPanel() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["tenant-mail-settings"], queryFn: fetchSettings });
  const [override, setOverride] = useState<MailDraft | null>(null);
  const draft = override ?? (query.data ? { sender_email: query.data.sender_email ?? "", smtp_host: query.data.smtp_host ?? "", smtp_port: query.data.smtp_port ?? 587, smtp_security: query.data.smtp_security ?? "starttls", smtp_username: query.data.smtp_username ?? "", password: "" } : EMPTY);
  const dirty = override !== null;
  function change<K extends keyof MailDraft>(key: K, value: MailDraft[K]) { setOverride({ ...draft, [key]: value }); }
  const mutation = useMutation({
    mutationFn: async () => {
      const response = await apiFetch("/admin/tenant-mail", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, password: draft.password || null }) });
      if (!response.ok) throw new Error("Workspace sender could not be saved");
      return response.json() as Promise<MailSettings>;
    },
    onSuccess: async () => { setOverride(null); await queryClient.invalidateQueries({ queryKey: ["tenant-mail-settings"] }); toast.success("Workspace sender saved."); },
    onError: () => toast.error("Workspace sender could not be saved. Check the settings and try again."),
  });
  return (
    <Card className="p-6">
      <h2 className="text-sm font-semibold text-copy-primary">Workspace email sender</h2>
      <p className="mt-1 text-p-sm text-copy-muted">Scheduled reports use this shared address. Personal inbox mail keeps using each person&apos;s connection.</p>
      {query.isLoading ? <PanelLoading label="Loading sender settings…" /> : query.isError ? <PanelError message="Sender settings could not be loaded." onRetry={() => void query.refetch()} /> : (
        <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
          <Field><FieldLabel htmlFor="tenant-mail-from">Sender email</FieldLabel><Input id="tenant-mail-from" type="email" required value={draft.sender_email} onChange={(event) => change("sender_email", event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="tenant-mail-host">SMTP host</FieldLabel><Input id="tenant-mail-host" required value={draft.smtp_host} onChange={(event) => change("smtp_host", event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="tenant-mail-port">SMTP port</FieldLabel><Input id="tenant-mail-port" type="number" min={1} max={65535} required value={draft.smtp_port} onChange={(event) => change("smtp_port", Number(event.target.value))} /></Field>
          <Field><FieldLabel htmlFor="tenant-mail-security">Security</FieldLabel><Select value={draft.smtp_security} onValueChange={(value) => change("smtp_security", value)}><SelectTrigger id="tenant-mail-security"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="starttls">STARTTLS</SelectItem><SelectItem value="ssl">SSL</SelectItem><SelectItem value="none">None</SelectItem></SelectContent></Select></Field>
          <Field><FieldLabel htmlFor="tenant-mail-user">SMTP username</FieldLabel><Input id="tenant-mail-user" required value={draft.smtp_username} onChange={(event) => change("smtp_username", event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="tenant-mail-password">SMTP password</FieldLabel><Input id="tenant-mail-password" type="password" required={!query.data?.configured} placeholder={query.data?.configured ? "Leave blank to keep saved password" : undefined} value={draft.password} onChange={(event) => change("password", event.target.value)} /></Field>
          <div className="md:col-span-2"><Button type="submit" disabled={!dirty || mutation.isPending}>{mutation.isPending ? "Saving…" : "Save sender"}</Button>{dirty ? <span className="ml-3 text-sm text-copy-muted">Unsaved changes</span> : null}</div>
        </form>
      )}
    </Card>
  );
}
