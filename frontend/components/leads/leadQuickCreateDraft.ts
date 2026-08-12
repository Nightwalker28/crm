/** The Lead instance of the shared Quick Create draft handoff. See `lib/quickCreateDraft`. */

import { EMPTY_LEAD_FORM, type LeadFormValue } from "@/components/leads/LeadFormFields";
import {
  createQuickCreateDraftStore,
  isQuickCreateHandoff,
  QUICK_CREATE_HANDOFF_PARAM,
  QUICK_CREATE_HANDOFF_VALUE,
  type QuickCreateDraft,
} from "@/lib/quickCreateDraft";

export const LEAD_QUICK_CREATE_HANDOFF_PARAM = QUICK_CREATE_HANDOFF_PARAM;
export const LEAD_QUICK_CREATE_HANDOFF_VALUE = QUICK_CREATE_HANDOFF_VALUE;
export const LEAD_FULL_CREATE_ROUTE = "/dashboard/sales/leads/new";

export type LeadQuickCreateDraft = QuickCreateDraft<LeadFormValue>;

const store = createQuickCreateDraftStore<LeadFormValue>({
  storageKey: "lynk:lead-quick-create-draft",
  fullCreateRoute: LEAD_FULL_CREATE_ROUTE,
  emptyForm: EMPTY_LEAD_FORM,
});

export const LEAD_QUICK_CREATE_HANDOFF_ROUTE = store.handoffRoute;
export const saveLeadQuickCreateDraft = store.save;
export const clearLeadQuickCreateDraft = store.clear;
export const consumeLeadQuickCreateDraft = store.consume;
export const isLeadQuickCreateHandoff = isQuickCreateHandoff;
