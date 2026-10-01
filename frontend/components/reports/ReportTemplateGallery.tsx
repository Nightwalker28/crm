"use client";

import Link from "next/link";
import { ArrowRight, LayoutTemplate } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { RouteLoadingState } from "@/components/ui/RouteStates";
import { FORMAT_LABELS, type ReportTemplate } from "@/lib/reports";

/**
 * Ready-made reports, grouped by the question they answer (HubSpot's report library). A
 * template opens the builder prefilled and unsaved, so trying one costs nothing. The same
 * shape as the automation template gallery.
 */
export function ReportTemplateGallery({ templates, isLoading, hasError, onRetry }: {
  templates: ReportTemplate[];
  isLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
}) {
  if (isLoading) return <RouteLoadingState label="templates" />;
  if (hasError) {
    return <EmptyState icon={LayoutTemplate} title="Templates could not be loaded" description="Your reports are unchanged. Try again." action={<Button type="button" variant="outline" onClick={onRetry}>Try again</Button>} />;
  }
  if (!templates.length) {
    return <EmptyState icon={LayoutTemplate} title="No templates for your modules" description="Templates appear for the modules you can view. Build a report from scratch instead." />;
  }

  const categories = [...new Set(templates.map((template) => template.category))];
  return (
    <div data-testid="report-template-gallery" className="grid gap-6">
      {categories.map((category) => (
        <section key={category} aria-labelledby={`report-templates-${category}`} className="grid gap-3">
          <h2 id={`report-templates-${category}`} className="text-sm font-semibold text-copy-primary">{category}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {templates.filter((template) => template.category === category).map((template) => (
              <Card key={template.key} className="flex min-w-0 flex-col gap-3 p-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-copy-primary">{template.name}</h3>
                  <p className="mt-1 text-p-sm text-copy-muted">{template.description}</p>
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                  <Chip>{template.module_label} · {FORMAT_LABELS[template.config.format]}</Chip>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/dashboard/reports/new?template=${encodeURIComponent(template.key)}`} aria-label={`Use template: ${template.name}`}>Use template<ArrowRight /></Link>
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
