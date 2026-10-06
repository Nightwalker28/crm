"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus, Star, Trash2, UserCog } from "lucide-react";
import { toast } from "sonner";

import { ContactQuickCreate } from "@/components/contacts/ContactQuickCreate";
import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { RecordRelatedCard } from "@/components/recordWorkspace/RecordRelatedList";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ListRow, RowList } from "@/components/ui/ListRow";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/hooks/useConfirm";
import { apiFetch } from "@/lib/api";

/**
 * Participant management on a deal — frontend Phase 2 of
 * `docs/crm-evolution/05-relationships-data-model.md`.
 *
 * A participant is a row that points at the deal (`sales_opportunity_contacts`), so by
 * design.md §4.7's test it is managed from the content region, beside the deal's other
 * related records — not from the spine, which owns the deal's own columns.
 *
 * Every write goes through the explicit participant routes; the server re-checks tenant,
 * deal `edit`/`delete`/`restore` and Contacts link access. The flags here only decide what is
 * drawn. Adding a person who is not in the CRM yet opens Contact Quick Create in place, with
 * the deal's account filled in, so the operator never leaves the deal to add a participant.
 */

export type OpportunityParticipant = {
  id: number;
  contact_id: number;
  role_key: string;
  role_label: string;
  is_primary: boolean;
  contact_name?: string | null;
  contact: {
    contact_id: number;
    first_name?: string | null;
    last_name?: string | null;
    primary_email?: string | null;
    contact_telephone?: string | null;
    current_title?: string | null;
    email_opt_out?: boolean | null;
  };
};

type RoleOption = { key: string; label: string };

type PanelState =
  | { mode: "closed" }
  | { mode: "add"; contactId: number | null; contactName: string }
  | { mode: "role"; participant: OpportunityParticipant };

class ParticipantRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function participantName(participant: OpportunityParticipant) {
  return (
    participant.contact_name
    || [participant.contact.first_name, participant.contact.last_name].filter(Boolean).join(" ")
    || participant.contact.primary_email
    || "Contact"
  );
}

/**
 * The server's own sentence for a 400/409 names the fix — a duplicate, a primary that needs a
 * replacement, a contact in the recycle bin — so it is shown as written. Anything else gets a
 * fixed sentence: a 500's detail is not for the operator.
 */
async function participantRequest(path: string, init?: RequestInit) {
  const res = await apiFetch(path, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = typeof body?.detail === "string" ? body.detail : null;
    let message = "The participants could not be updated. Try again.";
    if (res.status === 403) {
      message = "You do not have permission to change the people on this deal.";
    } else if ((res.status === 400 || res.status === 409 || res.status === 404) && detail) {
      message = detail;
    }
    throw new ParticipantRequestError(message, res.status);
  }
  return body;
}

function errorMessage(error: unknown) {
  return error instanceof ParticipantRequestError
    ? error.message
    : "We could not reach the server. Try again.";
}

async function fetchRoleCatalog(): Promise<RoleOption[]> {
  const body = await participantRequest("/sales/opportunities/participant-roles");
  return Array.isArray(body?.results) ? body.results : [];
}

async function fetchContactName(contactId: number) {
  try {
    const body = await participantRequest(`/sales/contacts/${contactId}`);
    return (
      [body?.first_name, body?.last_name].filter(Boolean).join(" ")
      || body?.primary_email
      || ""
    );
  } catch {
    return "";
  }
}

