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
  const visibleColumns = draftConfig.visible_columns?.length ? draftConfig.visible_columns : MODULE_VIEW_DEFAULTS.sales_contacts.visible_columns;
  const {
    contacts,
    page,
    totalPages,
    totalCount,
    rangeStart,
    rangeEnd,
    pageSize,
    isLoading,
    error,
    goToPage,
    refresh,
  } = useContacts(visibleColumns, draftConfig.filters);

  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="bg-zinc-950 overflow-hidden">
      <div className="max-w-5xl mx-auto flex flex-col gap-6 h-full">
        <div className="flex items-start justify-between gap-4">
          <ContactsHeader onCreateClick={() => setCreateOpen(true)} onImportSuccess={refresh} />
          <SavedViewSelector
            moduleKey="sales_contacts"
            views={views}
            selectedViewId={selectedViewId}
            onSelect={setSelectedViewId}
          />
        </div>

        <SearchBar
          value={typeof draftConfig.filters?.search === "string" ? draftConfig.filters.search : ""}
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
          <div className="bg-red-900/40 border border-red-700 text-red-200 text-sm rounded-lg px-4 py-3 flex justify-between">
            <span>{error}</span>
            <button
              onClick={refresh}
              className="underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0">
          <ContactList
            contacts={contacts}
            isLoading={isLoading}
            visibleColumns={visibleColumns}
            columnOptions={definition?.columns ?? []}
          />
        </div>

        <Pagination
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          pageSize={pageSize}
          onPageChange={goToPage}
          onPageSizeChange={() => {}}
        />
      </div>

      <CreateContactModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={refresh}
      />
    </div>
  );
}
