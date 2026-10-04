"use client";

import Image, { type ImageProps } from "next/image";
import { useState, type ReactNode } from "react";

/**
 * An uploaded image that degrades to its fallback when the file is missing (13a H17).
 *
 * A logo, avatar or product photo whose file was not on disk drew the browser's broken-image
 * icon on the invoice print and in the header. Uploads live in a volume that a restore, a new
 * machine or a cleared directory can leave without the file the record still points at, so a
 * missing file is a normal state, not a crash: show what the record would show with no image.
 *
 * `fallback` is that state: initials, a placeholder, or `null` to show nothing at all. It is
 * also what renders when there is no `src`, so a call site needs no ternary of its own.
 */
export function MediaImage({
  src,
  fallback,
  onError,
  ...props
}: Omit<ImageProps, "src"> & { src: ImageProps["src"] | null | undefined; fallback: ReactNode }) {
  const [failedSrc, setFailedSrc] = useState<ImageProps["src"] | null>(null);
  if (!src || failedSrc === src) return <>{fallback}</>;
  return (
    // eslint-disable-next-line jsx-a11y/alt-text -- `alt` arrives in props and is required by ImageProps.
    <Image
      unoptimized
      {...props}
      src={src}
      onError={(event) => {
        setFailedSrc(src);
        onError?.(event);
      }}
    />
  );
}
