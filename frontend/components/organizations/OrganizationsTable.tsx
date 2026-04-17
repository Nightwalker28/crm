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
import { Pill } from "@/components/ui/Pill";
import type { Organization } from "@/hooks/sales/useOrganizations";
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import { getCustomFieldKeyFromColumn, getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";

type Props = {
  organizations: Organization[];
  isLoading: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
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
  visibleColumns = [],
  columnOptions = [],
}: Props) {
  const headers: Record<string, string> = {
    org_name: "Organization",
    primary_email: "Email",
    website: "Website",
    industry: "Industry",
    annual_revenue: "Revenue",
    primary_phone: "Phone",
    billing_country: "Country",
  };

  const renderCell = (org: Organization, column: string) => {
    if (isCustomFieldColumnKey(column)) {
      const fieldKey = getCustomFieldKeyFromColumn(column);
      const value = org.custom_fields?.[fieldKey];
      return (
        <TableCell>
          <span className="text-sm text-neutral-300">
            {value == null || value === "" ? (
              <span className="text-neutral-600">—</span>
            ) : String(value)}
          </span>
        </TableCell>
      );
    }

    switch (column) {
      case "org_name":
        return (
          <TableCell>
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
                href={org.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-sky-400 hover:text-sky-300 transition-colors truncate block max-w-[200px]"
              >
                {org.website.replace(/^https?:\/\//, "")}
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
      default:
        return null;
    }
  };

  return (
    <ModuleTableShell>
      <Table className="min-w-[960px]">
        <TableHeader>
          <TableHeaderRow>
            {visibleColumns.map((column) => (
              <TableHead key={column}>
                {headers[column] ?? getReadableColumnLabel(column, columnOptions)}
              </TableHead>
            ))}
            <TableHead className="text-right pr-5">Record</TableHead>
          </TableHeaderRow>
        </TableHeader>

        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length + 1} className="py-16 text-center">
                <div className="flex flex-col items-center gap-3 text-neutral-500">
                  <div className="h-5 w-5 rounded-full border-2 border-neutral-700 border-t-neutral-400 animate-spin" />
                  <span className="text-sm">Loading organizations...</span>
                </div>
              </TableCell>
            </TableRow>
          ) : organizations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length + 1} className="py-16 text-center">
                <div className="flex flex-col items-center gap-2 text-neutral-500">
                  <svg className="w-8 h-8 text-neutral-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  <span className="text-sm">No organizations found</span>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            organizations.map((org) => (
              <TableRow key={org.org_id} className="group">
                {visibleColumns.map((column) => (
                  <Fragment key={column}>{renderCell(org, column)}</Fragment>
                ))}
                <TableCell className="text-right pr-5">
                  <Link
                    href={`/dashboard/sales/organizations/${org.org_id}`}
                    className="text-xs font-medium uppercase tracking-widest text-neutral-500 group-hover:text-neutral-200 transition-colors"
                  >
                    Open →
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
