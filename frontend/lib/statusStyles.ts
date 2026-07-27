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
  bg: "bg-surface-muted",
  text: "text-copy-secondary",
  border: "border-line-default",
  label: "Unknown",
};

export function getGenericStatusStyle(status: string): StatusStyle {
  return { ...GENERIC_STATUS, label: labelize(status || "Unknown") };
}

export function getInsertionOrderStatusStyle(status: string): StatusStyle {
  const styles: Record<string, StatusStyle> = {
    draft: { bg: "bg-surface-muted", text: "text-copy-secondary", border: "border-line-default", label: "Draft" },
    issued: { bg: "bg-action-primary-muted", text: "text-primary", border: "border-action-primary/40", label: "Issued" },
    active: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40", label: "Active" },
    completed: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40", label: "Completed" },
    cancelled: { bg: "bg-state-danger-muted", text: "text-state-danger", border: "border-state-danger/40", label: "Cancelled" },
    imported: { bg: "bg-action-primary-muted", text: "text-primary", border: "border-action-primary/40", label: "Imported" },
  };

  return styles[status.toLowerCase()] ?? {
    bg: "bg-surface-muted",
    text: "text-copy-secondary",
    border: "border-line-default",
    label: labelize(status || "Unknown"),
  };
}

export function getContractStatusStyle(status: string): StatusStyle {
  const styles: Record<string, StatusStyle> = {
    draft: { bg: "bg-surface-muted", text: "text-copy-secondary", border: "border-line-default", label: "Draft" },
    review: { bg: "bg-state-info-muted", text: "text-state-info", border: "border-state-info/40", label: "Review" },
    sent: { bg: "bg-action-primary-muted", text: "text-primary", border: "border-action-primary/40", label: "Sent" },
    partially_signed: { bg: "bg-state-warning-muted", text: "text-state-warning", border: "border-state-warning/40", label: "Partially signed" },
    signed: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40", label: "Signed" },
    active: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40", label: "Active" },
    expired: { bg: "bg-state-warning-muted", text: "text-state-warning", border: "border-state-warning/40", label: "Expired" },
    cancelled: { bg: "bg-state-danger-muted", text: "text-state-danger", border: "border-state-danger/40", label: "Cancelled" },
  };

  return styles[status.toLowerCase()] ?? {
    ...GENERIC_STATUS,
    label: labelize(status || "Unknown"),
  };
}

export function getPosInvoiceStatusStyle(status: string): StatusStyle {
  const styles: Record<string, StatusStyle> = {
    draft: { bg: "bg-surface-muted", text: "text-copy-secondary", border: "border-line-default", label: "Draft" },
    issued: { bg: "bg-state-info-muted", text: "text-state-info", border: "border-state-info/40", label: "Issued" },
    paid: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40", label: "Paid" },
    void: { bg: "bg-state-danger-muted", text: "text-state-danger", border: "border-state-danger/40", label: "Void" },
  };

  return styles[status.toLowerCase()] ?? {
    bg: "bg-surface-muted",
    text: "text-copy-secondary",
    border: "border-line-default",
    label: labelize(status || "Unknown"),
  };
}

export function getPosPaymentStatusStyle(status: string): StatusStyle {
  const styles: Record<string, StatusStyle> = {
    unpaid: { bg: "bg-state-warning-muted", text: "text-state-warning", border: "border-state-warning/40", label: "Unpaid" },
    partial: { bg: "bg-state-info-muted", text: "text-state-info", border: "border-state-info/40", label: "Partially paid" },
    paid: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40", label: "Paid" },
    refunded: { bg: "bg-surface-muted", text: "text-copy-secondary", border: "border-line-default", label: "Refunded" },
  };

  return styles[status.toLowerCase()] ?? {
    bg: "bg-surface-muted",
    text: "text-copy-secondary",
    border: "border-line-default",
    label: labelize(status || "Unknown"),
  };
}

export function getOpportunityStageStyle(stage: string): StatusStyle {
  const styles: Record<string, StatusStyle> = {
    lead: { bg: "bg-surface-muted", text: "text-copy-secondary", border: "border-line-default", label: "Lead" },
    qualified: { bg: "bg-state-info-muted", text: "text-state-info", border: "border-state-info/40", label: "Qualified" },
    proposal: { bg: "bg-action-primary-muted", text: "text-primary", border: "border-action-primary/40", label: "Proposal" },
    negotiation: { bg: "bg-state-warning-muted", text: "text-state-warning", border: "border-state-warning/40", label: "Negotiation" },
    closed_won: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40", label: "Closed Won" },
    closed_lost: { bg: "bg-state-danger-muted", text: "text-state-danger", border: "border-state-danger/40", label: "Closed Lost" },
    unstaged: { bg: "bg-surface-muted", text: "text-copy-muted", border: "border-line-default", label: "Unstaged" },
  };

  const key = stage.toLowerCase().replace(/\s+/g, "_");
  return styles[key] ?? getGenericStatusStyle(stage || "unstaged");
}

