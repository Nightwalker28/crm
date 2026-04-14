"use client";

import { useState, useCallback, useRef } from "react";
import { Upload, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import DuplicateConfirmation from "@/components/finance/duplicateConfirmation";
import { apiFetch } from "@/lib/api";

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: () => void;
}

type UploadStatus = "idle" | "uploading" | "success" | "error";

export default function UploadModal({
  isOpen,
  onClose,
  onUploadSuccess,
}: UploadModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [duplicateDialog, setDuplicateDialog] = useState({
    open: false,
    items: [] as string[],
    formData: null as FormData | null,
  });

  /* ================= VALIDATION ================= */

  const validateFile = (file: File): boolean => {
    const lowerCaseName = file.name.toLowerCase();
    if (!lowerCaseName.endsWith(".csv")) {
      toast.error("Invalid file type", {
        description: "Only .csv files are supported",
      });
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large", {
        description: "Max allowed size is 10MB",
      });
      return false;
    }
    return true;
  };

  /* ================= DRAG & DROP ================= */

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter(validateFile);
    if (droppedFiles.length) {
      setFiles((prev) => [...prev, ...droppedFiles]);
    }
  }, []);

  /* ================= FILE PICKER ================= */

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    const selected = Array.from(e.target.files).filter(validateFile);
    if (selected.length) {
      setFiles((prev) => [...prev, ...selected]);
    }
  };

  /* ================= UPLOAD ================= */

  const handleUpload = async () => {
    if (!files.length) return;

    setUploadStatus("uploading");

    const formData = new FormData();
    if (files[0]) {
      formData.append("file", files[0]);
    }

    try {
      const res = await apiFetch(
        "/finance/insertion-orders/import?replace_duplicates=false&skip_duplicates=false&create_new_records=false",
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && data.requires_confirmation) {
        setUploadStatus("idle");
        setDuplicateDialog({
          open: true,
          items: data.duplicate_io_numbers || [],
          formData,
        });
        return;
      }

      if (!res.ok) throw new Error(data.detail ?? data.message ?? "Upload failed");

      setUploadStatus("success");
      toast.success(data.message || "Upload successful!");

      setTimeout(() => {
        onUploadSuccess();
        handleClose();
      }, 600);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      toast.error(message);
      setUploadStatus("error");
    }
  };

  /* ================= DUPLICATE CONFIRMATION ================= */

const resendWithAction = async (
  action: "replace" | "skip" | "create"
) => {
  if (!duplicateDialog.formData) return;

  const query =
    action === "replace"
      ? "?replace_duplicates=true"
      : action === "skip"
      ? "?skip_duplicates=true"
      : "?create_new_records=true";

  try {
    const res = await apiFetch(`/finance/insertion-orders/import${query}`, {
      method: "POST",
      body: duplicateDialog.formData, // ✅ contains ALL selected files
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.detail ?? data.message ?? "Upload failed");
    }

    toast.success(data.message || "Upload completed");

    setDuplicateDialog({
      open: false,
      items: [],
      formData: null,
    });

    onUploadSuccess();
    handleClose();
  } catch (err) {
    console.error(err);
    toast.error(err instanceof Error ? err.message : "Upload failed");
  }
};

  /* ================= HELPERS ================= */

  const handleClose = () => {
    setFiles([]);
    setUploadStatus("idle");
    setIsDragging(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    onClose();
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-zinc-900 rounded-xl shadow-2xl max-w-lg w-full border border-zinc-800">

          {/* HEADER */}
          <div className="flex items-center justify-between p-6 border-b border-zinc-800">
            <div>
              <h2 className="text-xl font-semibold text-zinc-100">
                Import Insertion Orders
              </h2>
              <p className="text-sm text-zinc-400 mt-1">
                Import generic insertion orders from a CSV file
              </p>
            </div>
            <Button onClick={handleClose} variant="ghost" size="icon-sm">
              <X />
            </Button>
          </div>

          <div className="p-6">
            {/* DROP ZONE */}
            {files.length === 0 && (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`
                  border-2 border-dashed rounded-lg p-6 text-center transition-all
                  ${isDragging ? "border-blue-500 bg-blue-500/10" : "border-zinc-700"}
                `}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="file-upload"
                />

                <Upload className="mx-auto mb-3 text-zinc-400" size={40} />
                <p className="text-zinc-100 font-medium">
                  Drag & drop a CSV file here
                </p>
                <p className="text-sm text-zinc-400 my-2">or</p>
                <Button asChild variant="outline">
                  <label htmlFor="file-upload" className="cursor-pointer">
                    Browse Files
                  </label>
                </Button>
              </div>
            )}

            {/* FILE LIST */}
            {files.length > 0 && (
              <div className="max-h-48 overflow-y-auto pr-1">
                <div className="flex flex-col gap-2">
                  {files.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 bg-zinc-800/50 border border-zinc-700 rounded-md px-3 py-2"
                    >
                      <FileText className="text-blue-400 shrink-0" size={24} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-100 truncate">
                          {file.name}
                        </p>
                        <p className="text-xs text-zinc-400">
                          {(file.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                      <Button
                        onClick={() => removeFile(idx)}
                        variant="ghost"
                        size="icon-sm"
                      >
                        <X />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* FOOTER */}
          <div className="flex items-center justify-end gap-3 p-6 border-t border-zinc-800">
            <Button onClick={handleClose} variant="ghost">
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!files.length || uploadStatus === "uploading"}
            >
              {uploadStatus === "uploading" ? "Uploading..." : "Upload"}
            </Button>
          </div>
        </div>
      </div>

      <DuplicateConfirmation
        open={duplicateDialog.open}
        items={duplicateDialog.items}
        onCancel={() =>
          setDuplicateDialog({ open: false, items: [], formData: null })
        }
        onChoose={resendWithAction}
      />
    </>
  );
}
