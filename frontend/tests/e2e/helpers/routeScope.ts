// Scopes the route-walking guards (design-rules, scroll-containers) to a slice while it is
// being fixed: `scripts/e2e.sh --routes /dashboard/inventory,...` sets E2E_ROUTES. Unset, they
// walk every route, which is what a module's close-out runs. A scoped pass never stands in for
// the full walk, so the guards print the scope they ran with.
export const ROUTE_SCOPE = (process.env.E2E_ROUTES ?? "")
  .split(",")
  .map((prefix) => prefix.trim().replace(/\/+$/, ""))
  .filter(Boolean);

export function inRouteScope(route: string): boolean {
  if (!ROUTE_SCOPE.length) return true;
  const path = route.split("?")[0];
  return ROUTE_SCOPE.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function describeRouteScope(): string {
  return ROUTE_SCOPE.length ? `scoped to ${ROUTE_SCOPE.join(", ")} (E2E_ROUTES)` : "every route";
}
