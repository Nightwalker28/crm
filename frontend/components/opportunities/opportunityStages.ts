export const OPPORTUNITY_STAGE_ORDER = [
  "lead",
  "qualified",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
] as const;

export const OPPORTUNITY_STAGE_LABELS: Record<string, string> = {
  lead: "Lead",
  qualified: "Qualified",
  proposal: "Proposal",
  negotiation: "Negotiation",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
};

import { getOpportunityStageStyle as getCentralOpportunityStageStyle } from "@/lib/statusStyles";

export function normalizeOpportunityStage(stage?: string | null) {
  return (stage ?? "").toLowerCase().replace(/\s+/g, "_");
}

export function getOpportunityStageLabel(stage?: string | null) {
  const key = normalizeOpportunityStage(stage);
  return OPPORTUNITY_STAGE_LABELS[key] ?? stage ?? "Unstaged";
}

export function getOpportunityStageStyle(stage?: string | null) {
  return getCentralOpportunityStageStyle(normalizeOpportunityStage(stage) || "unstaged");
}
