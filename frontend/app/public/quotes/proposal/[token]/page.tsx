"use client";

import { Check, Download, Link2Off, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  QuoteAcceptForm,
  QuoteDeclineForm,
  type QuoteAcceptValues,
  type QuoteDeclineValues,
  type QuoteOptionalItem,
} from "@/components/quotes/QuoteResponse";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Money } from "@/components/ui/Money";
import { downloadBlob } from "@/lib/browser";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { apiUrl } from "@/lib/runtime-config";

/** What `GET /sales/quotes/proposal/public/{token}` answers (13d §3.5). */
type PublicQuoteProposal = {
  quote_number: string;
  title?: string | null;
  company_name?: string | null;
  customer_name: string;
  currency?: string | null;
  total_amount?: string | number | null;
  expiry_date?: string | null;
  state: "open" | "accepted" | "declined" | "expired" | "replaced";
  can_respond: boolean;
  accepted_by_name?: string | null;
  accepted_at?: string | null;
  html: string;
  optional_items: QuoteOptionalItem[];
  decline_reasons: Array<{ key: string; label: string }>;
};

type ProposalLoadError = "unavailable" | "temporary";
type Mode = "view" | "accept" | "decline";

async function readJsonSafely(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function isPublicQuoteProposal(value: unknown): value is PublicQuoteProposal {
  if (!value || typeof value !== "object") return false;
  const proposal = value as Partial<PublicQuoteProposal>;
  return typeof proposal.quote_number === "string" && typeof proposal.html === "string" && typeof proposal.state === "string";
}

function errorDetail(body: unknown, fallback: string) {
  const detail = (body as { detail?: unknown } | null)?.detail;
  return typeof detail === "string" ? detail : fallback;
}

/** What the customer reads once the quote is no longer open. */
const CLOSED_COPY: Record<Exclude<PublicQuoteProposal["state"], "open">, { title: string; body: string }> = {
  accepted: { title: "Quote accepted", body: "Thank you. The sender has been told and will be in touch about next steps." },
  declined: { title: "Quote declined", body: "Thank you for letting us know. The sender has been told." },
  expired: { title: "This quote has expired", body: "It can no longer be accepted. Ask the sender for an updated quote." },
  replaced: { title: "This quote has been replaced", body: "The sender has issued a newer version. Use the link in their latest message." },
};

export default function PublicQuoteProposalPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [proposal, setProposal] = useState<PublicQuoteProposal | null>(null);
  const [error, setError] = useState<ProposalLoadError | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
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

  /** The PDF is the issued snapshot; the server records the download itself. */
  async function handleDownload() {
    if (!proposal) return;
    setDownloading(true);
    try {
      const res = await fetch(apiUrl(`${apiPath}/pdf`), { cache: "no-store", credentials: "omit" });
      if (!res.ok) throw new Error(errorDetail(await readJsonSafely(res), "The PDF could not be downloaded. Please try again."));
      const disposition = res.headers.get("content-disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${proposal.quote_number}.pdf`;
      downloadBlob(await res.blob(), filename);
    } catch (downloadError) {
      toast.error(downloadError instanceof Error ? downloadError.message : "The PDF could not be downloaded. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  async function respond(action: "accept" | "decline", payload: QuoteAcceptValues | QuoteDeclineValues) {
    setSubmitting(true);
    try {
      const res = await fetch(apiUrl(`${apiPath}/${action}`), {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await readJsonSafely(res);
      if (!res.ok || !isPublicQuoteProposal(body)) {
        throw new Error(errorDetail(body, action === "accept" ? "The quote could not be accepted. Please try again." : "Your answer could not be sent. Please try again."));
      }
      setProposal(body);
      setMode("view");
    } catch (respondError) {
      toast.error(respondError instanceof Error ? respondError.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const brand = proposal?.company_name || "Proposal";

  return (
    <main className="min-h-screen bg-app text-copy-primary">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle pb-4">
          <div className="text-lg font-semibold tracking-tight text-copy-primary">{brand}</div>
          <div className="flex items-center gap-2 text-xs text-copy-muted">
            <ShieldCheck className="h-4 w-4 text-state-success" aria-hidden="true" />
            Private quote link
          </div>
        </header>

        <section className="flex flex-1 flex-col py-6 sm:py-8" aria-live="polite">
          {loading ? (
            <Card className="flex min-h-64 flex-1 items-center justify-center p-6" role="status" aria-busy="true">
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-copy-muted" aria-hidden="true" />
              <span className="text-sm text-copy-secondary">Loading quote…</span>
            </Card>
          ) : error || !proposal ? (
            <Card className="flex min-h-64 flex-col items-center justify-center border-state-danger/40 bg-state-danger-muted p-6 text-center" role="alert">
              <Link2Off className="h-9 w-9 text-state-danger" aria-hidden="true" />
              <h1 className="mt-4 text-lg font-semibold text-copy-primary">
                {error === "unavailable" ? "This quote link is unavailable" : "The quote could not be loaded"}
              </h1>
              <p className="mt-2 max-w-md text-p-sm text-copy-secondary">
                {error === "unavailable"
                  ? "The link may have expired or been replaced. Ask the sender for a new link."
                  : "Check your connection and try again. If the problem continues, contact the sender."}
              </p>
              {error === "temporary" ? (
                <Button type="button" variant="outline" className="mt-4" onClick={() => setReloadKey((current) => current + 1)}>
                  <RefreshCw />
                  Try again
                </Button>
              ) : null}
            </Card>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
              <div className="grid min-w-0 gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="text-lg font-semibold text-copy-primary">
                      Quote {proposal.quote_number}{proposal.title ? ` · ${proposal.title}` : ""}
                    </h1>
                    <p className="mt-1 text-sm text-copy-secondary">Prepared for {proposal.customer_name}</p>
                  </div>
                  <Button type="button" variant="outline" onClick={() => void handleDownload()} disabled={downloading}>
                    {downloading ? <Loader2 className="animate-spin" /> : <Download />}
                    {downloading ? "Preparing…" : "Download PDF"}
                  </Button>
                </div>
                {/* The document as issued, in a blank sandbox: its HTML runs no script and reaches nothing. */}
                <iframe
                  title={`Quote ${proposal.quote_number}`}
                  sandbox=""
                  srcDoc={proposal.html}
                  className="h-[75vh] w-full rounded-[var(--radius-card)] border border-line-default bg-surface"
                />
              </div>

              <Card className="grid gap-4 p-4 sm:p-6 lg:sticky lg:top-6">
                {proposal.state === "open" ? (
                  mode === "accept" ? (
                    <>
                      <h2 className="font-semibold text-copy-primary">Accept quote</h2>
                      <QuoteAcceptForm
                        optionalItems={proposal.optional_items}
                        currency={proposal.currency}
                        total={proposal.total_amount}
                        submitting={submitting}
                        onCancel={() => setMode("view")}
                        onSubmit={(values) => void respond("accept", values)}
                      />
                    </>
                  ) : mode === "decline" ? (
                    <>
                      <h2 className="font-semibold text-copy-primary">Decline quote</h2>
                      <QuoteDeclineForm
                        reasons={proposal.decline_reasons}
                        submitting={submitting}
                        onCancel={() => setMode("view")}
                        onSubmit={(values) => void respond("decline", values)}
                      />
                    </>
                  ) : (
                    <>
                      <div>
                        <p className="text-sm text-copy-secondary">Total</p>
                        <Money amount={proposal.total_amount} currency={proposal.currency} className="text-2xl font-semibold text-copy-primary" />
                        {proposal.optional_items.length ? (
                          <p className="mt-1 text-p-xs text-copy-muted">Optional items can be added when you accept.</p>
                        ) : null}
                        {proposal.expiry_date ? (
                          <p className="mt-2 text-sm text-copy-muted">
                            Valid until <time dateTime={proposal.expiry_date}>{formatDateOnly(proposal.expiry_date)}</time>
                          </p>
                        ) : null}
                      </div>
                      <div className="grid gap-2">
                        <Button type="button" onClick={() => setMode("accept")}>
                          <Check />
                          Accept
                        </Button>
                        <Button type="button" variant="outline" onClick={() => setMode("decline")}>
                          <X />
                          Decline
                        </Button>
                      </div>
                    </>
                  )
                ) : (
                  <div role="status">
                    <h2 className="font-semibold text-copy-primary">{CLOSED_COPY[proposal.state].title}</h2>
                    <p className="mt-2 text-p-sm text-copy-secondary">
                      {proposal.state === "accepted" && proposal.accepted_by_name
                        ? `Accepted by ${proposal.accepted_by_name}${proposal.accepted_at ? ` on ${formatDateTime(proposal.accepted_at)}` : ""}. `
                        : ""}
                      {CLOSED_COPY[proposal.state].body}
                    </p>
                  </div>
                )}
              </Card>
            </div>
          )}
        </section>

        <footer className="border-t border-line-subtle pt-4 text-center text-p-xs text-copy-muted">
          This link gives access only to the quote shared with you.
        </footer>
      </div>
    </main>
  );
}
