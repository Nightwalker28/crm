"use client";

import { useParams } from "next/navigation";
import OrganizationRecordFormPage from "@/components/organizations/OrganizationRecordFormPage";

export default function EditAccountPage() {
  const params = useParams<{ orgId: string }>();
  return <OrganizationRecordFormPage mode="edit" orgId={params.orgId} />;
}
