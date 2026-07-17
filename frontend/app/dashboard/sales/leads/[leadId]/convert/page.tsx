"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import LeadConversionForm from "@/components/leads/LeadConversionForm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { apiFetch } from "@/lib/api";

type LeadSummary = { lead: { lead_id: number; first_name?: string | null; last_name?: string | null; company?: string | null; primary_email: string; status?: string | null } };

async function fetchLeadSummary(leadId: string) {
  const res = await apiFetch(`/sales/leads/${leadId}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body as LeadSummary;
}

export default function ConvertLeadPage() {
  const params = useParams<{ leadId: string }>();
  const summaryQuery = useQuery({ queryKey: ["sales-lead-summary", params.leadId], queryFn: () => fetchLeadSummary(params.leadId), enabled: Boolean(params.leadId), refetchOnWindowFocus: false });
  const backHref = `/dashboard/sales/leads/${params.leadId}`;

  if (summaryQuery.isLoading) return <RouteLoadingState label="lead conversion" />;
  if (!summaryQuery.data || summaryQuery.error) return <RouteErrorState title="Unable to prepare this lead conversion" reset={() => void summaryQuery.refetch()} backHref={backHref} backLabel="Back to lead" />;

  const lead = summaryQuery.data.lead;
  const leadName = `${lead.first_name || ""} ${lead.last_name || ""}`.trim() || lead.primary_email;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Convert ${leadName}`} description="Confirm the account, contact, and opportunity records created by this conversion." actions={<Button asChild variant="ghost" size="sm"><Link href={backHref}><ArrowLeft />Back to lead</Link></Button>} />
      {lead.status === "converted" ? (
        <Card className="p-6"><p className="text-sm text-copy-secondary">This lead has already been converted.</p><Button asChild className="mt-4"><Link href={backHref}>Return to lead</Link></Button></Card>
      ) : <LeadConversionForm leadId={lead.lead_id} leadName={leadName} company={lead.company} />}
    </div>
  );
}
