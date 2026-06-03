import { DASHBOARD_ROUTES, SETTINGS_ROUTES } from "@/lib/routes";

export type ModuleStatus = "tier1" | "tier2" | "experimental" | "deprecated" | "hidden";

export type ModuleGroupKey =
  | "workspace"
  | "sales"
  | "catalog"
  | "support"
  | "finance"
  | "reports"
  | "settings"
  | "other";

export type ModuleRegistryEntry = {
  key: string;
  label: string;
  route: string;
  group: ModuleGroupKey;
  status: ModuleStatus;
  enabled: boolean;
  sortOrder: number;
  requiredModuleKey?: string;
  adminOnly?: boolean;
};

export const MODULE_REGISTRY: readonly ModuleRegistryEntry[] = [
  { key: "sales_leads", label: "Leads", route: DASHBOARD_ROUTES.leads, group: "sales", status: "tier1", enabled: true, sortOrder: 10 },
  { key: "sales_organizations", label: "Accounts", route: DASHBOARD_ROUTES.accounts, group: "sales", status: "tier1", enabled: true, sortOrder: 20 },
  { key: "sales_contacts", label: "Contacts", route: DASHBOARD_ROUTES.contacts, group: "sales", status: "tier1", enabled: true, sortOrder: 30 },
  { key: "sales_opportunities", label: "Deals", route: DASHBOARD_ROUTES.deals, group: "sales", status: "tier1", enabled: true, sortOrder: 40 },
  { key: "sales_quotes", label: "Quotes", route: DASHBOARD_ROUTES.quotes, group: "sales", status: "tier1", enabled: true, sortOrder: 50 },
  { key: "sales_orders", label: "Orders", route: DASHBOARD_ROUTES.orders, group: "sales", status: "tier1", enabled: true, sortOrder: 60 },
  { key: "contracts", label: "Contracts", route: DASHBOARD_ROUTES.contracts, group: "sales", status: "tier2", enabled: true, sortOrder: 70 },
  { key: "catalog_products", label: "Products", route: DASHBOARD_ROUTES.products, group: "catalog", status: "tier1", enabled: true, sortOrder: 10 },
  { key: "catalog_services", label: "Services", route: DASHBOARD_ROUTES.services, group: "catalog", status: "tier1", enabled: true, sortOrder: 20 },
  { key: "documents", label: "Documents", route: DASHBOARD_ROUTES.documents, group: "workspace", status: "tier1", enabled: true, sortOrder: 10 },
  { key: "calendar", label: "Calendar", route: DASHBOARD_ROUTES.calendar, group: "workspace", status: "tier1", enabled: true, sortOrder: 20 },
  { key: "mail", label: "Mail", route: DASHBOARD_ROUTES.mail, group: "workspace", status: "tier1", enabled: true, sortOrder: 30 },
  { key: "tasks", label: "Tasks", route: DASHBOARD_ROUTES.tasks, group: "workspace", status: "tier2", enabled: true, sortOrder: 40 },
  { key: "support_cases", label: "Support Cases", route: DASHBOARD_ROUTES.supportCases, group: "support", status: "tier1", enabled: true, sortOrder: 10 },
  { key: "client_portal", label: "Client Portal", route: DASHBOARD_ROUTES.clientPortal, group: "support", status: "tier1", enabled: true, sortOrder: 20 },
  { key: "finance_io", label: "Insertion Orders", route: DASHBOARD_ROUTES.insertionOrders, group: "finance", status: "tier2", enabled: true, sortOrder: 10 },
  { key: "finance_pos", label: "POS", route: DASHBOARD_ROUTES.financePos, group: "finance", status: "tier2", enabled: true, sortOrder: 20 },
  { key: "reports", label: "Reports", route: DASHBOARD_ROUTES.reports, group: "reports", status: "tier2", enabled: true, sortOrder: 90 },
  { key: "message_templates", label: "Templates", route: SETTINGS_ROUTES.templates, group: "settings", status: "tier2", enabled: true, sortOrder: 80, adminOnly: true },
  { key: "integrations", label: "Integrations", route: SETTINGS_ROUTES.integrations, group: "settings", status: "tier1", enabled: true, sortOrder: 90, adminOnly: true },
] as const;

export const SETTINGS_NAV_ITEMS = [
  { href: SETTINGS_ROUTES.general, label: "General", sortOrder: 10 },
  { href: SETTINGS_ROUTES.users, label: "User Management", sortOrder: 20 },
  { href: SETTINGS_ROUTES.teams, label: "Teams", sortOrder: 30 },
  { href: SETTINGS_ROUTES.customerGroups, label: "Customer Groups", sortOrder: 40 },
  { href: SETTINGS_ROUTES.permissions, label: "Permissions", sortOrder: 50 },
  { href: SETTINGS_ROUTES.modules, label: "Module Settings", sortOrder: 60 },
  { href: SETTINGS_ROUTES.moduleBuilder, label: "Module Builder", sortOrder: 70 },
  { href: SETTINGS_ROUTES.fields, label: "Field Config", sortOrder: 80 },
  { href: SETTINGS_ROUTES.automation, label: "Automation", sortOrder: 90 },
  { href: SETTINGS_ROUTES.calendarBooking, label: "Booking Links", sortOrder: 100 },
  { href: SETTINGS_ROUTES.integrations, label: "Integrations", sortOrder: 110 },
  { href: SETTINGS_ROUTES.templates, label: "Templates", sortOrder: 120 },
  { href: SETTINGS_ROUTES.activityLog, label: "Activity Log", sortOrder: 130 },
  { href: SETTINGS_ROUTES.recycleBin, label: "Recycle Bin", sortOrder: 140 },
] as const;

const MODULES_BY_KEY = new Map<string, ModuleRegistryEntry>(MODULE_REGISTRY.map((module) => [module.key, module]));
const MODULES_BY_ROUTE = new Map<string, ModuleRegistryEntry>(MODULE_REGISTRY.map((module) => [module.route, module]));

export function getModuleDefinition(moduleKey: string): ModuleRegistryEntry | null {
  return MODULES_BY_KEY.get(moduleKey) ?? null;
}

export function getModuleRoute(moduleKey: string, fallbackRoute?: string | null): string {
  return getModuleDefinition(moduleKey)?.route ?? fallbackRoute ?? "";
}

export function getModuleRegistryLabel(moduleKey: string): string | null {
  return getModuleDefinition(moduleKey)?.label ?? null;
}

export function getGuardedModuleRoutePrefixes(): string[] {
  return MODULE_REGISTRY.filter((module) => module.enabled && !module.adminOnly).map((module) => module.route);
}

export function isRegisteredModuleRoute(route: string): boolean {
  return MODULES_BY_ROUTE.has(route);
}

export function isModuleVisibleInNavigation(moduleKey: string): boolean {
  const definition = getModuleDefinition(moduleKey);
  return definition?.enabled === true && definition.status !== "hidden" && !definition.adminOnly;
}
