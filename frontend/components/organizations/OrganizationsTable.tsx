"use client";

import { useMemo } from "react";
import { Building2 } from "lucide-react";

import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/button";
import { CustomFieldValue } from "@/components/ui/CustomFieldValue";
import { RecordTable, type RecordTableColumn, type RecordTableSort } from "@/components/ui/RecordTable";
import type { Organization } from "@/hooks/sales/useOrganizations";
import type { TableColumnOption } from "@/types/table";
import { getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";
import { formatWebsiteDisplay, normalizeWebsiteHref } from "@/lib/urlDisplay";
import { formatDateTime } from "@/lib/datetime";

type Props = {
  organizations: Organization[];
  isLoading: boolean;
  isRefreshing?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  selectedIds?: number[];
  onToggleRow?: (orgId: number, checked: boolean) => void;
  onToggleCurrentPage?: (checked: boolean) => void;
  sort?: RecordTableSort | null;
  onSortChange?: (sort: RecordTableSort) => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  onCreateOrganization?: () => void;
};

const HEADERS: Record<string, string> = {
  org_name: "Account",
  primary_email: "Email",
  website: "Website",
  industry: "Industry",
  annual_revenue: "Revenue",
  primary_phone: "Phone",
  billing_country: "Country",
  assigned_to_name: "Owner",
  created_time: "Created",
  updated_at: "Updated",
};

const SORTABLE_COLUMNS = new Set([
  "org_name",
  "primary_email",
  "website",
  "industry",
  "annual_revenue",
  "primary_phone",
  "billing_country",
  "assigned_to",
  "customer_group_id",
  "created_time",
  "updated_at",
]);

const COLUMN_SIZES: Record<string, "sm" | "md" | "lg"> = {
  org_name: "lg",
  primary_email: "lg",
  website: "lg",
  billing_country: "sm",
  industry: "sm",
};

function getOrgInitials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("");
}

function emptyValue() {
  return <span className="text-copy-disabled">—</span>;
}

function renderCell(org: Organization, column: string) {
  if (isCustomFieldColumnKey(column)) return <CustomFieldValue column={column} values={org.custom_fields} />;

  switch (column) {
    case "org_name":
      return (
        <div className="flex h-8 items-center gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-control-sm)] border border-line-default bg-surface-muted text-2xs font-bold leading-none text-copy-secondary">
            {getOrgInitials(org.org_name)}
          </div>
          <span className="truncate text-sm font-semibold text-copy-primary">{org.org_name}</span>
        </div>
      );
    case "primary_email":
      return <span className="text-sm text-copy-secondary">{org.primary_email || emptyValue()}</span>;
    case "website":
      return org.website ? (
        <a
          href={normalizeWebsiteHref(org.website)}
          target="_blank"
          rel="noopener noreferrer"
          className="block max-w-[200px] truncate rounded-[var(--radius-control-sm)] text-sm text-action-primary transition-colors duration-100 hover:text-action-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {formatWebsiteDisplay(org.website)}
        </a>
      ) : (
        <span className="text-sm text-copy-disabled">—</span>
      );
    case "industry":
      return org.industry ? <Chip className="max-w-36">{org.industry}</Chip> : <span className="text-sm text-copy-disabled">—</span>;
    case "annual_revenue":
      return org.annual_revenue
        ? <span className="text-sm font-medium text-state-success">{org.annual_revenue}</span>
        : <span className="text-sm text-copy-disabled">—</span>;
    case "primary_phone":
      return <span className="text-sm text-copy-muted">{org.primary_phone || emptyValue()}</span>;
    case "billing_country":
      return <span className="text-sm text-copy-muted">{org.billing_country || emptyValue()}</span>;
    case "assigned_to_name":
      return <span className="text-sm text-copy-secondary">{org.assigned_to_name || "Unassigned"}</span>;
    case "created_time":
      return <span className="text-sm text-copy-muted">{org.created_time ? formatDateTime(org.created_time) : "-"}</span>;
    case "updated_at":
      return <span className="text-sm text-copy-muted">{org.updated_at ? formatDateTime(org.updated_at) : "-"}</span>;
    default:
      return null;
  }
}

export default function OrganizationsTable({
  organizations,
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
  onCreateOrganization,
}: Props) {
  const columns = useMemo<RecordTableColumn<Organization>[]>(
    () =>
      visibleColumns.map((column) => ({
        key: column,
        label: HEADERS[column] ?? getReadableColumnLabel(column, columnOptions),
        sortable: !isCustomFieldColumnKey(column) && SORTABLE_COLUMNS.has(column),
        size: COLUMN_SIZES[column],
        interactive: column === "website",
        render: (org) => renderCell(org, column),
      })),
    [visibleColumns, columnOptions],
  );

  return (
    <RecordTable
      label="Accounts"
      columns={columns}
      rows={organizations}
      rowKey={(org) => org.org_id ?? 0}
      rowHref={(org) => `/dashboard/sales/organizations/${org.org_id}`}
      rowLabel={(org) => `Open account ${org.org_name}`}
      selection={
        onToggleRow && onToggleCurrentPage
          ? {
              selectedIds,
              onToggleRow: (id, checked) => onToggleRow(Number(id), checked),
              onToggleAll: onToggleCurrentPage,
              rowLabel: (org) => `Select account ${org.org_name}`,
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
        icon: Building2,
        title: "No accounts yet",
        description: "Create an account or import accounts from CSV.",
        action: onCreateOrganization ? <Button type="button" onClick={onCreateOrganization}>Create account</Button> : undefined,
      }}
      filteredEmptyState={{ icon: Building2 }}
    />
  );
}
