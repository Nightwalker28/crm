"use client";

import ContactsHeader from "@/components/contacts/contactHeader";
import Pagination from "@/components/ui/Pagination";
import ContactList from "@/components/contacts/contactList";
import { useContacts } from "@/hooks/sales/useContacts";
import { useState } from "react";
import CreateContactModal from "@/components/contacts/createContactModal";
import { ColumnPicker } from "@/components/ui/ColumnPicker";
import { useTablePreferences } from "@/hooks/useTablePreferences";

const CONTACT_COLUMNS = [
  { key: "first_name", label: "First Name" },
  { key: "last_name", label: "Last Name" },
  { key: "primary_email", label: "Email" },
  { key: "current_title", label: "Job Title" },
  { key: "organization_name", label: "Organization" },
  { key: "region", label: "Region" },
  { key: "country", label: "Country" },
  { key: "linkedin_url", label: "LinkedIn" },
];

const DEFAULT_CONTACT_COLUMNS = ["first_name", "last_name", "primary_email", "organization_name", "linkedin_url"];

export default function ContactsPage() {
  const { visibleColumns, saveVisibleColumns } = useTablePreferences(
    "sales_contacts",
    CONTACT_COLUMNS,
    DEFAULT_CONTACT_COLUMNS,
  );
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
  } = useContacts(visibleColumns);

  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="bg-zinc-950 overflow-hidden">
      <div className="max-w-5xl mx-auto flex flex-col gap-6 h-full">
        <div className="flex items-start justify-between gap-4">
          <ContactsHeader onCreateClick={() => setCreateOpen(true)} />
          <ColumnPicker
            title="Contact columns"
            options={CONTACT_COLUMNS}
            visibleColumns={visibleColumns}
            onChange={saveVisibleColumns}
          />
        </div>

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
