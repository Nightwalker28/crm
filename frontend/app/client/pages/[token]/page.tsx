"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Check, Download, FileText, LogIn, MessageSquare, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CLIENT_TOKEN_STORAGE_KEY, publicClientPageDocumentUrl, recordClientPageAction, usePublicClientPage } from "@/hooks/useClientPortal";
import { resolveMediaUrl } from "@/lib/media";

function money(value: string | number, currency: string) {
  const amount = Number(value);
  return `${currency} ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function getError(error: unknown) {
  return error instanceof Error ? error.message : "Failed to submit response.";
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "Unknown size";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function brandAccent(value?: string | null) {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#14b8a6";
}

export default function PublicClientPage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const pageQuery = usePublicClientPage(token);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState<"accept" | "request-changes" | null>(null);
  const hasClientToken = useMemo(() => typeof window !== "undefined" && Boolean(window.localStorage.getItem(CLIENT_TOKEN_STORAGE_KEY)), []);
  const page = pageQuery.data;
  const accentColor = brandAccent(page?.brand_settings?.accent_color);
  const brandName = page?.brand_settings?.company_name || "Lynk";
  const logoUrl = resolveMediaUrl(page?.brand_settings?.logo_url);

  async function submitAction(action: "accept" | "request-changes", event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setIsSubmitting(action);
    try {
      await recordClientPageAction(token, action, { message });
      setMessage("");
      toast.success(action === "accept" ? "Accepted." : "Change request sent.");
    } catch (error) {
      toast.error(getError(error));
    } finally {
      setIsSubmitting(null);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6">
        <header className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <Link href="/" className="flex items-center gap-3 text-white">
            {logoUrl ? (
              <Image src={logoUrl} alt="" width={36} height={36} unoptimized className="h-9 w-9 rounded-md object-contain" />
            ) : (
              <span className="h-9 w-9 rounded-md" style={{ backgroundColor: accentColor }} />
            )}
            <span className="font-lynk text-3xl">{brandName}</span>
          </Link>
          <div className="flex items-center gap-2">
            {page?.pricing_mode === "personalized" ? (
              <span className="rounded-md border border-emerald-900/70 bg-emerald-950/30 px-3 py-2 text-xs font-medium text-emerald-200">
                Personalized pricing
              </span>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href={`/client/login?redirect=/client/pages/${token}`}>
                <LogIn className="h-4 w-4" />
                {hasClientToken ? "Switch Account" : "Client Sign In"}
              </Link>
            </Button>
          </div>
        </header>

        {pageQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">Loading client page...</div>
        ) : pageQuery.error ? (
          <div className="my-8 rounded-md border border-red-900/60 bg-red-950/20 p-5 text-sm text-red-200">
            {pageQuery.error instanceof Error ? pageQuery.error.message : "Client page unavailable."}
          </div>
        ) : page ? (
          <div className="grid flex-1 gap-6 py-8 lg:grid-cols-[minmax(0,1.4fr)_360px]">
            <section>
              <div className="mb-6 border-l-4 pl-4" style={{ borderColor: accentColor }}>
                <h1 className="text-3xl font-semibold tracking-normal text-neutral-50">{page.title}</h1>
                {page.summary ? <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">{page.summary}</p> : null}
              </div>

              {page.proposal_sections.length ? (
                <div className="mb-4 grid gap-3">
                  {page.proposal_sections.map((section) => (
                    <div key={`${section.sort_order}-${section.title}`} className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
                      <h2 className="text-sm font-semibold text-neutral-100">{section.title}</h2>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-400">{section.body}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="overflow-hidden rounded-md border border-neutral-800 bg-neutral-900">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-neutral-800 text-xs uppercase text-neutral-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Item</th>
                      <th className="px-4 py-3 text-right font-medium">Qty</th>
                      <th className="px-4 py-3 text-right font-medium">Public</th>
                      <th className="px-4 py-3 text-right font-medium">Your Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {page.pricing_items.map((item, index) => (
                      <tr key={`${item.name}-${index}`}>
                        <td className="px-4 py-4">
                          <div className="font-medium text-neutral-100">{item.name}</div>
                          {item.description ? <div className="mt-1 text-xs text-neutral-500">{item.description}</div> : null}
                        </td>
                        <td className="px-4 py-4 text-right text-neutral-300">{item.quantity}</td>
                        <td className="px-4 py-4 text-right text-neutral-400">{money(item.public_unit_price, item.currency)}</td>
                        <td className="px-4 py-4 text-right font-semibold text-neutral-50">{money(item.resolved_total, item.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {page.documents.length ? (
                <div className="mt-4 rounded-md border border-neutral-800 bg-neutral-900 p-4">
                  <h2 className="text-sm font-semibold text-neutral-100">Documents</h2>
                  <div className="mt-3 grid gap-2">
                    {page.documents.map((document) => (
                      <div key={document.id} className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-medium text-neutral-100">
                            <FileText className="h-4 w-4 text-neutral-500" />
                            <span className="truncate">{document.title || document.original_filename}</span>
                          </div>
                          <div className="mt-1 text-xs text-neutral-500">
                            {document.original_filename} · {document.extension.toUpperCase()} · {formatBytes(document.file_size_bytes)}
                          </div>
                        </div>
                        <Button asChild variant="outline" size="sm">
                          <a href={publicClientPageDocumentUrl(token, document.id)} target="_blank" rel="noreferrer">
                            <Download className="h-4 w-4" />
                            Open
                          </a>
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <aside className="h-fit rounded-md border border-neutral-800 bg-neutral-900 p-5">
              <h2 className="text-base font-semibold text-neutral-100">Response</h2>
              <p className="mt-1 text-sm text-neutral-400">
                {page.pricing_mode === "personalized"
                  ? `Pricing resolved for ${page.customer_group?.name ?? "your account"}.`
                  : "Sign in to view any personalized pricing available to your account."}
              </p>
              <form className="mt-4 space-y-3" onSubmit={(event) => void submitAction("request-changes", event)}>
                <Textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Add a note or requested change" />
                <div className="grid gap-2">
                  <Button type="button" onClick={() => void submitAction("accept")} disabled={Boolean(isSubmitting)} style={{ backgroundColor: accentColor }}>
                    <Check className="h-4 w-4" />
                    {isSubmitting === "accept" ? "Accepting..." : "Accept"}
                  </Button>
                  <Button type="submit" variant="outline" disabled={Boolean(isSubmitting)}>
                    <MessageSquare className="h-4 w-4" />
                    {isSubmitting === "request-changes" ? "Sending..." : "Request Changes"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => pageQuery.refetch()} disabled={pageQuery.isFetching}>
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </Button>
                </div>
              </form>
            </aside>
          </div>
        ) : null}
      </div>
    </main>
  );
}
