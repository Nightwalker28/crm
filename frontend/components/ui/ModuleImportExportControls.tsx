"use client";

import { useRef, useState } from "react";
import { ChevronDown, Download, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ExportControls } from "@/components/ui/ExportControls";
import { ImportControls } from "@/components/ui/ImportControls";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";

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
  /** The module whose `configure` grant lets the importer add unknown picklist values. */
  picklistModuleKey?: string;
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
  picklistModuleKey,
}: Props) {
  const { modules } = useAccessibleModules();
  const canAddListValues = Boolean(
    picklistModuleKey && modules.find((module) => module.name === picklistModuleKey)?.actions?.can_configure,
  );
  // The dialog and the file input live beside the menu, not inside it. Radix unmounts the
  // menu's content when an item closes it, and anything rendered there went with it: the
  // export dialog opened and vanished in the same frame, and the import picker returned to an
  // input that no longer existed. The items only open what is mounted out here.
  const [isExportOpen, setIsExportOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
            <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
              <Upload aria-hidden="true" />
              {importLabel}
            </DropdownMenuItem>
          ) : null}
          {exportEndpoint ? (
            <DropdownMenuItem onSelect={() => setIsExportOpen(true)}>
              <Download aria-hidden="true" />
              {exportLabel}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {importEndpoint ? (
        <ImportControls
          hideTrigger
          fileInputRef={fileInputRef}
          importEndpoint={importEndpoint}
          importLabel={importLabel}
          fileAccept={fileAccept}
          onImportSuccess={onImportSuccess}
          allowAddingListValues={canAddListValues}
        />
      ) : null}
      {exportEndpoint ? (
        <ExportControls
          hideTrigger
          open={isExportOpen}
          onOpenChange={setIsExportOpen}
          exportEndpoint={exportEndpoint}
          exportMethod={exportMethod}
          exportBody={exportBody}
          exportLabel={exportLabel}
          selectedIds={selectedIds}
          currentPageIds={currentPageIds}
          onExportSuccess={onExportSuccess}
        />
      ) : null}
    </div>
  );
}
