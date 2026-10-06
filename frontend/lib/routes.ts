export const DASHBOARD_ROUTES = {
  home: "/dashboard",
  leads: "/dashboard/sales/leads",
  accounts: "/dashboard/sales/organizations",
  contacts: "/dashboard/sales/contacts",
  deals: "/dashboard/sales/opportunities",
  quotes: "/dashboard/sales/quotes",
  orders: "/dashboard/sales/orders",
  clientPortal: "/dashboard/client-portal",
  documents: "/dashboard/documents",
  calendar: "/dashboard/calendar",
  mail: "/dashboard/mail",
  tasks: "/dashboard/tasks",
  invoices: "/dashboard/finance/invoices",
  payments: "/dashboard/finance/payments",
  creditNotes: "/dashboard/finance/credit-notes",
  products: "/dashboard/catalog/products",
  services: "/dashboard/catalog/services",
  inventoryStock: "/dashboard/inventory/stock",
  inventoryMovements: "/dashboard/inventory/movements",
  inventoryAdjustments: "/dashboard/inventory/adjustments",
  inventoryTransfers: "/dashboard/inventory/transfers",
  inventoryDeliveries: "/dashboard/inventory/deliveries",
  inventoryReturns: "/dashboard/inventory/returns",
  inventoryValuation: "/dashboard/inventory/valuation",
  purchaseOrders: "/dashboard/purchasing/orders",
  purchaseReceipts: "/dashboard/purchasing/receipts",
  purchaseReorder: "/dashboard/purchasing/reorder",
  purchaseBills: "/dashboard/purchasing/bills",
  reports: "/dashboard/reports",
} as const;

export const SETTINGS_ROUTES = {
  root: "/dashboard/settings",
  general: "/dashboard/settings/general",
  users: "/dashboard/settings/users",
  authentication: "/dashboard/settings/authentication",
  domains: "/dashboard/settings/domains",
  provisioning: "/dashboard/settings/provisioning",
  teams: "/dashboard/settings/teams",
  customerGroups: "/dashboard/settings/customer-groups",
  permissions: "/dashboard/settings/permissions",
  modules: "/dashboard/settings/modules",
  moduleAccess: (moduleId: string | number) => `/dashboard/settings/modules/${moduleId}`,
  moduleBuilder: "/dashboard/settings/module-builder",
  fields: "/dashboard/settings/fields",
  recordLayouts: "/dashboard/settings/record-layouts",
  picklists: "/dashboard/settings/picklists",
  picklist: (listKey: string) => `/dashboard/settings/picklists/${encodeURIComponent(listKey)}`,
  pipeline: "/dashboard/settings/pipeline",
  catalogCategories: "/dashboard/settings/catalog-categories",
  warehouses: "/dashboard/settings/warehouses",
  automation: "/dashboard/settings/automation",
  calendarBooking: "/dashboard/settings/calendar-booking",
  backups: "/dashboard/settings/backups",
  integrations: "/dashboard/settings/integrations",
  templates: "/dashboard/settings/message-templates",
  recycleBin: "/dashboard/settings/recycle-bin",
  activityLog: "/dashboard/settings/activity-log",
} as const;

/**
 * A9: the fallback was `SETTINGS_ROUTES.activityLog`, which is admin-only — so a
 * notification with a missing or malformed link sent a non-admin straight into a
 * permission wall. The default is the dashboard, which every role can reach. A caller that
 * knows its audience is admin still passes the activity log explicitly.
 */
export function resolveNotificationHref(
  href: string | null | undefined,
  fallback: string = DASHBOARD_ROUTES.home,
): string {
  const candidate = href?.trim();
  const isDashboardPath = candidate === "/dashboard" ||
    candidate?.startsWith("/dashboard/") ||
    candidate?.startsWith("/dashboard?");
  if (!candidate || !isDashboardPath || /[\u0000-\u001f\u007f\\]/.test(candidate)) {
    return fallback;
  }
  return candidate;
}

const FRIENDLY_ROUTE_LABELS: Record<string, string> = {
  leads: "Leads",
  organizations: "Accounts",
  opportunities: "Deals",
  quotes: "Quotes",
  orders: "Orders",
  contacts: "Contacts",
  documents: "Documents",
  calendar: "Calendar",
  mail: "Mail",
  tasks: "Tasks",
  "client-portal": "Client portal",
  catalog: "Products & services",
  products: "Products",
  services: "Services",
  inventory: "Inventory",
  stock: "Stock",
  movements: "Movements",
  valuation: "Valuation",
  warehouses: "Warehouses",
  sales: "Sales",
  finance: "Finance",
  payments: "Payments",
  invoices: "Invoices",
  "credit-notes": "Credit notes",
  bills: "Bills",
  company: "General",
  general: "General",
  users: "User management",
  authentication: "Authentication",
  domains: "Domains",
  provisioning: "Provisioning",
  teams: "Teams",
  "customer-groups": "Customer groups",
  "catalog-categories": "Catalog categories",
  "roles-permissions": "Permissions",
  permissions: "Permissions",
  modules: "Module settings",
  "module-builder": "Module builder",
  "custom-fields": "Field config",
  fields: "Field config",
  automation: "Automation",
  "calendar-booking": "Booking links",
  backups: "Backups",
  "recycle-bin": "Recycle bin",
  "activity-log": "Activity log",
  "message-templates": "Templates",
  reports: "Reports",
  dashboards: "Dashboards",
  forecast: "Forecast",
};

export function getFriendlyRouteLabel(pathOrSegment: string): string {
  const segments = pathOrSegment.split("?")[0]?.split("#")[0]?.split("/").filter(Boolean) ?? [];
  const segment = segments[segments.length - 1] ?? pathOrSegment;

  return FRIENDLY_ROUTE_LABELS[segment] ?? segment.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
