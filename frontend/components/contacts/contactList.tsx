"use client";

import { Fragment } from "react";
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
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import { getCustomFieldKeyFromColumn, getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";

interface ContactListProps {
  contacts: Contact[];
  isLoading: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
}

export default function ContactList({
  contacts,
  isLoading,
  visibleColumns = [],
  columnOptions = [],
}: ContactListProps) {
  const headers: Record<string, string> = {
    first_name: "First Name",
    last_name: "Last Name",
    primary_email: "Email",
    current_title: "Job Title",
    organization_name: "Organization",
    region: "Region",
    country: "Country",
    linkedin_url: "LinkedIn",
  };
  const renderCell = (contact: Contact, column: string) => {
    if (isCustomFieldColumnKey(column)) {
      const fieldKey = getCustomFieldKeyFromColumn(column);
      const value = contact.custom_fields?.[fieldKey];
      return <TableCell>{value == null || value === "" ? "-" : String(value)}</TableCell>;
    }
    switch (column) {
      case "first_name":
        return <TableCell>{contact.first_name || "-"}</TableCell>;
      case "last_name":
        return <TableCell>{contact.last_name || "-"}</TableCell>;
      case "primary_email":
        return <TableCell>{contact.primary_email || "-"}</TableCell>;
      case "current_title":
        return <TableCell>{contact.current_title || "-"}</TableCell>;
      case "organization_name":
        return <TableCell>{contact.organization_name || "-"}</TableCell>;
      case "region":
        return <TableCell>{contact.region || "-"}</TableCell>;
      case "country":
        return <TableCell>{contact.country || "-"}</TableCell>;
      case "linkedin_url":
        return (
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
        );
      default:
        return null;
    }
  };

  return (
    <ModuleTableShell>
      <Table className="min-w-[920px]">
        <TableHeader>
          <TableHeaderRow>
            {visibleColumns.map((column) => (
              <TableHead key={column}>{headers[column] ?? getReadableColumnLabel(column, columnOptions)}</TableHead>
            ))}
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
                {visibleColumns.map((column) => (
                  <Fragment key={column}>{renderCell(contact, column)}</Fragment>
                ))}
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
