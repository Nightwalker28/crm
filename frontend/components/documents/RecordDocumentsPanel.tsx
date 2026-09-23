"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";

import DocumentList from "@/components/documents/DocumentList";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/input";
import { PanelError, PanelLoading } from "@/components/ui/PanelStates";
import { useDocumentActions, useDocuments } from "@/hooks/useDocuments";
import type { DocumentItem } from "@/hooks/useDocuments";
import { useConfirm } from "@/hooks/useConfirm";
import type { RecordModuleKey } from "@/types/record-activity";

/**
 * The archetype's `Files` tab.
 *
 * No heading: the tab strip above says `Files`, and drawing `Documents` under it is the
 * same word twice — in a second vocabulary (4.7, 1.6). The upload row is the panel's first
 * row, the way `Timeline`'s composer is, and the states come from `PanelStates` and from
 * `DocumentList`'s own table rather than from three hand-rolled boxes (7.4).
 */

type Props = {
  moduleKey: RecordModuleKey;
  entityId: string | number;
  canUpload?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
};

const ACCEPTED_EXTENSIONS = ".pdf,.doc,.docx,.txt,.rtf,.odt";

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
    } catch {
      toast.error("The document could not be uploaded. Check the file type and try again.");
    }
  }

  async function handleDelete(document: DocumentItem) {
    const confirmed = await confirm({
      title: "Delete document?",
      description: `Move "${document.title}" to the Recycle Bin? An administrator can restore it later.`,
      confirmLabel: "Move to recycle bin",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      await deleteDocument(document.id);
      toast.success("Document deleted.");
    } catch {
      toast.error("The document could not be deleted. Check your access and try again.");
    }
  }

  const documents = documentsQuery.data?.results ?? [];

  return (
    <Card className="px-5 py-5">
      {canUpload ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Optional document title"
            aria-label="Document title"
            className="sm:w-72"
          />
          <Input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            onChange={(event) => void handleSelectedFile(event.target.files?.[0])}
            className="hidden"
          />
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={isUploadingDocument}>
            <Upload />
            {isUploadingDocument ? "Uploading…" : "Upload document"}
          </Button>
        </div>
      ) : null}

      <div className={canUpload ? "mt-4" : undefined}>
        {documentsQuery.isLoading ? (
          <PanelLoading label="Loading documents…" />
        ) : documentsQuery.error ? (
          <PanelError message="Documents could not be loaded." onRetry={() => void documentsQuery.refetch()} />
        ) : (
          // The empty state comes from `DocumentList`'s own `RecordTable` (7.4) rather than
          // from a second one here — this panel only supplies the sentence that used to be
          // the heading's description.
          <DocumentList
            documents={documents}
            // Short deliberately: `RecordTable` lays its empty state out across the table's
            // scrollWidth rather than its visible width, so inside the record's narrower
            // content region a long line renders off-centre and clips. That is a table
            // defect and it is 5.5's; this copy does not depend on it being fixed.
            emptyText="Files uploaded here stay linked to this record."
            onDelete={canDelete ? (document) => void handleDelete(document) : undefined}
            canEdit={canEdit}
            isDeleting={isDeletingDocument}
          />
        )}
      </div>
    </Card>
  );
}
