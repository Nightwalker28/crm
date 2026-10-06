import type { Page } from "@playwright/test";

/**
 * Calls the backend from inside the page, the way the app does: the API base comes from the
 * runtime config and the session cookie rides along. `page.request` against the frontend
 * origin reaches `next start`, which serves HTML for `/api/v1/*`, not the backend.
 */
export async function apiResponse(
  page: Page,
  path: string,
  init: { method?: string; data?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(async ({ path, method, data }) => {
    const base = (window.__LYNK_RUNTIME_CONFIG__?.apiBaseUrl ?? "").replace(/\/+$/, "");
    const response = await fetch(`${base}${path}`, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Lynk-Frontend-Origin": window.location.origin },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { path, method: init.method ?? "GET", data: init.data });
}

/** The parsed body of a call that must succeed. */
export async function api<T>(page: Page, path: string, init: { method?: string; data?: unknown } = {}): Promise<T> {
  const { status, body } = await apiResponse(page, path, init);
  if (status < 200 || status >= 300) throw new Error(`${init.method ?? "GET"} ${path} → ${status} ${JSON.stringify(body)}`);
  return body as T;
}
