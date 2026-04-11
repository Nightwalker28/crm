"use client";

import ContactsHeader from "@/components/contacts/contactHeader";
import Pagination from "@/components/ui/Pagination";
import ContactList from "@/components/contacts/contactList";
import { useContacts } from "@/hooks/sales/useContacts";
import { useState } from "react";
import CreateContactModal from "@/components/contacts/createContactModal";

export default function ContactsPage() {
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
  } = useContacts();

  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="bg-zinc-950 overflow-hidden">
      <div className="max-w-5xl mx-auto flex flex-col gap-6 h-full">
        <ContactsHeader onCreateClick={() => setCreateOpen(true)} />

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