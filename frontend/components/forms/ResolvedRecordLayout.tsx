"use client";

import type { ReactNode } from "react";

import { Card } from "@/components/ui/Card";
import type {
  ResolvedRecordLayout as ResolvedRecordLayoutContract,
  ResolvedRecordLayoutField,
  ResolvedRecordLayoutSection,
} from "@/hooks/useResolvedRecordLayout";
import { cn } from "@/lib/utils";

/**
 * `viewport` exists for the layout builder's mobile preview. "auto" is the product
 * behaviour — breakpoints follow the real viewport. "mobile" pins the layout to the
 * single-column form it takes below `sm`, so an administrator on a desktop can see the
 * narrow-screen result without resizing the browser.
 */
export type ResolvedRecordLayoutViewport = "auto" | "mobile";

type Props = {
  layout: ResolvedRecordLayoutContract;
  renderField: (field: ResolvedRecordLayoutField) => ReactNode;
  className?: string;
  invalidFieldKeys?: string[];
  fixedSidebar?: ReactNode;
  viewport?: ResolvedRecordLayoutViewport;
};

function LayoutSection({
  section,
  renderField,
  invalidFieldKeys,
  viewport,
}: {
  section: ResolvedRecordLayoutSection;
  renderField: Props["renderField"];
  invalidFieldKeys: Set<string>;
  viewport: ResolvedRecordLayoutViewport;
}) {
  const fields = [...section.fields]
    .filter((field) => field.visible)
    .sort((left, right) => left.position - right.position);
  if (!fields.length) return null;
  const hasInvalidField = fields.some((field) => invalidFieldKeys.has(field.field_key));

  const body = (
    <div className={cn("grid gap-x-6 gap-y-4", viewport === "auto" && "sm:grid-cols-2")}>
      {fields.map((field) => (
        <div
          key={field.field_key}
          data-layout-field={field.field_key}
          data-layout-width={field.width}
          className={cn(field.width === "full" && viewport === "auto" && "sm:col-span-2")}
        >
          {renderField(field)}
        </div>
      ))}
    </div>
  );

  return (
    <Card
      className="px-5 py-5"
      data-layout-section={section.id}
      data-layout-region={section.region}
    >
      {section.collapsed_by_default ? (
        <details open={hasInvalidField ? true : undefined}>
          <summary className="cursor-pointer text-base font-semibold text-copy-primary">
            {section.label}
          </summary>
          <div className="mt-5">{body}</div>
        </details>
      ) : (
        <>
          <h2 className="mb-5 text-base font-semibold text-copy-primary">{section.label}</h2>
          {body}
        </>
      )}
    </Card>
  );
}

export function ResolvedRecordLayout({
  layout,
  renderField,
  className,
  invalidFieldKeys = [],
  fixedSidebar,
  viewport = "auto",
}: Props) {
  const sections = [...layout.sections].sort((left, right) => left.position - right.position);
  const mainSections = sections.filter((section) => section.region === "main");
  const sidebarSections = sections.filter((section) => section.region === "sidebar");
  const hasSidebar = sidebarSections.length > 0 || Boolean(fixedSidebar);
  const invalidFields = new Set(invalidFieldKeys);

  return (
    <div
      className={cn(
        "grid items-start gap-4",
        hasSidebar && viewport === "auto" && "lg:grid-cols-[minmax(0,2fr)_minmax(18rem,0.8fr)]",
        className,
      )}
      data-record-layout={`${layout.module_key}:${layout.surface}`}
      data-layout-source={layout.source}
      data-layout-version={layout.version}
      data-layout-viewport={viewport}
    >
      <div className="grid min-w-0 gap-4">
        {mainSections.map((section) => (
          <LayoutSection key={section.id} section={section} renderField={renderField} invalidFieldKeys={invalidFields} viewport={viewport} />
        ))}
      </div>
      {hasSidebar ? (
        <aside className="grid gap-4">
          {sidebarSections.map((section) => (
            <LayoutSection key={section.id} section={section} renderField={renderField} invalidFieldKeys={invalidFields} viewport={viewport} />
          ))}
          {fixedSidebar}
        </aside>
      ) : null}
    </div>
  );
}
