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
import type { Organization } from "@/hooks/sales/useOrganizations";

type Props = {
  organizations: Organization[];
  isLoading: boolean;
  visibleColumns: string[];
};

export default function OrganizationsTable({
  organizations,
  isLoading,
  visibleColumns = [],
}: Props) {
  const hasColumn = (key: string) => visibleColumns.includes(key);

  return (
    <ModuleTableShell>
      <Table className="min-w-[960px]">
        <TableHeader>
          <TableHeaderRow>
            {hasColumn("org_name") && <TableHead>Organization</TableHead>}
            {hasColumn("primary_email") && <TableHead>Email</TableHead>}
            {hasColumn("website") && <TableHead>Website</TableHead>}
            {hasColumn("industry") && <TableHead>Industry</TableHead>}
            {hasColumn("annual_revenue") && <TableHead>Revenue</TableHead>}
            {hasColumn("primary_phone") && <TableHead>Phone</TableHead>}
            {hasColumn("billing_country") && <TableHead>Country</TableHead>}
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
                {hasColumn("org_name") && <TableCell>{org.org_name}</TableCell>}
                {hasColumn("primary_email") && <TableCell>{org.primary_email || "-"}</TableCell>}
                {hasColumn("website") && (
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
                )}
                {hasColumn("industry") && <TableCell>{org.industry || "-"}</TableCell>}
                {hasColumn("annual_revenue") && <TableCell>{org.annual_revenue || "-"}</TableCell>}
                {hasColumn("primary_phone") && <TableCell>{org.primary_phone || "-"}</TableCell>}
                {hasColumn("billing_country") && <TableCell>{org.billing_country || "-"}</TableCell>}
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
