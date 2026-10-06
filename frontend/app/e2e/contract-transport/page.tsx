import { notFound } from "next/navigation";

import { ContractTransportHarness } from "@/components/testing/ContractTransportHarness";

export const dynamic = "force-dynamic";

export default function ContractTransportTestPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return <ContractTransportHarness />;
}
