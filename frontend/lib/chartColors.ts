/**
 * The categorical series palette, as CSS variable references.
 *
 * Charts are the one place colour survives in an otherwise neutral UI, because
 * series identity genuinely requires hue separation — there is no gray-only way
 * to tell five lines apart. See docs/design/design.md 1.2 and tokens.md 3.4.
 *
 * These resolve through `--chart-*`, so a chart follows the theme: every light
 * value is its dark counterpart with OKLCH hue held (drift <= 0.55 degrees) and
 * lightness moved until it clears 3:1 on white. A series therefore keeps its
 * identity across a theme flip.
 *
 * Assign in order and wrap with `seriesColor` — do not reorder for aesthetics,
 * because the same series should keep the same colour across screens.
 */
export const CHART_SERIES_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
  "var(--color-chart-7)",
  "var(--color-chart-8)",
] as const;

/** Colour for series `index`, cycling once the palette is exhausted. */
export function seriesColor(index: number): string {
  return CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length];
}

/**
 * Chart chrome. Axes and gridlines are structure, not data, so they use the
 * neutral tokens and follow the theme like everything else.
 */
export const CHART_GRID_STROKE = "var(--color-line-subtle)";
export const CHART_AXIS_STROKE = "var(--color-line-default)";
export const CHART_TICK_FILL = "var(--color-copy-muted)";
