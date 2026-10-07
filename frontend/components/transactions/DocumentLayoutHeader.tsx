"use client";

import type { ReactNode } from "react";

import { ReadOnlyRecordLayout, referenceLabel } from "@/components/forms/ReadOnlyRecordLayout";
import { Button } from "@/components/ui/button";
import { EmptyValue } from "@/components/ui/EmptyValue";
import { Money } from "@/components/ui/Money";
import { TextLink } from "@/components/ui/TextLink";
import { useResolvedRecordLayout, type ResolvedRecordLayoutField } from "@/hooks/useResolvedRecordLayout";

/**
 * An ERP document's header once it is no longer editable (13b Phase 4e): the tenant's
 * `detail` layout, read-only. Amounts read in the document's currency, references as links
 * where the page gives one, everything else by its field type. Numbers and statuses sit in
 * the page header, so the layout lists what the header does not.
 */
export function DocumentDetailHeader({
  moduleKey,
  record,
  currency,
  links = {},
  renderValue,
  omitFieldKeys,
}: {
  moduleKey: string;
  record: object & { custom_fields?: Record<string, unknown> | null };
  /** The currency the document's amounts are in. */
  currency?: string | null;
  /** Field key → where its reference opens. A key with no href draws the name only. */
  links?: Record<string, string | null | undefined>;
  /** The page's own rendering for a field; `undefined` falls through to the defaults. */
  renderValue?: (field: ResolvedRecordLayoutField, value: unknown) => ReactNode | undefined;
  omitFieldKeys?: readonly string[];
}) {
  const layoutQuery = useResolvedRecordLayout(moduleKey, "detail");
  const values = record as Record<string, unknown>;
  if (layoutQuery.isLoading) {
    return <p className="text-sm text-copy-muted" aria-busy="true">Loading details…</p>;
  }
  if (!layoutQuery.data) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-copy-secondary">
        <span>These details could not be loaded.</span>
        <Button type="button" variant="outline" size="sm" onClick={() => void layoutQuery.refetch()}>Try again</Button>
      </div>
    );
  }
  return (
    <ReadOnlyRecordLayout
      layout={layoutQuery.data}
      values={values}
      customValues={record.custom_fields ?? {}}
      omitFieldKeys={omitFieldKeys}
      renderValue={(field, value) => {
        const own = renderValue?.(field, value);
        if (own !== undefined) return own;
        const href = links[field.field_key];
        if (href && value !== null && value !== undefined) {
          return <TextLink href={href}>{referenceLabel(field.field_key, values) ?? String(value)}</TextLink>;
        }
        if (field.field_type === "currency") {
          return value === null || value === undefined || value === ""
            ? <EmptyValue context="field" />
            : <Money amount={value as string | number} currency={currency ?? undefined} context="field" />;
        }
        return undefined;
      }}
    />
  );
}
