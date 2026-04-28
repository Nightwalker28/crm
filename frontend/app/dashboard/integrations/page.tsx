"use client";

import { useEffect, useState } from "react";
import { PlugZap, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { apiFetch } from "@/lib/api";

type NotificationChannel = {
  id: number;
  provider: string;
  channel_name: string | null;
  webhook_url_masked: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type ChannelDraft = {
  provider: string;
  channel_name: string;
  webhook_url: string;
  is_active: boolean;
};

const emptyDraft: ChannelDraft = {
  provider: "slack",
  channel_name: "",
  webhook_url: "",
  is_active: true,
};

export default function IntegrationsPage() {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [draft, setDraft] = useState<ChannelDraft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadChannels() {
    try {
      setLoading(true);
      const res = await apiFetch("/admin/notification-channels");
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      setChannels(Array.isArray(body?.results) ? body.results : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load integrations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadChannels();
  }, []);

  async function createChannel() {
    try {
      setSaving(true);
      const res = await apiFetch("/admin/notification-channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: draft.provider,
          channel_name: draft.channel_name.trim() || null,
          webhook_url: draft.webhook_url.trim(),
          is_active: draft.is_active,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      setDraft(emptyDraft);
      await loadChannels();
      toast.success("Notification channel added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add channel.");
    } finally {
      setSaving(false);
    }
  }

  async function updateChannel(channel: NotificationChannel, payload: Partial<NotificationChannel>) {
    try {
      setSaving(true);
      const res = await apiFetch(`/admin/notification-channels/${channel.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      await loadChannels();
      toast.success("Notification channel updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update channel.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteChannel(channel: NotificationChannel) {
    try {
      setSaving(true);
      const res = await apiFetch(`/admin/notification-channels/${channel.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Failed with ${res.status}`);
      }
      await loadChannels();
      toast.success("Notification channel deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete channel.");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest(channel: NotificationChannel) {
    try {
      setSaving(true);
      const res = await apiFetch(`/admin/notification-channels/${channel.id}/test`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      toast.success(body?.message ?? "Test message sent.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send test message.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 text-neutral-200">
      <PageHeader
        title="Integrations"
        description="Configure simple external alert webhooks for CRM events. Slack is active first; Teams uses the same channel foundation later."
      />

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <Card className="px-5 py-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-800 bg-neutral-950">
              <PlugZap size={17} className="text-neutral-300" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-neutral-100">Add Webhook</h2>
              <p className="mt-1 text-sm text-neutral-500">Paste a Slack incoming webhook URL. OAuth is not used in this phase.</p>
            </div>
          </div>

          <FieldGroup className="mt-5 grid gap-4">
            <Field>
              <FieldLabel>Provider</FieldLabel>
              <Select value={draft.provider} onValueChange={(value) => setDraft((current) => ({ ...current, provider: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="slack">Slack</SelectItem>
                  <SelectItem value="teams">Microsoft Teams</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Channel Name</FieldLabel>
              <Input value={draft.channel_name} onChange={(event) => setDraft((current) => ({ ...current, channel_name: event.target.value }))} placeholder="#sales-alerts" />
            </Field>
            <Field>
              <FieldLabel>Webhook URL</FieldLabel>
              <Input
                value={draft.webhook_url}
                onChange={(event) => setDraft((current) => ({ ...current, webhook_url: event.target.value }))}
                placeholder="https://hooks.slack.com/services/..."
              />
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300">
              Active
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))}
                className="h-4 w-4 accent-neutral-100"
              />
            </label>
            <Button type="button" disabled={saving || !draft.webhook_url.trim()} onClick={createChannel}>
              Add Webhook
            </Button>
          </FieldGroup>
        </Card>

        <ModuleTableShell>
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableHeaderRow>
                <TableHead>Provider</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Webhook</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableHeaderRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-neutral-500">Loading integrations...</TableCell>
                </TableRow>
              ) : channels.length ? (
                channels.map((channel) => (
                  <TableRow key={channel.id}>
                    <TableCell className="capitalize text-neutral-100">{channel.provider}</TableCell>
                    <TableCell className="text-neutral-400">{channel.channel_name || "-"}</TableCell>
                    <TableCell className="font-mono text-xs text-neutral-500">{channel.webhook_url_masked}</TableCell>
                    <TableCell>
                      <Pill
                        bg={channel.is_active ? "bg-emerald-950/60" : "bg-red-950/60"}
                        text={channel.is_active ? "text-emerald-200" : "text-red-200"}
                        border={channel.is_active ? "border-emerald-800/70" : "border-red-800/70"}
                      >
                        {channel.is_active ? "Active" : "Inactive"}
                      </Pill>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => sendTest(channel)}>
                          <Send size={14} />
                          Test
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => updateChannel(channel, { is_active: !channel.is_active })}>
                          {channel.is_active ? "Disable" : "Enable"}
                        </Button>
                        <Button type="button" variant="outline" size="icon-sm" disabled={saving} aria-label={`Delete ${channel.channel_name || channel.provider}`} onClick={() => deleteChannel(channel)}>
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-neutral-500">No notification channels configured.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ModuleTableShell>
      </div>
    </div>
  );
}
