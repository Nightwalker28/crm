"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";

import {
  SortableHead,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableHeaderRow,
  TableRow,
} from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { CustomFieldCell } from "@/components/ui/CustomFieldCell";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import { Pill } from "@/components/ui/Pill";
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox";
import type { Organization } from "@/hooks/sales/useOrganizations";
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import { getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";
import { formatWebsiteDisplay, normalizeWebsiteHref } from "@/lib/urlDisplay";
import { formatDateTime } from "@/lib/datetime";

type SortState = { column: string; direction: "asc" | "desc" } | null;

type Props = {
  organizations: Organization[];
  isLoading: boolean;
  isRefreshing?: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
  selectedIds?: number[];
  currentPageSelectionState?: boolean | "indeterminate";
  onToggleRow?: (orgId: number, checked: boolean) => void;
  onToggleCurrentPage?: (checked: boolean) => void;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
};

const INDUSTRY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  SaaS: { bg: "bg-state-info-muted", text: "text-state-info", border: "border-state-info/40" },
  Technology: { bg: "bg-state-info-muted", text: "text-state-info", border: "border-state-info/40" },
  Finance: { bg: "bg-state-success-muted", text: "text-state-success", border: "border-state-success/40" },
  Healthcare: { bg: "bg-teal-900/30", text: "text-teal-300", border: "border-teal-700/40" },
  Media: { bg: "bg-violet-900/30", text: "text-violet-300", border: "border-violet-700/40" },
  Retail: { bg: "bg-orange-900/30", text: "text-orange-300", border: "border-orange-700/40" },
};

function getIndustryStyle(industry?: string | null) {
  if (!industry) return { bg: "bg-surface-muted", text: "text-copy-muted", border: "border-line-default" };
  const key = Object.keys(INDUSTRY_STYLES).find(k => industry.toLowerCase().includes(k.toLowerCase()));
  return key ? INDUSTRY_STYLES[key] : { bg: "bg-surface-muted", text: "text-copy-muted", border: "border-line-default" };
}

function getOrgInitials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
}

function formatRevenue(value?: string | null): string {
  if (!value) return "";
  return value;
}

