"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Pencil, UserRoundCheck, UsersRound } from "lucide-react";
import { toast } from "sonner";

import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { PageShell } from "@/components/ui/PageShell";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/Pill";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Contract } from "@/hooks/contracts/useContracts";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
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

async function fetchContract(contractId: string) {
  const res = await apiFetch(`/contracts/${contractId}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error("We could not load this contract.");
  return body as Contract;
}

export default function ContractDetailPage() {
  const params = useParams<{ contractId: string }>();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const { modules } = useAccessibleModules();
  const [status, setStatus] = useState("draft");
  const [saving, setSaving] = useState(false);
  const [partySaving, setPartySaving] = useState(false);
  const [signerSaving, setSignerSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partyForm, setPartyForm] = useState(INITIAL_PARTY_FORM);
  const [signerForm, setSignerForm] = useState(INITIAL_SIGNER_FORM);
  const [signerStatusDrafts, setSignerStatusDrafts] = useState<Record<number, string>>({});

  const contractQuery = useQuery({
    queryKey: ["contract", params.contractId],
    queryFn: () => fetchContract(params.contractId),
    enabled: Boolean(params.contractId),
    refetchOnWindowFocus: false,
  });
  const item = contractQuery.data ?? null;
  const canEdit = Boolean(modules.find((module) => module.name === "contracts")?.actions?.can_edit);

  useEffect(() => {
    if (!item) return;
    setError(null);
    setStatus(item.status ?? "draft");
    setSignerStatusDrafts(Object.fromEntries((item.signers ?? []).map((signer) => [signer.id, signer.status])));
  }, [item]);

  async function handleSaveStatus() {
    if (!item || !canEdit || status === item.status) return;
    const confirmed = await confirm({
      title: "Change contract status?",
      description: `Move ${item.contract_number} from ${statusLabel(item.status)} to ${statusLabel(status)}? This change is recorded in the contract event history.`,
      confirmLabel: "Change status",
    });
    if (!confirmed) return;
    try {
      setSaving(true);
      setError(null);
      const res = await apiFetch(`/contracts/${params.contractId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Contract status update failed");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["contracts"] }),
        queryClient.invalidateQueries({ queryKey: ["contract-edit", params.contractId] }),
        contractQuery.refetch(),
      ]);
      toast.success("Contract status updated.");
    } catch {
      setError("We could not update the contract status. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function addParty() {
    if (!canEdit || !partyForm.name.trim() || partySaving) return;
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
      if (!res.ok) throw new Error("Party creation failed");
      setPartyForm(INITIAL_PARTY_FORM);
      await contractQuery.refetch();
      toast.success("Contract party added.");
    } catch {
      setError("We could not add this party. Check the information and try again.");
    } finally {
      setPartySaving(false);
    }
  }

  async function addSigner() {
    if (!canEdit || !signerForm.name.trim() || !signerForm.email.trim() || signerSaving) return;
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
      if (!res.ok) throw new Error("Signer creation failed");
      setSignerForm(INITIAL_SIGNER_FORM);
      await contractQuery.refetch();
      toast.success("Signer added.");
    } catch {
      setError("We could not add this signer. Check the information and try again.");
    } finally {
      setSignerSaving(false);
    }
  }

  async function updateSignerStatus(signerId: number) {
    if (!canEdit) return;
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
      if (!res.ok) throw new Error("Signer update failed");
      await contractQuery.refetch();
      toast.success("Signer updated.");
    } catch {
      setError("We could not update this signer. Try again.");
    } finally {
      setSignerSaving(false);
    }
  }

  if (contractQuery.isLoading) return <RouteLoadingState label="contract" />;
  if (contractQuery.error || !item) {
    return (
      <RouteErrorState
        title="Unable to load contract"
        reset={() => void contractQuery.refetch()}
        backHref="/dashboard/contracts"
        backLabel="Back to contracts"
      />
    );
  }

  return (
    <PageShell
      title={item.contract_number}
      description={item.title ?? "Review contract lifecycle, related CRM records, parties, signers, and events."}
    >
      <RecordPageHeader
        backHref="/dashboard/contracts"
        backLabel="Back to Contracts"
        primaryAction={canEdit ? (
          <>
            <Button asChild variant="outline"><Link href={`/dashboard/contracts/${params.contractId}/edit`}><Pencil />Edit contract</Link></Button>
            <Button onClick={() => void handleSaveStatus()} disabled={saving || status === item.status}>{saving ? "Saving…" : "Save status"}</Button>
          </>
        ) : undefined}
      />

      {error ? (
        <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]">
        <Card role="region" aria-labelledby="contract-details-heading">
          <CardHeader>
            <div>
              <h2 id="contract-details-heading" className="text-lg font-semibold text-copy-primary">Contract details</h2>
              <FieldDescription className="mt-1">Lifecycle, ownership, value, and important dates.</FieldDescription>
            </div>
            <StatusPill status={item.status} />
          </CardHeader>
          <CardBody>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              {canEdit ? (
                <Field>
                  <FieldLabel htmlFor="contract-status">Status</FieldLabel>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger id="contract-status"><SelectValue /></SelectTrigger>
                    <SelectContent>{CONTRACT_STATUSES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <FieldDescription>Status changes are saved explicitly and recorded in event history.</FieldDescription>
                </Field>
              ) : null}
              <SummaryTile label="Owner" value={item.owner_id ? `User #${item.owner_id}` : "Unassigned"} />
              <SummaryTile label="Value" value={formatMoney(item.value_amount, item.currency)} />
              <SummaryTile label="Effective" value={item.effective_date ?? "Not set"} />
              <SummaryTile label="Expires" value={item.expiration_date ?? "Not set"} />
              <SummaryTile label="Renewal" value={item.renewal_date ?? "Not set"} />
              <SummaryTile label="Created" value={formatDateTime(item.created_at)} />
              <SummaryTile label="Updated" value={formatDateTime(item.updated_at)} />
            </FieldGroup>
          </CardBody>
        </Card>

        <Card role="region" aria-labelledby="contract-related-heading">
          <CardHeader>
            <div>
              <h2 id="contract-related-heading" className="text-lg font-semibold text-copy-primary">Related records</h2>
              <FieldDescription className="mt-1">CRM records connected to this agreement.</FieldDescription>
            </div>
          </CardHeader>
          <CardBody className="pt-4">
            <div className="mt-4 grid gap-3">
              <LinkedTile label="Contact" value={item.contact_id ? `Contact #${item.contact_id}` : "No contact"} href={item.contact_id ? `/dashboard/sales/contacts/${item.contact_id}` : null} />
              <LinkedTile label="Account" value={item.organization_id ? `Account #${item.organization_id}` : "No account"} href={item.organization_id ? `/dashboard/sales/organizations/${item.organization_id}` : null} />
              <LinkedTile label="Deal" value={item.opportunity_id ? `Deal #${item.opportunity_id}` : "No deal"} href={item.opportunity_id ? `/dashboard/sales/opportunities/${item.opportunity_id}` : null} />
              <LinkedTile label="Quote" value={item.quote_id ? `Quote #${item.quote_id}` : "No quote"} href={item.quote_id ? `/dashboard/sales/quotes/${item.quote_id}` : null} />
              <LinkedTile label="Order" value={item.order_id ? `Order #${item.order_id}` : "No order"} href={item.order_id ? `/dashboard/sales/orders/${item.order_id}` : null} />
              <LinkedTile label="Document" value={item.document_id ? `Document #${item.document_id}` : "No document"} href={item.document_id ? "/dashboard/documents" : null} />
            </div>
          </CardBody>
        </Card>

        <Card role="region" aria-labelledby="contract-parties-heading">
          <CardHeader>
            <div>
              <h2 id="contract-parties-heading" className="text-lg font-semibold text-copy-primary">Parties</h2>
              <FieldDescription className="mt-1">Organizations and people represented in the agreement.</FieldDescription>
            </div>
          </CardHeader>
          <CardBody className="pt-4">
            {(item.parties ?? []).length ? (
              <div className="grid gap-3">
                {item.parties?.map((party) => (
                  <div key={party.id} className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-3">
                    <div className="text-sm font-medium text-copy-primary">{party.name}</div>
                    <div className="mt-1 text-xs text-copy-muted">{party.role}{party.email ? ` · ${party.email}` : ""}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={UsersRound} title="No parties yet" description="Parties added to this contract will appear here." />
            )}
            {canEdit ? (
              <div className="mt-5 border-t border-line-subtle pt-5">
                <h3 className="text-sm font-semibold text-copy-primary">Add party</h3>
                <FieldGroup className="mt-4 grid gap-3 md:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="contract-party-name">Name <RequiredMark /></FieldLabel>
                    <Input id="contract-party-name" value={partyForm.name} onChange={(event) => setPartyForm((current) => ({ ...current, name: event.target.value }))} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="contract-party-email">Email</FieldLabel>
                    <Input id="contract-party-email" type="email" value={partyForm.email} onChange={(event) => setPartyForm((current) => ({ ...current, email: event.target.value }))} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="contract-party-role">Role</FieldLabel>
                    <Input id="contract-party-role" value={partyForm.role} onChange={(event) => setPartyForm((current) => ({ ...current, role: event.target.value }))} />
                  </Field>
                </FieldGroup>
                <Button onClick={addParty} disabled={!partyForm.name.trim() || partySaving} className="mt-3 w-fit">
                  {partySaving ? "Adding…" : "Add party"}
                </Button>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card role="region" aria-labelledby="contract-signers-heading">
          <CardHeader>
            <div>
              <h2 id="contract-signers-heading" className="text-lg font-semibold text-copy-primary">Signers</h2>
              <FieldDescription className="mt-1">Signing order and current signature progress.</FieldDescription>
            </div>
          </CardHeader>
          <CardBody className="pt-4">
            {(item.signers ?? []).length ? (
              <div className="grid gap-3">
                {item.signers?.map((signer) => (
                  <div key={signer.id} className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-copy-primary">{signer.name}</div>
                        <div className="mt-1 break-words text-xs text-copy-muted">
                          {signer.email} · Order {signer.signing_order}{signer.signed_at ? ` · Signed ${formatDateTime(signer.signed_at)}` : ""}
                        </div>
                      </div>
                      {canEdit ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Select value={signerStatusDrafts[signer.id] ?? signer.status} onValueChange={(value) => setSignerStatusDrafts((current) => ({ ...current, [signer.id]: value }))}>
                            <SelectTrigger className="w-40" aria-label={`Status for ${signer.name}`}><SelectValue /></SelectTrigger>
                            <SelectContent>{SIGNER_STATUSES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateSignerStatus(signer.id)}
                            disabled={signerSaving || (signerStatusDrafts[signer.id] ?? signer.status) === signer.status}
                          >
                            Update
                          </Button>
                        </div>
                      ) : (
                        <StatusPill status={signer.status} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={UserRoundCheck} title="No signers yet" description="Signers and their progress will appear here." />
            )}
            {canEdit ? (
              <div className="mt-5 border-t border-line-subtle pt-5">
                <h3 className="text-sm font-semibold text-copy-primary">Add signer</h3>
                <FieldGroup className="mt-4 grid gap-3 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="contract-signer-name">Name <RequiredMark /></FieldLabel>
                    <Input id="contract-signer-name" value={signerForm.name} onChange={(event) => setSignerForm((current) => ({ ...current, name: event.target.value }))} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="contract-signer-email">Email <RequiredMark /></FieldLabel>
                    <Input id="contract-signer-email" type="email" value={signerForm.email} onChange={(event) => setSignerForm((current) => ({ ...current, email: event.target.value }))} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="contract-signer-party">Party</FieldLabel>
                    <Select value={signerForm.party_id} onValueChange={(value) => setSignerForm((current) => ({ ...current, party_id: value }))}>
                      <SelectTrigger id="contract-signer-party"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No party</SelectItem>
                        {(item.parties ?? []).map((party) => <SelectItem key={party.id} value={String(party.id)}>{party.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="contract-signing-order">Signing order</FieldLabel>
                    <Input id="contract-signing-order" type="number" min="1" value={signerForm.signing_order} onChange={(event) => setSignerForm((current) => ({ ...current, signing_order: event.target.value }))} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="contract-signer-status">Status</FieldLabel>
                    <Select value={signerForm.status} onValueChange={(value) => setSignerForm((current) => ({ ...current, status: value }))}>
                      <SelectTrigger id="contract-signer-status"><SelectValue /></SelectTrigger>
                      <SelectContent>{SIGNER_STATUSES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>
                <Button onClick={addSigner} disabled={!signerForm.name.trim() || !signerForm.email.trim() || signerSaving} className="mt-3 w-fit">
                  {signerSaving ? "Adding…" : "Add signer"}
                </Button>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card role="region" aria-labelledby="contract-events-heading" className="lg:col-span-2">
          <CardHeader>
            <div>
              <h2 id="contract-events-heading" className="text-lg font-semibold text-copy-primary">Events</h2>
              <FieldDescription className="mt-1">Recorded lifecycle and signature activity for this contract.</FieldDescription>
            </div>
          </CardHeader>
          <CardBody className="pt-4">
            {(item.events ?? []).length ? (
              <div className="grid gap-3">
                {item.events?.map((event) => (
                  <div key={event.id} className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-3">
                    <div className="text-sm font-medium capitalize text-copy-primary">{event.event_type.replace(/_/g, " ")}</div>
                    <div className="mt-1 text-xs text-copy-muted">
                      {formatDateTime(event.created_at)}{event.created_by_id ? ` · User #${event.created_by_id}` : " · System"}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={History} title="No events yet" description="Contract lifecycle events will appear here." />
            )}
          </CardBody>
        </Card>
      </div>
    </PageShell>
  );
}

function formatMoney(value: Contract["value_amount"], currency: string | null) {
  if (value === null || value === undefined || value === "") return "Not set";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return `${currency || "USD"} ${numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusLabel(status: string) {
  return [...CONTRACT_STATUSES, ...SIGNER_STATUSES].find((option) => option.value === status)?.label
    ?? status.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function StatusPill({ status }: { status: string }) {
  if (status === "active" || status === "signed") {
    return <Pill bg="bg-state-success-muted" text="text-state-success" border="border-state-success/40">{statusLabel(status)}</Pill>;
  }
  if (status === "cancelled" || status === "declined" || status === "voided" || status === "expired") {
    return <Pill bg="bg-state-danger-muted" text="text-state-danger" border="border-state-danger/40">{statusLabel(status)}</Pill>;
  }
  if (status === "review" || status === "sent" || status === "partially_signed" || status === "viewed") {
    return <Pill bg="bg-state-warning-muted" text="text-state-warning" border="border-state-warning/40">{statusLabel(status)}</Pill>;
  }
  return <Pill>{statusLabel(status)}</Pill>;
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-4">
      <div className="text-xs font-medium text-copy-label">{label}</div>
      <div className="mt-2 text-sm text-copy-primary">{value}</div>
    </div>
  );
}

function LinkedTile({ label, value, href }: { label: string; value: string; href: string | null }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-4">
      <div className="text-xs font-medium text-copy-label">{label}</div>
      <div className="mt-2 text-sm text-copy-primary">
        {href ? <Link href={href} className="rounded-[var(--radius-control-sm)] text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{value}</Link> : value}
      </div>
    </div>
  );
}
