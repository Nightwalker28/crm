"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBackdrop, DialogFooter, DialogHeader, DialogPanel, DialogTitle } from "@/components/ui/dialog";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch, SwitchThumb } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api";

type LeadConversionResult = {
  account_id?: number | null;
  contact_id?: number | null;
  deal_id?: number | null;
  created_account: boolean;
  created_contact: boolean;
  created_deal: boolean;
};

type Props = {
  leadId: number;
  leadName: string;
  company?: string | null;
  isOpen: boolean;
  onClose: () => void;
  onConverted: () => void;
};

const DEAL_STAGES = [
  { value: "qualified", label: "Qualified" },
  { value: "proposal", label: "Proposal" },
  { value: "negotiation", label: "Negotiation" },
  { value: "closed_won", label: "Closed Won" },
  { value: "closed_lost", label: "Closed Lost" },
];

export default function ConvertLeadDialog({ leadId, leadName, company, isOpen, onClose, onConverted }: Props) {
  const [createAccount, setCreateAccount] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [createContact, setCreateContact] = useState(true);
  const [contactId, setContactId] = useState("");
  const [createDeal, setCreateDeal] = useState(false);
  const [dealName, setDealName] = useState("");
  const [dealStage, setDealStage] = useState("qualified");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LeadConversionResult | null>(null);

  const defaultDealName = useMemo(() => `${company || leadName} opportunity`, [company, leadName]);
  const canSubmit = !submitting && (createContact || contactId.trim() || !createDeal);

  function resetAndClose() {
    setError(null);
    setResult(null);
    onClose();
  }

  async function submit() {
    try {
      setSubmitting(true);
      setError(null);
      const payload = {
        create_account: createAccount,
        account_id: createAccount || !accountId.trim() ? null : Number(accountId),
        create_contact: createContact,
        contact_id: createContact || !contactId.trim() ? null : Number(contactId),
        create_deal: createDeal,
        deal_name: createDeal ? (dealName.trim() || defaultDealName) : null,
        deal_stage: createDeal ? dealStage : null,
      };
      const res = await apiFetch(`/sales/leads/${leadId}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      setResult(body as LeadConversionResult);
      toast.success("Lead converted.");
      onConverted();
    } catch (conversionError) {
      setError(conversionError instanceof Error ? conversionError.message : "Failed to convert lead");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={isOpen} onClose={resetAndClose}>
      <DialogBackdrop />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel size="2xl">
          <DialogHeader>
            <DialogTitle>Convert Lead</DialogTitle>
            <DialogIconClose />
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {error ? <div className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</div> : null}
            {result ? (
              <div className="rounded-md border border-emerald-800 bg-emerald-950/30 px-3 py-3 text-sm text-emerald-100">
                <div className="font-medium">Conversion complete</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {result.account_id ? <Button asChild size="sm" variant="outline"><Link href={`/dashboard/sales/organizations/${result.account_id}`}>Account #{result.account_id}</Link></Button> : null}
                  {result.contact_id ? <Button asChild size="sm" variant="outline"><Link href={`/dashboard/sales/contacts/${result.contact_id}`}>Contact #{result.contact_id}</Link></Button> : null}
                  {result.deal_id ? <Button asChild size="sm" variant="outline"><Link href={`/dashboard/sales/opportunities/${result.deal_id}`}>Deal #{result.deal_id}</Link></Button> : null}
                </div>
              </div>
            ) : null}

            <ToggleRow
              label="Create account"
              description={company ? `Uses ${company}. Existing accounts with the same name are reused.` : "Uses the lead name when no company is present."}
              checked={createAccount}
              onCheckedChange={setCreateAccount}
            />
            {!createAccount ? (
              <Field>
                <FieldLabel>Existing account ID</FieldLabel>
                <Input inputMode="numeric" value={accountId} onChange={(event) => setAccountId(event.target.value)} />
              </Field>
            ) : null}

            <ToggleRow
              label="Create contact"
              description="Existing contacts with the same email are reused."
              checked={createContact}
              onCheckedChange={setCreateContact}
            />
            {!createContact ? (
              <Field>
                <FieldLabel>Existing contact ID</FieldLabel>
                <Input inputMode="numeric" value={contactId} onChange={(event) => setContactId(event.target.value)} />
              </Field>
            ) : null}

            <ToggleRow
              label="Create deal"
              description="Creates an opportunity linked to the converted contact and account."
              checked={createDeal}
              onCheckedChange={setCreateDeal}
            />
            {createDeal ? (
              <div className="grid gap-3 md:grid-cols-2">
                <Field>
                  <FieldLabel>Deal name</FieldLabel>
                  <Input value={dealName} onChange={(event) => setDealName(event.target.value)} placeholder={defaultDealName} />
                </Field>
                <Field>
                  <FieldLabel>Initial stage</FieldLabel>
                  <Select value={dealStage} onValueChange={setDealStage}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DEAL_STAGES.map((stage) => <SelectItem key={stage.value} value={stage.value}>{stage.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            ) : null}
          </div>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={resetAndClose}>Close</Button>
            <Button onClick={() => void submit()} disabled={!canSubmit || Boolean(result)}>
              <ArrowRightLeft />{submitting ? "Converting..." : "Convert"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

function ToggleRow({ label, description, checked, onCheckedChange }: { label: string; description: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-3">
      <div>
        <div className="text-sm font-medium text-neutral-100">{label}</div>
        <FieldDescription className="mt-1">{description}</FieldDescription>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="relative h-6 w-11 shrink-0 rounded-full border border-neutral-700 bg-neutral-800 data-[state=checked]:bg-emerald-600"
      >
        <SwitchThumb className="block h-5 w-5 rounded-full bg-white shadow-sm data-[state=checked]:translate-x-5" />
      </Switch>
    </div>
  );
}
