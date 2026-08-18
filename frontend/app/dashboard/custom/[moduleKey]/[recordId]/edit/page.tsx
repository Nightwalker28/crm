"use client";

import { useParams } from "next/navigation";

import CustomModuleRecordEditPage from "@/components/customModules/CustomModuleRecordEditPage";

export default function EditCustomModuleRecordPage() {
  const params = useParams<{ moduleKey: string; recordId: string }>();
  return <CustomModuleRecordEditPage moduleKey={params.moduleKey} recordId={params.recordId} />;
}
