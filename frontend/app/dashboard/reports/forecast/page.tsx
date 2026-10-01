"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/Card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ListRow, RowList } from "@/components/ui/ListRow";
import { PageShell } from "@/components/ui/PageShell";
import { PanelError, PanelHeader, PanelLoading } from "@/components/ui/PanelStates";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatGroup, StatTile } from "@/components/ui/StatTile";
import { apiFetch, isForbiddenError } from "@/lib/api";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/currency";
import { DASHBOARD_ROUTES } from "@/lib/routes";

type ForecastBucket = {
  key: string;
  label: string;
  count: number;
  weighted_pipeline_amount: number | string;
};

type ForecastSummary = {
  gross_pipeline_amount: number | string;
  weighted_pipeline_amount: number | string;
  commit_amount: number | string;
  best_case_amount: number | string;
  actual_revenue_amount: number | string;
  open_opportunity_count: number;
  won_opportunity_count: number;
  by_stage: ForecastBucket[];
  by_owner: ForecastBucket[];
  by_team: ForecastBucket[];
};

async function fetchForecast(periodStart: string, periodEnd: string) {
  const params = new URLSearchParams({ period_start: periodStart, period_end: periodEnd });
  const res = await apiFetch(`/reports/forecast?${params.toString()}`);
  if (!res.ok) {
    const error = new Error("forecast-failed") as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return res.json() as Promise<ForecastSummary>;
}

// Zero, not `Not set`: a forecast figure with no deals is a zero pipeline rather than an
// absent field (design.md 3.6).
function formatCurrency(value: number | string | null | undefined) {
  const amount = typeof value === "string" ? Number(value) : value;
  return formatMoney(Number.isFinite(amount ?? NaN) ? (amount as number) : 0, DEFAULT_CURRENCY, { maximumFractionDigits: 0 }) ?? "";
}

function isoDateOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The weighted forecast, on its own page rather than above the report builder. Salesforce
 * and HubSpot both keep forecasting a separate tool from reports (11-reports.md §4.1).
 */
export default function ForecastPage() {
  const [start, setStart] = useState(() => isoDateOffset(0));
  const [end, setEnd] = useState(() => isoDateOffset(90));
  const datesValid = Boolean(start && end && start <= end);
  const forecastQuery = useQuery({ queryKey: ["reports-forecast", start, end], queryFn: () => fetchForecast(start, end), enabled: datesValid });
  const forecast = forecastQuery.data;

  return (
    <PageShell
      title="Forecast"
      description="Open deal value, weighted by each deal's probability or its stage's default."
      isPermissionDenied={isForbiddenError(forecastQuery.error)}
      backHref={DASHBOARD_ROUTES.reports}
      backLabel="Back to reports"
    >
      <Card>
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
          <PanelHeader title="Expected close" description="Deals whose expected close date falls in this period." />
          <FieldGroup className="grid gap-3 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="forecast-start">Start</FieldLabel>
              <Input id="forecast-start" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
            </Field>
            <Field data-invalid={!datesValid || undefined}>
              <FieldLabel htmlFor="forecast-end">End</FieldLabel>
              <Input id="forecast-end" type="date" value={end} onChange={(event) => setEnd(event.target.value)} aria-invalid={!datesValid} aria-describedby={!datesValid ? "forecast-date-error" : undefined} />
              {!datesValid ? <FieldError id="forecast-date-error">The end date must be on or after the start date.</FieldError> : null}
            </Field>
          </FieldGroup>
        </div>
        {!datesValid ? null : forecastQuery.isError && !isForbiddenError(forecastQuery.error) ? (
          <div className="px-4 pb-4"><PanelError message="The forecast could not be loaded." onRetry={() => void forecastQuery.refetch()} /></div>
        ) : forecastQuery.isLoading ? (
          <div className="px-4 pb-4"><PanelLoading label="Loading forecast…" /></div>
        ) : (
          <>
            <StatGroup label="Forecast totals" className="border-y border-line-subtle">
              <StatTile label="Weighted" value={formatCurrency(forecast?.weighted_pipeline_amount)} context={`${forecast?.open_opportunity_count ?? 0} open deals`} />
              <StatTile label="Gross" value={formatCurrency(forecast?.gross_pipeline_amount)} context="Open pipeline" />
              <StatTile label="Commit" value={formatCurrency(forecast?.commit_amount)} context="Probability 75%+" />
              <StatTile label="Best case" value={formatCurrency(forecast?.best_case_amount)} context="Probability 50%+" />
              <StatTile label="Won" value={formatCurrency(forecast?.actual_revenue_amount)} context={`${forecast?.won_opportunity_count ?? 0} won deals`} />
            </StatGroup>
            <div className="grid gap-6 p-4 lg:grid-cols-3">
              <ForecastBucketList title="By stage" rows={forecast?.by_stage ?? []} />
              <ForecastBucketList title="By owner" rows={forecast?.by_owner ?? []} />
              <ForecastBucketList title="By team" rows={forecast?.by_team ?? []} />
            </div>
          </>
        )}
      </Card>
    </PageShell>
  );
}

/** A forecast breakdown: an ink group under its heading, one `ListRow` per bucket (§7.15). */
function ForecastBucketList({ title, rows }: { title: string; rows: ForecastBucket[] }) {
  return (
    <section>
      <SectionHeading as="h3">{title}</SectionHeading>
      {rows.length ? (
        <RowList label={`Forecast ${title.toLowerCase()}`} className="mt-3">
          {rows.slice(0, 8).map((row) => (
            <ListRow
              key={row.key}
              title={row.label}
              meta={`${row.count} ${row.count === 1 ? "deal" : "deals"}`}
              // A weighted amount is a number, not good news (R5).
              trailing={<span className="text-sm font-medium text-copy-primary">{formatCurrency(row.weighted_pipeline_amount)}</span>}
            />
          ))}
        </RowList>
      ) : (
        <p className="mt-3 text-sm text-copy-muted">No deals close in this period.</p>
      )}
    </section>
  );
}
