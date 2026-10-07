"use client";

import { inputIdLookup } from "@/components/forms/ServerFieldErrors";
import { addressFrom, type AddressValue } from "@/components/forms/AddressFields";

export type ContactFormValue = {
  salutation: string;
  first_name: string;
  last_name: string;
  primary_email: string;
  /** The work phone; the column keeps its first name (13b §3.5). */
  contact_telephone: string;
  mobile_phone: string;
  mailing_address: string;
  mailing_street2: string;
  mailing_city: string;
  mailing_state: string;
  mailing_postal_code: string;
  linkedin_url: string;
  current_title: string;
  region: string;
  country: string;
  email_opt_out: boolean;
  organization_id: number | null;
  organization_name: string;
  assigned_to: number | null;
  assigned_to_name: string;
};

export const EMPTY_CONTACT_FORM: ContactFormValue = {
  salutation: "",
  first_name: "",
  last_name: "",
  primary_email: "",
  contact_telephone: "",
  mobile_phone: "",
  mailing_address: "",
  mailing_street2: "",
  mailing_city: "",
  mailing_state: "",
  mailing_postal_code: "",
  linkedin_url: "",
  current_title: "",
  region: "",
  country: "",
  email_opt_out: false,
  organization_id: null,
  organization_name: "",
  assigned_to: null,
  assigned_to_name: "",
};

/** The mailing address as one value; its country is the contact's `country`. */
export function contactMailingAddress(value: ContactFormValue): AddressValue {
  return { ...addressFrom(value, "mailing"), country: value.country };
}

/** Payload field → input id, for the server's field errors (H2). */
export const CONTACT_FORM_INPUT_IDS: Record<string, string> = {
  salutation: "contact-salutation",
  first_name: "contact-first-name",
  last_name: "contact-last-name",
  current_title: "contact-job-title",
  linkedin_url: "contact-linkedin",
  primary_email: "contact-primary-email",
  contact_telephone: "contact-phone",
  mobile_phone: "contact-mobile",
  mailing_address: "contact-mailing-address",
  mailing_street2: "contact-mailing-street2",
  mailing_city: "contact-mailing-city",
  mailing_state: "contact-mailing-state",
  mailing_postal_code: "contact-mailing-postal-code",
  organization_id: "contact-account",
  assigned_to: "contact-owner",
  region: "contact-region",
  country: "contact-mailing-country",
};
export const contactFormInputIdFor = inputIdLookup("sales_contacts", CONTACT_FORM_INPUT_IDS);

