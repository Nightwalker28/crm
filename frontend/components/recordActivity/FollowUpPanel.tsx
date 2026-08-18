"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PanelHeader } from "@/components/ui/PanelStates";
import { formatDateTime } from "@/lib/datetime";

type Channel = "whatsapp" | "email" | "call";

type Props = {
  endpoint: string;
  title?: string;
  lastContactedAt?: string | null;
  lastContactedChannel?: string | null;
  email?: string | null;
  phone?: string | null;
  onLogged?: () => Promise<void> | void;
  canLog?: boolean;
  canCreateTask?: boolean;
};

const channelLabels: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  call: "Call",
};

function toIsoOrNull(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export default function FollowUpPanel({
  endpoint,
  title = "Follow-up",
  lastContactedAt,
  lastContactedChannel,
  email,
  phone,
  onLogged,
  canLog = true,
  canCreateTask = true,
}: Props) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [createReminder, setCreateReminder] = useState(true);
  const [dueAt, setDueAt] = useState("");
  const [isLogging, setIsLogging] = useState<Channel | null>(null);
  const shouldCreateReminder = canCreateTask && createReminder;

  async function logFollowUp(channel: Channel) {
    if (!canLog) return;
    try {
      setIsLogging(channel);
      const res = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          note: note.trim() || null,
          create_follow_up_task: shouldCreateReminder,
          follow_up_due_at: shouldCreateReminder ? toIsoOrNull(dueAt) : null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`The ${channelLabels[channel]} follow-up could not be logged.`);
      if (channel === "email" && email) window.location.href = `mailto:${email}`;
      if (channel === "call" && phone) window.location.href = `tel:${phone}`;
      if (channel === "whatsapp" && phone) window.open(`https://wa.me/${phone.replace(/\D/g, "")}`, "_blank", "noopener,noreferrer");
      setNote("");
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["record-tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["user-notifications"] });
      toast.success(body?.follow_up_task_id ? `${channelLabels[channel]} logged and reminder created.` : `${channelLabels[channel]} logged.`);
      await onLogged?.();
    } catch {
      toast.error(`The ${channelLabels[channel]} follow-up could not be logged. Try again.`);
    } finally {
      setIsLogging(null);
    }
  }

  return (
    <Card className="px-5 py-5">
      <PanelHeader
        title={title}
        description={
          lastContactedAt
            ? `Last contacted via ${lastContactedChannel ? channelLabels[lastContactedChannel as Channel] ?? lastContactedChannel : "follow-up"} on ${formatDateTime(lastContactedAt)}`
            : "No follow-up logged yet"
        }
        icon={MessageCircle}
      />
      {canLog ? <div className="mt-4 grid gap-3">
        <Field>
          <FieldLabel htmlFor="record-follow-up-note">Follow-up note</FieldLabel>
          <Textarea
            id="record-follow-up-note"
            rows={3}
            maxLength={5000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Capture the outcome and next action."
          />
        </Field>
        {canCreateTask ? <label className="flex items-center gap-2 text-sm text-copy-secondary">
          <Checkbox
            checked={createReminder}
            onCheckedChange={(checked) => setCreateReminder(checked === true)}
          />
          Create reminder task
        </label> : null}
        {shouldCreateReminder ? (
          <Field>
            <FieldLabel htmlFor="record-follow-up-due">Reminder due</FieldLabel>
            <Input
              id="record-follow-up-due"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
            <FieldDescription>Leave blank to create the reminder without a due time.</FieldDescription>
          </Field>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-3">
          <Button type="button" variant="outline" onClick={() => void logFollowUp("whatsapp")} disabled={isLogging !== null || !phone}>
            <MessageCircle className="h-4 w-4" />
            {isLogging === "whatsapp" ? "Logging..." : "WhatsApp"}
          </Button>
          <Button type="button" variant="outline" onClick={() => void logFollowUp("email")} disabled={isLogging !== null || !email}>
            <Mail className="h-4 w-4" />
            {isLogging === "email" ? "Logging..." : "Email"}
          </Button>
          <Button type="button" variant="outline" onClick={() => void logFollowUp("call")} disabled={isLogging !== null || !phone}>
            <Phone className="h-4 w-4" />
            {isLogging === "call" ? "Logging..." : "Call"}
          </Button>
        </div>
      </div> : (
        <p className="mt-4 text-p-sm text-copy-muted">
          You can view the latest follow-up here. Edit access is required to log a new outcome.
        </p>
      )}
    </Card>
  );
}
