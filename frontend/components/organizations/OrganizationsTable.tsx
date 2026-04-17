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
import type { Organization } from "@/hooks/sales/useOrganizations";
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import { getCustomFieldKeyFromColumn, getReadableColumnLabel, isCustomFieldColumnKey } from "@/lib/moduleViewConfigs";

type Props = {
  organizations: Organization[];
  isLoading: boolean;
  visibleColumns: string[];
  columnOptions?: TableColumnOption[];
};

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
      return <TableCell>{value == null || value === "" ? "-" : String(value)}</TableCell>;
    }
    switch (column) {
      case "org_name":
        return <TableCell>{org.org_name}</TableCell>;
      case "primary_email":
        return <TableCell>{org.primary_email || "-"}</TableCell>;
      case "website":
        return (
          <TableCell>
            {org.website ? (
              <a
                href={org.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 hover:text-sky-200"
              >
                {org.website.replace(/^https?:\/\//, "")}
              </a>
            ) : (
              "-"
            )}
          </TableCell>
        );
      case "industry":
        return <TableCell>{org.industry || "-"}</TableCell>;
      case "annual_revenue":
        return <TableCell>{org.annual_revenue || "-"}</TableCell>;
      case "primary_phone":
        return <TableCell>{org.primary_phone || "-"}</TableCell>;
      case "billing_country":
        return <TableCell>{org.billing_country || "-"}</TableCell>;
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
              <TableHead key={column}>{headers[column] ?? getReadableColumnLabel(column, columnOptions)}</TableHead>
            ))}
            <TableHead className="text-right">Record</TableHead>
          </TableHeaderRow>
        </TableHeader>

        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length + 1} className="py-10 text-center text-neutral-500">
                Loading organizations...
              </TableCell>
            </TableRow>
          ) : organizations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length + 1} className="py-10 text-center text-neutral-500">
                No organizations found.
              </TableCell>
            </TableRow>
          ) : (
            organizations.map((org) => (
              <TableRow key={org.org_id}>
                {visibleColumns.map((column) => (
                  <Fragment key={column}>{renderCell(org, column)}</Fragment>
                ))}
                <TableCell className="text-right">
                  <Link
                    href={`/dashboard/sales/organizations/${org.org_id}`}
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
