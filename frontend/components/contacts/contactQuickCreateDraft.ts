/** The Contact instance of the shared Quick Create draft handoff. See `lib/quickCreateDraft`. */

import { EMPTY_CONTACT_FORM, type ContactFormValue } from "@/components/contacts/ContactFormFields";
import {
  createQuickCreateDraftStore,
  isQuickCreateHandoff,
  type QuickCreateDraft,
} from "@/lib/quickCreateDraft";

export const CONTACT_FULL_CREATE_ROUTE = "/dashboard/sales/contacts/new";

export type ContactQuickCreateDraft = QuickCreateDraft<ContactFormValue>;

const store = createQuickCreateDraftStore<ContactFormValue>({
  storageKey: "lynk:contact-quick-create-draft",
  fullCreateRoute: CONTACT_FULL_CREATE_ROUTE,
  emptyForm: EMPTY_CONTACT_FORM,
});

export const CONTACT_QUICK_CREATE_HANDOFF_ROUTE = store.handoffRoute;
export const saveContactQuickCreateDraft = store.save;
export const consumeContactQuickCreateDraft = store.consume;
export const isContactQuickCreateHandoff = isQuickCreateHandoff;
