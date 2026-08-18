"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, UserRoundCheck, UsersRound } from "lucide-react";
import { toast } from "sonner";

import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import { ReadOnlyRecordLayout } from "@/components/forms/ReadOnlyRecordLayout";
import RecordAuditHistory, {
  type RecordModuleEvent,
} from "@/components/recordActivity/RecordAuditHistory";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import RecordTimeline from "@/components/recordActivity/RecordTimeline";
import {
  RecordWorkspace,
  recordEditHref,
} from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InlineFieldEdit, type InlineFieldEditOption } from "@/components/ui/InlineFieldEdit";
import { Input } from "@/components/ui/input";
import { PanelError, PanelLoading } from "@/components/ui/PanelStates";
import {
  RecordSpine,
  RecordSpineBlock,
  RecordSpineField,
  RecordSpineLink,
  RecordSpineMeta,
  RecordSpineTrack,
} from "@/components/ui/RecordSpine";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { RouteNotFoundState } from "@/components/ui/RouteStates";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusValue } from "@/components/ui/StatusValue";
import type { Contract } from "@/hooks/contracts/useContracts";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
import {
  useResolvedRecordLayout,
  type ResolvedRecordLayout as ResolvedRecordLayoutContract,
} from "@/hooks/useResolvedRecordLayout";
import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/currency";
import { formatDateTime } from "@/lib/datetime";
import { getContractStatus } from "@/lib/statusStyles";

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

const CONTRACT_STATUS_OPTIONS: InlineFieldEditOption[] = CONTRACT_STATUSES.map(({ value }) => ({
  value,
  ...getContractStatus(value),
}));

const SIGNER_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "sent", label: "Sent" },
  { value: "viewed", label: "Viewed" },
  { value: "signed", label: "Signed" },
  { value: "declined", label: "Declined" },
  { value: "voided", label: "Voided" },
];

/**
 * The track is the agreement's pipeline. `expired` and `cancelled` leave it rather than
 * complete it, so neither is a step — the same rule the lead and deal tracks follow.
 */
const CONTRACT_TRACK_VALUES = ["draft", "review", "sent", "partially_signed", "signed", "active"] as const;

const CONTRACT_TRACK_STEPS = CONTRACT_TRACK_VALUES.map((value) => ({
  id: value,
  label: statusLabel(value),
}));

/**
 * Fields `Details` must not draw a second time (design.md §4.7): the spine owns status and
 * owner, and the header owns the contract number — it is the record's name.
 */
const SPINE_OWNED_FIELDS = ["contract_number", "status", "owner_id"] as const;

const INITIAL_PARTY_FORM = { name: "", email: "", role: "counterparty" };
const INITIAL_SIGNER_FORM = { party_id: "none", name: "", email: "", signing_order: "1", status: "pending" };

class ContractRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function fetchContract(contractId: string) {
  const res = await apiFetch(`/contracts/${contractId}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ContractRequestError(body?.detail ?? "We could not load this contract.", res.status);
  }
  return body as Contract;
}

export default function ContractDetailPage() {
  const params = useParams<{ contractId: string }>();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const { modules } = useAccessibleModules();
  const activeTab = searchParams.get("tab");

  const moduleActions = (moduleKey: string) =>
    modules.find((module) => module.name === moduleKey)?.actions;
  const contractActions = moduleActions("contracts");
  const taskActions = moduleActions("tasks");
  const documentActions = moduleActions("documents");
  const canEdit = Boolean(contractActions?.can_edit);
  const canViewTasks = Boolean(taskActions?.can_view);
  const canCreateTasks = Boolean(taskActions?.can_create);
  const canEditTasks = Boolean(taskActions?.can_edit);
  const canViewDocuments = Boolean(documentActions?.can_view);
  const canCreateDocuments = Boolean(documentActions?.can_create);
  const canEditDocuments = Boolean(documentActions?.can_edit);
  const canDeleteDocuments = Boolean(documentActions?.can_delete);

  const contractQuery = useQuery({
    queryKey: ["contract", params.contractId],
    queryFn: () => fetchContract(params.contractId),
    enabled: Boolean(params.contractId),
    refetchOnWindowFocus: false,
  });
  const detailLayoutQuery = useResolvedRecordLayout("contracts", "detail");

  const item = contractQuery.data ?? null;
  const contractError = contractQuery.error;
  const notFound = contractError instanceof ContractRequestError && contractError.status === 404;
  const contractName = item?.contract_number || "Contract";
  const recordHref = `/dashboard/contracts/${params.contractId}`;

  async function confirmStatusChange(next: InlineFieldEditOption) {
    if (!item) return false;
    return confirm({
      title: "Change contract status?",
      description: `Move ${item.contract_number} from ${statusLabel(item.status)} to ${next.label}? This change is recorded in the contract's history.`,
      confirmLabel: "Change status",
    });
  }

  /** R1's autosave, behind the confirm `InlineFieldEdit` supports for a side-effecting field. */
  async function updateStatus(next: string) {
    const res = await apiFetch(`/contracts/${params.contractId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) throw new Error("Contract status update failed");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["contracts"] }),
      queryClient.invalidateQueries({ queryKey: ["contract-edit", params.contractId] }),
      queryClient.invalidateQueries({
        queryKey: ["record-audit-history", "contracts", params.contractId],
      }),
      contractQuery.refetch(),
    ]);
  }

  return (
    <RecordWorkspace
      title={contractName}
      description="Review the agreement's lifecycle, linked CRM records, signing progress, and activity."
      backHref="/dashboard/contracts"
      backLabel="Contracts"
      isPermissionDenied={contractError instanceof ContractRequestError && contractError.status === 403}
      isLoading={contractQuery.isLoading || (!item && !contractError)}
      hasError={Boolean(contractError)}
      onRetry={() => void contractQuery.refetch()}
      errorState={notFound ? (
        <RouteNotFoundState
          titleAs="p"
          recordLabel="Contract"
          backHref="/dashboard/contracts"
          backLabel="Back to contracts"
        />
      ) : undefined}
      status={item ? <ContractStatus status={item.status} /> : null}
      subtitle={item ? (
        <>
          <span>{item.title}</span>
          {formatMoney(item.value_amount, item.currency) ? (
            <span>{formatMoney(item.value_amount, item.currency)}</span>
          ) : null}
        </>
      ) : null}
      actions={item && canEdit ? (
        <Button asChild variant="outline">
          <Link href={recordEditHref(`${recordHref}/edit`, activeTab)}>
            <Pencil />
            Edit
          </Link>
        </Button>
      ) : null}
      spine={
        <RecordSpine>
          {item ? (
            <>
              {CONTRACT_TRACK_VALUES.includes(item.status as (typeof CONTRACT_TRACK_VALUES)[number]) ? (
                <RecordSpineTrack
                  steps={CONTRACT_TRACK_STEPS}
                  currentId={item.status}
                  label="Contract lifecycle"
                />
              ) : null}

              <RecordSpineBlock title="State">
                <RecordSpineField label="Status">
                  {canEdit ? (
                    <InlineFieldEdit
                      fieldLabel="Status"
                      value={item.status}
                      options={CONTRACT_STATUS_OPTIONS}
                      confirm={confirmStatusChange}
                      onCommit={(next) => updateStatus(next.value)}
                    />
                  ) : (
                    <ContractStatus status={item.status} />
                  )}
                </RecordSpineField>
              </RecordSpineBlock>

              {/* Six relationships, every one of which rendered as `Contact #12` before the
                  service started resolving names. A link labelled with an id is a link the
                  operator has to follow to find out where it goes. */}
              <RecordSpineBlock title="Connected">
                <RecordSpineLink label="Owner" value={item.owner_name} />
                <RecordSpineLink
                  label="Contact"
                  value={item.contact_name}
                  href={item.contact_id ? `/dashboard/sales/contacts/${item.contact_id}` : null}
                />
                <RecordSpineLink
                  label="Account"
                  value={item.organization_name}
                  href={item.organization_id ? `/dashboard/sales/organizations/${item.organization_id}` : null}
                />
                <RecordSpineLink
                  label="Deal"
                  value={item.opportunity_name}
                  href={item.opportunity_id ? `/dashboard/sales/opportunities/${item.opportunity_id}` : null}
                />
                <RecordSpineLink
                  label="Quote"
                  value={item.quote_number}
                  href={item.quote_id ? `/dashboard/sales/quotes/${item.quote_id}` : null}
                />
                <RecordSpineLink
                  label="Order"
                  value={item.order_number}
                  href={item.order_id ? `/dashboard/sales/orders/${item.order_id}` : null}
                />
                <RecordSpineLink
                  label="Document"
                  value={item.document_name}
                  href={item.document_id ? "/dashboard/documents" : null}
                />
              </RecordSpineBlock>

              <RecordSpineMeta
                createdLabel={`Created ${formatDateTime(item.created_at)}`}
                updatedLabel={`Updated ${formatDateTime(item.updated_at)}`}
                history={
                  <RecordAuditHistory
                    moduleKey="contracts"
                    entityId={item.id}
                    // The contract's own event log, merged rather than drawn as an `Events`
                    // card at the foot of the page (§4.7). It is the half that sees a party
                    // added and a signer sign, which `activity_logs` never records.
                    moduleEvents={contractEvents(item)}
                  />
                }
              />
            </>
          ) : null}
        </RecordSpine>
      }
      details={item ? (
        <ContractOverview
          contract={item}
          layout={detailLayoutQuery.data}
          isLayoutLoading={detailLayoutQuery.isLoading}
          layoutError={detailLayoutQuery.error}
          onRetryLayout={() => void detailLayoutQuery.refetch()}
        />
      ) : null}
      timeline={item ? (
        // Note-only: a contract has no follow-up endpoint, and inventing channels here would
        // offer the operator buttons that post nowhere. You call the contact, from the contact.
        <RecordTimeline moduleKey="contracts" entityId={item.id} canEdit={canEdit} />
      ) : undefined}
      tasks={item && canViewTasks ? (
        <RecordTasksPanel
          moduleKey="contracts"
          entityId={item.id}
          sourceLabel={contractName}
          canCreate={canCreateTasks}
          canEdit={canEditTasks}
          createActionVariant="outline"
        />
      ) : undefined}
      files={item && canViewDocuments ? (
        <RecordDocumentsPanel
          moduleKey="contracts"
          entityId={item.id}
          canUpload={canCreateDocuments && canEdit}
          canEdit={canEditDocuments && canEdit}
          canDelete={canDeleteDocuments && canEdit}
        />
      ) : undefined}
      extraTabs={item ? [
        {
          id: "signing",
          label: "Signing",
          content: (
            <SigningPanel
              contract={item}
              canEdit={canEdit}
              onChanged={() => void contractQuery.refetch()}
            />
          ),
        },
      ] : []}
    />
  );
}

