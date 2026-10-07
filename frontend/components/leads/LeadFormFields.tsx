"use client";

import { useEffect } from "react";

import { inputIdLookup } from "@/components/forms/ServerFieldErrors";
import { picklistDefault, usePicklist } from "@/hooks/usePicklists";

export type LeadFormValue = {
  first_name: string;
  last_name: string;
  company: string;
  primary_email: string;
  phone: string;
  mobile_phone: string;
  title: string;
  source: string;
  status: string;
  notes: string;
  assigned_to: number | null;
  assigned_to_name: string;
  next_follow_up_at: string;
  team_id: number | null;
  team_name: string;
  tags: string[];
};

export const EMPTY_LEAD_FORM: LeadFormValue = {
  first_name: "",
  last_name: "",
  company: "",
  primary_email: "",
  phone: "",
  mobile_phone: "",
  title: "",
  source: "",
  // Filled from the tenant's default lead status when the form opens; the server applies the
  // same default when none is sent.
  status: "",
  notes: "",
  assigned_to: null,
  assigned_to_name: "",
  next_follow_up_at: "",
  team_id: null,
  team_name: "",
  tags: [],
};

/**
 * A new lead starts in the tenant's default status, as the server would put it.
 *
 * `applyDefault` receives only the status, so a caller holding state applies it as a
 * functional update: another effect in the same commit (a *More details* handoff, a clone)
 * may have replaced the form, and writing back the value this render saw would undo it.
 */
export function useLeadStatusDefault(status: string, applyDefault: (status: string) => void) {
  const { picklist } = usePicklist("lead_status");
  const fallback = picklistDefault(picklist);
  useEffect(() => {
    if (!status && fallback) applyDefault(fallback);
  }, [applyDefault, fallback, status]);
}

/** Payload field → input id, for the server's field errors (H2). */
export const LEAD_FORM_INPUT_IDS: Record<string, string> = {
  first_name: "lead-first-name",
  last_name: "lead-last-name",
  company: "lead-company",
  title: "lead-job-title",
  primary_email: "lead-primary-email",
  phone: "lead-phone",
  mobile_phone: "lead-mobile",
  notes: "lead-notes",
  assigned_to: "lead-owner",
  team_id: "lead-team",
  status: "lead-status",
  source: "lead-source",
  next_follow_up_at: "lead-next-follow-up",
  tags: "lead-tags",
};
export const leadFormInputIdFor = inputIdLookup("sales_leads", LEAD_FORM_INPUT_IDS);

