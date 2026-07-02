"use client";

import { useMemo, useState } from "react";

import { apiFetch } from "@/lib/api";
import { pickEnabledModulePayload, type ModuleFieldConfig } from "@/hooks/useModuleFieldConfigs";

export type ContactForm = {
  first_name: string;
  last_name: string;
  primary_email: string;
  contact_telephone: string;
  linkedin_url: string;
  current_title: string;
  region: string;
  country: string;
  organization_id: number | null;
  custom_fields?: Record<string, unknown>;
};

const emptyForm: ContactForm = {
  first_name: "",
  last_name: "",
  primary_email: "",
  contact_telephone: "",
  linkedin_url: "",
  current_title: "",
  region: "",
  country: "",
  organization_id: null,
  custom_fields: {},
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Failed to create contact";
}

export function useCreateContact({
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [organizationDisplay, setOrganizationDisplay] = useState("");

  const canSubmit = useMemo(
    () => Boolean(form.primary_email.trim()),
    [form.primary_email],
  );

  function resetForm() {
    setForm(emptyForm);
    setOrganizationDisplay("");
    setError(null);
  }

  function closeModal() {
    resetForm();
    onClose();
  }

  async function submit(overrides?: Record<string, unknown>, moduleFields?: ModuleFieldConfig[]) {
    try {
      setIsSubmitting(true);
      setError(null);

      const payload = {
        ...form,
        ...overrides,
        organization_id: form.organization_id,
      };
      const requestPayload = moduleFields
        ? pickEnabledModulePayload(payload, moduleFields, ["primary_email", "custom_fields"])
        : payload;

      const res = await apiFetch("/sales/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      });

      if (!res.ok) {
        const data = await res.json().catch(async () => {
          const text = await res.text().catch(() => "");
          return text ? { detail: text } : null;
        });
        throw new Error(data?.detail ?? data?.message ?? `Failed with ${res.status}`);
      }

      onSuccess();
      closeModal();
    } catch (error: unknown) {
      setError(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return {
    form,
    setForm,
    error,
    isSubmitting,
    canSubmit,
    organizationDisplay,
    setOrganizationDisplay,
    closeModal,
    submit,
  };
}
