"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export type ChartConfig = Record<string, { label: string; color?: string }>;

type ChartContextValue = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextValue | null>(null);

const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    config: ChartConfig;
  }
>(function ChartContainer({
  config,
  className,
  children,
  ...props
}, ref) {
  const cssVars = Object.fromEntries(
    Object.entries(config)
      .filter(([, item]) => item.color)
      .map(([key, item]) => [`--color-${key}`, item.color]),
  ) as React.CSSProperties;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        ref={ref}
        data-slot="chart"
        className={cn(
          "flex aspect-auto justify-center text-xs text-neutral-400 [&_.recharts-cartesian-axis-tick_text]:fill-neutral-400 [&_.recharts-cartesian-grid_line]:stroke-neutral-800 [&_.recharts-tooltip-cursor]:fill-neutral-800/50",
          className,
        )}
        style={cssVars}
        {...props}
      >
        {children}
      </div>
    </ChartContext.Provider>
  );
});

function ChartTooltipContent({ active, payload, label }: { active?: boolean; payload?: Array<Record<string, unknown>>; label?: string }) {
  const context = React.useContext(ChartContext);
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm shadow-xl">
      {label ? <div className="mb-2 font-medium text-neutral-100">{label}</div> : null}
      <div className="space-y-1.5">
        {payload.map((item, index) => {
          const dataKey = String(item.dataKey ?? item.name ?? index);
          const config = context?.config[dataKey];
          const value = typeof item.value === "number"
            ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(item.value)
            : String(item.value ?? "");
          return (
            <div key={`${dataKey}-${index}`} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-neutral-400">
                <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: String(item.color ?? config?.color ?? "#8bdbc1") }} />
                <span>{config?.label ?? String(item.name ?? dataKey)}</span>
              </div>
              <span className="font-medium tabular-nums text-neutral-100">{value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { ChartContainer, ChartTooltipContent };
