import { apiUrl } from "./runtime-config";

const REFRESH_PATH = "/auth/refresh";
const AUTH_PUBLIC_PATHS = new Set([
  "/auth/google",
  "/auth/microsoft",
  "/auth/login",
  "/auth/sso/start",
  "/auth/password-policy",
  "/auth/setup-password",
]);
const MAX_TRANSIENT_RETRIES = 2;
const RETRY_BACKOFF_MS = 300;
const RETRYABLE_METHODS = new Set(["GET", "HEAD"]);
const inFlightGetRequests = new Map<string, Promise<Response>>();
let inFlightRefresh: Promise<boolean> | null = null;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTransientRetry(input: RequestInfo | URL, init?: RequestInit) {
  let lastError: unknown;
  const method = (init?.method ?? "GET").toUpperCase();
  const retryLimit = RETRYABLE_METHODS.has(method) ? MAX_TRANSIENT_RETRIES : 0;

  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    try {
      const res = await fetch(input, init);
      if (res.status < 500 || attempt === retryLimit) {
        return res;
      }
    } catch (error) {
      lastError = error;
      if (attempt === retryLimit) {
        throw error;
      }
    }

    await wait(RETRY_BACKOFF_MS * 2 ** attempt);
  }

  throw lastError instanceof Error ? lastError : new Error("Network request failed");
}

function getRequestKey(input: string, init: RequestInit) {
  const headers = [...new Headers(init.headers).entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return JSON.stringify([input, headers]);
}

function fetchWithGetDeduplication(input: string, init: RequestInit) {
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" || init.signal) {
    return fetchWithTransientRetry(input, init);
  }

  const requestKey = getRequestKey(input, init);
  const existing = inFlightGetRequests.get(requestKey);
  if (existing) {
    return existing.then((res) => res.clone());
  }

  const request = fetchWithTransientRetry(input, init).finally(() => {
    inFlightGetRequests.delete(requestKey);
  });
  inFlightGetRequests.set(requestKey, request);
  return request.then((res) => res.clone());
}

function requestHeaders(headers?: HeadersInit) {
  const merged = new Headers(headers);
  merged.set("Accept", "application/json");
  if (typeof window !== "undefined") {
    merged.set("X-Lynk-Frontend-Origin", window.location.origin);
  }
  return merged;
}

// This function attempts to refresh the session. On success, it dispatches
// a global event that a session provider can listen for to reset its timers.
async function performRefresh(): Promise<boolean> {
  const res = await fetchWithTransientRetry(apiUrl(REFRESH_PATH), {
    method: "POST",
    credentials: "include",
  });

  if (res.ok) {
    const data = await res.json();
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("sessionRefreshed", { detail: { maxAge: data.accessTokenMaxAge } })
      );
    }
  }

  return res.ok;
}

function refreshOnce(): Promise<boolean> {
  if (!inFlightRefresh) {
    inFlightRefresh = performRefresh().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const managesSession = !AUTH_PUBLIC_PATHS.has(path) && path !== REFRESH_PATH;
  const doRequest = () =>
    fetchWithGetDeduplication(apiUrl(path), {
      ...init,
      credentials: "include",
      headers: requestHeaders(init.headers),
    });

  let res = await doRequest();

  if (res.status === 401 && managesSession) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      res = await doRequest();
    }
  }

  if (res.status === 401 && managesSession && typeof window !== "undefined") {
    window.location.href = "/auth/login";
    throw new Error("Session expired");
  }

  return res;
}
