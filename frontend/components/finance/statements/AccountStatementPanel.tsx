"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Send } from "lucide-react";
import { toast } from "sonner";

import RecordEmailComposer from "@/components/mail/RecordEmailComposer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/Money";
import { PanelError, PanelLoading } from "@/components/ui/PanelStates";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { statementSearch, useStatement, type StatementKind, type StatementQuery } from "@/hooks/finance/useReceivables";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useMailContext } from "@/hooks/useMail";
import { ApiError, apiFetch } from "@/lib/api";
import { todayIsoDate } from "@/lib/datetime";

function monthStart(isoDate: string) {
  return `${isoDate.slice(0, 8)}01`;
}

async function failure(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  throw new ApiError(res.status, res.status < 500 && typeof body?.detail === "string" ? body.detail : fallback);
}

/**
 * An account's statement (13d §3.6): what it owes and how it got there. *Activity* is the
 * period's invoices, payments, credits and write-offs from an opening balance; *Open invoices*
 * is what is unpaid today. Both end with the ageing. The preview is the PDF's own page.
 */
export function AccountStatementPanel({ orgId, orgName, orgEmail }: { orgId: number; orgName: string; orgEmail?: string | null }) {
  const today = todayIsoDate();
  const [query, setQuery] = useState<StatementQuery>({ kind: "activity", from: monthStart(today), to: today });
  const [downloading, setDownloading] = useState(false);
  const [composing, setComposing] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const statement = useStatement(orgId, query);
  const search = statementSearch({ ...query, currency: query.currency ?? statement.data?.currency });
  const preview = useQuery({
    queryKey: ["account-statement-preview", orgId, search],
    queryFn: async () => {
      const res = await apiFetch(`/finance/statements/${orgId}/preview?${search}`);
      if (!res.ok) await failure(res, "The statement could not be shown.");
      return res.text();
    },
    enabled: Boolean(statement.data),
  });
  const mail = useMailContext();
  const { modules } = useAccessibleModules();
  const canSendMail = Boolean(modules.find((module) => module.name === "mail")?.actions?.can_edit);
  const hasMailbox = (mail.data?.connections ?? []).some((connection) => connection.can_send);

  async function download() {
    setDownloading(true);
    try {
      const res = await apiFetch(`/finance/statements/${orgId}/pdf?${search}`);
      if (!res.ok) await failure(res, "The PDF could not be made. Try again in a moment.");
      const blob = await res.blob();
      const filename = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "statement.pdf";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The PDF could not be made.");
    } finally {
      setDownloading(false);
    }
  }

  const data = statement.data;
  const currency = query.currency ?? data?.currency;
  return (
    <div className="grid gap-4">
      <Card className="grid gap-4 p-4 md:p-6">
        <SectionHeading
          description="Share it with the customer, or check it before a call about payment."
          action={(
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void download()} disabled={downloading || !data}>
                <Download />
                {downloading ? "Preparing…" : "Download PDF"}
              </Button>
              {canSendMail ? (
                <Button
                  ref={triggerRef}
                  variant="outline"
                  disabled={!data || !hasMailbox}
                  title={hasMailbox ? undefined : "Connect your mailbox under Mail to send from Lynk."}
                  onClick={() => setComposing((value) => value + 1)}
                >
                  <Send />
                  Send statement
                </Button>
              ) : null}
            </div>
          )}
        >
          Statement
        </SectionHeading>
        {data?.balances?.length ? (
          <p className="text-sm text-copy-secondary">
            Owed now:{" "}
            {data.balances.map((row, index) => (
              <span key={row.currency}>
                {index ? ", " : ""}
                <Money amount={row.balance_due} currency={row.currency} className="font-semibold text-copy-primary" /> on {row.open_invoices} invoice{row.open_invoices === 1 ? "" : "s"}
              </span>
            ))}
          </p>
        ) : data ? <p className="text-sm text-copy-secondary">Nothing is owed on this account.</p> : null}
        <div className="flex flex-wrap items-end gap-4">
          <Field className="w-auto">
            <FieldLabel>Show</FieldLabel>
            <SegmentedControl value={query.kind} onValueChange={(kind) => setQuery({ ...query, kind: kind as StatementKind })} aria-label="Statement type">
              <SegmentedItem value="activity">Activity</SegmentedItem>
              <SegmentedItem value="open">Open invoices</SegmentedItem>
            </SegmentedControl>
          </Field>
          {query.kind === "activity" ? (
            <>
              <Field className="w-auto">
                <FieldLabel htmlFor="statement-from">From</FieldLabel>
                <Input id="statement-from" type="date" value={query.from ?? ""} max={query.to} onChange={(event) => setQuery({ ...query, from: event.target.value })} />
              </Field>
              <Field className="w-auto">
                <FieldLabel htmlFor="statement-to">To</FieldLabel>
                <Input id="statement-to" type="date" value={query.to ?? ""} min={query.from} onChange={(event) => setQuery({ ...query, to: event.target.value })} />
              </Field>
            </>
          ) : null}
          {data && data.currencies.length > 1 ? (
            <Field className="w-auto">
              <FieldLabel htmlFor="statement-currency">Currency</FieldLabel>
              <Select value={currency} onValueChange={(value) => setQuery({ ...query, currency: value })}>
                <SelectTrigger id="statement-currency" className="min-w-28"><SelectValue /></SelectTrigger>
                <SelectContent>{data.currencies.map((code) => <SelectItem key={code} value={code}>{code}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          ) : null}
        </div>
      </Card>
      {statement.error || preview.error ? (
        <Card className="p-6">
          <PanelError message={(statement.error ?? preview.error)?.message ?? "The statement could not be loaded."}
            onRetry={() => void (statement.error ? statement.refetch() : preview.refetch())} />
        </Card>
      ) : !preview.data ? (
        <Card className="p-6"><PanelLoading label="Loading statement…" /></Card>
      ) : (
        // A blank sandbox: the statement's HTML runs no script and reaches nothing.
        <iframe
          title={`Statement for ${orgName}`}
          sandbox=""
          srcDoc={preview.data}
          className="h-[70vh] w-full rounded-[var(--radius-card)] border border-line-default bg-surface"
        />
      )}
      {composing && data ? (
        <RecordEmailComposer
          key={composing}
          open
          onOpenChange={(open) => { if (!open) setComposing(0); }}
          moduleKey="sales_organizations"
          entityId={orgId}
          recordLabel={orgName}
          defaultRecipient={orgEmail ?? undefined}
          returnFocusRef={triggerRef}
          defaultSubject="Your account statement"
          documentPdf={{
            filename: `Statement-${orgName}.pdf`,
            payload: { attach_statement: { kind: query.kind, start: query.kind === "activity" ? query.from : null, end: query.kind === "activity" ? query.to : null, currency } },
          }}
        />
      ) : null}
    </div>
  );
}
