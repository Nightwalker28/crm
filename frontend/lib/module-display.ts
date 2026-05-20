export type ModuleCategory =
  | "Workspace"
  | "Sales"
  | "Products & Services"
  | "Finance"
  | "Platform"
  | "Other";

const MODULE_DISPLAY_NAMES: Record<string, string> = {
  tasks: "Tasks",
  calendar: "Calendar",
  mail: "Mail",
  whatsapp: "WhatsApp",
  documents: "Documents",
  message_templates: "Templates",
  sales_contacts: "Contacts",
  sales_organizations: "Accounts",
  sales_opportunities: "Deals",
  catalog_products: "Products",
  catalog_services: "Services",
  finance_io: "Insertion Orders",
  finance_insertion_orders: "Insertion Orders",
  finance_pos: "POS",
  sales_leads: "Leads",
  sales_activities: "Activities",
  sales_notes: "Notes",
  sales_quotes: "Quotes",
  sales_orders: "Sales Orders",
  finance_invoices: "Invoices",
  finance_payments: "Payments",
  finance_credit_notes: "Credit Notes",
  finance_expenses: "Expenses",
  purchase_vendors: "Vendors",
  purchase_orders: "Purchase Orders",
  inventory_warehouses: "Warehouses",
  inventory_locations: "Stock Locations",
  inventory_stock_moves: "Stock Moves",
  inventory_stock_adjustments: "Stock Adjustments",
  support_tickets: "Tickets",
  projects: "Projects",
  project_tasks: "Project Tasks",
};

const MODULE_CATEGORIES: Record<string, ModuleCategory> = {
  tasks: "Workspace",
  calendar: "Workspace",
  mail: "Workspace",
  whatsapp: "Workspace",
  documents: "Workspace",
  sales_contacts: "Sales",
  sales_organizations: "Sales",
  sales_opportunities: "Sales",
  catalog_products: "Products & Services",
  catalog_services: "Products & Services",
  finance_io: "Finance",
  finance_insertion_orders: "Finance",
  finance_pos: "Finance",
  message_templates: "Platform",
};

export function formatSnakeCaseLabel(value: string): string {
  return value
    .replace(/^custom_\d+_/, "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getModuleDisplayName(moduleName: string, fallbackDescription?: string): string {
  const mappedName = MODULE_DISPLAY_NAMES[moduleName];
  if (mappedName) {
    return mappedName;
  }

  const customDescription = fallbackDescription?.replace(/^Custom module:\s*/i, "").trim();
  if (customDescription && customDescription !== fallbackDescription) {
    return customDescription;
  }

  return formatSnakeCaseLabel(moduleName);
}

export function getModuleCategory(moduleName: string): ModuleCategory {
  if (moduleName.startsWith("custom_")) {
    return "Other";
  }

  return MODULE_CATEGORIES[moduleName] ?? "Other";
}
