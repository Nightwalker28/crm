"use client";

import { useParams } from "next/navigation";

import ContractRecordFormPage from "@/components/contracts/ContractRecordFormPage";

export default function EditContractPage() {
  const params = useParams<{ contractId: string }>();
  return <ContractRecordFormPage mode="edit" contractId={params.contractId} />;
}
