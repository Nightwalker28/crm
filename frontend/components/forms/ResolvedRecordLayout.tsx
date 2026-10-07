"use client";

import { Fragment, type ReactNode } from "react";

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
  /**
   * Fields another region already owns. Filtered here rather than by returning `null` from
   * `renderField`, so an omitted field takes its grid cell with it and a section left with
   * nothing disappears instead of drawing an empty panel.
   */
  omitFieldKeys?: readonly string[];
  /**
   * What sits between the sections but is not a field — a document's line editor. It goes
   * after `afterSection` when the layout still has that section in the main region, else
   * after the first main section: an administrator renaming or moving sections must not
   * lose the lines.
   */
  mainInsert?: { afterSection?: string; node: ReactNode };
  /** Controls in a section's heading, by section id ("Same as billing"). */
  sectionActions?: Record<string, ReactNode>;
};

function LayoutSection({
  section,
  renderField,
  invalidFieldKeys,
  viewport,
  omitted,
  actions,
}: {
  section: ResolvedRecordLayoutSection;
  renderField: Props["renderField"];
  invalidFieldKeys: Set<string>;
  viewport: ResolvedRecordLayoutViewport;
  omitted: Set<string>;
  actions?: ReactNode;
}) {
  const fields = [...section.fields]
    .filter((field) => field.visible && !omitted.has(field.field_key))
    .sort((left, right) => left.position - right.position);
  if (!fields.length) return null;
  const hasInvalidField = fields.some((field) => invalidFieldKeys.has(field.field_key));

  const body = (
    <div className={cn("grid gap-x-6 gap-y-4", viewport === "auto" && "md:grid-cols-2")}>
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
      className="p-6"
      data-layout-section={section.id}
      data-layout-region={section.region}
    >
      {section.collapsed_by_default ? (
        <details open={hasInvalidField ? true : undefined}>
          <summary className="cursor-pointer text-base font-semibold text-copy-primary">
            {section.label}
          </summary>
          <div className="mt-4">{body}</div>
        </details>
      ) : (
        <>
          {actions ? (
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-copy-primary">{section.label}</h2>
              {actions}
            </div>
          ) : (
            <h2 className="mb-4 text-base font-semibold text-copy-primary">{section.label}</h2>
          )}
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
  omitFieldKeys,
  mainInsert,
  sectionActions = {},
}: Props) {
  const sections = [...layout.sections].sort((left, right) => left.position - right.position);
  const mainSections = sections.filter((section) => section.region === "main");
  const sidebarSections = sections.filter((section) => section.region === "sidebar");
  const hasSidebar = sidebarSections.length > 0 || Boolean(fixedSidebar);
  const invalidFields = new Set(invalidFieldKeys);
  const omitted = new Set(omitFieldKeys ?? []);
  const insertAfter = mainInsert
    ? mainSections.some((section) => section.id === mainInsert.afterSection)
      ? mainInsert.afterSection
      : mainSections[0]?.id
    : undefined;
  const renderSection = (section: ResolvedRecordLayoutSection) => (
    <LayoutSection
      key={section.id}
      section={section}
      renderField={renderField}
      invalidFieldKeys={invalidFields}
      viewport={viewport}
      omitted={omitted}
      actions={sectionActions[section.id]}
    />
  );

  return (
    <div
      className={cn(
        "grid items-start gap-4",
        hasSidebar && viewport === "auto" && "lg:grid-cols-[minmax(0,1fr)_20rem]",
        className,
      )}
      data-record-layout={`${layout.module_key}:${layout.surface}`}
      data-layout-source={layout.source}
      data-layout-version={layout.version}
      data-layout-viewport={viewport}
    >
      <div className="grid min-w-0 gap-4">
        {mainInsert && !insertAfter ? mainInsert.node : null}
        {mainSections.map((section) => (
          <Fragment key={section.id}>
            {renderSection(section)}
            {section.id === insertAfter ? mainInsert?.node : null}
          </Fragment>
        ))}
      </div>
      {hasSidebar ? (
        <aside className="grid gap-4">
          {sidebarSections.map(renderSection)}
          {fixedSidebar}
        </aside>
      ) : null}
    </div>
  );
}
