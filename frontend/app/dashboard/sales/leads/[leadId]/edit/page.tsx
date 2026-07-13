"use client";

import { useParams } from "next/navigation";

import LeadRecordFormPage from "@/components/leads/LeadRecordFormPage";

export default function EditLeadPage() {
  const params = useParams<{ leadId: string }>();
  return <LeadRecordFormPage mode="edit" leadId={params.leadId} />;
}
