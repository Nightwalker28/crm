"use client";

import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Globe2, Grid3x3, Lock, Plus, Rows3, Save, Table2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBackdrop, DialogFooter, DialogHeader, DialogPanel, DialogTitle } from "@/components/ui/dialog";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { SavedViewConditionEditor } from "@/components/ui/SavedViewConditionEditor";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import {
  AGGREGATE_LABELS,
  CHART_LABELS,
  DATE_RANGE_OPTIONS,
  FORMAT_DESCRIPTIONS,
  FORMAT_LABELS,
  GRANULARITY_LABELS,
  SCOPE_LABELS,
  createSavedReport,
  defaultReportConfig,
  describeReportScope,
  reportHref,
  serializeReportConfig,
  toFilterField,
  updateSavedReport,
  type ReportAggregate,
  type ReportChartType,
  type ReportConfig,
  type ReportField,
  type ReportFormat,
  type ReportGranularity,
  type ReportModule,
  type ReportScope,
  type SavedReport,
} from "@/lib/reports";
import { ReportView } from "./ReportView";

const NONE = "__none__";
const MAX_MEASURES = 4;
const MAX_COLUMNS = 12;
const CHART_TYPES: ReportChartType[] = ["column", "bar", "line", "donut", "funnel", "metric", "none"];
const LIMIT_OPTIONS = [10, 25, 50, 100];

export type ReportBuilderInitial = {
  moduleKey: string;
  config: ReportConfig;
  report?: SavedReport | null;
  /** A template or a copy starts named but unsaved. */
  suggestedName?: string;
  suggestedDescription?: string;
};

function isDate(field: ReportField | undefined) {
  return field?.field_type === "date" || field?.field_type === "datetime";
}

/**
 * The report builder (11-reports.md §4.6): the definition on the left, the report itself on
 * the right, rerun as the definition changes, the way the Salesforce and HubSpot builders
 * preview live. Below `lg` the preview follows the form.
 *
 * It is a form page (archetype 3) with one commit: Save, or Save as for a copy. A saved
 * report's link opens the viewer, not this page.
 */
