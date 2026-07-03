function withProtocol(value: string) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}

export function normalizeWebsiteHref(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  return withProtocol(trimmed);
}

export function formatWebsiteDisplay(value: string | null | undefined) {
  const href = normalizeWebsiteHref(value);
  if (!href) return "";

  try {
    const url = new URL(href);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`.replace(/^www\./, "");
  } catch {
    return value?.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "") ?? "";
  }
}
