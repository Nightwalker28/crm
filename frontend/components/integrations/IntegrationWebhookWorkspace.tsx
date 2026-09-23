"use client";

import { formatSnakeCaseLabel } from "@/lib/module-display";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { StatusValue } from "@/components/ui/StatusValue";
import { SegmentedBoolean } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RecordTable } from "@/components/ui/RecordTable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { useConfirm } from "@/hooks/useConfirm";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
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

async function fetchNotificationChannels() {
  const res = await apiFetch("/admin/notification-channels");
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error("notification-channels-unavailable");
  return Array.isArray(body?.results) ? body.results as NotificationChannel[] : [];
}

export function IntegrationWebhookWorkspace() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [draft, setDraft] = useState<ChannelDraft>(emptyDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const channelsQuery = useQuery({
    queryKey: ["integrations", "notification-channels"],
    queryFn: fetchNotificationChannels,
  });

  const channels = channelsQuery.data ?? [];
  const loading = channelsQuery.isLoading || channelsQuery.isFetching;
  const isDirty = JSON.stringify(draft) !== JSON.stringify(emptyDraft);
  useUnsavedChangesGuard(editorOpen && isDirty, saving);

  function openEditor() {
    setDraft(emptyDraft);
    setEditorOpen(true);
  }

  async function closeEditor() {
    if (isDirty) {
      const confirmed = await confirm({
        title: "Discard webhook draft?",
        description: "The unsaved provider, channel, URL, and availability settings will be cleared.",
        confirmLabel: "Discard draft",
        variant: "destructive",
      });
      if (!confirmed) return;
    }
    setDraft(emptyDraft);
    setEditorOpen(false);
  }

  function handleEditorOpenChange(open: boolean) {
    if (open) {
      setEditorOpen(true);
      return;
    }
    void closeEditor();
  }

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
      if (!res.ok) throw new Error("create-channel-failed");
      setDraft(emptyDraft);
      setEditorOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["integrations", "notification-channels"] });
      toast.success("Webhook created.");
    } catch {
      toast.error("The notification channel could not be added. Check the URL and try again.");
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
      if (!res.ok) throw new Error("update-channel-failed");
      await queryClient.invalidateQueries({ queryKey: ["integrations", "notification-channels"] });
      toast.success("Notification channel updated.");
    } catch {
      toast.error("The notification channel could not be updated. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteChannel(channel: NotificationChannel) {
    const confirmed = await confirm({
      title: `Delete ${channel.channel_name || channel.provider} webhook?`,
      description: "CRM event notifications will no longer be delivered through this channel.",
      confirmLabel: "Delete webhook",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      setSaving(true);
      const res = await apiFetch(`/admin/notification-channels/${channel.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete-channel-failed");
      await queryClient.invalidateQueries({ queryKey: ["integrations", "notification-channels"] });
      toast.success("Notification channel deleted.");
    } catch {
      toast.error("The notification channel could not be deleted. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest(channel: NotificationChannel) {
    try {
      setSaving(true);
      const res = await apiFetch(`/admin/notification-channels/${channel.id}/test`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error("test-channel-failed");
      toast.success(body?.message ?? "Test message sent.");
    } catch {
      toast.error("The test message could not be sent. Check the webhook configuration and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="webhooks" aria-labelledby="webhooks-heading" className="flex scroll-mt-5 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="webhooks-heading" className="text-lg font-semibold text-copy-primary">Notification webhooks</h2>
          <p className="mt-1 text-sm text-copy-muted">Manage Slack or Microsoft Teams incoming webhook destinations.</p>
        </div>
        <Button type="button" size="sm" onClick={openEditor}><Plus />Create webhook</Button>
      </div>

      <EditorPanel
        open={editorOpen}
        onOpenChange={handleEditorOpenChange}
        title="Create webhook"
        description="Paste a Slack or Microsoft Teams incoming webhook URL."
        closeLabel="Close webhook editor"
        onSubmit={() => void createChannel()}
        footer={(
          <>
            <Button type="button" variant="outline" disabled={saving} onClick={() => void closeEditor()}>Cancel</Button>
            <Button type="submit" disabled={saving || !draft.webhook_url.trim()}>{saving ? "Creating\u2026" : "Create webhook"}</Button>
          </>
        )}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="webhook-provider">Provider</FieldLabel>
            <Select value={draft.provider} onValueChange={(value) => setDraft((current) => ({ ...current, provider: value }))}>
              <SelectTrigger id="webhook-provider"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="slack">Slack</SelectItem>
                <SelectItem value="teams">Microsoft Teams</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="webhook-channel-name">Channel name</FieldLabel>
            <Input id="webhook-channel-name" value={draft.channel_name} onChange={(event) => setDraft((current) => ({ ...current, channel_name: event.target.value }))} placeholder="#sales-alerts" />
          </Field>
          <Field>
            <FieldLabel htmlFor="webhook-url">Webhook URL</FieldLabel>
            <Input id="webhook-url" type="url" value={draft.webhook_url} onChange={(event) => setDraft((current) => ({ ...current, webhook_url: event.target.value }))} placeholder="https://hooks.slack.com/services/..." />
          </Field>
          <Field>
            <FieldLabel>Webhook availability</FieldLabel>
            <SegmentedBoolean
              aria-label="Webhook availability"
              value={draft.is_active}
              onValueChange={(is_active) => setDraft((current) => ({ ...current, is_active }))}
              trueLabel="Active"
              falseLabel="Inactive"
            />
            <FieldDescription>Active webhooks can receive CRM event notifications immediately.</FieldDescription>
          </Field>
        </FieldGroup>
      </EditorPanel>

      <RecordTable
        label="Notification channels"
        rows={channels}
        rowKey={(channel) => channel.id}
        isLoading={loading}
        hasError={channelsQuery.isError}
        onRetry={() => void channelsQuery.refetch()}
        errorState={{
          title: "Notification channels could not be loaded",
          description: "Existing webhooks are unchanged.",
        }}
        emptyState={{
          title: "No webhooks yet",
          description: "Create a webhook to post CRM events to Slack or Microsoft Teams.",
          action: <Button type="button" onClick={openEditor}><Plus />Create webhook</Button>,
        }}
        columns={[
          {
            key: "provider",
            label: "Provider",
            render: (channel) => <span className="text-copy-primary">{formatSnakeCaseLabel(channel.provider)}</span>,
          },
          {
            key: "channel_name",
            label: "Channel",
            render: (channel) => <span className="text-copy-muted">{channel.channel_name || "-"}</span>,
          },
          {
            key: "webhook_url",
            label: "Webhook",
            size: "lg",
            render: (channel) => <span className="font-mono text-xs text-copy-muted">{channel.webhook_url_masked}</span>,
          },
          {
            key: "status",
            label: "Status",
            render: (channel) => (
              <StatusValue
                status={{
                  tone: channel.is_active ? "success" : "critical",
                  label: channel.is_active ? "Active" : "Inactive",
                }}
              />
            ),
          },
        ]}
        rowActions={(channel) => (
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
        )}
      />
    </section>
  );
}