/**
 * Parties and signers — related objects, so they live in the content region with their own
 * create affordances (§4.7's spine test: they are rows pointing at the contract, not columns
 * on it).
 */
function SigningPanel({
  contract,
  canEdit,
  onChanged,
}: {
  contract: Contract;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [partySaving, setPartySaving] = useState(false);
  const [signerSaving, setSignerSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partyForm, setPartyForm] = useState(INITIAL_PARTY_FORM);
  const [signerForm, setSignerForm] = useState(INITIAL_SIGNER_FORM);
  // Only the rows the operator has touched. An unset row reads its status from the record, so
  // there is no effect mirroring props into state and no stale draft after a refetch.
  const [signerStatusDrafts, setSignerStatusDrafts] = useState<Record<number, string>>({});

  async function addParty() {
    if (!canEdit || !partyForm.name.trim() || partySaving) return;
    try {
      setPartySaving(true);
      setError(null);
      const res = await apiFetch(`/contracts/${contract.id}/parties`, {
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
      onChanged();
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
      const res = await apiFetch(`/contracts/${contract.id}/signers`, {
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
      onChanged();
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
      const res = await apiFetch(`/contracts/${contract.id}/signers/${signerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error("Signer update failed");
      setSignerStatusDrafts((current) => {
        const rest = { ...current };
        delete rest[signerId];
        return rest;
      });
      onChanged();
      toast.success("Signer updated.");
    } catch {
      setError("We could not update this signer. Try again.");
    } finally {
      setSignerSaving(false);
    }
  }

  return (
    <div className="grid gap-4">
      {error ? (
        <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          {error}
        </div>
      ) : null}

      <Card className="px-5 py-5">
        <SectionHeading>Parties</SectionHeading>
        <div className="mt-4">
          {(contract.parties ?? []).length ? (
            <div className="divide-y divide-line-subtle">
              {contract.parties?.map((party) => (
                <div key={party.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="text-sm font-medium text-copy-primary">{party.name}</div>
                  <div className="mt-1 text-xs text-copy-muted">
                    {party.role}
                    {party.email ? ` · ${party.email}` : ""}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={UsersRound}
              title="No parties yet"
              description="Organizations and people represented in the agreement will appear here."
            />
          )}
        </div>
        {canEdit ? (
          <div className="mt-5 border-t border-line-subtle pt-5">
            <SectionHeading as="h3">Add party</SectionHeading>
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
              {partySaving ? "Saving…" : "Add party"}
            </Button>
          </div>
        ) : null}
      </Card>

      <Card className="px-5 py-5">
        <SectionHeading>Signers</SectionHeading>
        <div className="mt-4">
          {(contract.signers ?? []).length ? (
            <div className="divide-y divide-line-subtle">
              {contract.signers?.map((signer) => (
                <div key={signer.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-copy-primary">{signer.name}</div>
                    <div className="mt-1 break-words text-xs text-copy-muted">
                      {signer.email} · Order {signer.signing_order}
                      {signer.signed_at ? ` · Signed ${formatDateTime(signer.signed_at)}` : ""}
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
                    <ContractStatus status={signer.status} />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={UserRoundCheck}
              title="No signers yet"
              description="Signing order and signature progress will appear here."
            />
          )}
        </div>
        {canEdit ? (
          <div className="mt-5 border-t border-line-subtle pt-5">
            <SectionHeading as="h3">Add signer</SectionHeading>
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
                    {(contract.parties ?? []).map((party) => <SelectItem key={party.id} value={String(party.id)}>{party.name}</SelectItem>)}
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
              {signerSaving ? "Saving…" : "Add signer"}
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function ContractOverview({
  contract,
  layout,
  isLayoutLoading,
  layoutError,
  onRetryLayout,
}: {
  contract: Contract;
  layout?: ResolvedRecordLayoutContract;
  isLayoutLoading: boolean;
  layoutError: Error | null;
  onRetryLayout: () => void;
}) {
  if (isLayoutLoading || !layout) {
    return (
      <Card className="px-5 py-5">
        {layoutError ? (
          <PanelError message="The contract details layout could not be loaded." onRetry={onRetryLayout} />
        ) : (
          <PanelLoading label="Loading contract details…" />
        )}
      </Card>
    );
  }

  return (
    <ReadOnlyRecordLayout
      layout={layout}
      values={contract as unknown as Record<string, unknown>}
      omitFieldKeys={SPINE_OWNED_FIELDS}
      renderValue={(field, value) =>
        field.field_key === "value_amount"
          ? formatMoney(value as string | number | null, contract.currency) ?? undefined
          : undefined
      }
    />
  );
}

/** The contract's own event log, in the shape the History sheet merges (design.md §4.7). */
function contractEvents(contract: Contract): RecordModuleEvent[] {
  return (contract.events ?? []).map((event) => ({
    id: String(event.id),
    occurredAt: event.created_at,
    label: statusLabel(event.event_type),
    // No actor is a system event; an actor the service could not resolve is a user who has
    // since been removed, which is not the same thing and does not read as one.
    detail: event.created_by_id ? event.created_by_name ?? "Unknown user" : "System",
  }));
}

function statusLabel(status: string) {
  return [...CONTRACT_STATUSES, ...SIGNER_STATUSES].find((option) => option.value === status)?.label
    ?? status.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function ContractStatus({ status }: { status: string }) {
  return <StatusValue status={{ ...getContractStatus(status), label: statusLabel(status) }} context="record" />;
}
