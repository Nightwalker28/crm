export type StatusStyle = {
  bg: string;
  text: string;
  border: string;
  label: string;
};

function labelize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const GENERIC_STATUS: StatusStyle = {
  bg: "bg-neutral-800/60",
  text: "text-neutral-300",
  border: "border-neutral-700/50",
  label: "Unknown",
};

export function getGenericStatusStyle(status: string): StatusStyle {
  return { ...GENERIC_STATUS, label: labelize(status || "Unknown") };
}

export function getInsertionOrderStatusStyle(status: string): StatusStyle {
  const styles: Record<string, StatusStyle> = {
    draft: { bg: "bg-neutral-800/60", text: "text-neutral-300", border: "border-neutral-700/50", label: "Draft" },
    issued: { bg: "bg-sky-900/30", text: "text-sky-300", border: "border-sky-700/40", label: "Issued" },
    active: { bg: "bg-emerald-900/30", text: "text-emerald-300", border: "border-emerald-700/40", label: "Active" },
    completed: { bg: "bg-teal-900/30", text: "text-teal-300", border: "border-teal-700/40", label: "Completed" },
    cancelled: { bg: "bg-red-900/30", text: "text-red-300", border: "border-red-700/40", label: "Cancelled" },
    imported: { bg: "bg-violet-900/30", text: "text-violet-300", border: "border-violet-700/40", label: "Imported" },
  };

  return styles[status.toLowerCase()] ?? getGenericStatusStyle(status);
}

export function getOpportunityStageStyle(stage: string): StatusStyle {
  const styles: Record<string, StatusStyle> = {
    lead: { bg: "bg-neutral-800/60", text: "text-neutral-300", border: "border-neutral-700/50", label: "Lead" },
    qualified: { bg: "bg-sky-900/30", text: "text-sky-300", border: "border-sky-700/40", label: "Qualified" },
    proposal: { bg: "bg-violet-900/30", text: "text-violet-300", border: "border-violet-700/40", label: "Proposal" },
    negotiation: { bg: "bg-amber-900/30", text: "text-amber-300", border: "border-amber-700/40", label: "Negotiation" },
    closed_won: { bg: "bg-emerald-900/30", text: "text-emerald-300", border: "border-emerald-700/40", label: "Closed Won" },
    closed_lost: { bg: "bg-red-900/30", text: "text-red-300", border: "border-red-700/40", label: "Closed Lost" },
    unstaged: { bg: "bg-neutral-800/60", text: "text-neutral-400", border: "border-neutral-700/50", label: "Unstaged" },
  };

  const key = stage.toLowerCase().replace(/\s+/g, "_");
  return styles[key] ?? getGenericStatusStyle(stage || "unstaged");
}

export function getTaskPriorityStyle(priority: string): StatusStyle {
  const styles: Record<string, StatusStyle> = {
    high: { bg: "bg-red-950/60", text: "text-red-200", border: "border-red-800/70", label: "High" },
    medium: { bg: "bg-amber-950/60", text: "text-amber-200", border: "border-amber-800/70", label: "Medium" },
    low: { bg: "bg-emerald-950/60", text: "text-emerald-200", border: "border-emerald-800/70", label: "Low" },
  };

  return styles[priority.toLowerCase()] ?? styles.medium;
}

export function getTaskStatusStyle(status: string): StatusStyle {
  const styles: Record<string, StatusStyle> = {
    todo: { bg: "bg-neutral-900", text: "text-neutral-200", border: "border-neutral-700", label: "To Do" },
    in_progress: { bg: "bg-sky-950/60", text: "text-sky-200", border: "border-sky-800/70", label: "In Progress" },
    blocked: { bg: "bg-red-950/60", text: "text-red-200", border: "border-red-800/70", label: "Blocked" },
    completed: { bg: "bg-emerald-950/60", text: "text-emerald-200", border: "border-emerald-800/70", label: "Completed" },
  };

  return styles[status.toLowerCase()] ?? styles.todo;
}
