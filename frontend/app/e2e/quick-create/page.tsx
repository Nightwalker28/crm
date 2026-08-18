import { notFound } from "next/navigation";

import { QuickCreateSurfaceHarness } from "@/components/testing/QuickCreateSurfaceHarness";

export const dynamic = "force-dynamic";

export default function QuickCreateSurfaceTestPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return <QuickCreateSurfaceHarness />;
}
