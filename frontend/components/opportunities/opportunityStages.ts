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

export const OPPORTUNITY_STAGE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  lead: { bg: "bg-neutral-800/60", text: "text-neutral-300", border: "border-neutral-700/50" },
  qualified: { bg: "bg-sky-900/30", text: "text-sky-300", border: "border-sky-700/40" },
  proposal: { bg: "bg-violet-900/30", text: "text-violet-300", border: "border-violet-700/40" },
  negotiation: { bg: "bg-amber-900/30", text: "text-amber-300", border: "border-amber-700/40" },
  closed_won: { bg: "bg-emerald-900/30", text: "text-emerald-300", border: "border-emerald-700/40" },
  closed_lost: { bg: "bg-red-900/30", text: "text-red-300", border: "border-red-700/40" },
};

export function normalizeOpportunityStage(stage?: string | null) {
  return (stage ?? "").toLowerCase().replace(/\s+/g, "_");
}

export function getOpportunityStageLabel(stage?: string | null) {
  const key = normalizeOpportunityStage(stage);
  return OPPORTUNITY_STAGE_LABELS[key] ?? stage ?? "Unstaged";
}

export function getOpportunityStageStyle(stage?: string | null) {
  const key = normalizeOpportunityStage(stage);
  return OPPORTUNITY_STAGE_STYLES[key] ?? {
    bg: "bg-neutral-800/60",
    text: "text-neutral-400",
    border: "border-neutral-700/50",
  };
}
