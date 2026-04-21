"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, BriefcaseBusiness, Users } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";

type SalesSummaryResponse = {
  contacts: { total_count: number; results: Array<{ contact_id: number; first_name?: string | null; last_name?: string | null; primary_email?: string | null; created_time?: string | null }> };
  organizations: { total_count: number; results: Array<{ org_id?: number; org_name: string; primary_email?: string | null }> };
  opportunities: { total_count: number; results: Array<{ opportunity_id: number; opportunity_name: string; sales_stage?: string | null; total_cost_of_project?: string | null; created_time?: string | null }> };
};

async function fetchSalesSummary(): Promise<SalesSummaryResponse> {
  const [contactsRes, organizationsRes, opportunitiesRes] = await Promise.all([
    apiFetch("/sales/contacts?page=1&page_size=5&fields=first_name,last_name,primary_email,created_time"),
    apiFetch("/sales/organizations?page=1&page_size=5&fields=org_name,primary_email"),
    apiFetch("/sales/opportunities?page=1&page_size=5&fields=opportunity_name,sales_stage,total_cost_of_project,created_time"),
  ]);

  if (!contactsRes.ok || !organizationsRes.ok || !opportunitiesRes.ok) {
    throw new Error("Failed to load sales summary.");
  }

  const [contacts, organizations, opportunities] = await Promise.all([
    contactsRes.json(),
    organizationsRes.json(),
    opportunitiesRes.json(),
  ]);

  return {
    contacts,
    organizations,
    opportunities,
  } as SalesSummaryResponse;
}

function getContactName(contact: SalesSummaryResponse["contacts"]["results"][number]) {
  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim();
  return fullName || contact.primary_email || "Unnamed contact";
}

export default function SalesPage() {
  const summaryQuery = useQuery({
    queryKey: ["sales-dashboard-summary"],
    queryFn: fetchSalesSummary,
    staleTime: 30000,
  });

  const data = summaryQuery.data;

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="Sales"
        description="Sales entry point with live CRM counts, recent records, and direct access into pipeline work."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/dashboard/sales/contacts">Contacts</Link>
            </Button>
            <Button asChild>
              <Link href="/dashboard/sales/opportunities">Open Pipeline</Link>
            </Button>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">Contacts</div>
            <Users className="h-4 w-4 text-neutral-500" />
          </div>
          <div className="mt-3 text-3xl font-semibold text-neutral-100">{data?.contacts.total_count ?? "—"}</div>
          <div className="mt-2 text-sm text-neutral-400">People records currently in the CRM.</div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">Organizations</div>
            <Building2 className="h-4 w-4 text-neutral-500" />
          </div>
          <div className="mt-3 text-3xl font-semibold text-neutral-100">{data?.organizations.total_count ?? "—"}</div>
          <div className="mt-2 text-sm text-neutral-400">Accounts and company records linked to the sales graph.</div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">Opportunities</div>
            <BriefcaseBusiness className="h-4 w-4 text-neutral-500" />
          </div>
          <div className="mt-3 text-3xl font-semibold text-neutral-100">{data?.opportunities.total_count ?? "—"}</div>
          <div className="mt-2 text-sm text-neutral-400">Current pipeline records available for qualification and finance handoff.</div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 xl:col-span-1">
          <div className="border-b border-neutral-800 px-5 py-4">
            <h2 className="text-base font-semibold text-neutral-100">Recent Contacts</h2>
            <p className="mt-1 text-sm text-neutral-400">Newest people added to the CRM.</p>
          </div>
          {summaryQuery.isLoading ? (
            <div className="px-5 py-8 text-sm text-neutral-500">Loading contacts…</div>
          ) : data?.contacts.results.length ? (
            <div className="divide-y divide-neutral-800">
              {data.contacts.results.map((contact) => (
                <Link
                  key={contact.contact_id}
                  href={`/dashboard/sales/contacts/${contact.contact_id}`}
                  className="block px-5 py-4 transition-colors hover:bg-neutral-900/50"
                >
                  <div className="text-sm font-medium text-neutral-100">{getContactName(contact)}</div>
                  <div className="mt-1 text-sm text-neutral-400">{contact.primary_email || "No email"}</div>
                  <div className="mt-2 text-xs text-neutral-500">
                    {contact.created_time ? formatDateTime(contact.created_time) : "Created time unavailable"}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="px-5 py-8 text-sm text-neutral-500">No contacts yet.</div>
          )}
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 xl:col-span-1">
          <div className="border-b border-neutral-800 px-5 py-4">
            <h2 className="text-base font-semibold text-neutral-100">Organizations</h2>
            <p className="mt-1 text-sm text-neutral-400">Accounts you can jump into immediately.</p>
          </div>
          {summaryQuery.isLoading ? (
            <div className="px-5 py-8 text-sm text-neutral-500">Loading organizations…</div>
          ) : data?.organizations.results.length ? (
            <div className="divide-y divide-neutral-800">
              {data.organizations.results.map((organization) => (
                <Link
                  key={organization.org_id ?? organization.org_name}
                  href={organization.org_id ? `/dashboard/sales/organizations/${organization.org_id}` : "/dashboard/sales/organizations"}
                  className="block px-5 py-4 transition-colors hover:bg-neutral-900/50"
                >
                  <div className="text-sm font-medium text-neutral-100">{organization.org_name}</div>
                  <div className="mt-1 text-sm text-neutral-400">{organization.primary_email || "No primary email"}</div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="px-5 py-8 text-sm text-neutral-500">No organizations yet.</div>
          )}
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 xl:col-span-1">
          <div className="border-b border-neutral-800 px-5 py-4">
            <h2 className="text-base font-semibold text-neutral-100">Pipeline Snapshot</h2>
            <p className="mt-1 text-sm text-neutral-400">Latest opportunity records alongside the full pipeline view in the opportunities module.</p>
          </div>
          {summaryQuery.isLoading ? (
            <div className="px-5 py-8 text-sm text-neutral-500">Loading opportunities…</div>
          ) : data?.opportunities.results.length ? (
            <div className="divide-y divide-neutral-800">
              {data.opportunities.results.map((opportunity) => (
                <Link
                  key={opportunity.opportunity_id}
                  href="/dashboard/sales/opportunities"
                  className="block px-5 py-4 transition-colors hover:bg-neutral-900/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-neutral-100">{opportunity.opportunity_name}</div>
                      <div className="mt-1 text-sm text-neutral-400">
                        {opportunity.sales_stage || "No stage"}{opportunity.total_cost_of_project ? ` · ${opportunity.total_cost_of_project}` : ""}
                      </div>
                      <div className="mt-2 text-xs text-neutral-500">
                        {opportunity.created_time ? formatDateTime(opportunity.created_time) : "Created time unavailable"}
                      </div>
                    </div>
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-neutral-600" />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="px-5 py-8 text-sm text-neutral-500">No opportunities yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
