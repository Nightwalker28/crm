"use client";

import { useRef, useState } from "react";
import { RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";

import DocumentList from "@/components/documents/DocumentList";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useDocumentActions, useDocuments } from "@/hooks/useDocuments";
import type { DocumentItem } from "@/hooks/useDocuments";
import { useConfirm } from "@/hooks/useConfirm";
import type { RecordModuleKey } from "@/types/record-activity";

type Props = {
  moduleKey: RecordModuleKey;
  entityId: string | number;
  canUpload?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
};

function errorMessage(_error: unknown, fallback: string) {
  return fallback;
}

export default function RecordDocumentsPanel({
  moduleKey,
  entityId,
  canUpload = true,
  canEdit = true,
  canDelete = true,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { confirm } = useConfirm();
  const [title, setTitle] = useState("");
  const documentsQuery = useDocuments({ moduleKey, entityId, limit: 25 });
  const { uploadDocument, deleteDocument, isUploadingDocument, isDeletingDocument } = useDocumentActions({ moduleKey, entityId });

  async function handleSelectedFile(file: File | undefined) {
    if (!canUpload || !file) return;
    try {
      await uploadDocument({
        file,
        title: title.trim() || undefined,
        linked_module_key: moduleKey,
        linked_entity_id: entityId,
      });
      setTitle("");
      if (inputRef.current) inputRef.current.value = "";
      toast.success("Document uploaded.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to upload document."));
    }
  }

  async function handleDelete(document: DocumentItem) {
    const confirmed = await confirm({
      title: "Remove document?",
      description: `Move "${document.title}" to the recycle bin?`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      await deleteDocument(document.id);
      toast.success("Document removed.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to delete document."));
    }
  }

  return (
    <Card className="px-5 py-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-copy-primary">Documents</h2>
          <FieldDescription className="mt-1">PDF, DOC, DOCX, TXT, RTF, and ODT files linked to this record.</FieldDescription>
        </div>
        {canUpload ? <div className="flex flex-col gap-2 md:w-72">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Optional document title"
          />
          <Input
            ref={inputRef}
            type="file"
            accept=".pdf,.doc,.docx,.txt,.rtf,.odt"
            onChange={(event) => void handleSelectedFile(event.target.files?.[0])}
            className="hidden"
          />
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={isUploadingDocument}>
            <Upload className="h-4 w-4" />
            {isUploadingDocument ? "Uploading..." : "Upload Document"}
          </Button>
        </div> : null}
      </div>
      <div className="mt-4">
        {documentsQuery.isLoading ? (
          <div
            className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-8 text-center text-sm text-copy-muted"
            aria-busy="true"
          >
            Loading documents...
          </div>
        ) : documentsQuery.error ? (
          <div
            role="alert"
            className="rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-4 text-sm text-copy-secondary"
          >
            <p>Documents could not be loaded.</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void documentsQuery.refetch()}>
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          </div>
        ) : (
          <DocumentList
            documents={documentsQuery.data?.results ?? []}
            emptyText="No documents are linked to this record yet."
            onDelete={canDelete ? (document) => void handleDelete(document) : undefined}
            canEdit={canEdit}
            isDeleting={isDeletingDocument}
          />
        )}
      </div>
    </Card>
  );
}
