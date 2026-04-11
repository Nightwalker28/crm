const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const REFRESH_PATH = "/auth/refresh";

// This function attempts to refresh the session. On success, it dispatches
// a global event that a session provider can listen for to reset its timers.
async function refreshOnce(): Promise<boolean> {
  const res = await fetch(`${API_BASE}${REFRESH_PATH}`, {
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
    fetch(`${API_BASE}${path}`, {
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
