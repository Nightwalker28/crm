"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { PageHeader } from "@/components/ui/PageHeader";
import { buildSavedViewExportPayload } from "@/lib/savedViewQuery";

interface InsertionOrdersHeaderProps {
  onUploadSuccess: () => void;
  viewSelector?: ReactNode;
  selectedIds?: number[];
  currentPageIds?: number[];
  exportFilters?: SavedViewFilters;
}

export default function InsertionOrdersHeader({
  onUploadSuccess,
  viewSelector,
  selectedIds = [],
  currentPageIds = [],
  exportFilters,
}: InsertionOrdersHeaderProps) {
  return (
    <PageHeader
      title="Insertion Orders"
      description="Manage generic insertion orders and bring in CSV data when needed."
      actions={
        <>
          {viewSelector}
          <ModuleImportExportControls
            importEndpoint="/finance/insertion-orders/import"
            exportEndpoint="/finance/insertion-orders/export"
            exportMethod="POST"
            exportBody={buildSavedViewExportPayload(exportFilters)}
            importLabel="Import"
            exportLabel="Export"
            onImportSuccess={onUploadSuccess}
            selectedIds={selectedIds}
            currentPageIds={currentPageIds}
          />

          <Button asChild>
            <Link href="/dashboard/finance/insertion-orders/new">
              <Plus />
              <span className="hidden sm:inline">New Order</span>
            </Link>
          </Button>
        </>
      }
    />
  );
}
