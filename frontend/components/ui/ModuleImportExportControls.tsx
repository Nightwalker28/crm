"use client";

import { Menu, MenuButton, MenuItems } from "@headlessui/react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
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
      <Menu as="div" className="relative">
        <MenuButton
          as={Button}
          type="button"
          variant="outline"
          className="border-neutral-800 bg-neutral-950/70 text-neutral-200 hover:bg-neutral-900 hover:text-neutral-100"
        >
          Actions
          <ChevronDown className="h-4 w-4" />
        </MenuButton>
        <MenuItems
          anchor="bottom end"
          className="z-50 mt-2 w-44 rounded-lg border border-neutral-800 bg-[#0d0d0d] p-1 shadow-2xl outline-none"
        >
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
        </MenuItems>
      </Menu>
    </div>
  );
}
