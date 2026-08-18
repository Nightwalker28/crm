"use client";

import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ExportControls } from "@/components/ui/ExportControls";
import { ImportControls } from "@/components/ui/ImportControls";

type Props = {
  importEndpoint?: string;
  exportEndpoint?: string;
  exportMethod?: "GET" | "POST";
  exportBody?: unknown;
  importLabel?: string;
  exportLabel?: string;
  fileAccept?: string;
  onImportSuccess?: () => void;
  selectedIds?: number[];
  currentPageIds?: number[];
  onExportSuccess?: () => void;
};

export function ModuleImportExportControls({
  importEndpoint,
  exportEndpoint,
  exportMethod = "GET",
  exportBody,
  importLabel = "Import",
  exportLabel = "Export",
  fileAccept = ".csv",
  onImportSuccess,
  selectedIds = [],
  currentPageIds = [],
  onExportSuccess,
}: Props) {
  if (!importEndpoint && !exportEndpoint) {
    return null;
  }

  return (
    <div className="flex items-center gap-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline">
            Actions
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {importEndpoint ? (
            <ImportControls
              importEndpoint={importEndpoint}
              importLabel={importLabel}
              fileAccept={fileAccept}
              onImportSuccess={onImportSuccess}
            />
          ) : null}
          {exportEndpoint ? (
            <ExportControls
              exportEndpoint={exportEndpoint}
              exportMethod={exportMethod}
              exportBody={exportBody}
              exportLabel={exportLabel}
              selectedIds={selectedIds}
              currentPageIds={currentPageIds}
              onExportSuccess={onExportSuccess}
            />
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
