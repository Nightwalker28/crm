"use client";

import { Download, FileText, RefreshCw } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/runtime-config";

type PublicQuoteProposal = {
  quote_number: string;
  customer_name: string;
  title: string;
  content_text: string;
  currency?: string | null;
  total_amount?: string | number | null;
  expiry_date?: string | null;
};

async function readJsonSafely(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function detailMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return fallback;
}

function money(value: string | number | null | undefined, currency: string | null | undefined) {
  const amount = Number(value);
  return `${currency || "USD"} ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function PublicQuoteProposalPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [proposal, setProposal] = useState<PublicQuoteProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const apiPath = useMemo(() => `/sales/quotes/proposal/public/${encodeURIComponent(token)}`, [token]);

  useEffect(() => {
    let active = true;
    async function loadProposal() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(apiUrl(apiPath), { headers: { Accept: "application/json" } });
        const body = await readJsonSafely(res);
        if (!res.ok) throw new Error(detailMessage(body, "Proposal link not found."));
        if (active) setProposal(body as PublicQuoteProposal);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Proposal link not found.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadProposal();
    return () => {
      active = false;
    };
  }, [apiPath]);

  async function handleDownload() {
    if (!proposal) return;
    setDownloading(true);
    try {
      const res = await fetch(apiUrl(`${apiPath}/events`), {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ event_type: "downloaded" }),
      });
      if (!res.ok) {
        const body = await readJsonSafely(res);
        throw new Error(detailMessage(body, "Could not record proposal download."));
      }
      downloadText(`${proposal.quote_number}-proposal.txt`, proposal.content_text);
    } catch (downloadError) {
      toast.error(downloadError instanceof Error ? downloadError.message : "Failed to download proposal.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-6">
        <header className="border-b border-neutral-800 pb-4">
          <div className="font-lynk text-3xl text-white">Lynk</div>
        </header>

        <section className="flex flex-1 flex-col py-6">
          {loading ? (
            <div className="flex flex-1 items-center justify-center rounded-md border border-neutral-800 bg-neutral-900 text-sm text-neutral-400">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Loading proposal...
            </div>
          ) : error || !proposal ? (
            <div className="rounded-md border border-red-900/60 bg-red-950/20 p-5 text-sm text-red-200">
              {error || "Proposal link not found."}
            </div>
          ) : (
            <div className="grid gap-5">
              <div className="rounded-md border border-neutral-800 bg-neutral-900 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm text-neutral-400">
                      <FileText className="h-4 w-4" />
                      {proposal.quote_number}
                    </div>
                    <h1 className="mt-2 text-2xl font-semibold tracking-normal text-neutral-50">{proposal.title}</h1>
                    <p className="mt-1 text-sm text-neutral-400">{proposal.customer_name}</p>
                  </div>
                  <div className="text-left sm:text-right">
                    <div className="text-xl font-semibold text-neutral-50">{money(proposal.total_amount, proposal.currency)}</div>
                    {proposal.expiry_date ? <div className="mt-1 text-sm text-neutral-500">Expires {proposal.expiry_date}</div> : null}
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-neutral-800 bg-neutral-900 p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-semibold text-neutral-100">Proposal</h2>
                  <Button type="button" variant="outline" onClick={() => void handleDownload()} disabled={downloading}>
                    {downloading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Download
                  </Button>
                </div>
                <pre className="max-h-[42rem] overflow-auto whitespace-pre-wrap rounded-md border border-neutral-800 bg-neutral-950 p-4 text-sm leading-6 text-neutral-300">{proposal.content_text}</pre>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