export function getLeadStatusStyle(status: string): StatusStyle {
  const styles: Record<string, StatusStyle> = {
    new: { bg: "bg-state-info-muted", text: "text-state-info", border: "border-state-info/40", label: "New" },
    contacted: { bg: "bg-action-primary-muted", text: "text-primary", border: "border-action-primary/40", label: "Contacted" },
    qualified: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40", label: "Qualified" },
    unqualified: { bg: "bg-surface-muted", text: "text-copy-muted", border: "border-line-default", label: "Unqualified" },
    converted: { bg: "bg-state-warning-muted", text: "text-state-warning", border: "border-state-warning/40", label: "Converted" },
  };

  return styles[status.toLowerCase()] ?? getGenericStatusStyle(status);
}

export function getLeadScoreStyle(grade: string): StatusStyle {
  const styles: Record<string, StatusStyle> = {
    hot: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40", label: "Hot" },
    warm: { bg: "bg-state-warning-muted", text: "text-state-warning", border: "border-state-warning/40", label: "Warm" },
    cold: { bg: "bg-surface-muted", text: "text-copy-muted", border: "border-line-default", label: "Cold" },
  };

  return styles[grade.toLowerCase()] ?? getGenericStatusStyle(grade);
}

export function getQuoteStatusStyle(status: string): StatusStyle {
  const styles: Record<string, StatusStyle> = {
    draft: { bg: "bg-surface-muted", text: "text-copy-secondary", border: "border-line-default", label: "Draft" },
    sent: { bg: "bg-state-info-muted", text: "text-state-info", border: "border-state-info/40", label: "Sent" },
    accepted: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40", label: "Accepted" },
    declined: { bg: "bg-state-danger-muted", text: "text-state-danger", border: "border-state-danger/40", label: "Declined" },
    expired: { bg: "bg-state-warning-muted", text: "text-state-warning", border: "border-state-warning/40", label: "Expired" },
  };

  return styles[status.toLowerCase()] ?? getGenericStatusStyle(status);
}

export function getOrderStatusStyle(status: string): StatusStyle {
  const styles: Record<string, StatusStyle> = {
    draft: { bg: "bg-surface-muted", text: "text-copy-secondary", border: "border-line-default", label: "Draft" },
    confirmed: { bg: "bg-state-info-muted", text: "text-state-info", border: "border-state-info/40", label: "Confirmed" },
    fulfilled: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40", label: "Fulfilled" },
    cancelled: { bg: "bg-state-danger-muted", text: "text-state-danger", border: "border-state-danger/40", label: "Cancelled" },
  };

  return styles[status.toLowerCase()] ?? getGenericStatusStyle(status);
}

export function getTaskPriorityStyle(priority: string): StatusStyle {
  const styles: Record<string, StatusStyle> = {
    high: { bg: "bg-state-danger-muted", text: "text-state-danger", border: "border-state-danger/40", label: "High" },
    medium: { bg: "bg-state-warning-muted", text: "text-state-warning", border: "border-state-warning/40", label: "Medium" },
    low: { bg: "bg-surface-muted", text: "text-copy-secondary", border: "border-line-default", label: "Low" },
  };

  return styles[priority.toLowerCase()] ?? getGenericStatusStyle(priority);
}

export function getTaskStatusStyle(status: string): StatusStyle {
  const styles: Record<string, StatusStyle> = {
    todo: { bg: "bg-surface-muted", text: "text-copy-secondary", border: "border-line-default", label: "To Do" },
    in_progress: { bg: "bg-state-info-muted", text: "text-state-info", border: "border-state-info/40", label: "In Progress" },
    blocked: { bg: "bg-state-danger-muted", text: "text-state-danger", border: "border-state-danger/40", label: "Blocked" },
    completed: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40", label: "Completed" },
  };

  return styles[status.toLowerCase()] ?? getGenericStatusStyle(status);
}

export function getSupportCaseStatusStyle(status: string): StatusStyle {
  const styles: Record<string, StatusStyle> = {
    new: { bg: "bg-state-info-muted", text: "text-state-info", border: "border-state-info/40", label: "New" },
    open: { bg: "bg-state-warning-muted", text: "text-state-warning", border: "border-state-warning/40", label: "Open" },
    pending: { bg: "bg-surface-muted", text: "text-copy-secondary", border: "border-line-default", label: "Pending" },
    resolved: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40", label: "Resolved" },
    closed: { bg: "bg-surface-muted", text: "text-copy-muted", border: "border-line-default", label: "Closed" },
  };

  return styles[status.toLowerCase()] ?? getGenericStatusStyle(status);
}

export function getSupportCasePriorityStyle(priority: string): StatusStyle {
  const styles: Record<string, StatusStyle> = {
    low: { bg: "bg-surface-muted", text: "text-copy-secondary", border: "border-line-default", label: "Low" },
    medium: { bg: "bg-state-info-muted", text: "text-state-info", border: "border-state-info/40", label: "Medium" },
    high: { bg: "bg-state-warning-muted", text: "text-state-warning", border: "border-state-warning/40", label: "High" },
    urgent: { bg: "bg-state-danger-muted", text: "text-state-danger", border: "border-state-danger/40", label: "Urgent" },
  };

  return styles[priority.toLowerCase()] ?? getGenericStatusStyle(priority);
}
