import Image from "next/image";
import { UserRound } from "lucide-react";

import { resolveMediaUrl } from "@/lib/media";
import { cn } from "@/lib/utils";

const AVATAR_SIZE = {
  sm: { box: "size-6", px: 24, text: "text-[10px]" },
  default: { box: "size-8", px: 32, text: "text-2xs" },
  lg: { box: "size-10", px: 40, text: "text-xs" },
} as const;

export type AvatarSize = keyof typeof AVATAR_SIZE;

/**
 * Two initials from a name, one from a single word, one from an email's local part.
 *
 * Exported because a table that sorts or groups by person needs the same letters the avatar
 * shows, and re-deriving them at the call site is how the two bespoke avatars drifted apart in
 * the first place — one fell back to `"US"`, the other to `"?"`.
 */
export function getInitials(name?: string | null, email?: string | null): string | null {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  if (parts.length === 1) return parts[0][0].toUpperCase();
  const local = (email ?? "").trim().split("@")[0];
  if (local) return local[0].toUpperCase();
  return null;
}

type AvatarProps = {
  /** The person's display name. Drives the initials and the image's alt text. */
  name?: string | null;
  email?: string | null;
  /** A media path or absolute URL. Resolved through `lib/media.ts`. */
  src?: string | null;
  size?: AvatarSize;
  className?: string;
};

/**
 * A person, at one of three sizes.
 *
 * There were two implementations: a 28px bordered square with a `"?"` fallback in the leads
 * table, and a 32px filled square with a `"US"` fallback in the profile menu — so the same
 * operator was two different shapes on two screens.
 *
 * It is `rounded-full` because 4.3 reserves that corner for avatars, and because a circle is
 * the one shape in this product that means "a person". That is not the capsule R5 deleted:
 * `Pill` drew a border, a tint, a blur and a noise overlay around a word that already carried
 * its own meaning, where this shape *is* the information — it says the row is about someone.
 *
 * Three fallback steps, in order: the photo, the initials, a lucide glyph. The glyph rather
 * than a placeholder string, because an operator with no name and no photo on a record should
 * see an empty seat, not the letters `US`.
 */
export function Avatar({ name, email, src, size = "default", className }: AvatarProps) {
  const dimensions = AVATAR_SIZE[size];
  const initials = getInitials(name, email);
  const label = (name ?? "").trim() || email || null;

  const shell = cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
    dimensions.box,
    className,
  );

  if (src) {
    return (
      <Image
        src={resolveMediaUrl(src)}
        // Decorative: every call site puts the person's name in text beside it, so announcing
        // it again is a duplicate stop for a screen reader (design.md 8).
        alt=""
        width={dimensions.px}
        height={dimensions.px}
        unoptimized
        className={cn(shell, "object-cover")}
      />
    );
  }

  return (
    <span
      data-slot="avatar"
      className={cn(shell, "border border-line-default bg-surface-muted text-copy-secondary")}
      title={label ?? undefined}
    >
      {initials ? (
        <span className={cn("font-semibold", dimensions.text)}>{initials}</span>
      ) : (
        <UserRound className="size-1/2" aria-hidden="true" />
      )}
    </span>
  );
}