export default function OrganizationsTable({
  organizations,
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
}: Props) {
  const router = useRouter();
  const headers: Record<string, string> = {
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
  const sortableColumns = new Set([
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

  function toggleSort(column: string) {
    const nextSort: SortState = sort?.column === column
      ? { column, direction: sort.direction === "asc" ? "desc" : "asc" }
      : { column, direction: "asc" };
    onSortChange?.(nextSort);
  }

  const renderCell = (org: Organization, column: string, isIdentityColumn: boolean) => {
    const stickyClassName = isIdentityColumn ? "sticky left-12 z-10 border-r border-line-subtle bg-surface group-hover:bg-surface-raised" : undefined;
    if (isCustomFieldColumnKey(column)) {
      return <CustomFieldCell column={column} values={org.custom_fields} className={stickyClassName} />;
    }

    switch (column) {
      case "org_name":
        return (
          <TableCell className={stickyClassName}>
            <div className="flex items-center gap-3 h-8">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-control-sm)] border border-line-default bg-surface-muted text-[9px] font-bold leading-none text-copy-secondary">
                {getOrgInitials(org.org_name)}
              </div>
              <span className="truncate text-sm font-semibold text-copy-primary">
                {org.org_name}
              </span>
            </div>
          </TableCell>
        );
      case "primary_email":
        return (
          <TableCell>
            <span className="font-mono text-sm tracking-tight text-copy-secondary">
              {org.primary_email || <span className="text-copy-disabled">—</span>}
            </span>
          </TableCell>
        );
      case "website":
        return (
          <TableCell>
            {org.website ? (
              <a
                href={normalizeWebsiteHref(org.website)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="block max-w-[200px] truncate text-sm text-action-primary transition-colors hover:text-action-primary-hover"
              >
                {formatWebsiteDisplay(org.website)}
              </a>
            ) : (
              <span className="text-sm text-copy-disabled">—</span>
            )}
          </TableCell>
        );
      case "industry":
        return (
          <TableCell>
            {org.industry ? (() => {
              const style = getIndustryStyle(org.industry);
              return (
                <Pill bg={style.bg} text={style.text} border={style.border} className="w-28">
                  {org.industry}
                </Pill>
              );
            })() : <span className="text-sm text-copy-disabled">—</span>}
          </TableCell>
        );
      case "annual_revenue":
        return (
          <TableCell>
            {org.annual_revenue ? (
              <span className="text-sm font-medium text-state-success">
                {formatRevenue(org.annual_revenue)}
              </span>
            ) : (
              <span className="text-sm text-copy-disabled">—</span>
            )}
          </TableCell>
        );
      case "primary_phone":
        return (
          <TableCell>
            <span className="font-mono text-sm tracking-tight text-copy-muted">
              {org.primary_phone || <span className="text-copy-disabled">—</span>}
            </span>
          </TableCell>
        );
      case "billing_country":
        return (
          <TableCell>
            <span className="text-sm text-copy-muted">
              {org.billing_country || <span className="text-copy-disabled">—</span>}
            </span>
          </TableCell>
        );
      case "assigned_to_name":
        return <TableCell><span className="text-sm text-copy-secondary">{org.assigned_to_name || "Unassigned"}</span></TableCell>;
      case "created_time":
        return <TableCell><span className="text-sm text-copy-muted">{org.created_time ? formatDateTime(org.created_time) : "-"}</span></TableCell>;
      case "updated_at":
        return <TableCell><span className="text-sm text-copy-muted">{org.updated_at ? formatDateTime(org.updated_at) : "-"}</span></TableCell>;
      default:
        return null;
    }
  };

  return (
    <ModuleTableShell isRefreshing={isRefreshing}>
      <Table className="min-w-[960px]">
        <TableHeader>
          <TableHeaderRow>
            <TableHead className="sticky left-0 z-40 w-12 border-r border-line-subtle bg-surface-raised pr-0">
              <Checkbox
                checked={currentPageSelectionState}
                onCheckedChange={(checked) => onToggleCurrentPage?.(checked === true)}
                className="h-4 w-4 rounded border border-line-strong bg-surface-raised"
                aria-label="Select current page organizations"
              >
                <CheckboxIndicator className="h-3 w-3" />
              </Checkbox>
            </TableHead>
            {visibleColumns.map((column, index) => {
              const label = headers[column] ?? getReadableColumnLabel(column, columnOptions);
              if (isCustomFieldColumnKey(column) || !sortableColumns.has(column)) {
                return <TableHead key={column} className={index === 0 ? "sticky left-12 z-30 border-r border-line-subtle bg-surface-raised" : undefined}>{label}</TableHead>;
              }
              const isSorted = sort?.column === column;
              return (
                <SortableHead
                  key={column}
                  sorted={isSorted}
                  direction={isSorted ? sort.direction : "asc"}
                  onClick={() => toggleSort(column)}
                  className={index === 0 ? "sticky left-12 z-30 border-r border-line-subtle bg-surface-raised" : undefined}
                >
                  {label}
                </SortableHead>
              );
            })}
          </TableHeaderRow>
        </TableHeader>

        <TableBody>
          {isLoading ? (
            <ModuleTableLoading columnCount={visibleColumns.length + 1} />
          ) : organizations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length + 1} className="py-16 text-center">
                {hasActiveFilters ? <EmptyState icon={Building2} title="No accounts match these filters" description="Clear one or more filters and try again." action={<Button type="button" variant="outline" onClick={onClearFilters}>Clear filters</Button>} /> : <EmptyState icon={Building2} title="No accounts yet" description="Create an account or import accounts from CSV." action={<Button asChild><Link href="/dashboard/sales/organizations/new">Create account</Link></Button>} />}
              </TableCell>
            </TableRow>
          ) : (
            organizations.map((org) => (
              <TableRow
                key={org.org_id}
                className="group cursor-pointer"
                onClick={() => router.push(`/dashboard/sales/organizations/${org.org_id}`)}
              >
                <TableCell
                  className="sticky left-0 z-20 w-12 border-r border-line-subtle bg-surface pr-0 group-hover:bg-surface-raised"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Checkbox
                    checked={selectedIds.includes(org.org_id ?? 0)}
                    onCheckedChange={(checked) => {
                      if (org.org_id != null) onToggleRow?.(org.org_id, checked === true);
                    }}
                    className="h-4 w-4 rounded border border-line-strong bg-surface-raised"
                    aria-label={`Select organization ${org.org_name}`}
                  >
                    <CheckboxIndicator className="h-3 w-3" />
                  </Checkbox>
                </TableCell>
                {visibleColumns.map((column, index) => (
                  <Fragment key={column}>{renderCell(org, column, index === 0)}</Fragment>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ModuleTableShell>
  );
}
