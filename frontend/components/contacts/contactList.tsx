"use client";

import { useMemo } from "react";
import { Users } from "lucide-react";

import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/button";
import { CustomFieldValue } from "@/components/ui/CustomFieldValue";
import { RecordTable, type RecordTableColumn, type RecordTableSort } from "@/components/ui/RecordTable";
import type { Contact } from "@/hooks/sales/useContacts";
import type { TableColumnOption } from "@/types/table";
import { getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";
import { formatDateTime } from "@/lib/datetime";

interface ContactListProps {
  contacts: Contact[];
  isLoading: boolean;
  isRefreshing?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  selectedIds?: number[];
  onToggleRow?: (contactId: number, checked: boolean) => void;
  onToggleCurrentPage?: (checked: boolean) => void;
  sort?: RecordTableSort | null;
  onSortChange?: (sort: RecordTableSort) => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  onCreateContact?: () => void;
}

const HEADERS: Record<string, string> = {
  first_name: "First Name",
  last_name: "Last Name",
  primary_email: "Email",
  contact_telephone: "Phone",
  current_title: "Job Title",
  organization_name: "Account",
  region: "Region",
  country: "Country",
  linkedin_url: "LinkedIn",
  assigned_to_name: "Owner",
  last_contacted_at: "Last Activity",
  created_time: "Created",
};

const SORTABLE_COLUMNS = new Set([
  "first_name",
  "last_name",
  "primary_email",
  "contact_telephone",
  "current_title",
  "organization_name",
  "region",
  "country",
  "linkedin_url",
  "organization_id",
  "assigned_to",
  "created_time",
  "last_contacted_at",
]);

const COLUMN_SIZES: Record<string, "sm" | "md" | "lg"> = {
  first_name: "lg",
  primary_email: "lg",
  organization_name: "lg",
  region: "sm",
  country: "sm",
  linkedin_url: "sm",
};

function getInitials(firstName?: string | null, lastName?: string | null, email?: string | null): string {
  if (firstName && lastName) return `${firstName[0]}${lastName[0]}`.toUpperCase();
  if (firstName) return firstName[0].toUpperCase();
  if (email) return email[0].toUpperCase();
  return "?";
}

function contactName(contact: Contact) {
  return `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim();
}

function emptyValue() {
  return <span className="text-copy-disabled">—</span>;
}

function renderCell(contact: Contact, column: string) {
  if (isCustomFieldColumnKey(column)) return <CustomFieldValue column={column} values={contact.custom_fields} />;

  switch (column) {
    case "first_name":
      return (
        <div className="flex h-8 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-control-sm)] border border-line-default bg-surface-muted text-2xs font-semibold text-copy-secondary">
            {getInitials(contact.first_name, contact.last_name, contact.primary_email)}
          </div>
          <span className="truncate text-sm font-medium text-copy-primary">{contact.first_name || emptyValue()}</span>
        </div>
      );
    case "last_name":
      return <span className="text-sm text-copy-secondary">{contact.last_name || emptyValue()}</span>;
    case "primary_email":
      return <span className="text-sm text-copy-secondary">{contact.primary_email || emptyValue()}</span>;
    case "contact_telephone":
      return <span className="text-sm text-copy-secondary">{contact.contact_telephone || emptyValue()}</span>;
    case "current_title":
      return <span className="text-sm text-copy-muted">{contact.current_title || emptyValue()}</span>;
    case "organization_name":
      return contact.organization_name
        ? <span className="text-sm font-medium text-action-primary">{contact.organization_name}</span>
        : <span className="text-sm text-copy-disabled">—</span>;
    case "assigned_to_name":
      return <span className="text-sm text-copy-secondary">{contact.assigned_to_name || "Unassigned"}</span>;
    case "last_contacted_at":
      return <span className="text-sm text-copy-muted">{contact.last_contacted_at ? formatDateTime(contact.last_contacted_at) : "No activity"}</span>;
    case "created_time":
      return <span className="text-sm text-copy-muted">{contact.created_time ? formatDateTime(contact.created_time) : "-"}</span>;
    case "region":
      return contact.region ? <Chip>{contact.region}</Chip> : <span className="text-sm text-copy-disabled">—</span>;
    case "country":
      return <span className="text-sm text-copy-muted">{contact.country || emptyValue()}</span>;
    case "linkedin_url":
      return contact.linkedin_url ? (
        <a
          href={`https://${contact.linkedin_url.replace(/^https?:\/\//, "")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-control-sm)] border border-action-primary/40 bg-action-primary-muted px-2 py-0.5 text-xs font-medium text-action-primary transition-colors duration-100 hover:text-action-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
          </svg>
          View
        </a>
      ) : (
        <span className="text-sm text-copy-disabled">—</span>
      );
    default:
      return null;
  }
}

export default function ContactList({
  contacts,
  isLoading,
  isRefreshing = false,
  hasError = false,
  onRetry,
  visibleColumns = [],
  columnOptions = [],
  selectedIds = [],
  onToggleRow,
  onToggleCurrentPage,
  sort = null,
  onSortChange,
  hasActiveFilters = false,
  onClearFilters,
  onCreateContact,
}: ContactListProps) {
  const columns = useMemo<RecordTableColumn<Contact>[]>(
    () =>
      visibleColumns.map((column) => ({
        key: column,
        label: HEADERS[column] ?? getReadableColumnLabel(column, columnOptions),
        sortable: !isCustomFieldColumnKey(column) && SORTABLE_COLUMNS.has(column),
        size: COLUMN_SIZES[column],
        interactive: column === "linkedin_url",
        render: (contact) => renderCell(contact, column),
      })),
    [visibleColumns, columnOptions],
  );

  return (
    <RecordTable
      label="Contacts"
      columns={columns}
      rows={contacts}
      rowKey={(contact) => contact.contact_id}
      rowHref={(contact) => `/dashboard/sales/contacts/${contact.contact_id}`}
      rowLabel={(contact) => `Open contact ${contactName(contact) || contact.contact_id}`}
      selection={
        onToggleRow && onToggleCurrentPage
          ? {
              selectedIds,
              onToggleRow: (id, checked) => onToggleRow(Number(id), checked),
              onToggleAll: onToggleCurrentPage,
              rowLabel: (contact) => `Select contact ${contactName(contact) || contact.contact_id}`,
            }
          : undefined
      }
      sort={sort}
      onSortChange={onSortChange}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      hasError={hasError}
      onRetry={onRetry}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={onClearFilters}
      emptyState={{
        icon: Users,
        title: "No contacts yet",
        description: "Create a contact or import contacts from CSV.",
        action: onCreateContact ? <Button type="button" onClick={onCreateContact}>Create contact</Button> : undefined,
      }}
      filteredEmptyState={{ icon: Users }}
    />
  );
}
