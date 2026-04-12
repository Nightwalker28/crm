"use client";

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
import { useCreateContact } from "@/hooks/sales/useCreateContact";

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
  } = useCreateContact({
    isOpen,
    onClose,
    onSuccess,
  });

  return (
    <Dialog open={isOpen} onClose={closeModal}>
      <DialogBackdrop />

      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Contact</DialogTitle>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {error && <p className="text-sm text-red-400">{error}</p>}

            {/* NAME */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="First name">
                <Input
                  value={form.first_name}
                  onChange={(e) =>
                    setForm({ ...form, first_name: e.target.value })
                  }
                />
              </Field>

              <Field label="Last name">
                <Input
                  value={form.last_name}
                  onChange={(e) =>
                    setForm({ ...form, last_name: e.target.value })
                  }
                />
              </Field>
            </div>

            {/* EMAIL + TITLE */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Email">
                <Input
                  value={form.primary_email}
                  onChange={(e) =>
                    setForm({ ...form, primary_email: e.target.value })
                  }
                />
              </Field>

              <Field label="Job title">
                <Input
                  value={form.current_title}
                  onChange={(e) =>
                    setForm({ ...form, current_title: e.target.value })
                  }
                />
              </Field>
            </div>

            {/* LINKEDIN + REGION + COUNTRY */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <Field label="LinkedIn URL" className="md:col-span-2">
                <Input
                  value={form.linkedin_url}
                  onChange={(e) =>
                    setForm({ ...form, linkedin_url: e.target.value })
                  }
                />
              </Field>

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
            </div>

            {/* ORGANIZATION (SEARCHABLE INPUT) */}
            <Field label="Organization">
              <div ref={orgRef} className="relative">
                <Input
                  placeholder="Search organization..."
                  value={orgOpen ? orgSearch : selectedOrgName}
                  onFocus={() => {
                    setOrgOpen(true);
                    setOrgSearch("");
                  }}
                  onChange={(e) => {
                    setOrgSearch(e.target.value);
                    setOrgOpen(true);
                    setSelectedOrgName("");
                    setForm({ ...form, organization_id: "" });
                  }}
                />

                {orgOpen && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border border-zinc-800 bg-neutral-900 shadow-lg">
                    <div className="max-h-48 overflow-y-auto">
                      {filteredOrgs.length === 0 ? (
                        <div
                          key="no-orgs"
                          className="px-3 py-2 text-sm text-zinc-400"
                        >
                          No organizations found
                        </div>
                      ) : (
                        filteredOrgs.map((o) => (
                          <div
                            key={o.id}
                            onMouseDown={() => {
                              setForm({
                                ...form,
                                organization_id: o.id,
                              });
                              setSelectedOrgName(o.name);
                              setOrgSearch("");
                              setOrgOpen(false);
                            }}
                            className="px-3 py-2 text-sm cursor-pointer hover:bg-neutral-800"
                          >
                            {o.name}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Field>
          </div>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              onClick={submit}
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
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
