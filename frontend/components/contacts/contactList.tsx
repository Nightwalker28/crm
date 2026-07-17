"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableHeaderRow,
  TableRow,
  SortableHead,
} from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { CustomFieldCell } from "@/components/ui/CustomFieldCell";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { Pill } from "@/components/ui/Pill";
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
import type { Contact } from "@/hooks/sales/useContacts";
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import { getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";
import { formatDateTime } from "@/lib/datetime";

type SortDirection = "asc" | "desc";
type SortState = { column: string; direction: SortDirection } | null;

interface ContactListProps {
  contacts: Contact[];
  isLoading: boolean;
  isRefreshing?: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  selectedIds?: number[];
  currentPageSelectionState?: boolean | "indeterminate";
  onToggleRow?: (contactId: number, checked: boolean) => void;
  onToggleCurrentPage?: (checked: boolean) => void;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
}

function getInitials(firstName?: string | null, lastName?: string | null, email?: string | null): string {
  if (firstName && lastName) return `${firstName[0]}${lastName[0]}`.toUpperCase();
  if (firstName) return firstName[0].toUpperCase();
  if (email) return email[0].toUpperCase();
  return "?";
}

function getRegionStyle(region?: string | null): { bg: string; text: string; border: string } {
  const map: Record<string, { bg: string; text: string; border: string }> = {
    APAC: { bg: "bg-state-info-muted", text: "text-state-info", border: "border-state-info/40" },
    EMEA: { bg: "bg-violet-900/30", text: "text-violet-300", border: "border-violet-700/40" },
    NA: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40" },
    LATAM: { bg: "bg-orange-900/30", text: "text-orange-300", border: "border-orange-700/40" },
  };
  return map[region ?? ""] ?? { bg: "bg-surface-muted", text: "text-copy-muted", border: "border-line-default" };
}

export default function ContactList({
  contacts,
  isLoading,
  isRefreshing = false,
  visibleColumns = [],
  columnOptions = [],
  selectedIds = [],
  currentPageSelectionState = false,
  onToggleRow,
  onToggleCurrentPage,
  sort = null,
  onSortChange,
  hasActiveFilters = false,
  onClearFilters,
}: ContactListProps) {
  const router = useRouter();
  const headers: Record<string, string> = {
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
  const sortableColumns = new Set([
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

  const renderCell = (contact: Contact, column: string, isIdentityColumn: boolean) => {
    const stickyClassName = isIdentityColumn ? "sticky left-12 z-10 border-r border-line-subtle bg-surface group-hover:bg-surface-raised" : undefined;
    if (isCustomFieldColumnKey(column)) {
      return <CustomFieldCell column={column} values={contact.custom_fields} className={stickyClassName} />;
    }

    switch (column) {
      case "first_name":
        return (
          <TableCell className={stickyClassName}>
            <div className="flex items-center gap-2.5 h-8">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-control-sm)] border border-line-default bg-surface-muted text-[10px] font-semibold text-copy-secondary">
                {getInitials(contact.first_name, contact.last_name, contact.primary_email)}
              </div>
              <span className="truncate text-sm font-medium text-copy-primary">
                {contact.first_name || <span className="text-copy-disabled">—</span>}
              </span>
            </div>
          </TableCell>
        );
      case "last_name":
        return (
          <TableCell>
            <span className="text-sm text-copy-secondary">
              {contact.last_name || <span className="text-copy-disabled">—</span>}
            </span>
          </TableCell>
        );
      case "primary_email":
        return (
          <TableCell>
            <span className="font-mono text-sm tracking-tight text-copy-secondary">
              {contact.primary_email || <span className="text-copy-disabled">—</span>}
            </span>
          </TableCell>
        );
      case "contact_telephone":
        return (
          <TableCell>
            <span className="font-mono text-sm tracking-tight text-copy-secondary">
              {contact.contact_telephone || <span className="text-copy-disabled">—</span>}
            </span>
          </TableCell>
        );
      case "current_title":
        return (
          <TableCell>
            <span className="text-sm text-copy-muted">
              {contact.current_title || <span className="text-copy-disabled">—</span>}
            </span>
          </TableCell>
        );
      case "organization_name":
        return (
          <TableCell>
            {contact.organization_name ? (
              <span className="text-sm font-medium text-action-primary">{contact.organization_name}</span>
            ) : (
              <span className="text-sm text-copy-disabled">—</span>
            )}
          </TableCell>
        );
      case "assigned_to_name":
        return <TableCell><span className="text-sm text-copy-secondary">{contact.assigned_to_name || "Unassigned"}</span></TableCell>;
      case "last_contacted_at":
        return <TableCell><span className="text-sm text-copy-muted">{contact.last_contacted_at ? formatDateTime(contact.last_contacted_at) : "No activity"}</span></TableCell>;
      case "created_time":
        return <TableCell><span className="text-sm text-copy-muted">{contact.created_time ? formatDateTime(contact.created_time) : "-"}</span></TableCell>;
      case "region":
        return (
          <TableCell>
            {contact.region ? (() => {
              const style = getRegionStyle(contact.region);
              return (
                <Pill bg={style.bg} text={style.text} border={style.border}>
                  {contact.region}
                </Pill>
              );
            })() : <span className="text-sm text-copy-disabled">—</span>}
          </TableCell>
        );
      case "country":
        return (
          <TableCell>
            <span className="text-sm text-copy-muted">
              {contact.country || <span className="text-copy-disabled">—</span>}
            </span>
          </TableCell>
        );
      case "linkedin_url":
        return (
          <TableCell>
            {contact.linkedin_url ? (
              <a
                href={`https://${contact.linkedin_url.replace(/^https?:\/\//, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="inline-flex items-center gap-1.5 rounded border border-action-primary/40 bg-action-primary-muted px-2 py-0.5 text-xs font-medium text-action-primary transition-colors hover:text-action-primary-hover"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
                View
              </a>
            ) : (
              <span className="text-sm text-copy-disabled">—</span>
            )}
          </TableCell>
        );
      default:
        return null;
    }
  };

  function toggleSort(column: string) {
    const nextSort: SortState = sort?.column === column
      ? { column, direction: sort.direction === "asc" ? "desc" : "asc" }
      : { column, direction: "asc" };
    onSortChange?.(nextSort);
  }

  return (
    <ModuleTableShell isRefreshing={isRefreshing}>
      <Table className="min-w-[920px]">
        <TableHeader>
          <TableHeaderRow>
            <TableHead className="sticky left-0 z-40 w-12 border-r border-line-subtle bg-surface-raised pr-0">
              <Checkbox
                checked={currentPageSelectionState}
                onCheckedChange={(checked) => onToggleCurrentPage?.(checked === true)}
                className="h-4 w-4 rounded border border-line-strong bg-surface-raised"
                aria-label="Select current page contacts"
              >
                <CheckboxIndicator className="h-3 w-3" />
              </Checkbox>
            </TableHead>
            {visibleColumns.map((column, index) => {
              const label = headers[column] ?? getReadableColumnLabel(column, columnOptions);
              const sortable = !isCustomFieldColumnKey(column) && sortableColumns.has(column);
              return sortable ? (
                <SortableHead
                  key={column}
                  sorted={sort?.column === column}
                  direction={sort?.column === column ? sort.direction : "asc"}
                  onClick={() => toggleSort(column)}
                  className={index === 0 ? "sticky left-12 z-30 border-r border-line-subtle bg-surface-raised" : undefined}
                >
                  {label}
                </SortableHead>
              ) : (
                <TableHead key={column} className={index === 0 ? "sticky left-12 z-30 border-r border-line-subtle bg-surface-raised" : undefined}>{label}</TableHead>
              );
            })}
          </TableHeaderRow>
        </TableHeader>

        <TableBody>
          {isLoading ? (
            <ModuleTableLoading columnCount={visibleColumns.length + 1} />
          ) : contacts.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length + 1} className="py-16 text-center">
                {hasActiveFilters ? (
                  <EmptyState icon={Users} title="No contacts match these filters" description="Clear one or more filters and try again." action={<Button type="button" variant="outline" onClick={onClearFilters}>Clear filters</Button>} />
                ) : (
                  <EmptyState icon={Users} title="No contacts yet" description="Create a contact or import contacts from CSV." action={<Button asChild><Link href="/dashboard/sales/contacts/new">Create contact</Link></Button>} />
                )}
              </TableCell>
            </TableRow>
          ) : (
            contacts.map((contact) => (
              <TableRow
                key={contact.contact_id}
                className="group cursor-pointer"
                onClick={() => router.push(`/dashboard/sales/contacts/${contact.contact_id}`)}
              >
                <TableCell
                  className="sticky left-0 z-20 w-12 border-r border-line-subtle bg-surface pr-0 group-hover:bg-surface-raised"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Checkbox
                    checked={selectedIds.includes(contact.contact_id)}
                    onCheckedChange={(checked) => onToggleRow?.(contact.contact_id, checked === true)}
                    className="h-4 w-4 rounded border border-line-strong bg-surface-raised"
                    aria-label={`Select contact ${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim()}
                  >
                    <CheckboxIndicator className="h-3 w-3" />
                  </Checkbox>
                </TableCell>
                {visibleColumns.map((column, index) => (
                  <Fragment key={column}>{renderCell(contact, column, index === 0)}</Fragment>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
