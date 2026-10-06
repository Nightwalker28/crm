"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MediaImage } from "@/components/ui/MediaImage";
import { useCatalogRecordActions, type CatalogImage, type CatalogKind } from "@/hooks/catalog/useCatalogRecords";
import { resolveMediaUrl } from "@/lib/media";

/** The backend's limit (`MAX_GALLERY_IMAGES`). */
const MAX_PICTURES = 12;

/**
 * An item's pictures after its main image (13a C4). They are files rather than fields, so each
 * one is saved the moment it is added or removed, apart from the form's Save — and only once
 * the item exists, since a picture needs a record to belong to.
 */
export function CatalogGallery({
  kind,
  recordId,
  initialImages,
}: {
  kind: CatalogKind;
  /** Unset while the item is being created. */
  recordId?: number;
  initialImages: CatalogImage[];
}) {
  const actions = useCatalogRecordActions(kind);
  const [images, setImages] = useState(initialImages);
  const [busy, setBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  if (!recordId) {
    return <p className="text-p-sm text-copy-muted">Add more pictures after the item is saved.</p>;
  }
  const id = recordId;

  async function add(file: File) {
    setBusy(true);
    try {
      setImages(await actions.addGalleryImage(id, file));
    } catch {
      toast.error("The picture could not be added. Use a JPEG, PNG or WebP image and try again.");
    } finally {
      setBusy(false);
      setInputKey((key) => key + 1);
    }
  }

  async function remove(image: CatalogImage) {
    setBusy(true);
    try {
      setImages(await actions.removeGalleryImage(id, image.id));
    } catch {
      toast.error("The picture could not be removed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      {images.length ? (
        <ul className="grid grid-cols-3 gap-2" aria-label="More pictures">
          {images.map((image) => (
            <li key={image.id} className="relative">
              <MediaImage
                src={resolveMediaUrl(image.url)}
                alt={image.original_filename ?? ""}
                width={96}
                height={96}
                className="aspect-square w-full rounded-[var(--radius-control)] object-cover"
                fallback={<div className="flex aspect-square items-center justify-center rounded-[var(--radius-control)] border border-dashed border-line-strong text-p-xs text-copy-muted">Unavailable</div>}
              />
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="absolute right-1 top-1"
                aria-label={`Remove ${image.original_filename ?? "picture"}`}
                disabled={busy}
                onClick={() => void remove(image)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Field>
        <FieldLabel htmlFor="catalog-gallery">More pictures</FieldLabel>
        <Input
          key={inputKey}
          id="catalog-gallery"
          type="file"
          accept="image/*"
          disabled={busy || images.length >= MAX_PICTURES}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void add(file);
          }}
        />
        <FieldDescription>
          {images.length >= MAX_PICTURES ? `Up to ${MAX_PICTURES} more pictures; remove one to add another.` : "Saved as soon as you choose it."}
        </FieldDescription>
      </Field>
    </div>
  );
}
