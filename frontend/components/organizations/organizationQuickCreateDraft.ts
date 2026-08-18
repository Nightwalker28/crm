/** The Account instance of the shared Quick Create draft handoff. See `lib/quickCreateDraft`. */

import {
  EMPTY_ORGANIZATION_FORM,
  type OrganizationFormValue,
} from "@/components/organizations/OrganizationFormFields";
import {
  createQuickCreateDraftStore,
  isQuickCreateHandoff,
  type QuickCreateDraft,
} from "@/lib/quickCreateDraft";

export const ORGANIZATION_FULL_CREATE_ROUTE = "/dashboard/sales/organizations/new";

export type OrganizationQuickCreateDraft = QuickCreateDraft<OrganizationFormValue>;

const store = createQuickCreateDraftStore<OrganizationFormValue>({
  storageKey: "lynk:organization-quick-create-draft",
  fullCreateRoute: ORGANIZATION_FULL_CREATE_ROUTE,
  emptyForm: EMPTY_ORGANIZATION_FORM,
});

export const ORGANIZATION_QUICK_CREATE_HANDOFF_ROUTE = store.handoffRoute;
export const saveOrganizationQuickCreateDraft = store.save;
export const consumeOrganizationQuickCreateDraft = store.consume;
export const isOrganizationQuickCreateHandoff = isQuickCreateHandoff;
