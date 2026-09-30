/**
 * Calls — the vocabulary the call log and the Timeline share (07-telephony.md Phase 1).
 *
 * Lynk places no calls yet. The record header's Call is a `tel:` link and the call happens
 * on the operator's own phone; the Timeline composer's Call mode then records what they
 * report. Nothing built on this may say Lynk dialled, connected, timed or recorded a call —
 * a `manual` log is a person's account of it.
 */

export const CALL_OUTCOMES = [
  "connected",
  "left_voicemail",
  "left_message",
  "no_answer",
  "busy",
  "wrong_number",
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export type CallDirection = "outbound" | "inbound";

/** HubSpot's default call outcomes: the set operators already know. */
export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  connected: "Connected",
  left_voicemail: "Left voicemail",
  left_message: "Left live message",
  no_answer: "No answer",
  busy: "Busy",
  wrong_number: "Wrong number",
};

export function callOutcomeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return CALL_OUTCOME_LABELS[value as CallOutcome] ?? value;
}

/** `42 s`, `4 min`, `4 min 5 s`, `1 h 2 min`. */
export function formatCallDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  if (hours) return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  if (minutes) return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  return `${rest} s`;
}

/** The dialler link for a number as the record holds it, or null when there is none. */
export function telHref(phone: string | null | undefined): string | null {
  const raw = (phone ?? "").trim();
  if (!raw) return null;
  // The dialler reads `+` and digits; spaces, dots and brackets are formatting.
  const dialable = raw.replace(/[^\d+*#]/g, "");
  return dialable ? `tel:${dialable}` : null;
}

export function callLogEndpoint(moduleKey: string, entityId: string | number) {
  return `/telephony/records/${moduleKey}/${entityId}/calls`;
}
