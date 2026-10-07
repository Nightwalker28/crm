"use client";

import { inputIdLookup } from "@/components/forms/ServerFieldErrors";

export type OpportunityFormValue = {
  opportunity_name: string;
  contact_id: number | null;
  contact_name: string;
  organization_id: number | null;
  organization_name: string;
  assigned_to: number | null;
  assigned_to_name: string;
  sales_stage: string;
  start_date: string;
  expected_close_date: string;
  probability_percent: string;
  amount: string;
  /** Empty takes the company's base currency (13b §3.5). */
  currency_type: string;
  deal_type: string;
  source: string;
  next_step: string;
  lost_reason: string;
};

export const EMPTY_OPPORTUNITY_FORM: OpportunityFormValue = {
  opportunity_name: "", contact_id: null, contact_name: "", organization_id: null,
  organization_name: "", assigned_to: null, assigned_to_name: "", sales_stage: "", start_date: "",
  expected_close_date: "", probability_percent: "", amount: "", currency_type: "",
  deal_type: "", source: "", next_step: "", lost_reason: "",
};

/** Payload field → input id, for the server's field errors (H2). */
export const OPPORTUNITY_FORM_INPUT_IDS: Record<string, string> = {
  opportunity_name: "deal-name",
  contact_id: "deal-contact",
  organization_id: "deal-account",
  amount: "deal-amount",
  currency_type: "deal-currency",
  probability_percent: "deal-probability",
  start_date: "deal-start-date",
  expected_close_date: "deal-close-date",
  deal_type: "deal-type",
  source: "deal-source",
  next_step: "deal-next-step",
  lost_reason: "deal-lost-reason",
  sales_stage: "deal-stage",
  pipeline_stage_id: "deal-stage",
  assigned_to: "deal-owner",
};
export const opportunityFormInputIdFor = inputIdLookup("sales_opportunities", OPPORTUNITY_FORM_INPUT_IDS);

