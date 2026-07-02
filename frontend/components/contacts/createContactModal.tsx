"use client";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { COUNTRIES } from "@/lib/countries";
import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useCreateContact } from "@/hooks/sales/useCreateContact";
import { isModuleFieldEnabled, useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { RequiredMark } from "@/components/ui/RequiredMark";

const REGIONS = ["APAC", "EMEA", "NA", "LATAM"];

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export default function CreateContactModal({
  isOpen,
  onClose,
  onSuccess,
}: Props) {
  const {
    form,
    setForm,
    error,
    isSubmitting,
    canSubmit,
    organizationDisplay,
    setOrganizationDisplay,
    closeModal,
    submit,
  } = useCreateContact({
    isOpen,
    onClose,
    onSuccess,
  });
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const customFieldsQuery = useModuleCustomFields("sales_contacts", isOpen);
  const { fields: moduleFields } = useModuleFieldConfigs("sales_contacts", false, isOpen);
  const fieldEnabled = (fieldKey: string) => isModuleFieldEnabled(moduleFields, fieldKey);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isOpen) setCustomFieldValues({});
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onClose={closeModal}>
      <DialogBackdrop />

      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel size="2xl">
          <DialogHeader>
            <DialogTitle>Create Contact</DialogTitle>
            <DialogIconClose />
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {error && <p className="text-sm text-red-400">{error}</p>}

            {/* NAME */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {fieldEnabled("first_name") ? (
              <Field label="First name">
                <Input
                  value={form.first_name}
                  onChange={(e) =>
                    setForm({ ...form, first_name: e.target.value })
                  }
                />
              </Field>
              ) : null}

              {fieldEnabled("last_name") ? (
              <Field label="Last name">
                <Input
                  value={form.last_name}
                  onChange={(e) =>
                    setForm({ ...form, last_name: e.target.value })
                  }
                />
              </Field>
              ) : null}
            </div>

            {/* EMAIL + PHONE */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {fieldEnabled("primary_email") ? (
              <Field label="Email" required>
                <Input
                  value={form.primary_email}
                  onChange={(e) =>
                    setForm({ ...form, primary_email: e.target.value })
                  }
                  type="email"
                  placeholder="person@company.com"
                />
              </Field>
              ) : null}

              {fieldEnabled("contact_telephone") ? (
              <Field label="Phone">
                <Input
                  value={form.contact_telephone}
                  onChange={(e) =>
                    setForm({ ...form, contact_telephone: e.target.value })
                  }
                  type="tel"
                  placeholder="+94771234567"
                />
              </Field>
              ) : null}
            </div>

            {/* TITLE */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {fieldEnabled("current_title") ? (
              <Field label="Job title">
                <Input
                  value={form.current_title}
                  onChange={(e) =>
                    setForm({ ...form, current_title: e.target.value })
                  }
                />
              </Field>
              ) : null}
            </div>

            {/* LINKEDIN + REGION + COUNTRY */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {fieldEnabled("linkedin_url") ? (
              <Field label="LinkedIn URL" className="md:col-span-2">
                <Input
                  value={form.linkedin_url}
                  onChange={(e) =>
                    setForm({ ...form, linkedin_url: e.target.value })
                  }
                />
              </Field>
              ) : null}

              {fieldEnabled("region") ? (
              <Field label="Region">
                <Select
                  value={form.region}
                  onValueChange={(v) =>
                    setForm({ ...form, region: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select region" />
                  </SelectTrigger>
                  <SelectContent>
                    {REGIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              ) : null}

              {fieldEnabled("country") ? (
              <Field label="Country">
                <Select
                  value={form.country}
                  onValueChange={(v) =>
                    setForm({ ...form, country: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select country" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60 overflow-y-auto">
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              ) : null}
            </div>

            {/* ORGANIZATION (SEARCHABLE INPUT) */}
            {fieldEnabled("organization_id") ? (
            <Field label="Organization">
              <LinkedRecordPicker
                recordType="organization"
                valueId={form.organization_id}
                displayValue={organizationDisplay}
                onDisplayValueChange={(value) => {
                  setOrganizationDisplay(value);
                  setForm({ ...form, organization_id: null });
                }}
                onSelect={(option) => {
                  setOrganizationDisplay(option.label);
                  setForm({ ...form, organization_id: option.id });
                }}
                onClear={() => {
                  setOrganizationDisplay("");
                  setForm({ ...form, organization_id: null });
                }}
                placeholder="Search accounts"
                queryKeyPrefix="contact-create-account"
                noResultsText="No accounts matched this search."
              />
            </Field>
            ) : null}

            <CustomFieldInputs
              definitions={customFieldsQuery.data ?? []}
              values={customFieldValues}
              onChange={(fieldKey, value) =>
                setCustomFieldValues((current) => ({ ...current, [fieldKey]: value }))
              }
            />
          </div>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              onClick={() => submit({ custom_fields: customFieldValues }, moduleFields)}
              disabled={!canSubmit || isSubmitting}
            >
              {isSubmitting ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

/* ---------- FIELD ---------- */
function Field({
  label,
  children,
  className,
  required = false,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Label>
        {label} {required ? <RequiredMark /> : null}
      </Label>
      {children}
    </div>
  );
}
