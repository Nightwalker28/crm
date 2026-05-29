"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Contract } from "@/hooks/contracts/useContracts";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

const CONTRACT_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "review", label: "Review" },
  { value: "sent", label: "Sent" },
  { value: "partially_signed", label: "Partially Signed" },
  { value: "signed", label: "Signed" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

const SIGNER_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "sent", label: "Sent" },
  { value: "viewed", label: "Viewed" },
  { value: "signed", label: "Signed" },
  { value: "declined", label: "Declined" },
  { value: "voided", label: "Voided" },
];

const INITIAL_PARTY_FORM = { name: "", email: "", role: "counterparty" };
const INITIAL_SIGNER_FORM = { party_id: "none", name: "", email: "", signing_order: "1", status: "pending" };

export default function ContractDetailPage() {
  const params = useParams<{ contractId: string }>();
  const queryClient = useQueryClient();
  const [item, setItem] = useState<Contract | null>(null);
  const [status, setStatus] = useState("draft");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [partySaving, setPartySaving] = useState(false);
  const [signerSaving, setSignerSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partyForm, setPartyForm] = useState(INITIAL_PARTY_FORM);
  const [signerForm, setSignerForm] = useState(INITIAL_SIGNER_FORM);
  const [signerStatusDrafts, setSignerStatusDrafts] = useState<Record<number, string>>({});

  async function loadContract(signal?: { cancelled: boolean }) {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/contracts/${params.contractId}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      if (signal?.cancelled) return;
      setItem(body);
      setStatus(body.status ?? "draft");
      setSignerStatusDrafts(Object.fromEntries((body.signers ?? []).map((signer: { id: number; status: string }) => [signer.id, signer.status])));
    } catch (loadError) {
      if (!signal?.cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load contract");
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }

  useEffect(() => {
    const signal = { cancelled: false };
    void loadContract(signal);
    return () => {
      signal.cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.contractId]);

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
      const res = await apiFetch(`/contracts/${params.contractId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      setItem(body);
      await queryClient.invalidateQueries({ queryKey: ["contracts"] });
      toast.success("Contract updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update contract");
    } finally {
      setSaving(false);
    }
  }

  async function addParty() {
    if (!partyForm.name.trim() || partySaving) return;
    try {
      setPartySaving(true);
      setError(null);
      const res = await apiFetch(`/contracts/${params.contractId}/parties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: partyForm.name.trim(),
          email: partyForm.email.trim() || null,
          role: partyForm.role.trim() || "counterparty",
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      setPartyForm(INITIAL_PARTY_FORM);
      await loadContract();
      toast.success("Contract party added.");
    } catch (partyError) {
      setError(partyError instanceof Error ? partyError.message : "Failed to add party");
    } finally {
      setPartySaving(false);
    }
  }

  async function addSigner() {
    if (!signerForm.name.trim() || !signerForm.email.trim() || signerSaving) return;
    try {
      setSignerSaving(true);
      setError(null);
      const res = await apiFetch(`/contracts/${params.contractId}/signers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          party_id: signerForm.party_id === "none" ? null : Number(signerForm.party_id),
          name: signerForm.name.trim(),
          email: signerForm.email.trim(),
          signing_order: Number(signerForm.signing_order) || 1,
          status: signerForm.status,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      setSignerForm(INITIAL_SIGNER_FORM);
      await loadContract();
      toast.success("Signer added.");
    } catch (signerError) {
      setError(signerError instanceof Error ? signerError.message : "Failed to add signer");
    } finally {
      setSignerSaving(false);
    }
  }

  async function updateSignerStatus(signerId: number) {
    const nextStatus = signerStatusDrafts[signerId];
    if (!nextStatus) return;
    try {
      setSignerSaving(true);
      setError(null);
      const res = await apiFetch(`/contracts/${params.contractId}/signers/${signerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      await loadContract();
      toast.success("Signer updated.");
    } catch (signerError) {
      setError(signerError instanceof Error ? signerError.message : "Failed to update signer");
    } finally {
      setSignerSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <RecordPageHeader
        backHref="/dashboard/contracts"
        backLabel="Back to Contracts"
        title={item ? item.contract_number : "Contract"}
        description={item?.title ?? "Review contract lifecycle, related CRM records, parties, signers, and events."}
        primaryAction={<Button onClick={handleSave} disabled={saving || loading}>{saving ? "Saving..." : "Save Contract"}</Button>}
      />

      {error ? <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}

      {loading || !item ? (
        <Card className="px-5 py-5 text-sm text-neutral-500">Loading contract...</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
          <Card className="px-5 py-5">
            <h2 className="text-lg font-semibold text-neutral-100">Contract Details</h2>
            <FieldDescription className="mt-1">Move the contract through drafting, review, signature, activation, and renewal.</FieldDescription>
            <FieldGroup className="mt-4 grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>Status</FieldLabel>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CONTRACT_STATUSES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <SummaryTile label="Owner" value={item.owner_id ? `User #${item.owner_id}` : "Unassigned"} />
              <SummaryTile label="Value" value={formatMoney(item.value_amount, item.currency)} />
              <SummaryTile label="Effective" value={item.effective_date ?? "-"} />
              <SummaryTile label="Expires" value={item.expiration_date ?? "-"} />
              <SummaryTile label="Renewal" value={item.renewal_date ?? "-"} />
              <SummaryTile label="Created" value={formatDateTime(item.created_at)} />
              <SummaryTile label="Updated" value={formatDateTime(item.updated_at)} />
            </FieldGroup>
          </Card>

          <Card className="px-5 py-5">
            <h2 className="text-lg font-semibold text-neutral-100">Related Records</h2>
            <div className="mt-4 grid gap-3">
              <LinkedTile label="Contact" value={item.contact_id ? `Contact #${item.contact_id}` : "No contact"} href={item.contact_id ? `/dashboard/sales/contacts/${item.contact_id}` : null} />
              <LinkedTile label="Account" value={item.organization_id ? `Account #${item.organization_id}` : "No account"} href={item.organization_id ? `/dashboard/sales/organizations/${item.organization_id}` : null} />
              <LinkedTile label="Deal" value={item.opportunity_id ? `Deal #${item.opportunity_id}` : "No deal"} href={item.opportunity_id ? `/dashboard/sales/opportunities/${item.opportunity_id}` : null} />
              <LinkedTile label="Quote" value={item.quote_id ? `Quote #${item.quote_id}` : "No quote"} href={item.quote_id ? `/dashboard/sales/quotes/${item.quote_id}` : null} />
              <LinkedTile label="Order" value={item.order_id ? `Order #${item.order_id}` : "No order"} href={item.order_id ? `/dashboard/sales/orders/${item.order_id}` : null} />
              <LinkedTile label="Document" value={item.document_id ? `Document #${item.document_id}` : "No document"} href={item.document_id ? "/dashboard/documents" : null} />
            </div>
          </Card>

          <Card className="px-5 py-5">
            <h2 className="text-lg font-semibold text-neutral-100">Parties</h2>
            <div className="mt-4 grid gap-3">
              {(item.parties ?? []).length ? item.parties?.map((party) => (
                <div key={party.id} className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-3">
                  <div className="text-sm font-medium text-neutral-100">{party.name}</div>
                  <div className="mt-1 text-xs text-neutral-500">{party.role}{party.email ? ` · ${party.email}` : ""}</div>
                </div>
              )) : <div className="text-sm text-neutral-500">No parties yet.</div>}
            </div>
            <FieldGroup className="mt-4 grid gap-3 md:grid-cols-3">
              <Field>
                <FieldLabel>Name <RequiredMark /></FieldLabel>
                <Input value={partyForm.name} onChange={(event) => setPartyForm((current) => ({ ...current, name: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Email</FieldLabel>
                <Input type="email" value={partyForm.email} onChange={(event) => setPartyForm((current) => ({ ...current, email: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Role</FieldLabel>
                <Input value={partyForm.role} onChange={(event) => setPartyForm((current) => ({ ...current, role: event.target.value }))} />
              </Field>
            </FieldGroup>
            <Button onClick={addParty} disabled={!partyForm.name.trim() || partySaving} className="mt-3 w-fit">{partySaving ? "Adding..." : "Add Party"}</Button>
          </Card>

          <Card className="px-5 py-5">
            <h2 className="text-lg font-semibold text-neutral-100">Signers</h2>
            <div className="mt-4 grid gap-3">
              {(item.signers ?? []).length ? item.signers?.map((signer) => (
                <div key={signer.id} className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-medium text-neutral-100">{signer.name}</div>
                      <div className="mt-1 text-xs text-neutral-500">{signer.email} · Order {signer.signing_order}{signer.signed_at ? ` · Signed ${formatDateTime(signer.signed_at)}` : ""}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select value={signerStatusDrafts[signer.id] ?? signer.status} onValueChange={(value) => setSignerStatusDrafts((current) => ({ ...current, [signer.id]: value }))}>
                        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>{SIGNER_STATUSES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" onClick={() => updateSignerStatus(signer.id)} disabled={signerSaving}>Update</Button>
                    </div>
                  </div>
                </div>
              )) : <div className="text-sm text-neutral-500">No signers yet.</div>}
            </div>
            <FieldGroup className="mt-4 grid gap-3 md:grid-cols-2">
              <Field>
                <FieldLabel>Name <RequiredMark /></FieldLabel>
                <Input value={signerForm.name} onChange={(event) => setSignerForm((current) => ({ ...current, name: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Email <RequiredMark /></FieldLabel>
                <Input type="email" value={signerForm.email} onChange={(event) => setSignerForm((current) => ({ ...current, email: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Party</FieldLabel>
                <Select value={signerForm.party_id} onValueChange={(value) => setSignerForm((current) => ({ ...current, party_id: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No party</SelectItem>
                    {(item.parties ?? []).map((party) => <SelectItem key={party.id} value={String(party.id)}>{party.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Signing Order</FieldLabel>
                <Input type="number" min="1" value={signerForm.signing_order} onChange={(event) => setSignerForm((current) => ({ ...current, signing_order: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Status</FieldLabel>
                <Select value={signerForm.status} onValueChange={(value) => setSignerForm((current) => ({ ...current, status: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SIGNER_STATUSES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            <Button onClick={addSigner} disabled={!signerForm.name.trim() || !signerForm.email.trim() || signerSaving} className="mt-3 w-fit">{signerSaving ? "Adding..." : "Add Signer"}</Button>
          </Card>

          <Card className="px-5 py-5 lg:col-span-2">
            <h2 className="text-lg font-semibold text-neutral-100">Events</h2>
            <div className="mt-4 grid gap-3">
              {(item.events ?? []).length ? item.events?.map((event) => (
                <div key={event.id} className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-3">
                  <div className="text-sm font-medium text-neutral-200">{event.event_type.replace(/_/g, " ")}</div>
                  <div className="mt-1 text-xs text-neutral-500">{formatDateTime(event.created_at)}{event.created_by_id ? ` · User #${event.created_by_id}` : ""}</div>
                </div>
              )) : <div className="text-sm text-neutral-500">No events yet.</div>}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function formatMoney(value: Contract["value_amount"], currency: string | null) {
  if (value === null || value === undefined || value === "") return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return `${currency || "USD"} ${numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-2 text-sm text-neutral-100">{value}</div>
    </div>
  );
}

function LinkedTile({ label, value, href }: { label: string; value: string; href: string | null }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-2 text-sm text-neutral-100">
        {href ? <Link href={href} className="hover:text-white">{value}</Link> : value}
      </div>
    </div>
  );
}
