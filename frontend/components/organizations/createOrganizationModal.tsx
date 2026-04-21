"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import {
  Dialog,
  DialogBackdrop,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { Input } from "@/components/ui/input";

type OrganizationForm = {
  org_name: string;
  primary_email: string;
  website: string;
  primary_phone: string;
  secondary_email: string;
  industry: string;
  annual_revenue: string;
};

const emptyForm: OrganizationForm = {
  org_name: "",
  primary_email: "",
  website: "",
  primary_phone: "",
  secondary_email: "",
  industry: "",
  annual_revenue: "",
};

function RequiredMark() {
  return <span className="text-red-400">*</span>;
}

type Props = {
  isOpen: boolean;
  isSubmitting?: boolean;
  onClose: () => void;
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
};

export default function CreateOrganizationModal({
  isOpen,
  isSubmitting = false,
  onClose,
  onCreate,
}: Props) {
  const [form, setForm] = useState<OrganizationForm>(emptyForm);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const customFieldsQuery = useModuleCustomFields("sales_organizations", isOpen);

  function closeAndReset() {
    setForm(emptyForm);
    setCustomFieldValues({});
    onClose();
  }

  async function handleSubmit() {
    const payload = {
      org_name: form.org_name.trim(),
      primary_email: form.primary_email.trim(),
      website: form.website.trim(),
      primary_phone: form.primary_phone.trim(),
      secondary_email: form.secondary_email.trim(),
      industry: form.industry.trim(),
      annual_revenue: form.annual_revenue.trim(),
    };

    await onCreate(
      {
        ...Object.fromEntries(
          Object.entries(payload).filter(([, value]) => value.length > 0),
        ),
        custom_fields: customFieldValues,
      },
    );
    setForm(emptyForm);
    setCustomFieldValues({});
  }

  return (
    <Dialog open={isOpen} onClose={closeAndReset}>
      <DialogBackdrop />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel size="xl">
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
            <DialogIconClose />
          </DialogHeader>

          <FieldGroup className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2">
              <FieldLabel>Organization Name <RequiredMark /></FieldLabel>
              <Input
                value={form.org_name}
                onChange={(event) => setForm((current) => ({ ...current, org_name: event.target.value }))}
                placeholder="Acme Inc."
              />
            </Field>

            <Field>
              <FieldLabel>Primary Email <RequiredMark /></FieldLabel>
              <Input
                type="email"
                value={form.primary_email}
                onChange={(event) => setForm((current) => ({ ...current, primary_email: event.target.value }))}
                placeholder="ops@acme.com"
              />
            </Field>

            <Field>
              <FieldLabel>Website</FieldLabel>
              <Input
                value={form.website}
                onChange={(event) => setForm((current) => ({ ...current, website: event.target.value }))}
                placeholder="https://acme.com"
              />
            </Field>

            <Field>
              <FieldLabel>Primary Phone</FieldLabel>
              <Input
                value={form.primary_phone}
                onChange={(event) => setForm((current) => ({ ...current, primary_phone: event.target.value }))}
                placeholder="+1 555 123 4567"
              />
            </Field>

            <Field>
              <FieldLabel>Secondary Email</FieldLabel>
              <Input
                type="email"
                value={form.secondary_email}
                onChange={(event) => setForm((current) => ({ ...current, secondary_email: event.target.value }))}
                placeholder="finance@acme.com"
              />
            </Field>

            <Field>
              <FieldLabel>Industry</FieldLabel>
              <Input
                value={form.industry}
                onChange={(event) => setForm((current) => ({ ...current, industry: event.target.value }))}
                placeholder="SaaS"
              />
            </Field>

            <Field>
              <FieldLabel>Annual Revenue</FieldLabel>
              <Input
                value={form.annual_revenue}
                onChange={(event) => setForm((current) => ({ ...current, annual_revenue: event.target.value }))}
                placeholder="$10M - $25M"
              />
              <FieldDescription>Keep this lightweight for now. Full editing can come later.</FieldDescription>
            </Field>
          </FieldGroup>

          <div className="mt-4">
            <CustomFieldInputs
              definitions={customFieldsQuery.data ?? []}
              values={customFieldValues}
              onChange={(fieldKey, value) =>
                setCustomFieldValues((current) => ({ ...current, [fieldKey]: value }))
              }
            />
          </div>

          <DialogFooter className="mt-5">
            <Button variant="outline" onClick={closeAndReset}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                isSubmitting ||
                !form.org_name.trim() ||
                !form.primary_email.trim()
              }
            >
              {isSubmitting ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
