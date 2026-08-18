"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { RecordLayoutContractError, fetchResolvedRecordLayout } from "@/lib/contracts/recordLayouts";

// A path that exists only so the transport probes have something to intercept.
const PROBE_PATH = "/contract-transport-probe";

/**
 * Test-only surface for the layout contract pilot. It proves two rules that the generated
 * contract layer must never regress: `apiFetch` retries reads but not writes, and the
 * adapter reports contract failures as typed errors.
 */
export function ContractTransportHarness() {
  const [result, setResult] = useState("idle");

  async function probeTransport(method: "GET" | "POST") {
    setResult("running");
    try {
      const response = await apiFetch(
        PROBE_PATH,
        method === "GET" ? {} : { method: "POST", body: JSON.stringify({}) },
      );
      setResult(`${method}:${response.status}`);
    } catch {
      setResult(`${method}:threw`);
    }
  }

  async function probeLayoutContract() {
    setResult("running");
    try {
      await fetchResolvedRecordLayout("sales_leads", "quick_create");
      setResult("layout:ok");
    } catch (error) {
      if (error instanceof RecordLayoutContractError) {
        setResult(`layout:${error.kind}:${error.status ?? "none"}`);
        return;
      }
      setResult("layout:untyped");
    }
  }

  return (
    <main className="min-h-screen bg-app p-6 text-copy-primary">
      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={() => probeTransport("GET")}>
          Send read probe
        </Button>
        <Button type="button" onClick={() => probeTransport("POST")}>
          Send write probe
        </Button>
        <Button type="button" onClick={probeLayoutContract}>
          Load layout contract
        </Button>
      </div>
      <pre data-testid="probe-result" className="mt-4 text-xs">
        {result}
      </pre>
    </main>
  );
}
