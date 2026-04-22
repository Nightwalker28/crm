"use client";

import ContactsHeader from "@/components/contacts/contactHeader";
import Pagination from "@/components/ui/Pagination";
import ContactList from "@/components/contacts/contactList";
import { useContacts } from "@/hooks/sales/useContacts";
import { useState } from "react";
import CreateContactModal from "@/components/contacts/createContactModal";
import SearchBar from "@/components/ui/SearchBar";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { useSavedViews } from "@/hooks/useSavedViews";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS } from "@/lib/moduleViewConfigs";
import { useMemo } from "react";

export default function ContactsPage() {
  const { data: customFields = [] } = useModuleCustomFields("sales_contacts");
  const definition = useMemo(
    () => buildModuleViewDefinition("sales_contacts", customFields),
    [customFields],
  );
  const {
    views,
    selectedViewId,
    setSelectedViewId,
    draftConfig,
    setDraftConfig,
  } = useSavedViews(
    "sales_contacts",
    MODULE_VIEW_DEFAULTS.sales_contacts,
  );
  const visibleColumns = draftConfig.visible_columns?.length
    ? draftConfig.visible_columns
    : MODULE_VIEW_DEFAULTS.sales_contacts.visible_columns;

  const {
    contacts,
    page,
    totalPages,
    totalCount,
    rangeStart,
    rangeEnd,
    pageSize,
    onPageSizeChange,
    isLoading,
    isFetching,
    error,
    goToPage,
    refresh,
  } = useContacts(visibleColumns, draftConfig.filters);

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const currentPageIds = useMemo(
    () => contacts.map((contact) => contact.contact_id),
    [contacts],
  );

  const currentPageSelectionState = useMemo<boolean | "indeterminate">(() => {
    if (!currentPageIds.length) return false;
    const selectedOnPage = currentPageIds.filter((id) => selectedIds.includes(id)).length;
    if (!selectedOnPage) return false;
    if (selectedOnPage === currentPageIds.length) return true;
    return "indeterminate";
  }, [currentPageIds, selectedIds]);

  function toggleRow(contactId: number, checked: boolean) {
    setSelectedIds((current) =>
      checked
        ? Array.from(new Set([...current, contactId]))
        : current.filter((id) => id !== contactId),
    );
  }

  function toggleCurrentPage(checked: boolean) {
    setSelectedIds((current) => {
      if (checked) {
        return Array.from(new Set([...current, ...currentPageIds]));
      }
      return current.filter((id) => !currentPageIds.includes(id));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <ContactsHeader
        onCreateClick={() => setCreateOpen(true)}
        onImportSuccess={refresh}
        selectedIds={selectedIds}
        currentPageIds={currentPageIds}
        exportFilters={draftConfig.filters}
        viewSelector={
          <SavedViewSelector
            moduleKey="sales_contacts"
            views={views}
            selectedViewId={selectedViewId}
            onSelect={setSelectedViewId}
          />
        }
      />

      <SearchBar
        value={
          typeof draftConfig.filters?.search === "string"
            ? draftConfig.filters.search
            : ""
        }
        onChange={(value) =>
          setDraftConfig((current) => ({
            ...current,
            filters: {
              ...current.filters,
              search: value,
            },
          }))
        }
        placeholder="Search contacts"
      />

      <InlineSavedViewFilters
        filterFields={definition?.filterFields ?? []}
        filters={draftConfig.filters}
        onChange={(nextFilters) =>
          setDraftConfig((current) => ({
            ...current,
            filters: nextFilters,
          }))
        }
      />

      {error && (
        <div className="flex justify-between rounded-lg border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-200">
          <span>{error}</span>
          <button onClick={refresh} className="underline underline-offset-2">
            Retry
          </button>
        </div>
      )}

      <ContactList
        contacts={contacts}
        isLoading={isLoading}
        isRefreshing={isFetching && !isLoading}
        visibleColumns={visibleColumns}
        columnOptions={definition?.columns ?? []}
        selectedIds={selectedIds}
        currentPageSelectionState={currentPageSelectionState}
        onToggleRow={toggleRow}
        onToggleCurrentPage={toggleCurrentPage}
      />

      <Pagination
        page={page}
        totalPages={totalPages}
        totalCount={totalCount}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        pageSize={pageSize}
        isRefreshing={isFetching && !isLoading}
        onPageChange={goToPage}
        onPageSizeChange={onPageSizeChange}
      />

      <CreateContactModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={refresh}
      />
    </div>
  );
}
