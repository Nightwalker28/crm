"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ModuleImportExportControls } from "@/components/ui/ModuleImportExportControls";
import { PageHeader } from "@/components/ui/PageHeader";
import { Plus } from "lucide-react";

interface ContactsHeaderProps {
  onCreateClick: () => void;
  onImportSuccess?: () => void;
  viewSelector?: ReactNode;
}

export default function ContactsHeader({
  onCreateClick,
  onImportSuccess,
  viewSelector,
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
          onImportSuccess={onImportSuccess}
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