export function ReportBuilder({ modules, initial }: { modules: ReportModule[]; initial: ReportBuilderInitial }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const report = initial.report ?? null;
  const [moduleKey, setModuleKey] = useState(initial.moduleKey);
  const [config, setConfig] = useState<ReportConfig>(initial.config);
  const [baseline, setBaseline] = useState(() => JSON.stringify({ moduleKey: initial.moduleKey, config: serializeReportConfig(initial.config) }));
  const [saveMode, setSaveMode] = useState<"create" | "copy" | null>(null);
  const reportModule = modules.find((item) => item.module_key === moduleKey) ?? null;
  const fields = useMemo(() => reportModule?.fields ?? [], [reportModule]);
  const fieldByKey = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);
  const groupable = fields.filter((field) => field.groupable);
  const measurable = fields.filter((field) => field.measurable);
  const dateFields = fields.filter(isDate);
  const filterFields = useMemo(() => fields.map(toFilterField), [fields]);

  // The preview runs on a deferred copy, so typing in the search box does not queue a run
  // per keystroke ahead of the one that matters.
  const previewConfig = useDeferredValue(config);
  const isDirty = JSON.stringify({ moduleKey, config: serializeReportConfig(config) }) !== baseline;

  const saveMutation = useMutation({
    mutationFn: async (input: { mode: "update" | "create"; name?: string; description?: string | null; visibility?: "private" | "everyone" }) => {
      if (input.mode === "update" && report) return updateSavedReport(report.id, { config });
      return createSavedReport(moduleKey, {
        name: input.name ?? "",
        description: input.description ?? null,
        visibility: input.visibility ?? "private",
        config,
      });
    },
    onSuccess: async (saved) => {
      setBaseline(JSON.stringify({ moduleKey, config: serializeReportConfig(config) }));
      setSaveMode(null);
      await queryClient.invalidateQueries({ queryKey: ["saved-reports"] });
      await queryClient.invalidateQueries({ queryKey: ["saved-report", saved.id] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard-saved-reports"] });
      toast.success(report && saved.id === report.id ? "Report saved." : "Report created.");
      router.push(reportHref(saved.id));
    },
  });
  useUnsavedChangesGuard(isDirty, saveMutation.isPending);

  function update(patch: Partial<ReportConfig>) {
    setConfig((current) => ({ ...current, ...patch }));
  }

  function changeModule(next: string) {
    setModuleKey(next);
    setConfig(defaultReportConfig(modules.find((item) => item.module_key === next) ?? null));
  }

  function changeFormat(format: ReportFormat) {
    setConfig((current) => {
      let groupings = current.groupings;
      if (format === "matrix" && groupings.length < 2) {
        const second = groupable.find((field) => field.key !== groupings[0]?.field && !isDate(field)) ?? groupable.find((field) => field.key !== groupings[0]?.field);
        const first = groupings[0] ?? (groupable[0] ? { field: groupable[0].key } : null);
        groupings = [first, second ? { field: second.key, granularity: isDate(second) ? "month" as const : null } : null].filter(Boolean) as ReportConfig["groupings"];
      }
      if (format !== "tabular" && !groupings.length && groupable[0]) groupings = [{ field: groupable[0].key }];
      return {
        ...current,
        format,
        groupings,
        chart: { type: format === "tabular" ? "none" : current.chart.type === "none" ? "column" : current.chart.type },
        columns: current.columns.length ? current.columns : reportModule?.default_columns ?? [],
        sort: format === "tabular" ? { by: "default", direction: "desc" } : { by: "value", direction: "desc" },
      };
    });
  }

  function setGrouping(level: 0 | 1, key: string) {
    setConfig((current) => {
      const next = [...current.groupings];
      if (key === NONE) {
        next.splice(level);
      } else {
        const field = fieldByKey.get(key);
        next[level] = { field: key, granularity: isDate(field) ? next[level]?.granularity ?? "month" : null };
      }
      return { ...current, groupings: next.filter(Boolean) };
    });
  }

  function setGranularity(level: 0 | 1, granularity: ReportGranularity) {
    setConfig((current) => ({ ...current, groupings: current.groupings.map((grouping, index) => (index === level ? { ...grouping, granularity } : grouping)) }));
  }

  function setMeasure(index: number, aggregate: ReportAggregate, fieldKey?: string | null) {
    setConfig((current) => {
      const measures = [...current.measures];
      measures[index] = aggregate === "count" ? { aggregate } : { aggregate, field: fieldKey ?? measures[index]?.field ?? measurable[0]?.key ?? null };
      return { ...current, measures };
    });
  }

  function toggleColumn(key: string, checked: boolean) {
    setConfig((current) => {
      const columns = checked ? [...current.columns, key].slice(0, MAX_COLUMNS) : current.columns.filter((item) => item !== key);
      return { ...current, columns };
    });
  }

  const title = report ? (report.can_edit ? `Edit ${report.name}` : `Copy of ${report.name}`) : "New report";
  const hasFilters = Boolean(
    (config.filters.all_conditions?.length ?? 0) + (config.filters.any_conditions?.length ?? 0)
    || (typeof config.filters.search === "string" && config.filters.search.trim())
    || (config.date_filter && config.date_filter.range !== "all_time"),
  );
  const cancelHref = report ? reportHref(report.id) : DASHBOARD_ROUTES.reports;
  const matrixMissingColumns = config.format === "matrix" && config.groupings.length < 2;

  return (
    <PageShell
      title={title}
      description={reportModule ? describeReportScope(config, reportModule) : undefined}
      actions={(
        <>
          <Button asChild variant="ghost"><Link href={cancelHref}>Cancel</Link></Button>
          {report?.can_edit ? (
            <>
              <Button type="button" variant="outline" onClick={() => setSaveMode("copy")} disabled={saveMutation.isPending}>Save as</Button>
              <Button type="button" onClick={() => saveMutation.mutate({ mode: "update" }, { onError: () => toast.error("The report could not be saved. Try again.") })} disabled={!isDirty || saveMutation.isPending || matrixMissingColumns}>
                <Save />{saveMutation.isPending && !saveMode ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => setSaveMode(report ? "copy" : "create")} disabled={!reportModule || saveMutation.isPending || matrixMissingColumns}>
              <Save />{report ? "Save as" : "Save report"}
            </Button>
          )}
        </>
      )}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(19rem,24rem)_minmax(0,1fr)] lg:items-start">
        <Card className="divide-y divide-line-subtle">
          <BuilderSection title="Source">
            <Field>
              <FieldLabel htmlFor="report-module">Report on</FieldLabel>
              <Select value={moduleKey} onValueChange={changeModule} disabled={Boolean(report)}>
                <SelectTrigger id="report-module" aria-label="Report on"><SelectValue placeholder="Choose a module" /></SelectTrigger>
                <SelectContent>{modules.map((item) => <SelectItem key={item.module_key} value={item.module_key}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
              {report ? <FieldDescription>A saved report keeps its module. Start a new report to report on another.</FieldDescription> : null}
            </Field>
            <Field>
              <FieldLabel>Format</FieldLabel>
              <SegmentedControl aria-label="Report format" value={config.format} onValueChange={changeFormat}>
                <SegmentedItem value="summary"><Rows3 />{FORMAT_LABELS.summary}</SegmentedItem>
                <SegmentedItem value="matrix"><Grid3x3 />{FORMAT_LABELS.matrix}</SegmentedItem>
                <SegmentedItem value="tabular"><Table2 />{FORMAT_LABELS.tabular}</SegmentedItem>
              </SegmentedControl>
              <FieldDescription>{FORMAT_DESCRIPTIONS[config.format]}</FieldDescription>
            </Field>
          </BuilderSection>

          {config.format !== "tabular" ? (
            <BuilderSection title="Group and measure">
              <GroupingField
                id="report-group-rows"
                label={config.format === "matrix" ? "Rows" : "Group by"}
                fields={groupable}
                value={config.groupings[0]?.field}
                granularity={config.groupings[0]?.granularity}
                onChange={(key) => setGrouping(0, key)}
                onGranularityChange={(value) => setGranularity(0, value)}
              />
              {config.groupings.length ? (
                <GroupingField
                  id="report-group-columns"
                  label={config.format === "matrix" ? "Columns" : "Then by"}
                  fields={groupable.filter((field) => field.key !== config.groupings[0]?.field)}
                  value={config.groupings[1]?.field}
                  granularity={config.groupings[1]?.granularity}
                  allowNone={config.format !== "matrix"}
                  invalid={matrixMissingColumns}
                  onChange={(key) => setGrouping(1, key)}
                  onGranularityChange={(value) => setGranularity(1, value)}
                />
              ) : null}
              <div className="flex flex-col gap-3">
                <span className="text-sm font-medium text-copy-primary">Measures</span>
                {config.measures.map((measure, index) => (
                  <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
                    <Field>
                      <FieldLabel className="sr-only" htmlFor={`report-measure-${index}`}>Measure {index + 1}</FieldLabel>
                      <Select value={measure.aggregate} onValueChange={(value) => setMeasure(index, value as ReportAggregate)}>
                        <SelectTrigger id={`report-measure-${index}`} aria-label={`Measure ${index + 1}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(AGGREGATE_LABELS) as ReportAggregate[]).map((aggregate) => (
                            <SelectItem key={aggregate} value={aggregate} disabled={aggregate !== "count" && !measurable.length}>{AGGREGATE_LABELS[aggregate]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    {measure.aggregate === "count" ? <span aria-hidden="true" /> : (
                      <Field>
                        <FieldLabel className="sr-only" htmlFor={`report-measure-field-${index}`}>Measure {index + 1} field</FieldLabel>
                        <Select value={measure.field ?? ""} onValueChange={(value) => setMeasure(index, measure.aggregate, value)}>
                          <SelectTrigger id={`report-measure-field-${index}`} aria-label={`Measure ${index + 1} field`}><SelectValue placeholder="Field" /></SelectTrigger>
                          <SelectContent>{measurable.map((field) => <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </Field>
                    )}
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove measure ${index + 1}`} disabled={config.measures.length === 1} onClick={() => update({ measures: config.measures.filter((_, position) => position !== index) })}>
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                {config.measures.length < MAX_MEASURES ? (
                  <Button type="button" variant="outline" size="sm" className="self-start" disabled={!measurable.length} onClick={() => update({ measures: [...config.measures, { aggregate: "sum", field: measurable[0]?.key ?? null }] })}>
                    <Plus />Add measure
                  </Button>
                ) : null}
                {!measurable.length ? <p className="text-p-xs text-copy-muted">{reportModule?.label ?? "This module"} has no number fields to sum or average.</p> : null}
              </div>
            </BuilderSection>
          ) : (
            <BuilderSection title="Columns">
              <div className="grid gap-2">
                {fields.map((field) => (
                  <label key={field.key} className="flex cursor-pointer items-center gap-3 text-sm text-copy-secondary">
                    <Checkbox checked={config.columns.includes(field.key)} onCheckedChange={(checked) => toggleColumn(field.key, Boolean(checked))} disabled={!config.columns.includes(field.key) && config.columns.length >= MAX_COLUMNS} className="shrink-0" />
                    {field.label}
                  </label>
                ))}
              </div>
              <Field>
                <FieldLabel htmlFor="report-tabular-sort">Sort by</FieldLabel>
                <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
                  <Select value={config.sort.by} onValueChange={(value) => update({ sort: { ...config.sort, by: value } })}>
                    <SelectTrigger id="report-tabular-sort" aria-label="Sort by"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Newest first</SelectItem>
                      {fields.map((field) => <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={config.sort.direction} onValueChange={(value) => update({ sort: { ...config.sort, direction: value as "asc" | "desc" } })} disabled={config.sort.by === "default"}>
                    <SelectTrigger aria-label="Sort direction"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="asc">Ascending</SelectItem><SelectItem value="desc">Descending</SelectItem></SelectContent>
                  </Select>
                </div>
              </Field>
            </BuilderSection>
          )}

          <BuilderSection title="Filters">
            {reportModule?.supports_scope ? (
              <Field>
                <FieldLabel htmlFor="report-scope">Show me</FieldLabel>
                <Select value={config.scope} onValueChange={(value) => update({ scope: value as ReportScope })}>
                  <SelectTrigger id="report-scope" aria-label="Show me"><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(SCOPE_LABELS) as ReportScope[]).map((scope) => <SelectItem key={scope} value={scope}>{SCOPE_LABELS[scope]}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            ) : null}
            {dateFields.length ? (
              <DateFilterFields config={config} dateFields={dateFields} defaultField={reportModule?.default_date_field ?? dateFields[0].key} onChange={(dateFilter) => update({ date_filter: dateFilter })} />
            ) : null}
            <Field>
              <FieldLabel htmlFor="report-search">Search</FieldLabel>
              <Input id="report-search" value={typeof config.filters.search === "string" ? config.filters.search : ""} maxLength={100} onChange={(event) => update({ filters: { ...config.filters, search: event.target.value } })} placeholder="Match records containing…" />
            </Field>
            <SavedViewConditionEditor filterFields={filterFields} filters={config.filters} onChange={(filters) => update({ filters })} wrapInCard={false} title="Field filters" />
          </BuilderSection>

          {config.format !== "tabular" ? (
            <BuilderSection title="Display">
              <Field>
                <FieldLabel htmlFor="report-chart">Chart</FieldLabel>
                <Select value={config.chart.type} onValueChange={(value) => update({ chart: { type: value as ReportChartType } })}>
                  <SelectTrigger id="report-chart" aria-label="Chart"><SelectValue /></SelectTrigger>
                  <SelectContent>{CHART_TYPES.map((type) => <SelectItem key={type} value={type}>{CHART_LABELS[type]}</SelectItem>)}</SelectContent>
                </Select>
                {(config.chart.type === "donut" || config.chart.type === "funnel") && config.groupings.length > 1 ? (
                  <FieldDescription>A {CHART_LABELS[config.chart.type].toLocaleLowerCase()} shows the first grouping only.</FieldDescription>
                ) : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="report-sort">Order groups by</FieldLabel>
                <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
                  <Select value={config.sort.by} onValueChange={(value) => update({ sort: { ...config.sort, by: value } })}>
                    <SelectTrigger id="report-sort" aria-label="Order groups by"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="value">First measure</SelectItem><SelectItem value="label">Name</SelectItem></SelectContent>
                  </Select>
                  <Select value={config.sort.direction} onValueChange={(value) => update({ sort: { ...config.sort, direction: value as "asc" | "desc" } })}>
                    <SelectTrigger aria-label="Group order direction"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="desc">Descending</SelectItem><SelectItem value="asc">Ascending</SelectItem></SelectContent>
                  </Select>
                </div>
                <FieldDescription>Dates and pipeline stages always keep their own order.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="report-limit">Groups shown</FieldLabel>
                <Select value={String(config.limit)} onValueChange={(value) => update({ limit: Number(value) })}>
                  <SelectTrigger id="report-limit" aria-label="Groups shown"><SelectValue /></SelectTrigger>
                  <SelectContent>{LIMIT_OPTIONS.map((limit) => <SelectItem key={limit} value={String(limit)}>{limit}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </BuilderSection>
          ) : null}
        </Card>

        <section aria-label="Report preview" className="min-w-0">
          {reportModule ? (
            matrixMissingColumns ? (
              <Card className="p-4"><p className="text-sm text-copy-muted">Choose a column grouping to build the matrix.</p></Card>
            ) : (
              <ReportView module={reportModule} config={previewConfig} preview hasFilters={hasFilters} />
            )
          ) : (
            <Card className="p-4"><p className="text-sm text-copy-muted">Choose what to report on.</p></Card>
          )}
        </section>
      </div>

      <SaveReportDialog
        open={saveMode !== null}
        title={saveMode === "copy" ? "Save a copy" : "Save report"}
        initialName={saveMode === "copy" && report ? `${report.name} (copy)` : initial.suggestedName ?? ""}
        initialDescription={saveMode === "copy" && report ? report.description ?? "" : initial.suggestedDescription ?? ""}
        isPending={saveMutation.isPending}
        onClose={() => setSaveMode(null)}
        onSave={(details, onError) => saveMutation.mutate({ mode: "create", ...details }, { onError })}
      />
    </PageShell>
  );
}

function BuilderSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 p-4">
      <SectionHeading as="h2">{title}</SectionHeading>
      {children}
    </section>
  );
}

function GroupingField({ id, label, fields, value, granularity, allowNone = false, invalid = false, onChange, onGranularityChange }: {
  id: string;
  label: string;
  fields: ReportField[];
  value: string | undefined;
  granularity: ReportGranularity | null | undefined;
  allowNone?: boolean;
  invalid?: boolean;
  onChange: (key: string) => void;
  onGranularityChange: (value: ReportGranularity) => void;
}) {
  const field = fields.find((item) => item.key === value);
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className={isDate(field) ? "grid grid-cols-[minmax(0,1fr)_8rem] gap-2" : undefined}>
        <Select value={value ?? NONE} onValueChange={onChange}>
          <SelectTrigger id={id} aria-label={label} aria-invalid={invalid || undefined}><SelectValue placeholder="Choose a field" /></SelectTrigger>
          <SelectContent>
            {allowNone ? <SelectItem value={NONE}>None</SelectItem> : null}
            {fields.map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {isDate(field) ? (
          <Select value={granularity ?? "month"} onValueChange={(next) => onGranularityChange(next as ReportGranularity)}>
            <SelectTrigger aria-label={`${label} interval`}><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(GRANULARITY_LABELS) as ReportGranularity[]).map((item) => <SelectItem key={item} value={item}>{GRANULARITY_LABELS[item]}</SelectItem>)}</SelectContent>
          </Select>
        ) : null}
      </div>
      {invalid ? <FieldError>A matrix needs a column grouping.</FieldError> : null}
    </Field>
  );
}

function DateFilterFields({ config, dateFields, defaultField, onChange }: {
  config: ReportConfig;
  dateFields: ReportField[];
  defaultField: string;
  onChange: (value: ReportConfig["date_filter"]) => void;
}) {
  const current = config.date_filter ?? { field: defaultField, range: "all_time", start: null, end: null };
  const invalidRange = current.range === "custom" && current.start && current.end && current.end < current.start;
  return (
    <>
      <Field>
        <FieldLabel htmlFor="report-date-field">Date</FieldLabel>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
          <Select value={current.field} onValueChange={(field) => onChange({ ...current, field })}>
            <SelectTrigger id="report-date-field" aria-label="Date field"><SelectValue /></SelectTrigger>
            <SelectContent>{dateFields.map((field) => <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={current.range} onValueChange={(range) => onChange(range === "all_time" ? null : { ...current, range })}>
            <SelectTrigger aria-label="Date range"><SelectValue /></SelectTrigger>
            <SelectContent>{DATE_RANGE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {current.range !== "custom" && current.range !== "all_time" ? <FieldDescription>Relative: the range moves with the calendar.</FieldDescription> : null}
      </Field>
      {current.range === "custom" ? (
        <div className="grid grid-cols-2 gap-2">
          <Field>
            <FieldLabel htmlFor="report-date-start">From</FieldLabel>
            <Input id="report-date-start" type="date" value={current.start ?? ""} onChange={(event) => onChange({ ...current, start: event.target.value || null })} />
          </Field>
          <Field data-invalid={invalidRange || undefined}>
            <FieldLabel htmlFor="report-date-end">To</FieldLabel>
            <Input id="report-date-end" type="date" value={current.end ?? ""} aria-invalid={Boolean(invalidRange)} aria-describedby={invalidRange ? "report-date-end-error" : undefined} onChange={(event) => onChange({ ...current, end: event.target.value || null })} />
            {invalidRange ? <FieldError id="report-date-end-error">The end date must be on or after the start.</FieldError> : null}
          </Field>
        </div>
      ) : null}
    </>
  );
}

type SaveDetails = { name: string; description: string | null; visibility: "private" | "everyone" };

/** Name, description and who can see it: saving a report, a copy, or changing those later. */
export function SaveReportDialog({ open, title, initialName, initialDescription, initialVisibility = "private", submitLabel = "Save report", noun = "report", isPending, onClose, onSave }: {
  open: boolean;
  /** Reports and dashboards share this dialog; the noun is the only wording that differs. */
  noun?: "report" | "dashboard";
  title: string;
  initialName: string;
  initialDescription: string;
  initialVisibility?: "private" | "everyone";
  submitLabel?: string;
  isPending: boolean;
  onClose: () => void;
  onSave: (details: SaveDetails, onError: (error: Error) => void) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogBackdrop />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel size="md" aria-describedby={undefined}>
          {open ? <SaveReportForm title={title} noun={noun} initialName={initialName} initialDescription={initialDescription} initialVisibility={initialVisibility} submitLabel={submitLabel} isPending={isPending} onClose={onClose} onSave={onSave} /> : null}
        </DialogPanel>
      </div>
    </Dialog>
  );
}

function SaveReportForm({ title, noun, initialName, initialDescription, initialVisibility, submitLabel, isPending, onClose, onSave }: {
  title: string;
  noun: "report" | "dashboard";
  initialName: string;
  initialDescription: string;
  initialVisibility: "private" | "everyone";
  submitLabel: string;
  isPending: boolean;
  onClose: () => void;
  onSave: (details: SaveDetails, onError: (error: Error) => void) => void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [visibility, setVisibility] = useState<"private" | "everyone">(initialVisibility);
  const [error, setError] = useState("");

  function submit() {
    if (!name.trim()) {
      setError(`Name the ${noun}.`);
      return;
    }
    onSave({ name: name.trim(), description: description.trim() || null, visibility }, (failure) => {
      const status = (failure as Error & { status?: number }).status;
      setError(status === 409 ? `You already have a ${noun} with this name. Choose another.` : `The ${noun} could not be saved. Try again.`);
    });
  }

  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogIconClose />
      </DialogHeader>
      <div className="mt-4 flex flex-col gap-4">
        <Field data-invalid={Boolean(error) || undefined}>
          <FieldLabel htmlFor="saved-report-name">Name</FieldLabel>
          <Input id="saved-report-name" value={name} maxLength={150} autoFocus onChange={(event) => { setName(event.target.value); setError(""); }} aria-invalid={Boolean(error)} aria-describedby={error ? "saved-report-name-error" : undefined} placeholder={noun === "dashboard" ? "Sales overview" : "Deals closing this quarter"} />
          {error ? <FieldError id="saved-report-name-error">{error}</FieldError> : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="saved-report-description">Description</FieldLabel>
          <Textarea id="saved-report-description" value={description} maxLength={1000} rows={3} onChange={(event) => setDescription(event.target.value)} placeholder={noun === "dashboard" ? "Who it is for, and what it tracks" : "What this report answers"} />
        </Field>
        <Field>
          <FieldLabel>Who can see it</FieldLabel>
          <SegmentedControl aria-label="Who can see it" value={visibility} onValueChange={setVisibility}>
            <SegmentedItem value="private"><Lock />Only me</SegmentedItem>
            <SegmentedItem value="everyone"><Globe2 />Everyone</SegmentedItem>
          </SegmentedControl>
          <FieldDescription>
            {visibility === "everyone"
              ? noun === "dashboard"
                ? "Everyone can open it. Each widget shows only reports that are shared too, and only records each person already has access to."
                : "Everyone can open it. Each person sees only the records they already have access to."
              : `Only you can see this ${noun}.`}
          </FieldDescription>
        </Field>
      </div>
      <DialogFooter className="mt-4">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : submitLabel}</Button>
      </DialogFooter>
    </form>
  );
}
