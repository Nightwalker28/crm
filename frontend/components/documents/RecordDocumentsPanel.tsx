"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";

import DocumentList from "@/components/documents/DocumentList";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useDocumentActions, useDocuments } from "@/hooks/useDocuments";

type Props = {
  moduleKey: "sales_contacts" | "sales_organizations" | "sales_opportunities";
  entityId: string | number;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function RecordDocumentsPanel({ moduleKey, entityId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const documentsQuery = useDocuments({ moduleKey, entityId, limit: 25 });
  const { uploadDocument, deleteDocument, isUploadingDocument, isDeletingDocument } = useDocumentActions({ moduleKey, entityId });

  async function handleSelectedFile(file: File | undefined) {
    if (!file) return;
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

  async function handleDelete(documentId: number) {
    try {
      await deleteDocument(documentId);
      toast.success("Document removed.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to delete document."));
    }
  }

  return (
    <Card className="px-5 py-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-neutral-100">Documents</h2>
          <FieldDescription className="mt-1">PDF, DOC, DOCX, TXT, RTF, and ODT files linked to this record.</FieldDescription>
        </div>
        <div className="flex flex-col gap-2 md:w-72">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Optional document title"
            className="h-9"
          />
          <input
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
        </div>
      </div>
      <div className="mt-4">
        {documentsQuery.isLoading ? (
          <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-4 py-8 text-center text-sm text-neutral-500">Loading documents...</div>
        ) : documentsQuery.error ? (
          <div className="rounded-md border border-red-900/50 bg-red-950/20 px-4 py-4 text-sm text-red-300">
            {errorMessage(documentsQuery.error, "Failed to load documents.")}
          </div>
        ) : (
          <DocumentList
            documents={documentsQuery.data?.results ?? []}
            emptyText="No documents are linked to this record yet."
            onDelete={(documentId) => void handleDelete(documentId)}
            isDeleting={isDeletingDocument}
          />
        )}
      </div>
    </Card>
  );
}
