type LynkRuntimeConfig = {
  apiBaseUrl?: string;
};

declare global {
  interface Window {
    __LYNK_RUNTIME_CONFIG__?: LynkRuntimeConfig;
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function getApiBase() {
  if (typeof window === "undefined") return "";
  return trimTrailingSlash(window.__LYNK_RUNTIME_CONFIG__?.apiBaseUrl?.trim() ?? "");
}

export function apiUrl(path: string) {
  const apiBase = getApiBase();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase}${normalizedPath}`;
}

export function apiOrigin() {
  const apiBase = getApiBase();
  if (!apiBase) return "";

  try {
    return new URL(apiBase, window.location.origin).origin;
  } catch {
    return "";
  }
}

export {};
