import { apiOrigin } from "./runtime-config";

export function resolveMediaUrl(value?: string | null) {
  if (!value) return "";
  const cleaned = value.trim();
  if (!cleaned || cleaned.startsWith("//")) return "/placeholder-avatar.png";

  try {
    const { protocol } = new URL(cleaned);
    if (!["http:", "https:", "data:"].includes(protocol)) return "/placeholder-avatar.png";
    return cleaned;
  } catch {
    // Relative media paths are allowed and resolved against the API origin when configured.
  }

  const origin = apiOrigin();
  if (!origin) return cleaned;
  return `${origin}${cleaned.startsWith("/") ? cleaned : `/${cleaned}`}`;
}
