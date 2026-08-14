"use client";

import { useMemo, useRef, useState } from "react";

import { Plus } from "lucide-react";
import ContactList from "@/components/contacts/contactList";
import { ContactQuickCreate } from "@/components/contacts/ContactQuickCreate";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { ModuleListToolbar } from "@/components/ui/ModuleListToolbar";
import { PageShell } from "@/components/ui/PageShell";
import Pagination from "@/components/ui/Pagination";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { Button } from "@/components/ui/button";
import { useContacts, type ContactSortState } from "@/hooks/sales/useContacts";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";
import { buildSavedViewExportPayload } from "@/lib/savedViewQuery";

export default function ContactsPage() {
  const { modules } = useAccessibleModules();
  // UI gating only — the create endpoint and the quick_create layout endpoint both enforce this.
  const canCreate = Boolean(modules.find((module) => module.name === "sales_contacts")?.actions?.can_create);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const quickCreateTriggerRef = useRef<HTMLButtonElement>(null);
  const { data: customFields = [] } = useModuleCustomFields("sales_contacts");
  const { fields: moduleFields } = useModuleFieldConfigs("sales_contacts");
  const definition = useMemo(() => buildModuleViewDefinition("sales_contacts", customFields, moduleFields), [customFields, moduleFields]);
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.sales_contacts;
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews("sales_contacts", defaultConfig);
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const activeSort = useMemo<ContactSortState>(() => {
    const sort = draftConfig.sort;
    if (!sort || typeof sort.key !== "string") return null;
    return { key: sort.key, direction: sort.direction === "desc" ? "desc" : "asc" };
  }, [draftConfig.sort]);
  const { contacts, page, totalPages, totalCount, rangeStart, rangeEnd, pageSize, onPageSizeChange, isLoading, isFetching, error, goToPage, refresh } = useContacts(visibleColumns, activeFilters, activeSort);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const { allConditions, anyConditions } = getConditionGroups(activeFilters);
  const activeFilterCount = allConditions.length + anyConditions.length;
  const hasActiveFilters = Boolean((typeof activeFilters.search === "string" && activeFilters.search.trim()) || activeFilterCount);
  const currentPageIds = useMemo(() => contacts.map((contact) => contact.contact_id), [contacts]);

  function toggleRow(contactId: number, checked: boolean) {
    setSelectedIds((current) => checked ? Array.from(new Set([...current, contactId])) : current.filter((id) => id !== contactId));
  }

  function toggleCurrentPage(checked: boolean) {
    setSelectedIds((current) => checked ? Array.from(new Set([...current, ...currentPageIds])) : current.filter((id) => !currentPageIds.includes(id)));
  }

  function clearFilters() {
    setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: "", conditions: [], all_conditions: [], any_conditions: [] } }));
  }

  return (
    <PageShell variant="list" title="Contacts">
      <ModuleListToolbar
        searchValue={typeof activeFilters.search === "string" ? activeFilters.search : ""}
        onSearchChange={(value) => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, search: value } }))}
        searchPlaceholder="Search contacts"
        filtersOpen={Boolean(activeFilters.filtersOpen)}
        activeFilterCount={activeFilterCount}
        onToggleFilters={() => setDraftConfig((current) => ({ ...current, filters: { ...current.filters, filtersOpen: !current.filters.filtersOpen } }))}
        onClearFilters={clearFilters}
        selectedCount={selectedIds.length}
        selectionNoun="contact"
        onClearSelection={() => setSelectedIds([])}
        viewControls={<SavedViewSelector moduleKey="sales_contacts" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} />}
        actionControls={<ModuleImportExportControls importEndpoint="/sales/contacts/import" exportEndpoint="/sales/contacts/export" exportMethod="POST" exportBody={buildSavedViewExportPayload(activeFilters)} onImportSuccess={refresh} selectedIds={selectedIds} currentPageIds={currentPageIds} />}
        primaryAction={canCreate ? (
          <Button ref={quickCreateTriggerRef} type="button" onClick={() => setQuickCreateOpen(true)}>
            <Plus />Create contact
          </Button>
        ) : null}
      />
      <ContactQuickCreate
        open={quickCreateOpen}
        onOpenChange={setQuickCreateOpen}
        returnFocusRef={quickCreateTriggerRef}
        // refresh() refetches the query already keyed by the active view, filters, sort, and
        // page, so the list updates without resetting any of them.
        onCreated={() => refresh()}
      />
      <InlineSavedViewFilters filterFields={definition?.filterFields ?? []} filters={activeFilters} onChange={(nextFilters) => setDraftConfig((current) => ({ ...current, filters: nextFilters }))} hideHeader />
      <ContactList
        contacts={contacts}
        isLoading={isLoading}
        isRefreshing={isFetching && !isLoading}
        visibleColumns={visibleColumns}
        columnOptions={definition?.columns ?? []}
        selectedIds={selectedIds}
        onToggleRow={toggleRow}
        onToggleCurrentPage={toggleCurrentPage}
        hasActiveFilters={hasActiveFilters}
        hasError={Boolean(error)}
        onRetry={refresh}
        onClearFilters={clearFilters}
        onCreateContact={canCreate ? () => setQuickCreateOpen(true) : undefined}
        sort={activeSort ? { column: activeSort.key, direction: activeSort.direction } : null}
        onSortChange={(nextSort) => setDraftConfig((current) => ({ ...current, sort: nextSort ? { key: nextSort.column, direction: nextSort.direction } : null }))}
      />
      <Pagination page={page} totalPages={totalPages} totalCount={totalCount} rangeStart={rangeStart} rangeEnd={rangeEnd} pageSize={pageSize} isRefreshing={isFetching && !isLoading} onPageChange={goToPage} onPageSizeChange={onPageSizeChange} />
    </PageShell>
  );
}
