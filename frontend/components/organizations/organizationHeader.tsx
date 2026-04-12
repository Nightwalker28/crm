"use client";

import { Button } from "@/components/ui/button";
import { Upload, Plus } from "lucide-react";

interface OrganizationsHeaderProps {
  onUploadSuccess?: () => void;
  onCreateClick: () => void;
}

export default function OrganizationsHeader({
  onCreateClick,
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
        <Button
          variant="outline"
          disabled
          title="Bulk organization upload is not wired yet"
        >
          <Upload />
          <span className="hidden sm:inline">Upload</span>
        </Button>

        <Button onClick={onCreateClick}>
          <Plus />
          <span className="hidden sm:inline">Create</span>
        </Button>
      </div>
    </div>
  );
}
