export const DASHBOARD_ROUTES = {
  home: "/dashboard",
  sales: "/dashboard/sales",
  accounts: "/dashboard/sales/organizations",
  contacts: "/dashboard/sales/contacts",
  deals: "/dashboard/sales/opportunities",
  clientPortal: "/dashboard/client-portal",
  finance: "/dashboard/finance",
  financePos: "/dashboard/finance/pos",
  insertionOrders: "/dashboard/finance/insertion-orders",
  products: "/dashboard/catalog/products",
  services: "/dashboard/catalog/services",
} as const;

export const SETTINGS_ROUTES = {
  root: "/dashboard/settings",
  general: "/dashboard/settings/general",
  users: "/dashboard/settings/users",
  teams: "/dashboard/settings/teams",
  permissions: "/dashboard/settings/permissions",
  modules: "/dashboard/settings/modules",
  moduleAccess: (moduleId: string | number) => `/dashboard/settings/modules/${moduleId}`,
  moduleBuilder: "/dashboard/settings/module-builder",
  fields: "/dashboard/settings/fields",
  integrations: "/dashboard/settings/integrations",
  templates: "/dashboard/settings/message-templates",
  recycleBin: "/dashboard/settings/recycle-bin",
  activityLog: "/dashboard/settings/activity-log",
} as const;

const FRIENDLY_ROUTE_LABELS: Record<string, string> = {
  organizations: "Accounts",
  opportunities: "Deals",
  sales: "Sales",
  company: "General",
  general: "General",
  users: "User Management",
  teams: "Teams",
  "roles-permissions": "Permissions",
  permissions: "Permissions",
  modules: "Module Settings",
  "module-builder": "Module Builder",
  "custom-fields": "Field Config",
  fields: "Field Config",
  "recycle-bin": "Recycle Bin",
  "activity-log": "Activity Log",
  "message-templates": "Templates",
};

export function getFriendlyRouteLabel(pathOrSegment: string): string {
  const segments = pathOrSegment.split("?")[0]?.split("#")[0]?.split("/").filter(Boolean) ?? [];
  const segment = segments[segments.length - 1] ?? pathOrSegment;

  return FRIENDLY_ROUTE_LABELS[segment] ?? segment.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
