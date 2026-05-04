"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function FollowUpPanel({
  endpoint,
  title = "Follow-up",
  lastContactedAt,
  lastContactedChannel,
  email,
  phone,
  onLogged,
}: Props) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [createReminder, setCreateReminder] = useState(true);
  const [dueAt, setDueAt] = useState("");
  const [isLogging, setIsLogging] = useState<Channel | null>(null);

  async function logFollowUp(channel: Channel) {
    try {
      setIsLogging(channel);
      const res = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          note: note.trim() || null,
          create_follow_up_task: createReminder,
          follow_up_due_at: createReminder ? toIsoOrNull(dueAt) : null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      if (channel === "email" && email) window.location.href = `mailto:${email}`;
      if (channel === "call" && phone) window.location.href = `tel:${phone}`;
      if (channel === "whatsapp" && phone) window.open(`https://wa.me/${phone.replace(/\D/g, "")}`, "_blank", "noopener,noreferrer");
      setNote("");
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["record-tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["user-notifications"] });
      toast.success(body?.follow_up_task_id ? `${channelLabels[channel]} logged and reminder created.` : `${channelLabels[channel]} logged.`);
      await onLogged?.();
    } catch (error) {
      toast.error(errorMessage(error, `Failed to log ${channelLabels[channel]}.`));
    } finally {
      setIsLogging(null);
    }
  }

  return (
    <Card className="px-5 py-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-neutral-100">{title}</h2>
        <FieldDescription className="mt-1">
          {lastContactedAt
            ? `Last contacted via ${lastContactedChannel ? channelLabels[lastContactedChannel as Channel] ?? lastContactedChannel : "follow-up"} on ${formatDateTime(lastContactedAt)}`
            : "No follow-up logged yet"}
        </FieldDescription>
      </div>
      <div className="grid gap-3">
        <Textarea
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Follow-up note"
        />
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={createReminder}
            onChange={(event) => setCreateReminder(event.target.checked)}
            className="h-4 w-4 rounded border-neutral-700 bg-neutral-950"
          />
          Create reminder task
        </label>
        {createReminder ? (
          <Input
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
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
      </div>
    </Card>
  );
}
