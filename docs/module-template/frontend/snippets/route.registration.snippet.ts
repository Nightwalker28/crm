// frontend/lib/routes.ts
export const DASHBOARD_ROUTES = {
  // ...
  __modules__: "__route_prefix__",
} as const;

const FRIENDLY_ROUTE_LABELS: Record<string, string> = {
  // ...
  "__modules__": "__display_name__",
};
