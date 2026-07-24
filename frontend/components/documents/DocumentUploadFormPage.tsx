"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Upload } from "lucide-react";
import { toast } from "sonner";

import { FormSection, RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentActions, useDocumentStorageConnections } from "@/hooks/useDocuments";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

const ACCEPTED_DOCUMENT_TYPES = ".pdf,.doc,.docx,.txt,.rtf,.odt";
const ACCEPTED_EXTENSIONS = new Set(["pdf", "doc", "docx", "txt", "rtf", "odt"]);

function fileExtension(file: File) {
  const parts = file.name.toLowerCase().split(".");
  return parts.length > 1 ? parts.at(-1) ?? "" : "";
}

export default function DocumentUploadFormPage() {
  const router = useRouter();
  const connectionsQuery = useDocumentStorageConnections();
  const { uploadDocument, isUploadingDocument } = useDocumentActions();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [storageProvider, setStorageProvider] = useState("local");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState(false);
  const googleDriveConnected = connectionsQuery.data?.some((connection) => connection.provider === "google_drive" && connection.status === "connected") ?? false;
  const oneDriveConnected = connectionsQuery.data?.some((connection) => connection.provider === "microsoft_onedrive" && connection.status === "connected") ?? false;
  const dirty = useMemo(
    () => Boolean(title.trim() || description.trim() || storageProvider !== "local" || file),
    [description, file, storageProvider, title],
  );

  useUnsavedChangesGuard(dirty, isUploadingDocument);

  function selectFile(nextFile: File | null) {
    setFile(nextFile);
    if (!nextFile) {
      setFileError(null);
      return;
    }
    setFileError(ACCEPTED_EXTENSIONS.has(fileExtension(nextFile)) ? null : "Choose a PDF, DOC, DOCX, TXT, RTF, or ODT file.");
  }

  function validate() {
    const nextFileError = !file
      ? "Choose a document to upload."
      : ACCEPTED_EXTENSIONS.has(fileExtension(file))
        ? null
        : "Choose a PDF, DOC, DOCX, TXT, RTF, or ODT file.";
    setFileError(nextFileError);
    if (nextFileError) document.getElementById("document-file")?.focus();
    return !nextFileError;
  }

  async function submit() {
    if (!validate() || !file || isUploadingDocument) return;
    try {
      setSubmitError(false);
      const document = await uploadDocument({
        file,
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        storage_provider: storageProvider,
      });
      toast.success("Document uploaded.");
      router.push(`/dashboard/documents?documentId=${document.id}`);
    } catch {
      setSubmitError(true);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Upload document"
        description="Add a controlled document to the tenant library and choose its managed storage destination."
        actions={<Button asChild variant="ghost" size="sm"><Link href="/dashboard/documents"><ArrowLeft />Back to documents</Link></Button>}
      />

      {submitError ? (
        <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          <div className="font-medium">We could not upload this document.</div>
          <div className="mt-1 text-copy-secondary">Check the file, available storage, and tenant quota, then try again.</div>
        </div>
      ) : null}

      <RecordFormLayout
        sidebar={
          <Card className="p-5">
            <h2 className="text-base font-semibold text-copy-primary">Storage</h2>
            <FieldDescription className="mt-1">Files remain behind authenticated document access regardless of provider.</FieldDescription>
            <Field className="mt-5">
              <FieldLabel>Destination</FieldLabel>
              <Select value={storageProvider} onValueChange={setStorageProvider}>
                <SelectTrigger aria-label="Storage destination"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local backend</SelectItem>
                  <SelectItem value="google_drive" disabled={!googleDriveConnected}>Google Drive</SelectItem>
                  <SelectItem value="microsoft_onedrive" disabled={!oneDriveConnected}>Microsoft OneDrive</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>
                Manage external storage connections from <Link href="/dashboard/settings/integrations" className="text-copy-primary underline-offset-4 hover:underline">Integrations</Link>.
              </FieldDescription>
            </Field>
          </Card>
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-copy-muted">{dirty ? "You have an unsaved upload." : "Choose a supported file to continue."}</span>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline"><Link href="/dashboard/documents">Cancel</Link></Button>
              <Button onClick={() => void submit()} disabled={isUploadingDocument}><Upload />{isUploadingDocument ? "Uploading…" : "Upload document"}</Button>
            </div>
          </div>
        }
      >
        <FormSection title="Document file" description="The server verifies file type, size, quota, and safe storage before accepting the upload.">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="document-file">File <RequiredMark /></FieldLabel>
              <Input id="document-file" type="file" accept={ACCEPTED_DOCUMENT_TYPES} onChange={(event) => selectFile(event.target.files?.[0] ?? null)} aria-invalid={Boolean(fileError)} aria-describedby={fileError ? "document-file-error" : "document-file-description"} />
              <FieldDescription id="document-file-description">Allowed types: PDF, DOC, DOCX, TXT, RTF, and ODT.</FieldDescription>
              {fileError ? <FieldError id="document-file-error">{fileError}</FieldError> : null}
            </Field>
          </FieldGroup>
        </FormSection>

        <FormSection title="Library details" description="Use a clear title and description so teammates can find and understand the document.">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="document-title">Title</FieldLabel>
              <Input id="document-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional title" />
            </Field>
            <Field>
              <FieldLabel htmlFor="document-description">Description</FieldLabel>
              <Textarea id="document-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={6} placeholder="Optional description" />
            </Field>
          </FieldGroup>
        </FormSection>
      </RecordFormLayout>
    </div>
  );
}
