import {
  Activity,
  BadgePercent,
  Blocks,
  Building2,
  CalendarDays,
  Columns3,
  Database,
  FileText,
  Fingerprint,
  FolderTree,
  Warehouse,
  Globe,
  KeyRound,
  LayoutTemplate,
  GitBranch,
  ListChecks,
  Plug,
  Recycle,
  Repeat2,
  Settings2,
  ShieldCheck,
  UserCog,
  UsersRound,
  Wrench,
} from "lucide-react";

import { DASHBOARD_ROUTES, SETTINGS_ROUTES } from "@/lib/routes";

export type ModuleStatus = "tier1" | "tier2" | "experimental" | "deprecated" | "hidden";

export type ModuleGroupKey =
  | "workspace"
  | "sales"
  | "catalog"
  | "inventory"
  | "purchasing"
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
  { key: "catalog_products", label: "Products", route: DASHBOARD_ROUTES.products, group: "catalog", status: "tier1", enabled: true, sortOrder: 10, quickAction: { label: "Create product", description: "Add a catalog product", href: `${DASHBOARD_ROUTES.products}/new` } },
  { key: "catalog_services", label: "Services", route: DASHBOARD_ROUTES.services, group: "catalog", status: "tier1", enabled: true, sortOrder: 20, quickAction: { label: "Create service", description: "Add a catalog service", href: `${DASHBOARD_ROUTES.services}/new` } },
  { key: "inventory_stock", label: "Stock", route: DASHBOARD_ROUTES.inventoryStock, group: "inventory", status: "tier1", enabled: true, sortOrder: 10 },
  { key: "inventory_movements", label: "Movements", route: DASHBOARD_ROUTES.inventoryMovements, group: "inventory", status: "tier1", enabled: true, sortOrder: 20, requiredModuleKey: "inventory_stock" },
  { key: "inventory_adjustments", label: "Adjustments", route: DASHBOARD_ROUTES.inventoryAdjustments, group: "inventory", status: "tier1", enabled: true, sortOrder: 30, quickAction: { label: "New adjustment", description: "Record a quantity change or count", href: `${DASHBOARD_ROUTES.inventoryAdjustments}/new` } },
  { key: "inventory_transfers", label: "Transfers", route: DASHBOARD_ROUTES.inventoryTransfers, group: "inventory", status: "tier1", enabled: true, sortOrder: 40, quickAction: { label: "New transfer", description: "Move stock between warehouses", href: `${DASHBOARD_ROUTES.inventoryTransfers}/new` } },
  // Deliveries and returns start from their order and delivery, so neither has a quick action.
  { key: "inventory_deliveries", label: "Deliveries", route: DASHBOARD_ROUTES.inventoryDeliveries, group: "inventory", status: "tier1", enabled: true, sortOrder: 50 },
  { key: "inventory_returns", label: "Returns", route: DASHBOARD_ROUTES.inventoryReturns, group: "inventory", status: "tier1", enabled: true, sortOrder: 60 },
  // E6 (12d §3.4): what stock is worth, revaluations, and margin on orders.
  { key: "inventory_valuation", label: "Valuation", route: DASHBOARD_ROUTES.inventoryValuation, group: "inventory", status: "tier1", enabled: true, sortOrder: 70 },
  { key: "purchase_orders", label: "Purchase orders", route: DASHBOARD_ROUTES.purchaseOrders, group: "purchasing", status: "tier1", enabled: true, sortOrder: 10, quickAction: { label: "New purchase order", description: "Order stock from a vendor", href: `${DASHBOARD_ROUTES.purchaseOrders}/new` } },
  // Receipts start from their purchase order, so there is no quick action.
  { key: "purchase_receipts", label: "Receipts", route: DASHBOARD_ROUTES.purchaseReceipts, group: "purchasing", status: "tier1", enabled: true, sortOrder: 20 },
  // Bills start from a purchase order or receipt, or blank for a service or expense (12c §3.5).
  { key: "purchase_bills", label: "Bills", route: DASHBOARD_ROUTES.purchaseBills, group: "purchasing", status: "tier1", enabled: true, sortOrder: 25, quickAction: { label: "New bill", description: "Record a vendor's invoice", href: `${DASHBOARD_ROUTES.purchaseBills}/new` } },
  // 13c §3.6–3.7: a return starts from its receipt; a credit from a bill, a return, or blank.
  { key: "purchase_vendor_returns", label: "Vendor returns", route: DASHBOARD_ROUTES.vendorReturns, group: "purchasing", status: "tier1", enabled: true, sortOrder: 26 },
  { key: "purchase_vendor_credits", label: "Vendor credits", route: DASHBOARD_ROUTES.vendorCredits, group: "purchasing", status: "tier1", enabled: true, sortOrder: 27, quickAction: { label: "New vendor credit", description: "Record what a vendor owes back", href: `${DASHBOARD_ROUTES.vendorCredits}/new` } },
  { key: "purchase_reorder", label: "Reorder", route: DASHBOARD_ROUTES.purchaseReorder, group: "purchasing", status: "tier1", enabled: true, sortOrder: 30, requiredModuleKey: "purchase_orders" },
  { key: "documents", label: "Documents", route: DASHBOARD_ROUTES.documents, group: "workspace", status: "tier1", enabled: true, sortOrder: 10, quickAction: { label: "Upload document", description: "Open the document upload workflow", href: `${DASHBOARD_ROUTES.documents}/upload` } },
  { key: "calendar", label: "Calendar", route: DASHBOARD_ROUTES.calendar, group: "workspace", status: "tier1", enabled: true, sortOrder: 20, quickAction: { label: "Create event", description: "Schedule a calendar event", href: `${DASHBOARD_ROUTES.calendar}?action=create` } },
  { key: "mail", label: "Mail", route: DASHBOARD_ROUTES.mail, group: "workspace", status: "tier1", enabled: true, sortOrder: 30, quickAction: { label: "Compose email", description: "Write a CRM email", href: `${DASHBOARD_ROUTES.mail}/compose` } },
  { key: "tasks", label: "Tasks", route: DASHBOARD_ROUTES.tasks, group: "workspace", status: "tier2", enabled: true, sortOrder: 40, quickAction: { label: "Create task", description: "Add a workspace task", href: `${DASHBOARD_ROUTES.tasks}?action=create` } },
  { key: "client_portal", label: "Client portal", route: DASHBOARD_ROUTES.clientPortal, group: "support", status: "tier1", enabled: true, sortOrder: 10, quickAction: { label: "Create client page", description: "Prepare a client-facing page", href: `${DASHBOARD_ROUTES.clientPortal}/pages/new` } },
  { key: "finance_pos", label: "Invoices", route: DASHBOARD_ROUTES.invoices, group: "finance", status: "tier2", enabled: true, sortOrder: 20, quickAction: { label: "Create invoice", description: "Add an itemized invoice", href: `${DASHBOARD_ROUTES.invoices}/new` } },
  // Credit notes start from an invoice or a return, so there is no quick action.
  { key: "finance_credit_notes", label: "Credit notes", route: DASHBOARD_ROUTES.creditNotes, group: "finance", status: "tier2", enabled: true, sortOrder: 25 },
  { key: "finance_payments", label: "Payments", route: DASHBOARD_ROUTES.payments, group: "finance", status: "tier2", enabled: true, sortOrder: 30, quickAction: { label: "Record payment", description: "Apply a payment to an outstanding invoice", href: `${DASHBOARD_ROUTES.payments}/record`, requiredAction: "create" } },
  { key: "reports", label: "Reports", route: DASHBOARD_ROUTES.reports, group: "reports", status: "tier2", enabled: true, sortOrder: 90, quickAction: { label: "Build report", description: "Start a new report from scratch", href: `${DASHBOARD_ROUTES.reports}/new` } },
  { key: "message_templates", label: "Templates", route: SETTINGS_ROUTES.templates, group: "settings", status: "tier2", enabled: true, sortOrder: 80, adminOnly: true, quickAction: { label: "Create message template", description: "Add a reusable message template", href: `${SETTINGS_ROUTES.templates}/new` } },
  { key: "integrations", label: "Integrations", route: SETTINGS_ROUTES.integrations, group: "settings", status: "tier1", enabled: true, sortOrder: 90, adminOnly: true, quickAction: { label: "Configure integration", description: "Review providers and connect an integration", href: `${SETTINGS_ROUTES.integrations}#provider-registry`, requiredAction: "configure" } },
] as const;

