"use client";

import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/Table";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import type { Contact } from "@/hooks/sales/useContacts";

interface ContactListProps {
  contacts: Contact[];
  isLoading: boolean;
  visibleColumns: string[];
}

export default function ContactList({
  contacts,
  isLoading,
  visibleColumns = [],
}: ContactListProps) {
  const hasColumn = (key: string) => visibleColumns.includes(key);

  return (
    <ModuleTableShell>
      <Table className="min-w-[920px]">
        <TableHeader>
          <TableHeaderRow>
            {hasColumn("first_name") && <TableHead>First Name</TableHead>}
            {hasColumn("last_name") && <TableHead>Last Name</TableHead>}
            {hasColumn("primary_email") && <TableHead>Email</TableHead>}
            {hasColumn("current_title") && <TableHead>Job Title</TableHead>}
            {hasColumn("organization_name") && <TableHead>Organization</TableHead>}
            {hasColumn("region") && <TableHead>Region</TableHead>}
            {hasColumn("country") && <TableHead>Country</TableHead>}
            {hasColumn("linkedin_url") && <TableHead>LinkedIn</TableHead>}
            <TableHead className="text-right">Record</TableHead>
          </TableHeaderRow>
        </TableHeader>

        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length + 1} className="py-10 text-center text-neutral-500">
                Loading contacts...
              </TableCell>
            </TableRow>
          ) : contacts.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length + 1} className="py-10 text-center text-neutral-500">
                No contacts found.
              </TableCell>
            </TableRow>
          ) : (
            contacts.map((contact) => (
              <TableRow key={contact.contact_id}>
                {hasColumn("first_name") && <TableCell>{contact.first_name || "-"}</TableCell>}
                {hasColumn("last_name") && <TableCell>{contact.last_name || "-"}</TableCell>}
                {hasColumn("primary_email") && <TableCell>{contact.primary_email || "-"}</TableCell>}
                {hasColumn("current_title") && <TableCell>{contact.current_title || "-"}</TableCell>}
                {hasColumn("organization_name") && <TableCell>{contact.organization_name || "-"}</TableCell>}
                {hasColumn("region") && <TableCell>{contact.region || "-"}</TableCell>}
                {hasColumn("country") && <TableCell>{contact.country || "-"}</TableCell>}
                {hasColumn("linkedin_url") && (
                  <TableCell>
                    {contact.linkedin_url ? (
                      <a
                        href={`https://${contact.linkedin_url.replace(/^https?:\/\//, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-300 hover:text-sky-200"
                      >
                        Open
                      </a>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                )}
                <TableCell className="text-right">
                  <Link
                    href={`/dashboard/sales/contacts/${contact.contact_id}`}
                    className="text-xs font-medium uppercase tracking-wide text-neutral-400 hover:text-neutral-100"
                  >
                    Open
                  </Link>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
