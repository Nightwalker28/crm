"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Plus } from "lucide-react";
// import UploadModal from "@/components/organizations/uploadModal"; // future

interface OrganizationsHeaderProps {
  onUploadSuccess?: () => void;
  onCreateClick: () => void;
}

export default function OrganizationsHeader({
  onUploadSuccess,
  onCreateClick,
}: OrganizationsHeaderProps) {
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const handleUploadSuccess = () => {
    onUploadSuccess?.();
    setIsUploadModalOpen(false);
  };

  return (
    <>
      {/* HEADER */}
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
            onClick={() => setIsUploadModalOpen(true)}
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

      {/* UPLOAD MODAL (future-ready) */}
      {/*
      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUploadSuccess={handleUploadSuccess}
        apiBaseUrl={API_BASE || ""}
      />
      */}
    </>
  );
}