/**
 * The settings information architecture, in **one** place (rebuild.md 5.6, ruling 2).
 *
 * There were two. `SETTINGS_NAV_ITEMS` was flat with 18 entries and fed the command palette,
 * the recent-pages labeller and the dashboard layout's admin-only prefix list;
 * `settings/page.tsx` held a second, grouped, 19-entry copy for the hub. They disagreed about
 * `record-layouts`, which existed only in the hub — so it was invisible to the palette and its
 * header rendered Title Case out of a label fallback. Two lists is one list plus a bug.
 *
 * Everything now derives from here: the hub, the header title, the flat list below. Adding a
 * settings page means adding one row.
 */
export const SETTINGS_NAV_GROUPS = [
  {
    key: "workspace",
    title: "Workspace",
    items: [
      { href: SETTINGS_ROUTES.general, label: "General", description: "Manage company profile and tenant setup.", icon: Building2, sortOrder: 10 },
      { href: SETTINGS_ROUTES.calendarBooking, label: "Booking links", description: "Manage public scheduling links and booking availability.", icon: CalendarDays, sortOrder: 100 },
    ],
  },
  {
    key: "users-organization",
    title: "Users and organization",
    items: [
      { href: SETTINGS_ROUTES.users, label: "Users", description: "Invite users, manage accounts, and keep access current.", icon: UsersRound, sortOrder: 20 },
      { href: SETTINGS_ROUTES.teams, label: "Teams", description: "Organize departments and team membership.", icon: Blocks, sortOrder: 30 },
      { href: SETTINGS_ROUTES.customerGroups, label: "Customer groups", description: "Review customer segmentation used by contacts, accounts, and client portal context.", icon: BadgePercent, sortOrder: 40 },
    ],
  },
  {
    key: "security-access",
    title: "Security and access",
    items: [
      { href: SETTINGS_ROUTES.permissions, label: "Permissions", description: "Control role actions across enabled modules.", icon: ShieldCheck, sortOrder: 50 },
      { href: SETTINGS_ROUTES.modules, label: "Module settings", description: "Enable modules and assign department or team access.", icon: KeyRound, sortOrder: 60 },
      { href: SETTINGS_ROUTES.authentication, label: "Authentication", description: "Configure MFA, password policy, and tenant SSO.", icon: Fingerprint, sortOrder: 21 },
      { href: SETTINGS_ROUTES.domains, label: "Domains", description: "Verify workspace domains for tenant sign-in.", icon: Globe, sortOrder: 22 },
      { href: SETTINGS_ROUTES.provisioning, label: "Provisioning", description: "Map verified identities to roles and teams.", icon: UserCog, sortOrder: 23 },
    ],
  },
  {
    key: "customization",
    title: "Customization",
    items: [
      { href: SETTINGS_ROUTES.moduleBuilder, label: "Module builder", description: "Create and maintain custom module definitions.", icon: Wrench, sortOrder: 70 },
      { href: SETTINGS_ROUTES.fields, label: "Field config", description: "Add configurable fields to supported modules.", icon: Settings2, sortOrder: 80 },
      { href: SETTINGS_ROUTES.picklists, label: "Picklists", description: "Manage the value lists fields choose from: statuses, sources, industries, units.", icon: ListChecks, sortOrder: 82 },
      { href: SETTINGS_ROUTES.fieldDependencies, label: "Field dependencies", description: "Let one picklist limit another's values, like deal type limiting lost reasons.", icon: GitBranch, sortOrder: 83 },
      { href: SETTINGS_ROUTES.recordLayouts, label: "Record layouts", description: "Arrange the fields of forms and record details, per role or team.", icon: LayoutTemplate, sortOrder: 85 },
      { href: SETTINGS_ROUTES.pipeline, label: "Deal pipeline", description: "Name, order and weight the stages deals move through.", icon: Columns3, sortOrder: 87 },
      { href: SETTINGS_ROUTES.catalogCategories, label: "Catalog categories", description: "Group products and services the way your team browses them.", icon: FolderTree, sortOrder: 88 },
      { href: SETTINGS_ROUTES.warehouses, label: "Warehouses", description: "Manage inventory locations and the default warehouse.", icon: Warehouse, sortOrder: 89 },
      { href: SETTINGS_ROUTES.templates, label: "Templates", description: "Manage reusable message templates.", icon: FileText, sortOrder: 130 },
      { href: SETTINGS_ROUTES.automation, label: "Automation", description: "Configure event-based workflow rules and review run history.", icon: Repeat2, sortOrder: 90 },
    ],
  },
  {
    key: "integrations",
    title: "Integrations",
    items: [
      { href: SETTINGS_ROUTES.integrations, label: "Integrations", description: "Connect platform services and operational feeds.", icon: Plug, sortOrder: 120 },
    ],
  },
  {
    key: "data-maintenance",
    title: "Data and maintenance",
    items: [
      { href: SETTINGS_ROUTES.backups, label: "Backups", description: "Configure tenant-scoped backup exports and retention.", icon: Database, sortOrder: 110 },
      { href: SETTINGS_ROUTES.activityLog, label: "Activity log", description: "Review audited writes, restores, and configuration events.", icon: Activity, sortOrder: 140 },
      { href: SETTINGS_ROUTES.recycleBin, label: "Recycle bin", description: "Restore recoverable records from one place.", icon: Recycle, sortOrder: 150 },
    ],
  },
] as const;

export type SettingsNavItem = (typeof SETTINGS_NAV_GROUPS)[number]["items"][number];

/**
 * The flat projection, in `sortOrder`. Derived rather than authored — the command palette,
 * `lib/recent-pages.ts` and the dashboard layout's admin-only prefix list all read it, and
 * before this they read a hand-kept copy that was missing a page.
 */
export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = SETTINGS_NAV_GROUPS
  .flatMap<SettingsNavItem>((group) => [...group.items])
  .sort((left, right) => left.sortOrder - right.sortOrder);

export const ADMIN_QUICK_ACTIONS = [
  {
    label: "Create user",
    description: "Provision a user and assign their role and team",
    href: `${SETTINGS_ROUTES.users}?action=create-user`,
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

export function isModuleVisibleInNavigation(moduleKey: string): boolean {
  const definition = getModuleDefinition(moduleKey);
  return definition?.enabled === true && definition.status !== "hidden" && !definition.adminOnly;
}
