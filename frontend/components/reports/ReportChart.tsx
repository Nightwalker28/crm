"use client";

import { forwardRef, useMemo, type ReactElement } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartContainer, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { StatGroup, StatTile } from "@/components/ui/StatTile";
import { CHART_AXIS_STROKE, CHART_GRID_STROKE, CHART_SERIES_COLORS, CHART_TICK_FILL, seriesColor } from "@/lib/chartColors";
import { formatMeasureValue, type ReportChartType, type ReportResult } from "@/lib/reports";

/** Past the palette, series fold into "Other" rather than cycling a hue (dataviz). */
const MAX_SERIES = CHART_SERIES_COLORS.length;
const OTHER_KEY = "__other__";

type Datum = { key: string; label: string; [series: string]: number | string | null };

/**
 * The chart for a report run. It plots the first measure only: two measures of different
 * scale on one chart is a dual axis, and the table beside it carries the rest.
 *
 * One grouping is one series in one colour. A second grouping becomes the series: stacked
 * for columns and bars, a line each for lines, coloured by the column group's order, which
 * the server fixes (stage order, date order, or size), so a colour follows its entity.
 *
 * Clicking a mark drills into its records (`onSelect` with the group's keys).
 */
export const ReportChart = forwardRef<HTMLDivElement, {
  result: ReportResult;
  type: ReportChartType;
  onSelect?: (keys: string[], label: string) => void;
  className?: string;
}>(function ReportChart({ result, type, onSelect, className = "h-[22rem] w-full" }, ref) {
  const measure = result.measures[0];
  const twoLevel = result.groupings.length === 2;

  const { data, series, folded } = useMemo(() => {
    if (!twoLevel) {
      const rows: Datum[] = result.rows.map((row) => ({ key: row.keys[0], label: row.labels[0], value: row.values[0] ?? 0 }));
      return { data: rows, series: [{ key: "value", label: measure?.label ?? "Value" }], folded: false };
    }
    const columns = result.column_groups;
    const foldable = measure?.aggregate === "count" || measure?.aggregate === "sum";
    const kept = columns.length > MAX_SERIES ? columns.slice(0, MAX_SERIES - (foldable ? 1 : 0)) : columns;
    const keptKeys = new Set(kept.map((column) => column.key));
    const byRow = new Map<string, Datum>();
    for (const group of result.row_groups) byRow.set(group.key, { key: group.key, label: group.label });
    for (const row of result.rows) {
      const datum = byRow.get(row.keys[0]);
      if (!datum) continue;
      const value = row.values[0] ?? 0;
      if (keptKeys.has(row.keys[1])) datum[row.keys[1]] = value;
      else if (foldable) datum[OTHER_KEY] = Number(datum[OTHER_KEY] ?? 0) + value;
    }
    const seriesList = kept.map((column) => ({ key: column.key, label: column.label }));
    const didFold = foldable && columns.length > kept.length;
    if (didFold) seriesList.push({ key: OTHER_KEY, label: "Other" });
    return { data: [...byRow.values()], series: seriesList, folded: didFold };
  }, [measure, result, twoLevel]);

  const chartConfig: ChartConfig = Object.fromEntries(
    series.map((item, index) => [item.key, { label: item.label, color: seriesColor(index) }]),
  );
  const fieldType = measure?.field_type;
  const tickFormatter = (value: number) => formatMeasureValue(value, fieldType, { compact: true });
  const ariaLabel = `${result.label} ${measure?.label.toLocaleLowerCase() ?? "records"}${result.groupings.length ? ` by ${result.groupings.map((group) => group.label.toLocaleLowerCase()).join(" and ")}` : ""}`;

  function select(datum: Datum | undefined, seriesKey?: string) {
    if (!datum || !onSelect) return;
    if (twoLevel && seriesKey && seriesKey !== "value" && seriesKey !== OTHER_KEY) {
      const seriesLabel = series.find((item) => item.key === seriesKey)?.label ?? seriesKey;
      onSelect([datum.key, seriesKey], `${datum.label} · ${seriesLabel}`);
      return;
    }
    onSelect([datum.key], datum.label);
  }

  if (type === "metric" || !result.groupings.length) {
    return (
      <StatGroup label="Report total" layout="stack">
        <StatTile label={measure?.label ?? "Records"} value={formatMeasureValue(result.totals.values[0] ?? result.totals.count, fieldType)} context={`${new Intl.NumberFormat().format(result.totals.count)} records`} />
      </StatGroup>
    );
  }

  const legend = series.length > 1 ? (
    <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-p-xs text-copy-secondary">
      {series.map((item, index) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: seriesColor(index) }} />
          {item.label}
        </li>
      ))}
    </ul>
  ) : null;

  const cursor = onSelect ? "pointer" : undefined;
  let chart: ReactElement;
  if (type === "donut" || type === "funnel") {
    const single = twoLevel
      ? data.map((datum) => ({ key: datum.key, label: datum.label, value: series.reduce((sum, item) => sum + Number(datum[item.key] ?? 0), 0) }))
      : data;
    chart = type === "donut" ? (
      <PieChart>
        <Tooltip content={<ChartTooltipContent />} />
        <Pie data={single} dataKey="value" nameKey="label" outerRadius="82%" innerRadius="56%" paddingAngle={1} stroke="var(--color-surface-raised)" strokeWidth={2} onClick={(entry) => select((entry as { payload?: Datum })?.payload)} cursor={cursor}>
          {/* Slices are categories, so each takes its own hue in the server's order. */}
          {single.map((datum, index) => <Cell key={datum.key} fill={seriesColor(index)} />)}
        </Pie>
      </PieChart>
    ) : (
      <FunnelChart>
        <Tooltip content={<ChartTooltipContent />} />
        {/* A funnel is one measure across ordered stages: one series, one colour. */}
        <Funnel data={single} dataKey="value" nameKey="label" isAnimationActive={false} fill={seriesColor(0)} stroke="var(--color-surface-raised)" strokeWidth={2} onClick={(entry) => select((entry as { payload?: Datum })?.payload)} cursor={cursor}>
          <LabelList position="right" dataKey="label" fill={CHART_TICK_FILL} stroke="none" fontSize={11} />
        </Funnel>
      </FunnelChart>
    );
  } else if (type === "line") {
    chart = (
      <LineChart
        data={data}
        margin={{ top: 8, right: 16, left: 4, bottom: 8 }}
        // A click anywhere on a period drills into that period, across every line.
        onClick={(state) => {
          const index = Number((state as { activeTooltipIndex?: unknown } | null)?.activeTooltipIndex);
          if (Number.isInteger(index)) select(data[index]);
        }}
        style={cursor ? { cursor } : undefined}
      >
        <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
        <XAxis dataKey="label" tickLine={false} stroke={CHART_AXIS_STROKE} tick={{ fill: CHART_TICK_FILL, fontSize: 11 }} minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} stroke={CHART_AXIS_STROKE} tick={{ fill: CHART_TICK_FILL, fontSize: 11 }} tickFormatter={tickFormatter} width={56} />
        <Tooltip content={<ChartTooltipContent />} cursor={{ stroke: CHART_AXIS_STROKE }} />
        {series.map((item, index) => (
          <Line
            key={item.key}
            type="monotone"
            dataKey={item.key}
            name={item.label}
            stroke={seriesColor(index)}
            strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, fill: "var(--color-surface-raised)" }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    );
  } else {
    const horizontal = type === "bar";
    chart = (
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 16, left: 4, bottom: horizontal ? 8 : 40 }} barCategoryGap="20%">
        <CartesianGrid stroke={CHART_GRID_STROKE} vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tickLine={false} axisLine={false} stroke={CHART_AXIS_STROKE} tick={{ fill: CHART_TICK_FILL, fontSize: 11 }} tickFormatter={tickFormatter} />
            <YAxis type="category" dataKey="label" tickLine={false} stroke={CHART_AXIS_STROKE} tick={{ fill: CHART_TICK_FILL, fontSize: 11 }} width={128} interval={0} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" tickLine={false} stroke={CHART_AXIS_STROKE} tick={{ fill: CHART_TICK_FILL, fontSize: 11 }} angle={-24} textAnchor="end" height={56} interval={0} />
            <YAxis tickLine={false} axisLine={false} stroke={CHART_AXIS_STROKE} tick={{ fill: CHART_TICK_FILL, fontSize: 11 }} tickFormatter={tickFormatter} width={56} />
          </>
        )}
        <Tooltip content={<ChartTooltipContent />} cursor={{ fill: "var(--color-surface-muted)" }} />
        {series.map((item, index) => (
          <Bar
            key={item.key}
            dataKey={item.key}
            name={item.label}
            stackId={twoLevel ? "groups" : undefined}
            fill={seriesColor(index)}
            // A 2px surface gap between stacked segments; the data end is rounded only
            // where it meets nothing, which for a stack is the last segment.
            stroke="var(--color-surface-raised)"
            strokeWidth={twoLevel ? 1 : 0}
            radius={!twoLevel || index === series.length - 1 ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0}
            onClick={(entry) => select((entry as { payload?: Datum })?.payload, item.key)}
            cursor={cursor}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ChartContainer ref={ref} config={chartConfig} className={className} role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
      </ChartContainer>
      {legend}
      {folded ? <p className="text-p-xs text-copy-muted">The smallest groups are combined as Other. The table lists every group.</p> : null}
    </div>
  );
});
