"use client";

import { Button } from "@/components/ui/button";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { Plus } from "lucide-react";

interface OrganizationsHeaderProps {
  onImportSuccess?: () => void;
  onCreateClick: () => void;
}

export default function OrganizationsHeader({
  onCreateClick,
  onImportSuccess,
}: OrganizationsHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">
          Organizations
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Manage and view your organizations
        </p>
      </div>

      <div className="flex items-center gap-3">
        <ModuleImportExportControls
          importEndpoint="/sales/organizations/import"
          exportEndpoint="/sales/organizations/export"
          exportMethod="POST"
          exportBody={{ org_ids: null }}
          onImportSuccess={onImportSuccess}
        />

        <Button onClick={onCreateClick}>
          <Plus />
          <span className="hidden sm:inline">Create</span>
        </Button>
      </div>
    </div>
  );
}
