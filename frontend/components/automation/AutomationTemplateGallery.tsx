"use client";

import { ArrowRight, LayoutTemplate } from "lucide-react";

import type { AutomationTemplate } from "./types";
import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { RouteLoadingState } from "@/components/ui/RouteStates";

/**
 * Ready-made rules, grouped the way an operator thinks about them: by what they work on.
 * Choosing one opens the builder prefilled and disabled. Nothing runs until it is saved and
 * switched on, so trying one costs nothing.
 */
export function AutomationTemplateGallery({ templates, triggerLabels, isLoading, hasError, onRetry, onUse }: {
  templates: AutomationTemplate[];
  triggerLabels: Map<string, string>;
  isLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
  onUse: (template: AutomationTemplate) => void;
}) {
  if (isLoading) return <RouteLoadingState label="templates" />;
  if (hasError) {
    return <EmptyState icon={LayoutTemplate} title="Templates could not be loaded" description="Your rules are unchanged. Try again." action={<Button type="button" variant="outline" onClick={onRetry}>Try again</Button>} />;
  }
  if (!templates.length) return <EmptyState icon={LayoutTemplate} title="No templates available" description="Create a rule from scratch instead." />;

  const categories = [...new Set(templates.map((template) => template.category))];
  return <div data-testid="automation-template-gallery" className="grid gap-6">
    {categories.map((category) => (
      <section key={category} aria-labelledby={`automation-templates-${category}`} className="grid gap-3">
        <h2 id={`automation-templates-${category}`} className="text-sm font-semibold text-copy-primary">{category}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {templates.filter((template) => template.category === category).map((template) => (
            <Card key={template.key} className="flex min-w-0 flex-col gap-3 p-4">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-copy-primary">{template.name}</h3>
                <p className="mt-1 text-p-sm text-copy-muted">{template.description}</p>
              </div>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                <Chip>{triggerLabels.get(template.trigger_event) ?? template.trigger_event}</Chip>
                <Button type="button" variant="outline" size="sm" onClick={() => onUse(template)} aria-label={`Use template: ${template.name}`}>Use template<ArrowRight /></Button>
              </div>
            </Card>
          ))}
        </div>
      </section>
    ))}
  </div>;
}
