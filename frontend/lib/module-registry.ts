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
  quickAction?: {
    label: string;
    description: string;
    href: string;
    requiredAction?: "create" | "edit" | "configure" | "export";
  };
};

export const MODULE_REGISTRY: readonly ModuleRegistryEntry[] = [
  { key: "sales_leads", label: "Leads", route: DASHBOARD_ROUTES.leads, group: "sales", status: "tier1", enabled: true, sortOrder: 10, quickAction: { label: "Create lead", description: "Add a new sales lead", href: `${DASHBOARD_ROUTES.leads}/new` } },
  { key: "sales_organizations", label: "Accounts", route: DASHBOARD_ROUTES.accounts, group: "sales", status: "tier1", enabled: true, sortOrder: 20, quickAction: { label: "Create account", description: "Add a company account", href: `${DASHBOARD_ROUTES.accounts}/new` } },
  { key: "sales_contacts", label: "Contacts", route: DASHBOARD_ROUTES.contacts, group: "sales", status: "tier1", enabled: true, sortOrder: 30, quickAction: { label: "Create contact", description: "Add a CRM contact", href: `${DASHBOARD_ROUTES.contacts}/new` } },
  { key: "sales_opportunities", label: "Deals", route: DASHBOARD_ROUTES.deals, group: "sales", status: "tier1", enabled: true, sortOrder: 40, quickAction: { label: "Create deal", description: "Add a sales opportunity", href: `${DASHBOARD_ROUTES.deals}/new` } },
  { key: "sales_quotes", label: "Quotes", route: DASHBOARD_ROUTES.quotes, group: "sales", status: "tier1", enabled: true, sortOrder: 50, quickAction: { label: "Create quote", description: "Prepare a customer quote", href: `${DASHBOARD_ROUTES.quotes}/new` } },
  { key: "sales_orders", label: "Orders", route: DASHBOARD_ROUTES.orders, group: "sales", status: "tier1", enabled: true, sortOrder: 60, quickAction: { label: "Create order", description: "Add a sales order", href: `${DASHBOARD_ROUTES.orders}/new` } },
  { key: "contracts", label: "Contracts", route: DASHBOARD_ROUTES.contracts, group: "sales", status: "tier2", enabled: true, sortOrder: 70, quickAction: { label: "Create contract", description: "Add a contract", href: `${DASHBOARD_ROUTES.contracts}/new` } },
  { key: "catalog_products", label: "Products", route: DASHBOARD_ROUTES.products, group: "catalog", status: "tier1", enabled: true, sortOrder: 10, quickAction: { label: "Create product", description: "Add a catalog product", href: `${DASHBOARD_ROUTES.products}/new` } },
  { key: "catalog_services", label: "Services", route: DASHBOARD_ROUTES.services, group: "catalog", status: "tier1", enabled: true, sortOrder: 20, quickAction: { label: "Create service", description: "Add a catalog service", href: `${DASHBOARD_ROUTES.services}/new` } },
  { key: "documents", label: "Documents", route: DASHBOARD_ROUTES.documents, group: "workspace", status: "tier1", enabled: true, sortOrder: 10, quickAction: { label: "Upload document", description: "Open the document upload workflow", href: `${DASHBOARD_ROUTES.documents}/upload` } },
  { key: "calendar", label: "Calendar", route: DASHBOARD_ROUTES.calendar, group: "workspace", status: "tier1", enabled: true, sortOrder: 20, quickAction: { label: "Create event", description: "Schedule a calendar event", href: `${DASHBOARD_ROUTES.calendar}?action=create` } },
  { key: "mail", label: "Mail", route: DASHBOARD_ROUTES.mail, group: "workspace", status: "tier1", enabled: true, sortOrder: 30, quickAction: { label: "Compose email", description: "Write a CRM email", href: `${DASHBOARD_ROUTES.mail}/compose` } },
  { key: "tasks", label: "Tasks", route: DASHBOARD_ROUTES.tasks, group: "workspace", status: "tier2", enabled: true, sortOrder: 40, quickAction: { label: "Create task", description: "Add a workspace task", href: `${DASHBOARD_ROUTES.tasks}?action=create` } },
  { key: "support_cases", label: "Support Cases", route: DASHBOARD_ROUTES.supportCases, group: "support", status: "tier1", enabled: true, sortOrder: 10, quickAction: { label: "Create support case", description: "Open a customer support case", href: `${DASHBOARD_ROUTES.supportCases}/new` } },
  { key: "client_portal", label: "Client Portal", route: DASHBOARD_ROUTES.clientPortal, group: "support", status: "tier1", enabled: true, sortOrder: 20, quickAction: { label: "Create client page", description: "Prepare a client-facing page", href: `${DASHBOARD_ROUTES.clientPortal}/pages/new` } },
  { key: "finance_io", label: "Insertion Orders", route: DASHBOARD_ROUTES.insertionOrders, group: "finance", status: "tier2", enabled: true, sortOrder: 10, quickAction: { label: "Create insertion order", description: "Add a finance insertion order", href: `${DASHBOARD_ROUTES.insertionOrders}/new` } },
  { key: "finance_pos", label: "Invoices", route: DASHBOARD_ROUTES.financePos, group: "finance", status: "tier2", enabled: true, sortOrder: 20, quickAction: { label: "Create invoice", description: "Add an itemized invoice", href: `${DASHBOARD_ROUTES.financePos}/new` } },
  { key: "finance_payments", label: "Payments", route: DASHBOARD_ROUTES.payments, group: "finance", status: "tier2", enabled: true, sortOrder: 30, requiredModuleKey: "finance_pos", quickAction: { label: "Record payment", description: "Apply a payment to an outstanding invoice", href: `${DASHBOARD_ROUTES.payments}/record`, requiredAction: "edit" } },
  { key: "reports", label: "Reports", route: DASHBOARD_ROUTES.reports, group: "reports", status: "tier2", enabled: true, sortOrder: 90, quickAction: { label: "Build report", description: "Configure a tenant-authorized report", href: `${DASHBOARD_ROUTES.reports}#report-builder` } },
  { key: "message_templates", label: "Templates", route: SETTINGS_ROUTES.templates, group: "settings", status: "tier2", enabled: true, sortOrder: 80, adminOnly: true, quickAction: { label: "Create message template", description: "Add a reusable message template", href: `${SETTINGS_ROUTES.templates}/new` } },
  { key: "integrations", label: "Integrations", route: SETTINGS_ROUTES.integrations, group: "settings", status: "tier1", enabled: true, sortOrder: 90, adminOnly: true, quickAction: { label: "Configure integration", description: "Review providers and connect an integration", href: `${SETTINGS_ROUTES.integrations}#provider-registry`, requiredAction: "configure" } },
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
  { href: SETTINGS_ROUTES.backups, label: "Backups", sortOrder: 110 },
  { href: SETTINGS_ROUTES.integrations, label: "Integrations", sortOrder: 120 },
  { href: SETTINGS_ROUTES.templates, label: "Templates", sortOrder: 130 },
  { href: SETTINGS_ROUTES.activityLog, label: "Activity Log", sortOrder: 140 },
  { href: SETTINGS_ROUTES.recycleBin, label: "Recycle Bin", sortOrder: 150 },
] as const;

