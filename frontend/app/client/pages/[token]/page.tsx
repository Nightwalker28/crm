"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Check, Download, FileText, LogIn, MessageSquare, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ListRow, RowList } from "@/components/ui/ListRow";
import { Money } from "@/components/ui/Money";
import { RecordTable } from "@/components/ui/RecordTable";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { Textarea } from "@/components/ui/textarea";
import { CLIENT_TOKEN_STORAGE_KEY, downloadPublicClientPageDocument, recordClientPageAction, usePublicClientPage } from "@/hooks/useClientPortal";
import { resolveMediaUrl } from "@/lib/media";
import { formatBytes } from "@/lib/format";

function getError() {
  return "The response could not be submitted. Try again.";
}

function brandAccent(value?: string | null) {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#14b8a6"; // design-exempt: tenant brand colour is data, this is the unset fallback (§2.5)
}

export default function PublicClientPage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const pageQuery = usePublicClientPage(token);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState<"accept" | "request-changes" | null>(null);
  const [openingDocumentId, setOpeningDocumentId] = useState<number | null>(null);
  const hasClientToken = useMemo(() => typeof window !== "undefined" && Boolean(window.localStorage.getItem(CLIENT_TOKEN_STORAGE_KEY)), []);
  const page = pageQuery.data;
  const accentColor = brandAccent(page?.brand_settings?.accent_color);
  const brandName = page?.brand_settings?.company_name || "Lynk";
  const logoUrl = resolveMediaUrl(page?.brand_settings?.logo_url);
  const signInHref = `/client/login?redirect=${encodeURIComponent(`/client/pages/${token}`)}`;

  async function submitAction(action: "accept" | "request-changes", event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setIsSubmitting(action);
    try {
      await recordClientPageAction(token, action, { message });
      setMessage("");
      toast.success(action === "accept" ? "Accepted." : "Change request sent.");
    } catch {
      toast.error(getError());
    } finally {
      setIsSubmitting(null);
    }
  }

  async function openDocument(document: NonNullable<typeof page>["documents"][number]) {
    setOpeningDocumentId(document.id);
    try {
      await downloadPublicClientPageDocument(token, document);
    } catch {
      toast.error("The document could not be opened. Check your connection and try again.");
    } finally {
      setOpeningDocumentId(null);
    }
  }

  return (
    <main className="min-h-screen bg-app text-copy-primary">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6">
        <header className="flex items-center justify-between border-b border-line-default pb-4">
          <Link href="/" className="flex items-center gap-3 text-copy-primary">
            {logoUrl ? (
              <Image src={logoUrl} alt="" width={36} height={36} unoptimized className="h-9 w-9 rounded-[var(--radius-control)] object-contain" />
            ) : (
              <span className="h-9 w-9 rounded-[var(--radius-control)]" style={{ backgroundColor: accentColor }} />
            )}
            {/* The *tenant's* name, in the product face. It was `font-lynk`, which is Lynk's
                wordmark and nobody else's (§3.1) — rendering another company's name in it
                made the tenant's brand read as Lynk's logo, on the one surface in the app
                that is deliberately not Lynk-branded. */}
            <span className="truncate text-base font-semibold text-copy-primary">{brandName}</span>
          </Link>
          <div className="flex items-center gap-2">
            {page?.pricing_mode === "personalized" ? (
              <span className="rounded-[var(--radius-control)] border border-state-success/40 bg-state-success-muted px-3 py-2 text-xs font-medium text-state-success">
                Personalized pricing
              </span>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href={signInHref}>
                <LogIn className="h-4 w-4" />
                {hasClientToken ? "Switch account" : "Client sign-in"}
              </Link>
            </Button>
          </div>
        </header>

        {/* Ruling 5, on the one portal surface batch 5 left hand-written: the failure was a
            bare line with no heading and no way out. The state's title is the page's h1 here —
            there is no shell above it — and the exit is the portal's door with a redirect back
            to this page, the only other destination someone holding this link has. */}
        {pageQuery.isLoading ? (
          <div className="py-8">
            <RouteLoadingState label="client page" />
          </div>
        ) : pageQuery.error ? (
          <div className="py-8">
            <RouteErrorState
              title="This page could not be loaded"
              description="The link may have expired or been replaced. Try again, or ask the sender for a new link."
              reset={() => void pageQuery.refetch()}
              backHref={signInHref}
              backLabel="Sign in to the client portal"
            />
          </div>
        ) : page ? (
          <div className="grid flex-1 gap-6 py-8 lg:grid-cols-[minmax(0,1.4fr)_360px]">
            <section>
              <div className="mb-6 border-l-4 pl-4" style={{ borderColor: accentColor }}>
                <h1 className="text-lg font-semibold text-copy-primary">{page.title}</h1>
                {page.summary ? <p className="mt-3 max-w-3xl text-p-sm text-copy-secondary">{page.summary}</p> : null}
              </div>

              {page.proposal_sections.length ? (
                <div className="mb-4 divide-y divide-line-subtle rounded-[var(--radius-card)] border border-line-default bg-surface">
                  {page.proposal_sections.map((section) => (
                    <div key={`${section.sort_order}-${section.title}`} className="p-4">
                      <h2 className="text-sm font-semibold text-copy-primary">{section.title}</h2>
                      <p className="mt-2 whitespace-pre-wrap text-p-sm text-copy-secondary">{section.body}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* R10: a read-only list is `RecordTable variant="readOnly"`. This was one of the
                  two raw `Table` importers left outside the primitives. */}
              <RecordTable
                variant="readOnly"
                label="Pricing"
                rows={page.pricing_items.map((item, index) => ({ ...item, rowId: `${item.name}-${index}` }))}
                rowKey={(item) => item.rowId}
                emptyState={{ title: "No pricing has been shared on this page" }}
                columns={[
                  {
                    key: "name",
                    label: "Item",
                    size: "lg",
                    render: (item) => (
                      <>
                        <div className="font-medium text-copy-primary">{item.name}</div>
                        {item.description ? <div className="mt-1 text-xs text-copy-muted">{item.description}</div> : null}
                      </>
                    ),
                  },
                  { key: "quantity", label: "Quantity", align: "right", size: "sm", render: (item) => <span className="tabular-nums">{item.quantity}</span> },
                  { key: "public", label: "Public price", align: "right", size: "sm", render: (item) => <Money amount={item.public_unit_price} currency={item.currency} /> },
                  {
                    key: "resolved",
                    label: "Your price",
                    align: "right",
                    size: "sm",
                    render: (item) => <Money amount={item.resolved_total} currency={item.currency} className="font-medium text-copy-primary" />,
                  },
                ]}
              />

              {page.documents.length ? (
                <div className="mt-4 rounded-[var(--radius-card)] border border-line-default bg-surface p-4">
                  <h2 className="text-sm font-semibold text-copy-primary">Documents</h2>
                  <div className="mt-3">
                    <RowList label="Documents">
                      {page.documents.map((document) => (
                        <ListRow
                          key={document.id}
                          title={document.title || document.original_filename}
                          leading={<FileText className="size-4 text-copy-muted" aria-hidden="true" />}
                          meta={`${document.original_filename} · ${document.extension.toUpperCase()} · ${formatBytes(document.file_size_bytes) ?? "Unknown size"}`}
                          actions={
                            <Button type="button" variant="outline" size="sm" onClick={() => void openDocument(document)} disabled={openingDocumentId === document.id}>
                              {openingDocumentId === document.id ? <RefreshCw className="animate-spin" /> : <Download />}
                              {openingDocumentId === document.id ? "Opening…" : "Open"}
                            </Button>
                          }
                        />
                      ))}
                    </RowList>
                  </div>
                </div>
              ) : null}
            </section>

            <aside className="h-fit rounded-[var(--radius-card)] border border-line-default bg-surface p-5">
              <h2 className="text-base font-semibold text-copy-primary">Response</h2>
              <p className="mt-1 text-sm text-copy-secondary">
                {page.pricing_mode === "personalized"
                  ? `Pricing resolved for ${page.customer_group?.name ?? "your account"}.`
                  : "Sign in to view any personalized pricing available to your account."}
              </p>
              <form className="mt-4 space-y-3" onSubmit={(event) => void submitAction("request-changes", event)}>
                <Textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Add a note or requested change" />
                <div className="grid gap-2">
                  <Button type="button" onClick={() => void submitAction("accept")} disabled={Boolean(isSubmitting)} style={{ backgroundColor: accentColor }}>
                    <Check className="h-4 w-4" />
                    {isSubmitting === "accept" ? "Accepting…" : "Accept"}
                  </Button>
                  <Button type="submit" variant="outline" disabled={Boolean(isSubmitting)}>
                    <MessageSquare className="h-4 w-4" />
                    {isSubmitting === "request-changes" ? "Sending…" : "Request changes"}
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
