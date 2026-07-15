"use client";

import { useParams } from "next/navigation";
import OpportunityRecordFormPage from "@/components/opportunities/OpportunityRecordFormPage";

export default function EditOpportunityPage() { const params = useParams<{ opportunityId: string }>(); return <OpportunityRecordFormPage mode="edit" opportunityId={params.opportunityId} />; }
