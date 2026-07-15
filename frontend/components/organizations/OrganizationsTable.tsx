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
  SaaS: { bg: "bg-sky-900/30", text: "text-sky-300", border: "border-sky-700/40" },
  Technology: { bg: "bg-sky-900/30", text: "text-sky-300", border: "border-sky-700/40" },
  Finance: { bg: "bg-emerald-900/30", text: "text-emerald-300", border: "border-emerald-700/40" },
  Healthcare: { bg: "bg-teal-900/30", text: "text-teal-300", border: "border-teal-700/40" },
  Media: { bg: "bg-violet-900/30", text: "text-violet-300", border: "border-violet-700/40" },
  Retail: { bg: "bg-orange-900/30", text: "text-orange-300", border: "border-orange-700/40" },
};

function getIndustryStyle(industry?: string | null) {
  if (!industry) return { bg: "bg-neutral-800/40", text: "text-neutral-400", border: "border-neutral-700/40" };
  const key = Object.keys(INDUSTRY_STYLES).find(k => industry.toLowerCase().includes(k.toLowerCase()));
  return key ? INDUSTRY_STYLES[key] : { bg: "bg-neutral-800/40", text: "text-neutral-400", border: "border-neutral-700/40" };
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
    const stickyClassName = isIdentityColumn ? "sticky left-12 z-10 border-r border-line-subtle bg-neutral-950 group-hover:bg-neutral-900" : undefined;
    if (isCustomFieldColumnKey(column)) {
      return <CustomFieldCell column={column} values={org.custom_fields} className={stickyClassName} />;
    }

    switch (column) {
      case "org_name":
        return (
          <TableCell className={stickyClassName}>
            <div className="flex items-center gap-3 h-8">
              <div className="h-7 w-7 rounded-md bg-neutral-800 border border-neutral-700 flex items-center justify-center text-[9px] font-bold text-neutral-300 shrink-0 leading-none">
                {getOrgInitials(org.org_name)}
              </div>
              <span className="text-sm font-semibold text-neutral-100 truncate">
                {org.org_name}
              </span>
            </div>
          </TableCell>
        );
      case "primary_email":
        return (
          <TableCell>
            <span className="text-sm text-neutral-300 font-mono tracking-tight">
              {org.primary_email || <span className="text-neutral-600">—</span>}
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
                className="text-sm text-sky-400 hover:text-sky-300 transition-colors truncate block max-w-[200px]"
              >
                {formatWebsiteDisplay(org.website)}
              </a>
            ) : (
              <span className="text-neutral-600 text-sm">—</span>
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
            })() : <span className="text-neutral-600 text-sm">—</span>}
          </TableCell>
        );
      case "annual_revenue":
        return (
          <TableCell>
            {org.annual_revenue ? (
              <span className="text-sm font-medium text-emerald-300">
                {formatRevenue(org.annual_revenue)}
              </span>
            ) : (
              <span className="text-neutral-600 text-sm">—</span>
            )}
          </TableCell>
        );
      case "primary_phone":
        return (
          <TableCell>
            <span className="text-sm text-neutral-400 font-mono tracking-tight">
              {org.primary_phone || <span className="text-neutral-600">—</span>}
            </span>
          </TableCell>
        );
      case "billing_country":
        return (
          <TableCell>
            <span className="text-sm text-neutral-400">
              {org.billing_country || <span className="text-neutral-600">—</span>}
            </span>
          </TableCell>
        );
      case "assigned_to_name":
        return <TableCell><span className="text-sm text-neutral-300">{org.assigned_to_name || "Unassigned"}</span></TableCell>;
      case "created_time":
        return <TableCell><span className="text-sm text-neutral-400">{org.created_time ? formatDateTime(org.created_time) : "-"}</span></TableCell>;
      case "updated_at":
        return <TableCell><span className="text-sm text-neutral-400">{org.updated_at ? formatDateTime(org.updated_at) : "-"}</span></TableCell>;
      default:
        return null;
    }
  };

  return (
    <ModuleTableShell isRefreshing={isRefreshing}>
      <Table className="min-w-[960px]">
        <TableHeader>
          <TableHeaderRow>
            <TableHead className="sticky left-0 z-40 w-12 border-r border-line-subtle bg-neutral-900 pr-0">
              <Checkbox
                checked={currentPageSelectionState}
                onCheckedChange={(checked) => onToggleCurrentPage?.(checked === true)}
                className="h-4 w-4 rounded border border-neutral-700 bg-neutral-900"
                aria-label="Select current page organizations"
              >
                <CheckboxIndicator className="h-3 w-3" />
              </Checkbox>
            </TableHead>
            {visibleColumns.map((column, index) => {
              const label = headers[column] ?? getReadableColumnLabel(column, columnOptions);
              if (isCustomFieldColumnKey(column) || !sortableColumns.has(column)) {
                return <TableHead key={column} className={index === 0 ? "sticky left-12 z-30 border-r border-line-subtle bg-neutral-900" : undefined}>{label}</TableHead>;
              }
              const isSorted = sort?.column === column;
              return (
                <SortableHead
                  key={column}
                  sorted={isSorted}
                  direction={isSorted ? sort.direction : "asc"}
                  onClick={() => toggleSort(column)}
                  className={index === 0 ? "sticky left-12 z-30 border-r border-line-subtle bg-neutral-900" : undefined}
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
                  className="sticky left-0 z-20 w-12 border-r border-line-subtle bg-neutral-950 pr-0 group-hover:bg-neutral-900"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Checkbox
                    checked={selectedIds.includes(org.org_id ?? 0)}
                    onCheckedChange={(checked) => {
                      if (org.org_id != null) onToggleRow?.(org.org_id, checked === true);
                    }}
                    className="h-4 w-4 rounded border border-neutral-700 bg-neutral-900"
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
