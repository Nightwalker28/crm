const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const API_ORIGIN = (() => {
  if (!API_BASE) return "";
  try {
    return new URL(API_BASE).origin;
  } catch {
    return "";
  }
})();

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

  if (!API_ORIGIN) return cleaned;
  return `${API_ORIGIN}${cleaned.startsWith("/") ? cleaned : `/${cleaned}`}`;
}
