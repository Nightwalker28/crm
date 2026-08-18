import { notFound } from "next/navigation";

import { RecordLayoutRuntimeHarness } from "@/components/testing/RecordLayoutRuntimeHarness";

export const dynamic = "force-dynamic";

export default function RecordLayoutRuntimeTestPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <RecordLayoutRuntimeHarness />;
}
