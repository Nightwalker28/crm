"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import UploadModal from "@/components/finance/uploadModal";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { PageHeader } from "@/components/ui/PageHeader";

interface InsertionOrdersHeaderProps {
  onUploadSuccess: () => void;
  onCreateClick: () => void;
  viewSelector?: ReactNode;
  selectedIds?: number[];
  currentPageIds?: number[];
}

export default function InsertionOrdersHeader({
  onUploadSuccess,
  onCreateClick,
  viewSelector,
  selectedIds = [],
  currentPageIds = [],
}: InsertionOrdersHeaderProps) {
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const handleUploadSuccess = () => {
    onUploadSuccess();
    setIsUploadModalOpen(false);
  };

  return (
    <>
      <PageHeader
        title="Insertion Orders"
        description="Manage generic insertion orders and bring in CSV data when needed."
        actions={
          <>
            {viewSelector}
          <ModuleImportExportControls
            exportEndpoint="/finance/insertion-orders/export"
            exportMethod="POST"
            exportLabel="Export"
            onImportClick={() => setIsUploadModalOpen(true)}
            importLabel="Import"
            selectedIds={selectedIds}
            currentPageIds={currentPageIds}
          />

          <Button onClick={onCreateClick}>
            <Plus />
            <span className="hidden sm:inline">New Order</span>
          </Button>
          </>
        }
      />

      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUploadSuccess={handleUploadSuccess}
      />
    </>
  );
}
