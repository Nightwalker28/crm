"use client";

import type { ReactNode } from "react";
import type { SavedViewFilters } from "@/hooks/useSavedViews";

import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { buildSavedViewExportPayload } from "@/lib/savedViewQuery";
import { Plus } from "lucide-react";

type LeadsHeaderProps = {
  onCreateClick: () => void;
  onImportSuccess?: () => void;
  viewSelector?: ReactNode;
  selectedIds?: number[];
  currentPageIds?: number[];
  exportFilters?: SavedViewFilters;
};

export default function LeadsHeader({
  onCreateClick,
  onImportSuccess,
  viewSelector,
  selectedIds = [],
  currentPageIds = [],
  exportFilters,
}: LeadsHeaderProps) {
  return (
    <PageHeader
      title="Leads"
      description="Capture and qualify early sales leads before they become contacts or deals."
      actions={
        <>
          {viewSelector}
          <ModuleImportExportControls
            importEndpoint="/sales/leads/import"
            exportEndpoint="/sales/leads/export"
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
