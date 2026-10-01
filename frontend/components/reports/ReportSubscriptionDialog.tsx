"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBackdrop, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogTitle } from "@/components/ui/dialog";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteReportSubscription, fetchReportSubscriptions, saveReportSubscription, type SubscriptionDraft } from "@/lib/reportSubscriptions";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function ReportSubscriptionDialog({ open, onClose, targetType, targetId }: { open: boolean; onClose: () => void; targetType: "report" | "dashboard"; targetId: number }) {
  const queryClient = useQueryClient();
  const queryKey = ["report-subscription", targetType, targetId];
  const query = useQuery({ queryKey, queryFn: () => fetchReportSubscriptions(targetType, targetId), enabled: open });
  const existing = query.data?.find((item) => item.is_active);
  const [draft, setDraft] = useState<SubscriptionDraft>({ frequency: "weekly", hour: 9, minute: 0, weekday: 0, day_of_month: null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", is_active: true });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing) setDraft({ frequency: existing.frequency, hour: existing.hour, minute: existing.minute, weekday: existing.weekday, day_of_month: existing.day_of_month, timezone: existing.timezone, is_active: true });
  }, [existing]);

  async function save() {
    setSaving(true);
    try {
      await saveReportSubscription(targetType, targetId, draft);
      await queryClient.invalidateQueries({ queryKey });
      toast.success("Scheduled email saved.");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Schedule could not be saved.");
    } finally { setSaving(false); }
  }

  async function stop() {
    if (!existing) return;
    setSaving(true);
    try {
      await deleteReportSubscription(existing.id);
      await queryClient.invalidateQueries({ queryKey });
      toast.success("Scheduled email stopped.");
      onClose();
    } catch { toast.error("Schedule could not be stopped."); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogBackdrop />
      <DialogPanel size="md">
        <DialogHeader><DialogTitle>Schedule email</DialogTitle><DialogDescription>Send this {targetType} to your own email using the workspace sender. It will include only records you can see when it runs.</DialogDescription><DialogIconClose /></DialogHeader>
        <div className="grid gap-4 p-6">
          {query.isError ? <p className="text-p-sm text-state-danger">The schedule could not be loaded. Try again.</p> : null}
          <Field><FieldLabel htmlFor="subscription-frequency">Repeat</FieldLabel><Select value={draft.frequency} onValueChange={(value) => setDraft((current) => ({ ...current, frequency: value as SubscriptionDraft["frequency"], weekday: value === "weekly" ? 0 : null, day_of_month: value === "monthly" ? 1 : null }))}><SelectTrigger id="subscription-frequency"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem></SelectContent></Select></Field>
          {draft.frequency === "weekly" ? <Field><FieldLabel htmlFor="subscription-weekday">Day</FieldLabel><Select value={String(draft.weekday ?? 0)} onValueChange={(value) => setDraft((current) => ({ ...current, weekday: Number(value) }))}><SelectTrigger id="subscription-weekday"><SelectValue /></SelectTrigger><SelectContent>{WEEKDAYS.map((day, index) => <SelectItem key={day} value={String(index)}>{day}</SelectItem>)}</SelectContent></Select></Field> : null}
          {draft.frequency === "monthly" ? <Field><FieldLabel htmlFor="subscription-day">Day of month (1–28)</FieldLabel><Input id="subscription-day" type="number" min={1} max={28} value={draft.day_of_month ?? 1} onChange={(event) => setDraft((current) => ({ ...current, day_of_month: Number(event.target.value) }))} /></Field> : null}
          <div className="grid grid-cols-2 gap-4"><Field><FieldLabel htmlFor="subscription-time">Time</FieldLabel><Input id="subscription-time" type="time" value={`${String(draft.hour).padStart(2, "0")}:${String(draft.minute).padStart(2, "0")}`} onChange={(event) => { const [hour, minute] = event.target.value.split(":").map(Number); setDraft((current) => ({ ...current, hour, minute })); }} /></Field><Field><FieldLabel htmlFor="subscription-zone">Time zone</FieldLabel><Input id="subscription-zone" value={draft.timezone} onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))} /></Field></div>
          {existing?.last_status === "failed" ? <p className="text-p-sm text-state-danger">Last delivery failed. Check the workspace sender and your access.</p> : null}
        </div>
        <DialogFooter>{existing ? <Button type="button" variant="outline" onClick={() => void stop()} disabled={saving}>Stop emails</Button> : null}<Button type="button" onClick={() => void save()} disabled={saving || query.isLoading || query.isError}>{saving ? "Saving…" : "Save schedule"}</Button></DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
