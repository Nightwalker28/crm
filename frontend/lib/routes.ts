export const DASHBOARD_ROUTES = {
  home: "/dashboard",
  leads: "/dashboard/sales/leads",
  accounts: "/dashboard/sales/organizations",
  contacts: "/dashboard/sales/contacts",
  deals: "/dashboard/sales/opportunities",
  quotes: "/dashboard/sales/quotes",
  clientPortal: "/dashboard/client-portal",
  financePos: "/dashboard/finance/pos",
  insertionOrders: "/dashboard/finance/insertion-orders",
  products: "/dashboard/catalog/products",
  services: "/dashboard/catalog/services",
  reports: "/dashboard/reports",
} as const;

export const SETTINGS_ROUTES = {
  root: "/dashboard/settings",
  general: "/dashboard/settings/general",
  users: "/dashboard/settings/users",
  teams: "/dashboard/settings/teams",
  customerGroups: "/dashboard/settings/customer-groups",
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
  leads: "Leads",
  organizations: "Accounts",
  opportunities: "Deals",
  quotes: "Quotes",
  sales: "Sales",
  company: "General",
  general: "General",
  users: "User Management",
  teams: "Teams",
  "customer-groups": "Customer Groups",
  "roles-permissions": "Permissions",
  permissions: "Permissions",
  modules: "Module Settings",
  "module-builder": "Module Builder",
  "custom-fields": "Field Config",
  fields: "Field Config",
  "recycle-bin": "Recycle Bin",
  "activity-log": "Activity Log",
  "message-templates": "Templates",
  reports: "Reports",
};

export function getFriendlyRouteLabel(pathOrSegment: string): string {
  const segments = pathOrSegment.split("?")[0]?.split("#")[0]?.split("/").filter(Boolean) ?? [];
  const segment = segments[segments.length - 1] ?? pathOrSegment;

  return FRIENDLY_ROUTE_LABELS[segment] ?? segment.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
