"use client";

import type { ReactNode } from "react";
import type { SavedViewFilters } from "@/hooks/useSavedViews";

import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { buildSavedViewExportPayload } from "@/lib/savedViewQuery";
import { Plus } from "lucide-react";

type QuotesHeaderProps = {
  onCreateClick: () => void;
  onImportSuccess?: () => void;
  viewSelector?: ReactNode;
  selectedIds?: number[];
  currentPageIds?: number[];
  exportFilters?: SavedViewFilters;
};

export default function QuotesHeader({ onCreateClick, onImportSuccess, viewSelector, selectedIds = [], currentPageIds = [], exportFilters }: QuotesHeaderProps) {
  return (
    <PageHeader
      title="Quotes"
      description="Prepare customer quotes before they become orders or invoices."
      actions={
        <>
          {viewSelector}
          <ModuleImportExportControls
            importEndpoint="/sales/quotes/import"
            exportEndpoint="/sales/quotes/export"
            exportMethod="POST"
            exportBody={buildSavedViewExportPayload(exportFilters)}
            onImportSuccess={onImportSuccess}
            selectedIds={selectedIds}
            currentPageIds={currentPageIds}
          />
          <Button onClick={onCreateClick}>
            <Plus />
            <span className="hidden sm:inline">Create</span>
          </Button>
        </>
      }
    />
  );
}
