export const DASHBOARD_ROUTES = {
  home: "/dashboard",
  leads: "/dashboard/sales/leads",
  accounts: "/dashboard/sales/organizations",
  contacts: "/dashboard/sales/contacts",
  deals: "/dashboard/sales/opportunities",
  quotes: "/dashboard/sales/quotes",
  orders: "/dashboard/sales/orders",
  contracts: "/dashboard/contracts",
  supportCases: "/dashboard/support/cases",
  clientPortal: "/dashboard/client-portal",
  documents: "/dashboard/documents",
  calendar: "/dashboard/calendar",
  mail: "/dashboard/mail",
  tasks: "/dashboard/tasks",
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
  automation: "/dashboard/settings/automation",
  calendarBooking: "/dashboard/settings/calendar-booking",
  backups: "/dashboard/settings/backups",
  integrations: "/dashboard/settings/integrations",
  templates: "/dashboard/settings/message-templates",
  recycleBin: "/dashboard/settings/recycle-bin",
  activityLog: "/dashboard/settings/activity-log",
} as const;

const LEGACY_DASHBOARD_ROUTE_REDIRECTS: Record<string, string> = {
  "/dashboard/admin": SETTINGS_ROUTES.general,
  "/dashboard/admin/users": SETTINGS_ROUTES.users,
  "/dashboard/admin/teams": SETTINGS_ROUTES.teams,
  "/dashboard/admin/roles-permissions": SETTINGS_ROUTES.permissions,
  "/dashboard/admin/modules": SETTINGS_ROUTES.modules,
  "/dashboard/admin/custom-fields": SETTINGS_ROUTES.fields,
  "/dashboard/admin/integrations": SETTINGS_ROUTES.integrations,
  "/dashboard/admin/message-templates": SETTINGS_ROUTES.templates,
  "/dashboard/settings/company": SETTINGS_ROUTES.general,
  "/dashboard/settings/roles-permissions": SETTINGS_ROUTES.permissions,
  "/dashboard/settings/custom-fields": SETTINGS_ROUTES.fields,
  "/dashboard/recycle-bin": SETTINGS_ROUTES.recycleBin,
  "/dashboard/activity-log": SETTINGS_ROUTES.activityLog,
  "/dashboard/finance/invoices": DASHBOARD_ROUTES.insertionOrders,
};

const LEGACY_DASHBOARD_ROUTE_PREFIX_REDIRECTS: Array<{ from: string; to: string }> = [
  { from: "/dashboard/admin/modules", to: SETTINGS_ROUTES.modules },
];

export function canonicalizeDashboardHref(href: string): string {
  const match = href.match(/^([^?#]*)([?#].*)?$/);
  const path = match?.[1] ?? href;
  const suffix = match?.[2] ?? "";
  const exact = LEGACY_DASHBOARD_ROUTE_REDIRECTS[path];
  if (exact) {
    return `${exact}${suffix}`;
  }
  const prefix = LEGACY_DASHBOARD_ROUTE_PREFIX_REDIRECTS.find((item) => path.startsWith(`${item.from}/`));
  if (prefix) {
    return `${prefix.to}${path.slice(prefix.from.length)}${suffix}`;
  }
  return href;
}

const FRIENDLY_ROUTE_LABELS: Record<string, string> = {
  leads: "Leads",
  organizations: "Accounts",
  opportunities: "Deals",
  quotes: "Quotes",
  orders: "Orders",
  contracts: "Contracts",
  contacts: "Contacts",
  support: "Support",
  cases: "Support Cases",
  documents: "Documents",
  calendar: "Calendar",
  mail: "Mail",
  tasks: "Tasks",
  "client-portal": "Client Portal",
  catalog: "Products & Services",
  products: "Products",
  services: "Services",
  sales: "Sales",
  finance: "Finance",
  "insertion-orders": "Insertion Orders",
  pos: "POS",
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
  automation: "Automation",
  "calendar-booking": "Booking Links",
  backups: "Backups",
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
