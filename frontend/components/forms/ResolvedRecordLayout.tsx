"use client";

import type { ReactNode } from "react";

import { Card } from "@/components/ui/Card";
import type {
  ResolvedRecordLayout as ResolvedRecordLayoutContract,
  ResolvedRecordLayoutField,
  ResolvedRecordLayoutSection,
} from "@/hooks/useResolvedRecordLayout";
import { cn } from "@/lib/utils";

type Props = {
  layout: ResolvedRecordLayoutContract;
  renderField: (field: ResolvedRecordLayoutField) => ReactNode;
  className?: string;
  invalidFieldKeys?: string[];
  fixedSidebar?: ReactNode;
};

function LayoutSection({
  section,
  renderField,
  invalidFieldKeys,
}: {
  section: ResolvedRecordLayoutSection;
  renderField: Props["renderField"];
  invalidFieldKeys: Set<string>;
}) {
  const fields = [...section.fields]
    .filter((field) => field.visible)
    .sort((left, right) => left.position - right.position);
  if (!fields.length) return null;
  const hasInvalidField = fields.some((field) => invalidFieldKeys.has(field.field_key));

  const body = (
    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {fields.map((field) => (
        <div
          key={field.field_key}
          data-layout-field={field.field_key}
          data-layout-width={field.width}
          className={cn(field.width === "full" && "sm:col-span-2")}
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

export function ResolvedRecordLayout({ layout, renderField, className, invalidFieldKeys = [], fixedSidebar }: Props) {
  const sections = [...layout.sections].sort((left, right) => left.position - right.position);
  const mainSections = sections.filter((section) => section.region === "main");
  const sidebarSections = sections.filter((section) => section.region === "sidebar");
  const hasSidebar = sidebarSections.length > 0 || Boolean(fixedSidebar);
  const invalidFields = new Set(invalidFieldKeys);

  return (
    <div
      className={cn(
        "grid items-start gap-4",
        hasSidebar && "lg:grid-cols-[minmax(0,2fr)_minmax(18rem,0.8fr)]",
        className,
      )}
      data-record-layout={`${layout.module_key}:${layout.surface}`}
      data-layout-source={layout.source}
      data-layout-version={layout.version}
    >
      <div className="grid min-w-0 gap-4">
        {mainSections.map((section) => (
          <LayoutSection key={section.id} section={section} renderField={renderField} invalidFieldKeys={invalidFields} />
        ))}
      </div>
      {hasSidebar ? (
        <aside className="grid gap-4">
          {sidebarSections.map((section) => (
            <LayoutSection key={section.id} section={section} renderField={renderField} invalidFieldKeys={invalidFields} />
          ))}
          {fixedSidebar}
        </aside>
      ) : null}
    </div>
  );
}
