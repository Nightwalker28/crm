"use client";

import { useRef, type ReactNode } from "react";
import { ImageIcon, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { resolveMediaUrl } from "@/lib/media";

export const IMAGE_ASSET_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_ASSET_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_ASSET_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const IMAGE_ASSET_EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function validateImageAssetFile(file: File): string | null {
  const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? "" : "";
  if (!IMAGE_ASSET_MIME_TYPES.has(file.type) || !IMAGE_ASSET_EXTENSIONS.has(extension)) {
    return "Choose a JPG, PNG, or WebP image.";
  }
  const normalizedExtension = extension === "jpeg" ? "jpg" : extension;
  if (IMAGE_ASSET_EXTENSION_BY_MIME[file.type] !== normalizedExtension) {
    return "The image type does not match its file extension.";
  }
  if (file.size === 0) return "Choose a non-empty image.";
  if (file.size > IMAGE_ASSET_MAX_BYTES) return "Choose an image no larger than 5 MB.";
  return null;
}

type ImageAssetFieldProps = {
  id: string;
  label: string;
  imageUrl: string;
  previewAlt: string;
  uploadAriaLabel: string;
  busyAction: "uploading" | "removing" | null;
  error: string | null;
  fallback?: ReactNode;
  onFileSelected: (file: File) => void;
  onRemove: () => void;
};

export function ImageAssetField({
  id,
  label,
  imageUrl,
  previewAlt,
  uploadAriaLabel,
  busyAction,
  error,
  fallback,
  onFileSelected,
  onRemove,
}: ImageAssetFieldProps) {
  const busy = busyAction !== null;
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Field aria-busy={busy}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex flex-wrap items-center gap-4 rounded-[var(--radius-control)] border border-line-subtle bg-surface-muted/40 p-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-control)] border border-line-default bg-surface text-copy-muted">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={resolveMediaUrl(imageUrl)} alt={previewAlt} className="h-full w-full object-cover" />
          ) : (
            fallback ?? <ImageIcon aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <Upload />
              {busyAction === "uploading" ? "Uploading…" : imageUrl ? "Replace image" : "Upload image"}
            </Button>
            {imageUrl ? (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onRemove}>
                <Trash2 />
                {busyAction === "removing" ? "Removing…" : "Remove image"}
              </Button>
            ) : null}
          </div>
          <FieldDescription className="mt-2">JPG, PNG, or WebP up to 5 MB. Changes are saved immediately.</FieldDescription>
        </div>
        <input
          id={id}
          ref={inputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          disabled={busy}
          aria-label={uploadAriaLabel}
          className="sr-only"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) onFileSelected(file);
            event.currentTarget.value = "";
          }}
        />
      </div>
      {error ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}
      <span className="sr-only" aria-live="polite">
        {busyAction === "uploading" ? "Image upload in progress." : busyAction === "removing" ? "Image removal in progress." : ""}
      </span>
    </Field>
  );
}
