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
  if (/^https?:\/\//i.test(value)) return value;
  if (!API_ORIGIN) return value;
  return `${API_ORIGIN}${value.startsWith("/") ? value : `/${value}`}`;
}
