"use client";

import type { ReactNode } from "react";
import type { SavedViewFilters } from "@/hooks/useSavedViews";

import { Button } from "@/components/ui/button";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { PageHeader } from "@/components/ui/PageHeader";
import { Plus } from "lucide-react";
import { buildSavedViewExportPayload } from "@/lib/savedViewQuery";

interface ContactsHeaderProps {
  onCreateClick: () => void;
  onImportSuccess?: () => void;
  viewSelector?: ReactNode;
  selectedIds?: number[];
  currentPageIds?: number[];
  exportFilters?: SavedViewFilters;
}

export default function ContactsHeader({
  onCreateClick,
  onImportSuccess,
  viewSelector,
  selectedIds = [],
  currentPageIds = [],
  exportFilters,
}: ContactsHeaderProps) {
  return (
    <PageHeader
      title="Contacts"
      description="View and manage contacts linked to organizations."
      actions={
        <>
          {viewSelector}
          <ModuleImportExportControls
            importEndpoint="/sales/contacts/import"
            exportEndpoint="/sales/contacts/export"
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
