"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { PageHeader } from "@/components/ui/PageHeader";
import { Plus } from "lucide-react";

interface OrganizationsHeaderProps {
  onImportSuccess?: () => void;
  onCreateClick: () => void;
  viewSelector?: ReactNode;
  selectedIds?: number[];
  currentPageIds?: number[];
}

export default function OrganizationsHeader({
  onCreateClick,
  onImportSuccess,
  viewSelector,
  selectedIds = [],
  currentPageIds = [],
}: OrganizationsHeaderProps) {
  return (
    <PageHeader
      title="Organizations"
      description="Manage and review customer and partner companies."
      actions={
        <>
          {viewSelector}
        <ModuleImportExportControls
          importEndpoint="/sales/organizations/import"
          exportEndpoint="/sales/organizations/export"
          exportMethod="POST"
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
