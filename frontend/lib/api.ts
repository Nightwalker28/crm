const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const REFRESH_PATH = "/auth/refresh";
const MAX_TRANSIENT_RETRIES = 2;
const RETRY_BACKOFF_MS = 300;
const inFlightGetRequests = new Map<string, Promise<Response>>();

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTransientRetry(input: RequestInfo | URL, init?: RequestInit) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
    try {
      const res = await fetch(input, init);
      if (res.status < 500 || attempt === MAX_TRANSIENT_RETRIES) {
        return res;
      }
    } catch (error) {
      lastError = error;
      if (attempt === MAX_TRANSIENT_RETRIES) {
        throw error;
      }
    }

    await wait(RETRY_BACKOFF_MS);
  }

  throw lastError instanceof Error ? lastError : new Error("Network request failed");
}

function fetchWithGetDeduplication(input: string, init: RequestInit) {
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    return fetchWithTransientRetry(input, init);
  }

  const existing = inFlightGetRequests.get(input);
  if (existing) {
    return existing.then((res) => res.clone());
  }

  const request = fetchWithTransientRetry(input, init).finally(() => {
    inFlightGetRequests.delete(input);
  });
  inFlightGetRequests.set(input, request);
  return request.then((res) => res.clone());
}

// This function attempts to refresh the session. On success, it dispatches
// a global event that a session provider can listen for to reset its timers.
async function refreshOnce(): Promise<boolean> {
  const res = await fetchWithTransientRetry(`${API_BASE}${REFRESH_PATH}`, {
    method: "POST",
    credentials: "include",
  });

  if (res.ok) {
    const data = await res.json();
    // Dispatch a custom event with the new expiration info (in seconds)
    window.dispatchEvent(
      new CustomEvent("sessionRefreshed", { detail: { maxAge: data.accessTokenMaxAge } })
    );
  }

  return res.ok;
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const doRequest = () =>
    fetchWithGetDeduplication(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });

  let res = await doRequest();

  if (res.status === 401 && path !== REFRESH_PATH) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      res = await doRequest();
    }
  }

  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/auth/login";
    throw new Error("Session expired");
  }

  return res;
}
