"use client";

import { useParams } from "next/navigation";

import CustomModuleRecordCreatePage from "@/components/customModules/CustomModuleRecordCreatePage";

export default function NewCustomModuleRecordPage() {
  const params = useParams<{ moduleKey: string }>();
  return <CustomModuleRecordCreatePage moduleKey={params.moduleKey} />;
}
