import { ApiError, RequestTimeoutError } from "./apiErrors";
import { currentPathForReturn, loginPathFor } from "./authRedirect";
import { apiUrl } from "./runtime-config";

export { ApiError, RequestTimeoutError } from "./apiErrors";

const REFRESH_PATH = "/auth/refresh";
const AUTH_PUBLIC_PATHS = new Set([
  "/auth/google",
  "/auth/microsoft",
  "/auth/login",
  "/auth/sso/start",
  "/auth/password-policy",
  "/auth/setup-password",
  "/auth/password/forgot",
  "/auth/password/reset",
]);
const MAX_TRANSIENT_RETRIES = 2;
const RETRY_BACKOFF_MS = 300;
const RETRYABLE_METHODS = new Set(["GET", "HEAD"]);
/**
 * How long a request may wait for the server's answer (13a H23). It bounds the time to the
 * response headers only, so a large download is not cut off while its body streams. A read
 * that never answered left skeletons on screen beside "Showing 0 – 0 of 0" for as long as the
 * tab stayed open; now it fails, and the page's own error state offers Retry.
 */
const READ_TIMEOUT_MS = 20_000;
const WRITE_TIMEOUT_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 300_000;
const inFlightGetRequests = new Map<string, Promise<Response>>();
let inFlightRefresh: Promise<boolean> | null = null;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutFor(method: string, init?: RequestInit) {
  if (RETRYABLE_METHODS.has(method)) return READ_TIMEOUT_MS;
  return typeof FormData !== "undefined" && init?.body instanceof FormData ? UPLOAD_TIMEOUT_MS : WRITE_TIMEOUT_MS;
}

/**
 * One fetch with a deadline on its answer. The caller's own signal still aborts it; only the
 * deadline turns into a `RequestTimeoutError`.
 */
async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit | undefined, method: string) {
  const controller = new AbortController();
  const callerSignal = init?.signal ?? null;
  let timedOut = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) controller.abort(callerSignal.reason);
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutFor(method, init));
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new RequestTimeoutError(!RETRYABLE_METHODS.has(method));
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

async function fetchWithTransientRetry(input: RequestInfo | URL, init?: RequestInit) {
  let lastError: unknown;
  const method = (init?.method ?? "GET").toUpperCase();
  const retryLimit = RETRYABLE_METHODS.has(method) ? MAX_TRANSIENT_RETRIES : 0;

  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    try {
      const res = await fetchWithTimeout(input, init, method);
      if (res.status < 500 || attempt === retryLimit) {
        return res;
      }
    } catch (error) {
      lastError = error;
      // A server that did not answer in time is not helped by asking twice more; a caller's
      // own abort is not transient at all.
      if (attempt === retryLimit || error instanceof RequestTimeoutError || init?.signal?.aborted) {
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
    // Come back to this page after signing in (13a I2).
    window.location.href = loginPathFor(currentPathForReturn());
    throw new Error("Session expired");
  }

  return res;
}

/** Pass to `PageShell`'s `isPermissionDenied`, so a 403 renders the wall and not the error. */
export function isForbiddenError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 401);
}

/**
 * The shared GET-and-parse for admin reads. `message` is the fallback for everything that
 * is not a 403 — the page's own error state names the fix, so this only has to carry the
 * status honestly.
 */
export async function readJson<T>(path: string, message: string): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) throw new ApiError(response.status, message);
  return response.json() as Promise<T>;
}
