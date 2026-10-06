"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ListChecks, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { FormSection } from "@/components/forms/RecordFormLayout";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import SearchBar from "@/components/ui/SearchBar";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import {
  ADMIN_PICKLISTS_QUERY_KEY,
  createPicklist,
  picklistErrorMessage,
  useAdminPicklists,
  type AdminPicklist,
} from "@/hooks/usePicklistAdmin";
import { useInvalidatePicklists } from "@/hooks/usePicklists";
import { isForbiddenError } from "@/lib/api";
import { SETTINGS_ROUTES } from "@/lib/routes";

function usedBy(list: AdminPicklist): string {
  if (!list.used_by.length) return list.is_system ? "Ready for fields that need it" : "Custom fields can use it";
  return list.used_by.map((field) => field.label).filter((label, index, all) => all.indexOf(label) === index).join(", ");
}

/**
 * Settings → Picklists (13b §3.1): the value lists fields choose from. A list opens on its own
 * page; this one names each list, what uses it, and whether it is shared (global) or belongs
 * to one field (local). New lists are global or local custom lists for custom fields.
 */
export default function PicklistsSettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const invalidatePicklists = useInvalidatePicklists();
  const lists = useAdminPicklists();
  const [search, setSearch] = useState("");
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<"global" | "local">("global");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (lists.data ?? []).filter((list) => !needle || list.label.toLowerCase().includes(needle) || usedBy(list).toLowerCase().includes(needle));
  }, [lists.data, search]);

  async function create(event: FormEvent) {
    event.preventDefault();
    const name = label.trim();
    if (!name) {
      setError("A list needs a name.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await createPicklist({ label: name, scope });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ADMIN_PICKLISTS_QUERY_KEY }), invalidatePicklists()]);
      setLabel("");
      router.push(SETTINGS_ROUTES.picklist(created.key));
    } catch (caught) {
      setError(picklistErrorMessage(caught, "The list could not be created. Try again."));
    } finally {
      setCreating(false);
    }
  }

  const isForbidden = isForbiddenError(lists.error);

  return (
    <PageShell
      variant="settings"
      title="Picklists"
      description="The value lists fields choose from. Records keep a value's key, so renaming one never changes them."
      backHref={SETTINGS_ROUTES.root}
      backLabel="Back to settings"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchBar value={search} onChange={setSearch} placeholder="Search lists" className="sm:max-w-sm" />
      </div>
      <RecordTable
        label="Picklists"
        columns={[
          {
            key: "label",
            label: "List",
            size: "lg",
            render: (list) => <span className="font-medium text-copy-primary">{list.label}</span>,
          },
          { key: "used_by", label: "Used by", render: (list) => <span className="text-sm text-copy-secondary">{usedBy(list)}</span> },
          {
            key: "values",
            label: "Values",
            size: "sm",
            align: "right",
            render: (list) => <span className="tabular-nums">{list.values.filter((value) => value.is_active).length}</span>,
          },
          {
            key: "scope",
            label: "Scope",
            size: "sm",
            render: (list) => <span className="text-sm text-copy-secondary">{list.is_locked ? "Platform" : list.scope === "global" ? "Shared" : "One field"}</span>,
          },
        ]}
        rows={visible}
        rowKey={(list) => list.id}
        rowHref={(list) => SETTINGS_ROUTES.picklist(list.key)}
        rowLabel={(list) => `Open ${list.label}`}
        isLoading={lists.isLoading}
        isRefreshing={lists.isFetching && !lists.isLoading}
        isPermissionDenied={isForbidden}
        hasError={Boolean(lists.error) && !isForbidden}
        onRetry={() => void lists.refetch()}
        errorState={{ title: "Picklists could not be loaded" }}
        hasActiveFilters={Boolean(search.trim())}
        onClearFilters={() => setSearch("")}
        filteredEmptyState={{ icon: ListChecks, title: "No matching lists", description: "Adjust the search to find another list." }}
        emptyState={{ icon: ListChecks, title: "No picklists yet", description: "Create a list for a custom field to choose from." }}
      />

      <FormSection title="New list" description="A custom list, for custom fields to choose from. Shared lists can serve several fields; a one-field list belongs to a single field.">
        <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row sm:items-end" aria-label="Create a list">
          <Field className="sm:w-72">
            <FieldLabel htmlFor="picklist-new-name">Name</FieldLabel>
            <Input
              id="picklist-new-name"
              value={label}
              maxLength={150}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "picklist-new-error" : "picklist-new-help"}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
          <Field className="sm:w-auto">
            <FieldLabel>Scope</FieldLabel>
            <SegmentedControl aria-label="Scope" size="default" value={scope} onValueChange={setScope}>
              <SegmentedItem value="global">Shared</SegmentedItem>
              <SegmentedItem value="local">One field</SegmentedItem>
            </SegmentedControl>
          </Field>
          <Button type="submit" variant="outline" disabled={creating}>
            <Plus />
            {creating ? "Creating…" : "Create list"}
          </Button>
        </form>
        {error ? <FieldError id="picklist-new-error" className="mt-2">{error}</FieldError> : (
          <FieldDescription id="picklist-new-help" className="mt-2">The list opens next, to add its values.</FieldDescription>
        )}
      </FormSection>
    </PageShell>
  );
}