export function OpportunityParticipants({
  opportunityId,
  organization,
  participants,
  canManage,
  canRemove,
  canRestore,
  canCreateContact,
  onChanged,
}: {
  opportunityId: number;
  /** The deal's account, filled in on a contact created from here. */
  organization: { org_id: number; org_name: string } | null;
  participants: OpportunityParticipant[];
  /** Deal `edit` plus Contacts `view`: add, change role, make primary. */
  canManage: boolean;
  /** Deal `delete`: removal is the module's recoverable delete. */
  canRemove: boolean;
  /** Deal `restore`: the undo on a removal. */
  canRestore: boolean;
  canCreateContact: boolean;
  /** Refreshes the deal summary, which owns the participant list and the primary contact. */
  onChanged: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const addTriggerRef = useRef<HTMLButtonElement>(null);
  // Contact Quick Create reports the new id before it closes itself, so the close handler
  // needs to know it was a create rather than an abandon.
  const contactCreatedRef = useRef(false);
  const [panel, setPanel] = useState<PanelState>({ mode: "closed" });
  const [roleKey, setRoleKey] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [busyParticipantId, setBusyParticipantId] = useState<number | null>(null);
  const [contactQuickCreateOpen, setContactQuickCreateOpen] = useState(false);

  const rolesQuery = useQuery({
    queryKey: ["sales-opportunity-participant-roles"],
    queryFn: fetchRoleCatalog,
    enabled: canManage,
    staleTime: 5 * 60 * 1000,
  });
  const roles = rolesQuery.data ?? [];
  const base = `/sales/opportunities/${opportunityId}/participants`;

  async function refresh() {
    await Promise.all([
      onChanged(),
      queryClient.invalidateQueries({
        queryKey: ["record-audit-history", "sales_opportunities", String(opportunityId)],
      }),
    ]);
  }

  function openAdd(contactId: number | null = null, contactName = "") {
    setRoleKey("");
    setIsPrimary(participants.length === 0);
    setFormError(null);
    setContactError(null);
    setPanel({ mode: "add", contactId, contactName });
  }

  function openRole(participant: OpportunityParticipant) {
    setRoleKey(participant.role_key);
    setFormError(null);
    setPanel({ mode: "role", participant });
  }

  const isDirty =
    panel.mode === "add"
      ? Boolean(panel.contactId || panel.contactName || roleKey)
      : panel.mode === "role" && roleKey !== panel.participant.role_key;

  async function closePanel(force = false) {
    if (isSaving) return;
    if (!force && isDirty) {
      const discard = await confirm({
        title: "Discard this change?",
        description: "The participant has not been saved.",
        confirmLabel: "Discard",
        variant: "destructive",
      });
      if (!discard) return;
    }
    setPanel({ mode: "closed" });
  }

  async function submit() {
    if (isSaving) return;
    setFormError(null);
    if (panel.mode === "add") {
      if (!panel.contactId) {
        setContactError("Select a contact to add.");
        return;
      }
      setIsSaving(true);
      try {
        await participantRequest(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contact_id: panel.contactId,
            // An unchosen role is the catalog default on the server, not a rejection.
            role_key: roleKey || null,
            is_primary: isPrimary,
          }),
        });
        await refresh();
        toast.success(`${panel.contactName || "Contact"} added to this deal.`);
        setPanel({ mode: "closed" });
      } catch (error) {
        setFormError(errorMessage(error));
      } finally {
        setIsSaving(false);
      }
      return;
    }
    if (panel.mode === "role") {
      if (roleKey === panel.participant.role_key) {
        setPanel({ mode: "closed" });
        return;
      }
      setIsSaving(true);
      try {
        await participantRequest(`${base}/${panel.participant.id}/role`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role_key: roleKey }),
        });
        await refresh();
        toast.success(`${participantName(panel.participant)}'s role changed.`);
        setPanel({ mode: "closed" });
      } catch (error) {
        setFormError(errorMessage(error));
      } finally {
        setIsSaving(false);
      }
    }
  }

  async function makePrimary(participant: OpportunityParticipant) {
    setBusyParticipantId(participant.id);
    try {
      await participantRequest(`${base}/${participant.id}/primary`, { method: "POST" });
      await refresh();
      toast.success(`${participantName(participant)} is now the primary contact.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusyParticipantId(null);
    }
  }

  async function restore(participant: OpportunityParticipant) {
    try {
      await participantRequest(`${base}/${participant.id}/restore`, { method: "POST" });
      await refresh();
      toast.success(`${participantName(participant)} is back on this deal.`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function remove(participant: OpportunityParticipant) {
    const name = participantName(participant);
    const confirmed = await confirm({
      title: "Remove participant?",
      description: canRestore
        ? `Take ${name} off this deal? The contact itself is not deleted, and you can undo this.`
        : `Take ${name} off this deal? The contact itself is not deleted.`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!confirmed) return;
    setBusyParticipantId(participant.id);
    try {
      await participantRequest(`${base}/${participant.id}`, { method: "DELETE" });
      await refresh();
      toast.success(`${name} removed from this deal.`, canRestore
        ? { action: { label: "Undo", onClick: () => void restore(participant) } }
        : undefined);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusyParticipantId(null);
    }
  }

  const hasRowActions = canManage || canRemove;
  const panelOpen = panel.mode !== "closed";

  return (
    <>
      <RecordRelatedCard
        title="Participants"
        empty={
          canManage
            ? "No contacts are involved in this deal yet. Add the people who decide, approve, or use it."
            : "No contacts are involved in this deal yet."
        }
        action={
          canManage ? (
            <Button
              ref={addTriggerRef}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => openAdd()}
            >
              <Plus />
              Participant
            </Button>
          ) : null
        }
      >
        {participants.length ? (
          <RowList label="Participants">
            {participants.map((participant) => {
              const name = participantName(participant);
              const busy = busyParticipantId === participant.id;
              return (
                <ListRow
                  key={participant.id}
                  href={`/dashboard/sales/contacts/${participant.contact_id}`}
                  title={name}
                  meta={[
                    participant.role_label,
                    participant.is_primary ? "Primary contact" : null,
                    participant.contact.current_title,
                  ].filter(Boolean).join(" · ")}
                  actions={hasRowActions ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${name}`}
                          disabled={busy}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {canManage ? (
                          <DropdownMenuItem onSelect={() => openRole(participant)}>
                            <UserCog />
                            Change role
                          </DropdownMenuItem>
                        ) : null}
                        {canManage && !participant.is_primary ? (
                          <DropdownMenuItem onSelect={() => void makePrimary(participant)}>
                            <Star />
                            Make primary contact
                          </DropdownMenuItem>
                        ) : null}
                        {canRemove ? (
                          <DropdownMenuItem
                            // The server refuses this too; saying why here saves the round trip.
                            disabled={participant.is_primary}
                            onSelect={(event) => {
                              // The confirmation takes focus, so the menu must not return it.
                              event.preventDefault();
                              void remove(participant);
                            }}
                            className="text-state-danger focus:bg-state-danger-muted focus:text-state-danger"
                          >
                            <Trash2 />
                            {participant.is_primary
                              ? "Make someone else primary to remove"
                              : "Remove from deal"}
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : undefined}
                />
              );
            })}
          </RowList>
        ) : null}
      </RecordRelatedCard>

      <EditorPanel
        open={panelOpen}
        onOpenChange={(open) => {
          if (!open) void closePanel();
        }}
        title={panel.mode === "role" ? "Change role" : "Add participant"}
        description={
          panel.mode === "role"
            ? `What ${participantName(panel.participant)} does on this deal.`
            : "Put a contact on this deal and say what they do on it."
        }
        closeLabel={panel.mode === "role" ? "Close Change role" : "Close Add participant"}
        onSubmit={() => void submit()}
        status={formError ? <span role="alert" className="text-state-danger">{formError}</span> : null}
        footer={(
          <>
            <Button type="button" variant="outline" disabled={isSaving} onClick={() => void closePanel()}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {panel.mode === "role"
                ? (isSaving ? "Saving…" : "Save role")
                : (isSaving ? "Adding…" : "Add participant")}
            </Button>
          </>
        )}
      >
        <FieldGroup>
          {panel.mode === "add" ? (
            <Field data-invalid={contactError ? true : undefined}>
              <FieldLabel htmlFor="participant-contact">
                Contact <RequiredMark />
              </FieldLabel>
              <LinkedRecordPicker
                inputId="participant-contact"
                recordType="contact"
                valueId={panel.contactId}
                displayValue={panel.contactName}
                onDisplayValueChange={(contactName) => {
                  setContactError(null);
                  setPanel({ mode: "add", contactId: null, contactName });
                }}
                onSelect={(option) => {
                  setContactError(null);
                  setPanel({ mode: "add", contactId: option.id, contactName: option.label });
                }}
                onClear={() => setPanel({ mode: "add", contactId: null, contactName: "" })}
                placeholder="Search contacts"
                queryKeyPrefix="opportunity-participant-contact"
                noResultsText="No contacts matched this search."
                ariaInvalid={Boolean(contactError)}
                ariaDescribedBy={contactError ? "participant-contact-error" : undefined}
              />
              {contactError ? (
                <FieldError id="participant-contact-error">{contactError}</FieldError>
              ) : null}
              {canCreateContact ? (
                <FieldDescription>
                  Not in the CRM yet?{" "}
                  <button
                    type="button"
                    className="font-medium text-copy-primary underline underline-offset-2 hover:text-copy-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-[var(--radius-control-sm)]"
                    onClick={() => {
                      // One surface at a time: this panel closes and reopens with the new
                      // contact selected, rather than stacking a second drawer on it.
                      contactCreatedRef.current = false;
                      setPanel({ mode: "closed" });
                      setContactQuickCreateOpen(true);
                    }}
                  >
                    Create a contact
                  </button>
                </FieldDescription>
              ) : null}
            </Field>
          ) : null}

          <Field>
            <FieldLabel htmlFor="participant-role">Role</FieldLabel>
            <Select value={roleKey || undefined} onValueChange={setRoleKey} disabled={rolesQuery.isError}>
              <SelectTrigger id="participant-role">
                <SelectValue placeholder={rolesQuery.isLoading ? "Loading roles…" : "Select role"} />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.key} value={role.key}>{role.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {rolesQuery.isError ? (
              <FieldDescription>
                The roles could not be loaded.{" "}
                {panel.mode === "add" ? "The participant is added as Other; change the role later." : "Close this and try again."}
              </FieldDescription>
            ) : panel.mode === "add" ? (
              <FieldDescription>Leave it empty and the participant is added as Other.</FieldDescription>
            ) : null}
          </Field>

          {panel.mode === "add" ? (
            <label className="flex items-start gap-3 rounded-[var(--radius-control)] border border-line-subtle px-4 py-3 text-sm text-copy-secondary transition-colors hover:bg-surface-muted">
              <Checkbox
                checked={isPrimary}
                onCheckedChange={(checked) => setIsPrimary(checked === true)}
                className="mt-0.5"
                aria-label="Primary contact"
              />
              <span>
                <span className="block font-medium text-copy-primary">Primary contact</span>
                <span className="mt-0.5 block text-xs text-copy-muted">
                  The deal&apos;s main contact. It replaces the current one, who stays a participant.
                </span>
              </span>
            </label>
          ) : null}
        </FieldGroup>
      </EditorPanel>

      {canCreateContact ? (
        <ContactQuickCreate
          open={contactQuickCreateOpen}
          onOpenChange={(open) => {
            setContactQuickCreateOpen(open);
            if (!open && contactCreatedRef.current) {
              contactCreatedRef.current = false;
            } else if (!open) {
              // Abandoned: go back to the participant panel the operator came from.
              openAdd();
            }
          }}
          returnFocusRef={addTriggerRef}
          onCreated={(contactId) => {
            contactCreatedRef.current = true;
            if (contactId === null) {
              openAdd();
              return;
            }
            void fetchContactName(contactId).then((name) => openAdd(contactId, name || "New contact"));
          }}
          context={organization ? {
            sourceModuleKey: "sales_opportunities",
            sourceEntityId: opportunityId,
            relationshipIntent: "deal_participant",
            defaults: {
              organization_id: organization.org_id,
              organization_name: organization.org_name,
            },
          } : undefined}
        />
      ) : null}
    </>
  );
}
