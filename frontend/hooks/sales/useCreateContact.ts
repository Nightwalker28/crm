"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

type OrgOption = {
  id: number;
  name: string;
};

export type ContactForm = {
  first_name: string;
  last_name: string;
  primary_email: string;
  linkedin_url: string;
  current_title: string;
  region: string;
  country: string;
  organization_id: string | number;
};

const emptyForm: ContactForm = {
  first_name: "",
  last_name: "",
  primary_email: "",
  linkedin_url: "",
  current_title: "",
  region: "",
  country: "",
  organization_id: "",
};

const emptyOrganizations: OrgOption[] = [];

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Failed to create contact";
}

export function useCreateContact({
  isOpen,
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
  const [orgSearch, setOrgSearch] = useState("");
  const [selectedOrgName, setSelectedOrgName] = useState("");
  const [orgOpen, setOrgOpen] = useState(false);
  const orgRef = useRef<HTMLDivElement>(null);

  const canSubmit = useMemo(
    () => Boolean(form.primary_email.trim()),
    [form.primary_email],
  );

  const orgsQuery = useQuery({
    queryKey: ["contact-org-options"],
    queryFn: async () => {
      const res = await apiFetch("/sales/organizations?page=1&page_size=50");
      if (!res.ok) throw new Error("Failed to load organizations");
      const json = await res.json();
      return (json.results ?? []).map((organization: { org_id?: number; id?: number; org_name: string }) => ({
        id: organization.org_id ?? organization.id ?? 0,
        name: organization.org_name,
      })) as OrgOption[];
    },
    enabled: isOpen,
    staleTime: 5 * 60_000,
  });

  const orgs = orgsQuery.data ?? emptyOrganizations;

  const filteredOrgs = useMemo(
    () => orgs.filter((org) => org.name.toLowerCase().includes(orgSearch.toLowerCase())),
    [orgSearch, orgs],
  );

  useEffect(() => {
    if (!orgOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (orgRef.current && !orgRef.current.contains(event.target as Node)) {
        setOrgOpen(false);
        setOrgSearch("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [orgOpen]);

  function resetForm() {
    setForm(emptyForm);
    setSelectedOrgName("");
    setOrgSearch("");
    setOrgOpen(false);
    setError(null);
  }

  function closeModal() {
    resetForm();
    onClose();
  }

  async function submit() {
    try {
      setIsSubmitting(true);
      setError(null);

      const res = await apiFetch("/sales/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          organization_id: form.organization_id ? Number(form.organization_id) : null,
        }),
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
    orgRef,
    orgSearch,
    setOrgSearch,
    selectedOrgName,
    setSelectedOrgName,
    orgOpen,
    setOrgOpen,
    filteredOrgs,
    closeModal,
    submit,
  };
}
