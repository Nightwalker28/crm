"use client";

import { Download, FileText, Link2Off, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { downloadBlob } from "@/lib/browser";
import { formatDateOnly } from "@/lib/datetime";
import { apiUrl } from "@/lib/runtime-config";
import { formatMoney } from "@/lib/currency";

type PublicQuoteProposal = {
  quote_number: string;
  customer_name: string;
  title: string;
  content_text: string;
  currency?: string | null;
  total_amount?: string | number | null;
  expiry_date?: string | null;
};

type ProposalLoadError = "unavailable" | "temporary";

async function readJsonSafely(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function money(value: string | number | null | undefined, currency: string | null | undefined) {
  return formatMoney(value, currency) ?? formatMoney(0, currency) ?? "";
}

function isPublicQuoteProposal(value: unknown): value is PublicQuoteProposal {
  if (!value || typeof value !== "object") return false;
  const proposal = value as Partial<PublicQuoteProposal>;
  return (
    typeof proposal.quote_number === "string"
    && typeof proposal.customer_name === "string"
    && typeof proposal.title === "string"
    && typeof proposal.content_text === "string"
  );
}

function proposalFilename(quoteNumber: string) {
  const safeQuoteNumber = quoteNumber
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${safeQuoteNumber || "quote"}-proposal.txt`;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  downloadBlob(blob, filename);
}

export default function PublicQuoteProposalPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [proposal, setProposal] = useState<PublicQuoteProposal | null>(null);
  const [error, setError] = useState<ProposalLoadError | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const apiPath = useMemo(() => `/sales/quotes/proposal/public/${encodeURIComponent(token)}`, [token]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadProposal() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(apiUrl(apiPath), {
          cache: "no-store",
          credentials: "omit",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const body = await readJsonSafely(res);
        if (res.status === 404) {
          setProposal(null);
          setError("unavailable");
          return;
        }
        if (!res.ok || !isPublicQuoteProposal(body)) {
          setProposal(null);
          setError("temporary");
          return;
        }
        setProposal(body);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setProposal(null);
        setError("temporary");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadProposal();
    return () => controller.abort();
  }, [apiPath, reloadKey]);

  async function recordDownloadEvent() {
    try {
      await fetch(apiUrl(`${apiPath}/events`), {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ event_type: "downloaded" }),
      });
    } catch {
      // Analytics must never block access to the customer document.
    }
  }

  function handleDownload() {
    if (!proposal) return;
    setDownloading(true);
    try {
      downloadText(proposalFilename(proposal.quote_number), proposal.content_text);
      void recordDownloadEvent();
    } catch {
      toast.error("The proposal could not be downloaded. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <main className="min-h-screen bg-app text-copy-primary">
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle pb-4">
          <div className="font-lynk text-3xl text-copy-primary">Lynk</div>
          <div className="flex items-center gap-2 text-xs text-copy-muted">
            <ShieldCheck className="h-4 w-4 text-state-success" aria-hidden="true" />
            Time-limited proposal link
          </div>
        </header>

        <section className="flex flex-1 flex-col py-6 sm:py-8" aria-live="polite">
          {loading ? (
            <Card className="flex min-h-64 flex-1 items-center justify-center p-6" role="status" aria-busy="true">
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-copy-muted" aria-hidden="true" />
              <span className="text-sm text-copy-secondary">Loading proposal…</span>
            </Card>
          ) : error || !proposal ? (
            <Card className="flex min-h-64 flex-col items-center justify-center border-state-danger/40 bg-state-danger-muted p-6 text-center" role="alert">
              <Link2Off className="h-9 w-9 text-state-danger" aria-hidden="true" />
              <h1 className="mt-4 text-xl font-semibold text-copy-primary">
                {error === "unavailable" ? "This proposal link is unavailable" : "The proposal could not be loaded"}
              </h1>
              <p className="mt-2 max-w-md text-p-sm text-copy-secondary">
                {error === "unavailable"
                  ? "The link may have expired or been replaced. Ask the sender for a new proposal link."
                  : "Check your connection and try again. If the problem continues, contact the sender."}
              </p>
              {error === "temporary" ? (
                <Button type="button" variant="outline" className="mt-5" onClick={() => setReloadKey((current) => current + 1)}>
                  <RefreshCw />
                  Try again
                </Button>
              ) : null}
            </Card>
          ) : (
            <div className="grid gap-5">
              <Card className="p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm text-copy-muted">
                      <FileText className="h-4 w-4" aria-hidden="true" />
                      {proposal.quote_number}
                    </div>
                    <h1 className="mt-2 text-2xl font-semibold tracking-normal text-copy-primary">{proposal.title}</h1>
                    <p className="mt-1 text-sm text-copy-secondary">Prepared for {proposal.customer_name}</p>
                  </div>
                  <div className="text-left sm:text-right">
                    <div className="text-xl font-semibold tabular-nums text-copy-primary">{money(proposal.total_amount, proposal.currency)}</div>
                    {proposal.expiry_date ? (
                      <div className="mt-1 text-sm text-copy-muted">
                        Quote valid until <time dateTime={proposal.expiry_date}>{formatDateOnly(proposal.expiry_date)}</time>
                      </div>
                    ) : null}
                  </div>
                </div>
              </Card>

              <Card className="p-5 sm:p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-copy-primary">Proposal</h2>
                    <p className="mt-1 text-sm text-copy-muted">Review the scope, pricing, and terms supplied by the sender.</p>
                  </div>
                  <Button type="button" variant="outline" onClick={handleDownload} disabled={downloading} aria-label={`Download proposal ${proposal.quote_number}`}>
                    {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {downloading ? "Preparing…" : "Download proposal"}
                  </Button>
                </div>
                {proposal.content_text.trim() ? (
                  <article className="whitespace-pre-wrap rounded-[var(--radius-control)] border border-line-subtle bg-surface-muted p-4 text-p-sm text-copy-secondary sm:p-5">
                    {proposal.content_text}
                  </article>
                ) : (
                  <div className="rounded-[var(--radius-control)] border border-dashed border-line-default bg-surface-muted p-6 text-center text-sm text-copy-muted">
                    No proposal content was provided.
                  </div>
                )}
              </Card>
            </div>
          )}
        </section>

        <footer className="border-t border-line-subtle pt-4 text-center text-p-xs text-copy-muted">
          This link provides access only to the proposal shared by its sender.
        </footer>
      </div>
    </main>
  );
}