export const ADMIN_QUICK_ACTIONS = [
  {
    label: "Add user",
    description: "Provision a user and assign their role and team",
    href: `${SETTINGS_ROUTES.users}?tab=users&action=create-user`,
  },
  {
    label: "Create team",
    description: "Add a team to the tenant organization structure",
    href: `${SETTINGS_ROUTES.teams}?action=create-team`,
  },
  {
    label: "Create department",
    description: "Add a department for team and module access targeting",
    href: `${SETTINGS_ROUTES.teams}?action=create-department`,
  },
  {
    label: "Create role",
    description: "Create a permission role from a secure template",
    href: `${SETTINGS_ROUTES.permissions}?action=create-role`,
  },
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

export function getDependentModuleDefinitions(moduleKey: string): ModuleRegistryEntry[] {
  return MODULE_REGISTRY.filter((module) => module.enabled && module.requiredModuleKey === moduleKey);
}

export function getRequiredModuleKeyForRoute(route: string): string | null {
  const definition = MODULES_BY_ROUTE.get(route);
  return definition ? definition.requiredModuleKey ?? definition.key : null;
}

export function isRegisteredModuleRoute(route: string): boolean {
  return MODULES_BY_ROUTE.has(route);
}

export function isModuleVisibleInNavigation(moduleKey: string): boolean {
  const definition = getModuleDefinition(moduleKey);
  return definition?.enabled === true && definition.status !== "hidden" && !definition.adminOnly;
}
