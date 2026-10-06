import { apiFetch } from "@/lib/api";

export type ReportSubscription = {
  id: number; target_type: "report" | "dashboard"; target_id: number;
  frequency: "daily" | "weekly" | "monthly"; hour: number; minute: number;
  weekday: number | null; day_of_month: number | null; timezone: string;
  is_active: boolean; next_run_at: string; last_status: string | null;
  last_error: string | null; last_sent_at: string | null;
};

export type SubscriptionDraft = Pick<ReportSubscription, "frequency" | "hour" | "minute" | "weekday" | "day_of_month" | "timezone" | "is_active">;

export async function fetchReportSubscriptions(targetType: "report" | "dashboard", targetId: number) {
  const response = await apiFetch(`/reports/subscriptions?target_type=${targetType}&target_id=${targetId}`);
  if (!response.ok) throw new Error("subscriptions-unavailable");
  return (await response.json() as { results: ReportSubscription[] }).results;
}

export async function saveReportSubscription(targetType: "report" | "dashboard", targetId: number, draft: SubscriptionDraft) {
  const response = await apiFetch("/reports/subscriptions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target_type: targetType, target_id: targetId, ...draft }) });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail ?? "Schedule could not be saved");
  }
  return response.json() as Promise<ReportSubscription>;
}

export async function deleteReportSubscription(id: number) {
  const response = await apiFetch(`/reports/subscriptions/${id}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Schedule could not be stopped");
}
