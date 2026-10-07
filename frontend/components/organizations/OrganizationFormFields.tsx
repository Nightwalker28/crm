"use client";

import { inputIdLookup } from "@/components/forms/ServerFieldErrors";

export type OrganizationFormValue = {
  org_name: string;
  primary_email: string;
  secondary_email: string;
  website: string;
  primary_phone: string;
  secondary_phone: string;
  industry: string;
  account_type: string;
  /** In the company's base currency (13a A4). */
  annual_revenue: string;
  employee_count: string;
  billing_address: string;
  billing_street2: string;
  billing_city: string;
  billing_state: string;
  billing_postal_code: string;
  billing_country: string;
  shipping_address: string;
  shipping_street2: string;
  shipping_city: string;
  shipping_state: string;
  shipping_postal_code: string;
  shipping_country: string;
  /** We buy from this account (E4). The same company can be a customer too. */
  is_vendor: boolean;
  /** Days to pay (E5): sets due dates on its invoices and bills. Blank uses the company default. */
  payment_terms_days: string;
  assigned_to: number | null;
  assigned_to_name: string;
};

export const EMPTY_ORGANIZATION_FORM: OrganizationFormValue = {
  org_name: "",
  primary_email: "",
  secondary_email: "",
  website: "",
  primary_phone: "",
  secondary_phone: "",
  industry: "",
  account_type: "",
  annual_revenue: "",
  employee_count: "",
  billing_address: "",
  billing_street2: "",
  billing_city: "",
  billing_state: "",
  billing_postal_code: "",
  billing_country: "",
  shipping_address: "",
  shipping_street2: "",
  shipping_city: "",
  shipping_state: "",
  shipping_postal_code: "",
  shipping_country: "",
  is_vendor: false,
  payment_terms_days: "",
  assigned_to: null,
  assigned_to_name: "",
};

/** Payload field → input id, for the server's field errors (H2). */
export const ORGANIZATION_FORM_INPUT_IDS: Record<string, string> = {
  org_name: "account-name",
  industry: "account-industry",
  account_type: "account-type",
  website: "account-website",
  annual_revenue: "account-revenue",
  employee_count: "account-employees",
  primary_email: "account-primary-email",
  secondary_email: "account-secondary-email",
  primary_phone: "account-primary-phone",
  secondary_phone: "account-secondary-phone",
  ...Object.fromEntries(
    ["billing", "shipping"].flatMap((prefix) =>
      ["address", "street2", "city", "state", "postal_code", "country"].map((part) => [
        `${prefix}_${part}`,
        `account-${prefix}-${part.replace("_", "-")}`,
      ]),
    ),
  ),
  assigned_to: "account-owner",
  payment_terms_days: "account-payment-terms",
};
export const organizationFormInputIdFor = inputIdLookup("sales_organizations", ORGANIZATION_FORM_INPUT_IDS);

