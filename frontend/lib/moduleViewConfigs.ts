import type {
  SavedViewCondition,
  SavedViewConfig,
  SavedViewFilterOperator,
} from "@/hooks/useSavedViews";
import type { TableColumnOption } from "@/types/table";
import type { ModuleFieldConfig } from "@/hooks/useModuleFieldConfigs";
import { isProtectedFieldKey } from "@/hooks/useModuleFieldConfigs";
import type { CustomFieldDefinition } from "@/hooks/useModuleCustomFields";
import type { CustomModuleDefinition } from "@/hooks/useModuleBuilder";
import { formatSnakeCaseLabel, getModuleDisplayName } from "@/lib/module-display";
import { filterFieldFor } from "@/lib/fieldTypes";
import { SETTINGS_ROUTES } from "@/lib/routes";

export type ModuleFilterFieldType = "text" | "number" | "date" | "select" | "relation";

export type ModuleFilterFieldOption = {
  value: string;
  label: string;
};

export type ModuleFilterField = {
  key: string;
  label: string;
  type: ModuleFilterFieldType;
  operators?: SavedViewFilterOperator[];
  options?: ModuleFilterFieldOption[];
  sourceModuleKey?: string;
  recordType?: "user" | "team" | "organization" | "contact";
  /** The field stores keys of this picklist; its values become the options (13b §3.3). */
  picklistKey?: string;
};

export type ModuleViewDisplayMode = { value: string; label: string };

export type ModuleViewDefinition = {
  key: string;
  label: string;
  route: string;
  columns: TableColumnOption[];
  filterFields: ModuleFilterField[];
  defaultConfig: SavedViewConfig;
  /**
   * Displays of the same filtered population a saved view can remember (04-pipelines-kanban
   * Phase 4). The first is the default and is stored as no display at all. The values are the
   * list page's `?display=` words.
   */
  displayModes?: ModuleViewDisplayMode[];
};

export const CUSTOM_FIELD_COLUMN_PREFIX = "custom:";
/** Built-in modules that take custom fields, with their names (13b §3.4; the server's list is
 * `SUPPORTED_MODULE_KEYS` in `custom_fields.py`). */
export const CUSTOM_FIELD_MODULE_LABELS: Record<string, string> = {
  sales_leads: "Leads",
  sales_contacts: "Contacts",
  sales_organizations: "Accounts",
  sales_opportunities: "Deals",
  sales_quotes: "Quotes",
  sales_orders: "Orders",
  catalog_products: "Products",
  catalog_services: "Services",
  finance_pos: "Invoices",
  finance_credit_notes: "Credit notes",
  finance_payments: "Payments",
  purchase_orders: "Purchase orders",
  purchase_receipts: "Receipts",
  purchase_bills: "Bills",
  inventory_deliveries: "Deliveries",
  inventory_returns: "Returns",
  inventory_adjustments: "Stock adjustments",
  inventory_transfers: "Stock transfers",
  purchase_vendor_returns: "Vendor returns",
  purchase_vendor_credits: "Vendor credits",
};
export const CUSTOM_FIELD_SUPPORTED_MODULES = new Set(Object.keys(CUSTOM_FIELD_MODULE_LABELS));

const TEXT_OPERATORS: SavedViewFilterOperator[] = ["is", "is_not", "contains", "not_contains", "in", "not_in", "is_empty", "is_not_empty"];
const NUMBER_OPERATORS: SavedViewFilterOperator[] = ["is", "is_not", "gt", "gte", "lt", "lte", "in", "not_in", "is_empty", "is_not_empty"];
const DATE_OPERATORS: SavedViewFilterOperator[] = ["is", "is_not", "gt", "gte", "lt", "lte", "in", "not_in", "is_empty", "is_not_empty"];
const SELECT_OPERATORS: SavedViewFilterOperator[] = ["is", "is_not", "in", "not_in", "is_empty", "is_not_empty"];
const RELATION_OPERATORS: SavedViewFilterOperator[] = ["is", "is_not", "is_empty", "is_not_empty"];

export const CONTACT_COLUMNS: TableColumnOption[] = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "primary_email", label: "Email" },
  { key: "contact_telephone", label: "Phone" },
  { key: "current_title", label: "Job title" },
  { key: "organization_name", label: "Account" },
  { key: "assigned_to_name", label: "Owner" },
  { key: "last_contacted_at", label: "Last activity" },
  { key: "created_time", label: "Created" },
  { key: "region", label: "Region" },
  { key: "country", label: "Country" },
  { key: "linkedin_url", label: "LinkedIn" },
];

export const LEAD_COLUMNS: TableColumnOption[] = [
  { key: "first_name", label: "Name" },
  { key: "last_name", label: "Last name" },
  { key: "company", label: "Company" },
  { key: "score", label: "Score" },
  { key: "score_grade", label: "Grade" },
  { key: "primary_email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "title", label: "Job title" },
  { key: "source", label: "Source" },
  { key: "status", label: "Status" },
  { key: "assigned_to_name", label: "Owner" },
  { key: "team_name", label: "Team" },
  { key: "tags", label: "Tags" },
  { key: "last_contacted_at", label: "Last activity" },
  { key: "next_follow_up_at", label: "Next Follow-up" },
  { key: "created_time", label: "Created" },
];

export const ORGANIZATION_COLUMNS: TableColumnOption[] = [
  { key: "org_name", label: "Account" },
  { key: "primary_email", label: "Email" },
  { key: "website", label: "Website" },
  { key: "industry", label: "Industry" },
  { key: "account_type", label: "Type" },
  { key: "annual_revenue", label: "Revenue" },
  { key: "employee_count", label: "Employees" },
  { key: "primary_phone", label: "Phone" },
  { key: "billing_country", label: "Country" },
  { key: "is_vendor", label: "Vendor" },
  { key: "assigned_to_name", label: "Owner" },
  { key: "created_time", label: "Created" },
  { key: "updated_at", label: "Updated" },
];

export const OPPORTUNITY_COLUMNS: TableColumnOption[] = [
  { key: "opportunity_name", label: "Deal" },
  { key: "organization_name", label: "Account" },
  { key: "contact_name", label: "Contact" },
  { key: "sales_stage", label: "Stage" },
  { key: "expected_close_date", label: "Expected close" },
  { key: "probability_percent", label: "Probability" },
  { key: "amount", label: "Amount" },
  { key: "currency_type", label: "Currency" },
  { key: "deal_type", label: "Type" },
  { key: "source", label: "Source" },
  { key: "next_step", label: "Next step" },
  { key: "lost_reason", label: "Lost reason" },
  { key: "assigned_to_name", label: "Owner" },
  { key: "created_time", label: "Created" },
];

export const QUOTE_COLUMNS: TableColumnOption[] = [
  { key: "quote_number", label: "Quote number" },
  { key: "customer_name", label: "Customer" },
  { key: "opportunity_id", label: "Deal ID" },
  { key: "title", label: "Title" },
  { key: "status", label: "Status" },
  { key: "total_amount", label: "Total" },
  { key: "currency", label: "Currency" },
  { key: "issue_date", label: "Issue date" },
  { key: "expiry_date", label: "Expiry date" },
  { key: "updated_at", label: "Updated" },
];

export const ORDER_COLUMNS: TableColumnOption[] = [
  { key: "order_number", label: "Order number" },
  { key: "status", label: "Status" },
  { key: "delivery_status", label: "Delivery" },
  { key: "invoice_status", label: "Invoicing" },
  { key: "priority", label: "Priority" },
  { key: "source", label: "Source" },
  { key: "channel", label: "Channel" },
  { key: "external_reference", label: "External reference" },
  { key: "quote_id", label: "Quote ID" },
  { key: "organization_name", label: "Account" },
  { key: "contact_name", label: "Contact" },
  { key: "opportunity_name", label: "Deal" },
  { key: "owner_name", label: "Owner" },
  { key: "currency", label: "Currency" },
  { key: "grand_total", label: "Total" },
  { key: "created_at", label: "Created" },
  { key: "updated_at", label: "Updated" },
];

export const CATALOG_PRODUCT_COLUMNS: TableColumnOption[] = [
  { key: "name", label: "Name" },
  { key: "slug", label: "Slug" },
  { key: "sku", label: "SKU" },
  { key: "barcode", label: "Barcode" },
  { key: "category_name", label: "Category" },
  { key: "unit", label: "Unit" },
  { key: "public_unit_price", label: "Price" },
  { key: "cost_price", label: "Cost" },
  { key: "stock_status", label: "Stock" },
  { key: "is_public", label: "Feed" },
  { key: "is_active", label: "Status" },
  { key: "media_url", label: "Media" },
  { key: "updated_at", label: "Updated" },
];

export const CATALOG_SERVICE_COLUMNS: TableColumnOption[] = [
  { key: "name", label: "Name" },
  { key: "slug", label: "Slug" },
  { key: "sku", label: "SKU" },
  { key: "category_name", label: "Category" },
  { key: "unit", label: "Unit" },
  { key: "public_unit_price", label: "Price" },
  { key: "cost_price", label: "Cost" },
  { key: "is_public", label: "Feed" },
  { key: "is_active", label: "Status" },
  { key: "media_url", label: "Media" },
  { key: "updated_at", label: "Updated" },
];

export const USER_COLUMNS: TableColumnOption[] = [
  { key: "name", label: "Name" },
  { key: "team_name", label: "Team" },
  { key: "role_name", label: "Role" },
  { key: "email", label: "Email" },
  { key: "auth_mode", label: "Sign-in mode" },
  { key: "mfa_enabled", label: "MFA" },
  { key: "is_active", label: "Status" },
];

export const MODULE_VIEW_DEFAULTS: Record<string, SavedViewConfig> = {
  inventory_stock: {
    visible_columns: ["product", "sku", "category", "warehouse", "on_hand", "available", "reorder_point", "status"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
    sort: null,
  },
  tasks: {
    visible_columns: ["title", "priority", "status", "due_at", "assignees", "updated_at"],
    filters: {
      search: "",
      logic: "all",
      conditions: [],
      all_conditions: [{ id: "default-hide-completed", field: "status", operator: "is_not", value: "completed" }],
      any_conditions: [],
    },
    sort: null,
  },
  sales_leads: {
    visible_columns: ["first_name", "company", "status", "source", "assigned_to_name", "last_contacted_at", "created_time"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
    sort: null,
  },
  sales_contacts: {
    visible_columns: ["first_name", "organization_name", "primary_email", "contact_telephone", "assigned_to_name", "last_contacted_at"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
    sort: null,
  },
  sales_organizations: {
    visible_columns: ["org_name", "primary_email", "industry", "assigned_to_name", "billing_country", "updated_at"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
    sort: null,
  },
  sales_opportunities: {
    visible_columns: ["opportunity_name", "organization_name", "sales_stage", "amount", "expected_close_date", "assigned_to_name"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
    sort: null,
  },
  sales_quotes: {
    visible_columns: ["quote_number", "customer_name", "opportunity_id", "status", "total_amount", "expiry_date"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
    sort: null,
  },
  sales_orders: {
    visible_columns: ["order_number", "organization_name", "status", "delivery_status", "invoice_status", "grand_total", "owner_name", "created_at"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
    sort: null,
  },
  finance_pos: {
    visible_columns: ["invoice_number", "customer_name", "status", "payment_status", "total_amount", "balance_due", "issue_date", "updated_at"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [], payment_status: "all", filtersOpen: false },
    sort: { key: "due_date", direction: "asc" },
  },
  catalog_products: {
    visible_columns: ["name", "sku", "category_name", "public_unit_price", "stock_status", "is_public", "is_active", "media_url", "updated_at"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
    sort: null,
  },
  catalog_services: {
    visible_columns: ["name", "sku", "category_name", "public_unit_price", "is_public", "is_active", "media_url", "updated_at"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
    sort: null,
  },
  // ERP document lists (13c §3.2): `status` is the list's quick status filter.
  purchase_orders: {
    visible_columns: ["number", "status", "vendor_name", "expected_date", "subtotal"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [], status: "all", filtersOpen: false },
    sort: null,
  },
  purchase_receipts: {
    visible_columns: ["number", "status", "order_number", "vendor_name", "received_on", "total_quantity"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [], status: "all", filtersOpen: false },
    sort: null,
  },
  purchase_bills: {
    visible_columns: ["number", "status", "vendor_name", "vendor_invoice_number", "order_number", "due_date", "payment_status", "total", "balance_due"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [], status: "all", filtersOpen: false },
    sort: null,
  },
  inventory_deliveries: {
    visible_columns: ["number", "status", "order_number", "customer_name", "shipped_on", "carrier", "total_quantity"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [], status: "all", filtersOpen: false },
    sort: null,
  },
  inventory_returns: {
    visible_columns: ["number", "status", "reason", "delivery_number", "customer_name", "received_at", "total_quantity"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [], status: "all", filtersOpen: false },
    sort: null,
  },
  inventory_adjustments: {
    visible_columns: ["number", "status", "warehouse_name", "reason", "line_count", "created_at"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [], status: "all", filtersOpen: false },
    sort: null,
  },
  inventory_transfers: {
    visible_columns: ["number", "status", "route", "line_count", "created_at"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [], status: "all", filtersOpen: false },
    sort: null,
  },
  finance_credit_notes: {
    visible_columns: ["number", "status", "invoice_number", "customer_name", "reason", "issue_date", "refund_due", "total_amount"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [], status: "all", filtersOpen: false },
    sort: null,
  },
  purchase_vendor_returns: {
    visible_columns: ["number", "status", "resolution", "vendor_name", "receipt_number", "reason", "total_quantity"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [], status: "all", filtersOpen: false },
    sort: null,
  },
  purchase_vendor_credits: {
    visible_columns: ["number", "status", "vendor_name", "bill_number", "credit_date", "total", "credit_remaining"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [], status: "all", filtersOpen: false },
    sort: null,
  },
  finance_payments: {
    visible_columns: ["number", "paid_on", "party_name", "documents", "kind", "method", "status", "amount"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [], status: "all", filtersOpen: false },
    sort: null,
  },
  admin_users: {
    visible_columns: ["name", "team_name", "role_name", "email", "mfa_enabled", "is_active"],
    filters: {
      search: "",
      logic: "all",
      conditions: [],
      all_conditions: [],
      any_conditions: [],
      filtersOpen: false,
      selectedTeams: [],
      selectedRoles: [],
      selectedStatuses: [],
    },
    sort: { key: "name", direction: "asc" },
  },
};

export const MODULE_VIEW_DEFINITIONS: Record<string, ModuleViewDefinition> = {
  inventory_stock: {
    key: "inventory_stock", label: "Stock", route: "/dashboard/inventory/stock",
    columns: [
      { key: "product", label: "Product" }, { key: "sku", label: "SKU" }, { key: "category", label: "Category" },
      { key: "warehouse", label: "Warehouse" }, { key: "on_hand", label: "On hand" },
      { key: "available", label: "Available" }, { key: "reorder_point", label: "Reorder point" }, { key: "status", label: "Status" },
    ],
    filterFields: [
      { key: "product_name", label: "Product", type: "text", operators: TEXT_OPERATORS },
      { key: "sku", label: "SKU", type: "text", operators: TEXT_OPERATORS },
      { key: "on_hand", label: "On hand", type: "number", operators: NUMBER_OPERATORS },
      { key: "available", label: "Available", type: "number", operators: NUMBER_OPERATORS },
      { key: "reorder_point", label: "Reorder point", type: "number", operators: NUMBER_OPERATORS },
      { key: "low_stock", label: "Low stock", type: "select", operators: ["is"], options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.inventory_stock,
  },
  tasks: {
    key: "tasks",
    label: "Tasks",
    route: "/dashboard/tasks",
    columns: [
      { key: "title", label: "Title" },
      { key: "priority", label: "Priority" },
      { key: "status", label: "Status" },
      { key: "assigned_by_name", label: "Assigned by" },
      { key: "assigned_at", label: "Assigned" },
      { key: "due_at", label: "Due" },
      { key: "assignees", label: "Assignees" },
      { key: "updated_at", label: "Updated" },
    ],
    filterFields: [
      { key: "title", label: "Title", type: "text", operators: TEXT_OPERATORS },
      {
        key: "priority",
        label: "Priority",
        type: "select",
        operators: SELECT_OPERATORS,
        options: [
          { value: "high", label: "High" },
          { value: "medium", label: "Medium" },
          { value: "low", label: "Low" },
        ],
      },
      {
        key: "status",
        label: "Status",
        type: "select",
        operators: SELECT_OPERATORS,
        options: [
          { value: "todo", label: "To do" },
          { value: "in_progress", label: "In progress" },
          { value: "blocked", label: "Blocked" },
          { value: "completed", label: "Completed" },
        ],
      },
      { key: "due_at", label: "Due date", type: "date", operators: DATE_OPERATORS },
      { key: "start_at", label: "Start date", type: "date", operators: DATE_OPERATORS },
      { key: "assigned_at", label: "Assigned at", type: "date", operators: DATE_OPERATORS },
      { key: "created_at", label: "Created at", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.tasks,
  },
  sales_leads: {
    key: "sales_leads",
    label: "Leads",
    route: "/dashboard/sales/leads",
    columns: LEAD_COLUMNS,
    filterFields: [
      { key: "first_name", label: "First name", type: "text", operators: TEXT_OPERATORS },
      { key: "last_name", label: "Last name", type: "text", operators: TEXT_OPERATORS },
      { key: "company", label: "Company", type: "text", operators: TEXT_OPERATORS },
      { key: "primary_email", label: "Email", type: "text", operators: TEXT_OPERATORS },
      { key: "phone", label: "Phone", type: "text", operators: TEXT_OPERATORS },
      { key: "title", label: "Job title", type: "text", operators: TEXT_OPERATORS },
      { key: "source", label: "Source", type: "select", operators: SELECT_OPERATORS, picklistKey: "lead_source" },
      {
        key: "assigned_to",
        label: "Owner",
        type: "relation",
        operators: RELATION_OPERATORS,
        sourceModuleKey: "sales_leads",
        recordType: "user",
      },
      {
        key: "team_id",
        label: "Team",
        type: "relation",
        operators: RELATION_OPERATORS,
        sourceModuleKey: "sales_leads",
        recordType: "team",
      },
      { key: "last_contacted_at", label: "Last activity", type: "date", operators: DATE_OPERATORS },
      { key: "next_follow_up_at", label: "Next Follow-up", type: "date", operators: DATE_OPERATORS },
      {
        key: "has_activity",
        label: "Has activity",
        type: "select",
        operators: ["is"],
        options: [
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ],
      },
      { key: "score", label: "Score", type: "number", operators: NUMBER_OPERATORS },
      {
        key: "score_grade",
        label: "Score grade",
        type: "select",
        operators: SELECT_OPERATORS,
        options: [
          { value: "hot", label: "Hot" },
          { value: "warm", label: "Warm" },
          { value: "cold", label: "Cold" },
        ],
      },
      {
        key: "status",
        label: "Status",
        type: "select",
        operators: SELECT_OPERATORS,
        picklistKey: "lead_status",
      },
      { key: "created_time", label: "Created time", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.sales_leads,
  },
  sales_contacts: {
    key: "sales_contacts",
    label: "Contacts",
    route: "/dashboard/sales/contacts",
    columns: CONTACT_COLUMNS,
    filterFields: [
      { key: "first_name", label: "First name", type: "text", operators: TEXT_OPERATORS },
      { key: "last_name", label: "Last name", type: "text", operators: TEXT_OPERATORS },
      { key: "primary_email", label: "Email", type: "text", operators: TEXT_OPERATORS },
      { key: "contact_telephone", label: "Phone", type: "text", operators: TEXT_OPERATORS },
      { key: "current_title", label: "Job title", type: "text", operators: TEXT_OPERATORS },
      { key: "organization_name", label: "Account", type: "text", operators: TEXT_OPERATORS },
      {
        key: "assigned_to",
        label: "Owner",
        type: "relation",
        operators: RELATION_OPERATORS,
        sourceModuleKey: "sales_contacts",
        recordType: "user",
      },
      { key: "last_contacted_at", label: "Last activity", type: "date", operators: DATE_OPERATORS },
      { key: "region", label: "Region", type: "select", operators: SELECT_OPERATORS, picklistKey: "region" },
      { key: "country", label: "Country", type: "select", operators: SELECT_OPERATORS, picklistKey: "country" },
      { key: "linkedin_url", label: "LinkedIn", type: "text", operators: TEXT_OPERATORS },
      { key: "created_time", label: "Created time", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.sales_contacts,
  },
  sales_organizations: {
    key: "sales_organizations",
    label: "Accounts",
    route: "/dashboard/sales/organizations",
    columns: ORGANIZATION_COLUMNS,
    filterFields: [
      { key: "org_name", label: "Account", type: "text", operators: TEXT_OPERATORS },
      { key: "primary_email", label: "Email", type: "text", operators: TEXT_OPERATORS },
      { key: "website", label: "Website", type: "text", operators: TEXT_OPERATORS },
      { key: "industry", label: "Industry", type: "select", operators: SELECT_OPERATORS, picklistKey: "industry" },
      { key: "account_type", label: "Type", type: "select", operators: SELECT_OPERATORS, picklistKey: "account_type" },
      { key: "annual_revenue", label: "Revenue", type: "number", operators: NUMBER_OPERATORS },
      { key: "employee_count", label: "Employees", type: "number", operators: NUMBER_OPERATORS },
      { key: "primary_phone", label: "Phone", type: "text", operators: TEXT_OPERATORS },
      { key: "billing_country", label: "Country", type: "select", operators: SELECT_OPERATORS, picklistKey: "country" },
      { key: "is_vendor", label: "Vendor", type: "select", operators: ["is"], options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      { key: "assigned_to", label: "Owner", type: "relation", operators: RELATION_OPERATORS, sourceModuleKey: "sales_organizations", recordType: "user" },
      { key: "created_time", label: "Created time", type: "date", operators: DATE_OPERATORS },
      { key: "updated_at", label: "Updated time", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.sales_organizations,
  },
  sales_opportunities: {
    key: "sales_opportunities",
    label: "Deals",
    route: "/dashboard/sales/opportunities",
    displayModes: [
      { value: "table", label: "Table" },
      { value: "pipeline", label: "Pipeline" },
    ],
    columns: OPPORTUNITY_COLUMNS,
    filterFields: [
      { key: "opportunity_name", label: "Deal", type: "text", operators: TEXT_OPERATORS },
      {
        key: "sales_stage",
        label: "Stage",
        type: "select",
        operators: SELECT_OPERATORS,
        options: [
          { value: "lead", label: "Lead" },
          { value: "qualified", label: "Qualified" },
          { value: "proposal", label: "Proposal" },
          { value: "negotiation", label: "Negotiation" },
          { value: "closed_won", label: "Closed won" },
          { value: "closed_lost", label: "Closed lost" },
        ],
      },
      { key: "expected_close_date", label: "Expected close", type: "date", operators: DATE_OPERATORS },
      { key: "probability_percent", label: "Probability", type: "number", operators: NUMBER_OPERATORS },
      { key: "amount", label: "Amount", type: "number", operators: NUMBER_OPERATORS },
      { key: "currency_type", label: "Currency", type: "text", operators: TEXT_OPERATORS },
      { key: "deal_type", label: "Type", type: "select", operators: SELECT_OPERATORS, picklistKey: "deal_type" },
      { key: "source", label: "Source", type: "select", operators: SELECT_OPERATORS, picklistKey: "lead_source" },
      { key: "lost_reason", label: "Lost reason", type: "select", operators: SELECT_OPERATORS, picklistKey: "lost_reason" },
      { key: "created_time", label: "Created time", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.sales_opportunities,
  },
  sales_quotes: {
    key: "sales_quotes",
    label: "Quotes",
    route: "/dashboard/sales/quotes",
    columns: QUOTE_COLUMNS,
    filterFields: [
      { key: "quote_number", label: "Quote number", type: "text", operators: TEXT_OPERATORS },
      { key: "customer_name", label: "Customer", type: "text", operators: TEXT_OPERATORS },
      { key: "opportunity_id", label: "Deal ID", type: "number", operators: NUMBER_OPERATORS },
      { key: "title", label: "Title", type: "text", operators: TEXT_OPERATORS },
      {
        key: "status",
        label: "Status",
        type: "select",
        operators: SELECT_OPERATORS,
        options: [
          { value: "draft", label: "Draft" },
          { value: "sent", label: "Sent" },
          { value: "accepted", label: "Accepted" },
          { value: "declined", label: "Declined" },
          { value: "expired", label: "Expired" },
        ],
      },
      { key: "issue_date", label: "Issue date", type: "date", operators: DATE_OPERATORS },
      { key: "expiry_date", label: "Expiry date", type: "date", operators: DATE_OPERATORS },
      { key: "currency", label: "Currency", type: "text", operators: TEXT_OPERATORS },
      { key: "subtotal_amount", label: "Subtotal", type: "number", operators: NUMBER_OPERATORS },
      { key: "discount_amount", label: "Discount", type: "number", operators: NUMBER_OPERATORS },
      { key: "tax_amount", label: "Tax", type: "number", operators: NUMBER_OPERATORS },
      { key: "total_amount", label: "Total", type: "number", operators: NUMBER_OPERATORS },
      { key: "created_time", label: "Created time", type: "date", operators: DATE_OPERATORS },
      { key: "updated_at", label: "Updated", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.sales_quotes,
  },
  sales_orders: {
    key: "sales_orders",
    label: "Orders",
    route: "/dashboard/sales/orders",
    columns: ORDER_COLUMNS,
    filterFields: [
      { key: "order_number", label: "Order number", type: "text", operators: TEXT_OPERATORS },
      { key: "quote_id", label: "Quote ID", type: "number", operators: NUMBER_OPERATORS },
      { key: "organization_id", label: "Account ID", type: "number", operators: NUMBER_OPERATORS },
      { key: "contact_id", label: "Contact ID", type: "number", operators: NUMBER_OPERATORS },
      { key: "opportunity_id", label: "Deal ID", type: "number", operators: NUMBER_OPERATORS },
      {
        key: "status",
        label: "Status",
        type: "select",
        operators: SELECT_OPERATORS,
        options: [
          { value: "draft", label: "Draft" },
          { value: "confirmed", label: "Confirmed" },
          { value: "fulfilled", label: "Fulfilled" },
          { value: "cancelled", label: "Cancelled" },
        ],
      },
      {
        key: "delivery_status",
        label: "Delivery",
        type: "select",
        operators: SELECT_OPERATORS,
        options: [
          { value: "none", label: "Nothing to ship" },
          { value: "pending", label: "To deliver" },
          { value: "partial", label: "Partly delivered" },
          { value: "delivered", label: "Delivered" },
          { value: "closed", label: "Closed" },
        ],
      },
      {
        key: "invoice_status",
        label: "Invoicing",
        type: "select",
        operators: SELECT_OPERATORS,
        options: [
          { value: "none", label: "Not invoiced" },
          { value: "pending", label: "Awaiting delivery" },
          { value: "to_invoice", label: "To invoice" },
          { value: "partial", label: "Partly invoiced" },
          { value: "invoiced", label: "Invoiced" },
        ],
      },
      {
        key: "priority",
        label: "Priority",
        type: "select",
        operators: SELECT_OPERATORS,
        options: [
          { value: "urgent", label: "Urgent" },
          { value: "high", label: "High" },
          { value: "normal", label: "Normal" },
        ],
      },
      { key: "waiting_for_stock", label: "Waiting for stock", type: "select", operators: ["is"], options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      {
        key: "source",
        label: "Source",
        type: "select",
        operators: SELECT_OPERATORS,
        options: [
          { value: "crm", label: "CRM" },
          { value: "website", label: "Website" },
          { value: "client_portal", label: "Client portal" },
        ],
      },
      { key: "channel", label: "Channel", type: "text", operators: TEXT_OPERATORS },
      { key: "external_reference", label: "External reference", type: "text", operators: TEXT_OPERATORS },
      { key: "currency", label: "Currency", type: "text", operators: TEXT_OPERATORS },
      { key: "grand_total", label: "Total", type: "number", operators: NUMBER_OPERATORS },
      { key: "created_at", label: "Created", type: "date", operators: DATE_OPERATORS },
      { key: "updated_at", label: "Updated", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.sales_orders,
  },
  finance_pos: {
    key: "finance_pos",
    label: "Invoices",
    route: "/dashboard/finance/invoices",
    columns: [
      { key: "invoice_number", label: "Invoice" },
      { key: "customer_name", label: "Customer" },
      { key: "status", label: "Invoice status" },
      { key: "payment_status", label: "Payment status" },
      { key: "total_amount", label: "Invoice total" },
      { key: "amount_paid", label: "Paid" },
      { key: "amount_credited", label: "Credited" },
      { key: "balance_due", label: "Balance due" },
      { key: "due_date", label: "Due date" },
      { key: "issue_date", label: "Issue date" },
      { key: "payment_method", label: "Payment method" },
      { key: "template_id", label: "Template" },
      { key: "updated_at", label: "Updated" },
    ],
    filterFields: [
      { key: "invoice_number", label: "Invoice number", type: "text", operators: TEXT_OPERATORS },
      { key: "customer_name", label: "Customer", type: "text", operators: TEXT_OPERATORS },
      {
        key: "status",
        label: "Invoice status",
        type: "select",
        operators: SELECT_OPERATORS,
        options: [
          { value: "draft", label: "Draft" },
          { value: "issued", label: "Issued" },
          { value: "void", label: "Void" },
        ],
      },
      {
        key: "payment_status",
        label: "Payment status",
        type: "select",
        operators: SELECT_OPERATORS,
        options: [
          { value: "unpaid", label: "Unpaid" },
          { value: "partial", label: "Partially paid" },
          { value: "paid", label: "Paid" },
        ],
      },
      // Issued, something still due, and past its due date (12c §3.2).
      { key: "overdue", label: "Overdue", type: "select", operators: ["is"], options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      { key: "payment_method", label: "Payment method", type: "select", operators: SELECT_OPERATORS, picklistKey: "payment_method" },
      { key: "currency", label: "Currency", type: "text", operators: TEXT_OPERATORS },
      { key: "total_amount", label: "Invoice total", type: "number", operators: NUMBER_OPERATORS },
      { key: "amount_paid", label: "Amount paid", type: "number", operators: NUMBER_OPERATORS },
      { key: "balance_due", label: "Balance due", type: "number", operators: NUMBER_OPERATORS },
      { key: "amount_credited", label: "Credited", type: "number", operators: NUMBER_OPERATORS },
      { key: "due_date", label: "Due date", type: "date", operators: DATE_OPERATORS },
      { key: "issue_date", label: "Issue date", type: "date", operators: DATE_OPERATORS },
      { key: "updated_at", label: "Updated", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.finance_pos,
  },
  // ERP document lists (13c §3.2). Filter keys match each list route's field map
  // (`list_field_map` in its service); the column keys are the list serializer's.
  purchase_orders: {
    key: "purchase_orders",
    label: "Purchase orders",
    route: "/dashboard/purchasing/orders",
    columns: [
      { key: "number", label: "Number" },
      { key: "status", label: "Status" },
      { key: "vendor_name", label: "Vendor" },
      { key: "vendor_reference", label: "Vendor reference" },
      { key: "warehouse_name", label: "Warehouse" },
      { key: "expected_date", label: "Expected" },
      { key: "ordered_at", label: "Placed" },
      { key: "bill_status", label: "Billing" },
      { key: "subtotal", label: "Total" },
    ],
    filterFields: [
      { key: "number", label: "Number", type: "text", operators: TEXT_OPERATORS },
      { key: "status", label: "Status", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "draft", label: "Request for quotation" }, { value: "sent", label: "RFQ sent" }, { value: "ordered", label: "Ordered" },
        { value: "received", label: "Received" }, { value: "closed", label: "Closed" }, { value: "cancelled", label: "Cancelled" },
      ] },
      { key: "to_receive", label: "To receive", type: "select", operators: ["is"], options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      { key: "receipt_status", label: "Receiving", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "none", label: "Nothing received" }, { value: "partial", label: "Partly received" }, { value: "received", label: "Received" },
      ] },
      { key: "bill_status", label: "Billing", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "none", label: "Nothing to bill" }, { value: "to_bill", label: "To bill" }, { value: "partial", label: "Partly billed" }, { value: "billed", label: "Billed" },
      ] },
      { key: "vendor_id", label: "Vendor", type: "relation", operators: RELATION_OPERATORS, sourceModuleKey: "sales_organizations", recordType: "organization" },
      { key: "owner_id", label: "Owner", type: "relation", operators: RELATION_OPERATORS, sourceModuleKey: "purchase_orders", recordType: "user" },
      { key: "vendor_reference", label: "Vendor reference", type: "text", operators: TEXT_OPERATORS },
      { key: "currency", label: "Currency", type: "text", operators: TEXT_OPERATORS },
      { key: "subtotal", label: "Total", type: "number", operators: NUMBER_OPERATORS },
      { key: "expected_date", label: "Expected", type: "date", operators: DATE_OPERATORS },
      { key: "ordered_at", label: "Placed", type: "date", operators: DATE_OPERATORS },
      { key: "created_at", label: "Created", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.purchase_orders,
  },
  purchase_receipts: {
    key: "purchase_receipts",
    label: "Receipts",
    route: "/dashboard/purchasing/receipts",
    columns: [
      { key: "number", label: "Number" },
      { key: "status", label: "Status" },
      { key: "order_number", label: "Purchase order" },
      { key: "vendor_name", label: "Vendor" },
      { key: "warehouse_name", label: "Warehouse" },
      { key: "vendor_delivery_ref", label: "Vendor delivery ref" },
      { key: "received_on", label: "Received on" },
      { key: "total_quantity", label: "Units" },
    ],
    filterFields: [
      { key: "number", label: "Number", type: "text", operators: TEXT_OPERATORS },
      { key: "status", label: "Status", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "draft", label: "Draft" }, { value: "posted", label: "Posted" }, { value: "cancelled", label: "Cancelled" },
      ] },
      { key: "vendor_delivery_ref", label: "Vendor delivery ref", type: "text", operators: TEXT_OPERATORS },
      { key: "received_on", label: "Received on", type: "date", operators: DATE_OPERATORS },
      { key: "created_at", label: "Created", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.purchase_receipts,
  },
  purchase_bills: {
    key: "purchase_bills",
    label: "Bills",
    route: "/dashboard/purchasing/bills",
    columns: [
      { key: "number", label: "Number" },
      { key: "status", label: "Status" },
      { key: "vendor_name", label: "Vendor" },
      { key: "vendor_invoice_number", label: "Vendor invoice" },
      { key: "order_number", label: "Purchase order" },
      { key: "bill_date", label: "Bill date" },
      { key: "due_date", label: "Due" },
      { key: "payment_status", label: "Payment" },
      { key: "total", label: "Total" },
      { key: "balance_due", label: "Balance due" },
    ],
    filterFields: [
      { key: "number", label: "Number", type: "text", operators: TEXT_OPERATORS },
      { key: "vendor_invoice_number", label: "Vendor invoice", type: "text", operators: TEXT_OPERATORS },
      { key: "status", label: "Status", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "draft", label: "Draft" }, { value: "posted", label: "Posted" }, { value: "void", label: "Void" },
      ] },
      { key: "payment_status", label: "Payment", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "unpaid", label: "Unpaid" }, { value: "partial", label: "Partially paid" }, { value: "paid", label: "Paid" },
      ] },
      { key: "overdue", label: "Overdue", type: "select", operators: ["is"], options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      { key: "match_status", label: "Matching", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "matched", label: "Matches the PO" }, { value: "variance", label: "Price differs from the PO" },
      ] },
      { key: "vendor_id", label: "Vendor", type: "relation", operators: RELATION_OPERATORS, sourceModuleKey: "sales_organizations", recordType: "organization" },
      { key: "owner_id", label: "Owner", type: "relation", operators: RELATION_OPERATORS, sourceModuleKey: "purchase_bills", recordType: "user" },
      { key: "currency", label: "Currency", type: "text", operators: TEXT_OPERATORS },
      { key: "total", label: "Total", type: "number", operators: NUMBER_OPERATORS },
      { key: "balance_due", label: "Balance due", type: "number", operators: NUMBER_OPERATORS },
      { key: "bill_date", label: "Bill date", type: "date", operators: DATE_OPERATORS },
      { key: "due_date", label: "Due date", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.purchase_bills,
  },
  inventory_deliveries: {
    key: "inventory_deliveries",
    label: "Deliveries",
    route: "/dashboard/inventory/deliveries",
    columns: [
      { key: "number", label: "Number" },
      { key: "status", label: "Status" },
      { key: "order_number", label: "Order" },
      { key: "customer_name", label: "Customer" },
      { key: "warehouse_name", label: "Warehouse" },
      { key: "shipped_on", label: "Shipped on" },
      { key: "carrier", label: "Carrier" },
      { key: "total_quantity", label: "Units" },
    ],
    filterFields: [
      { key: "number", label: "Number", type: "text", operators: TEXT_OPERATORS },
      { key: "status", label: "Status", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "draft", label: "Draft" }, { value: "posted", label: "Posted" }, { value: "cancelled", label: "Cancelled" },
      ] },
      { key: "carrier", label: "Carrier", type: "text", operators: TEXT_OPERATORS },
      { key: "tracking_number", label: "Tracking number", type: "text", operators: TEXT_OPERATORS },
      { key: "shipped_on", label: "Shipped on", type: "date", operators: DATE_OPERATORS },
      { key: "created_at", label: "Created", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.inventory_deliveries,
  },
  inventory_returns: {
    key: "inventory_returns",
    label: "Returns",
    route: "/dashboard/inventory/returns",
    columns: [
      { key: "number", label: "Number" },
      { key: "status", label: "Status" },
      { key: "reason", label: "Reason" },
      { key: "delivery_number", label: "Delivery" },
      { key: "order_number", label: "Order" },
      { key: "customer_name", label: "Customer" },
      { key: "received_at", label: "Received" },
      { key: "total_quantity", label: "Units" },
    ],
    filterFields: [
      { key: "number", label: "Number", type: "text", operators: TEXT_OPERATORS },
      { key: "status", label: "Status", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "draft", label: "Draft" }, { value: "received", label: "Received" }, { value: "cancelled", label: "Cancelled" },
      ] },
      { key: "reason", label: "Reason", type: "text", operators: TEXT_OPERATORS },
      { key: "received_at", label: "Received", type: "date", operators: DATE_OPERATORS },
      { key: "created_at", label: "Created", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.inventory_returns,
  },
  inventory_adjustments: {
    key: "inventory_adjustments",
    label: "Stock adjustments",
    route: "/dashboard/inventory/adjustments",
    columns: [
      { key: "number", label: "Number" },
      { key: "status", label: "Status" },
      { key: "warehouse_name", label: "Warehouse" },
      { key: "reason", label: "Reason" },
      { key: "line_count", label: "Products" },
      { key: "posted_at", label: "Posted" },
      { key: "created_at", label: "Created" },
    ],
    filterFields: [
      { key: "number", label: "Number", type: "text", operators: TEXT_OPERATORS },
      { key: "status", label: "Status", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "draft", label: "Draft" }, { value: "posted", label: "Posted" }, { value: "cancelled", label: "Cancelled" },
      ] },
      { key: "mode", label: "Kind", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "quantity", label: "Quantity change" }, { value: "count", label: "Physical count" },
      ] },
      { key: "reason", label: "Reason", type: "text", operators: TEXT_OPERATORS },
      { key: "posted_at", label: "Posted", type: "date", operators: DATE_OPERATORS },
      { key: "created_at", label: "Created", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.inventory_adjustments,
  },
  inventory_transfers: {
    key: "inventory_transfers",
    label: "Stock transfers",
    route: "/dashboard/inventory/transfers",
    columns: [
      { key: "number", label: "Number" },
      { key: "status", label: "Status" },
      { key: "route", label: "Route" },
      { key: "line_count", label: "Products" },
      { key: "posted_at", label: "Posted" },
      { key: "created_at", label: "Created" },
    ],
    filterFields: [
      { key: "number", label: "Number", type: "text", operators: TEXT_OPERATORS },
      { key: "status", label: "Status", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "draft", label: "Draft" }, { value: "posted", label: "Posted" }, { value: "cancelled", label: "Cancelled" },
      ] },
      { key: "posted_at", label: "Posted", type: "date", operators: DATE_OPERATORS },
      { key: "created_at", label: "Created", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.inventory_transfers,
  },
  finance_credit_notes: {
    key: "finance_credit_notes",
    label: "Credit notes",
    route: "/dashboard/finance/credit-notes",
    columns: [
      { key: "number", label: "Number" },
      { key: "status", label: "Status" },
      { key: "invoice_number", label: "Invoice" },
      { key: "customer_name", label: "Customer" },
      { key: "reason", label: "Reason" },
      { key: "issue_date", label: "Issued" },
      { key: "refund_due", label: "Refund due" },
      { key: "total_amount", label: "Amount" },
    ],
    filterFields: [
      { key: "number", label: "Number", type: "text", operators: TEXT_OPERATORS },
      { key: "status", label: "Status", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "draft", label: "Draft" }, { value: "issued", label: "Issued" }, { value: "void", label: "Void" },
      ] },
      { key: "reason", label: "Reason", type: "text", operators: TEXT_OPERATORS },
      { key: "created_by", label: "Created by", type: "relation", operators: RELATION_OPERATORS, sourceModuleKey: "finance_credit_notes", recordType: "user" },
      { key: "currency", label: "Currency", type: "text", operators: TEXT_OPERATORS },
      { key: "total_amount", label: "Amount", type: "number", operators: NUMBER_OPERATORS },
      { key: "refund_due", label: "Refund due", type: "number", operators: NUMBER_OPERATORS },
      { key: "issue_date", label: "Issued", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.finance_credit_notes,
  },
  purchase_vendor_returns: {
    key: "purchase_vendor_returns",
    label: "Vendor returns",
    route: "/dashboard/purchasing/vendor-returns",
    columns: [
      { key: "number", label: "Number" },
      { key: "status", label: "Status" },
      { key: "resolution", label: "Vendor will" },
      { key: "vendor_name", label: "Vendor" },
      { key: "receipt_number", label: "Receipt" },
      { key: "order_number", label: "Purchase order" },
      { key: "reason", label: "Reason" },
      { key: "shipped_at", label: "Shipped" },
      { key: "total_quantity", label: "Units" },
    ],
    filterFields: [
      { key: "number", label: "Number", type: "text", operators: TEXT_OPERATORS },
      { key: "status", label: "Status", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "draft", label: "Draft" }, { value: "shipped", label: "Shipped" }, { value: "cancelled", label: "Cancelled" },
      ] },
      { key: "resolution", label: "Vendor will", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "credit", label: "Credit" }, { value: "replace", label: "Replace" },
      ] },
      { key: "awaiting_credit", label: "Awaiting credit", type: "select", operators: ["is"], options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      { key: "vendor_id", label: "Vendor", type: "relation", operators: RELATION_OPERATORS, sourceModuleKey: "sales_organizations", recordType: "organization" },
      { key: "owner_id", label: "Owner", type: "relation", operators: RELATION_OPERATORS, sourceModuleKey: "purchase_vendor_returns", recordType: "user" },
      { key: "reason", label: "Reason", type: "text", operators: TEXT_OPERATORS },
      { key: "shipped_at", label: "Shipped", type: "date", operators: DATE_OPERATORS },
      { key: "created_at", label: "Created", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.purchase_vendor_returns,
  },
  purchase_vendor_credits: {
    key: "purchase_vendor_credits",
    label: "Vendor credits",
    route: "/dashboard/purchasing/vendor-credits",
    columns: [
      { key: "number", label: "Number" },
      { key: "status", label: "Status" },
      { key: "vendor_name", label: "Vendor" },
      { key: "vendor_reference", label: "Vendor's credit note" },
      { key: "bill_number", label: "Bill" },
      { key: "vendor_return_number", label: "Vendor return" },
      { key: "credit_date", label: "Credit date" },
      { key: "total", label: "Total" },
      { key: "credit_remaining", label: "Credit left" },
    ],
    filterFields: [
      { key: "number", label: "Number", type: "text", operators: TEXT_OPERATORS },
      { key: "status", label: "Status", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "draft", label: "Draft" }, { value: "issued", label: "Issued" }, { value: "void", label: "Void" },
      ] },
      { key: "open_credit", label: "Credit left", type: "select", operators: ["is"], options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      { key: "vendor_id", label: "Vendor", type: "relation", operators: RELATION_OPERATORS, sourceModuleKey: "sales_organizations", recordType: "organization" },
      { key: "owner_id", label: "Owner", type: "relation", operators: RELATION_OPERATORS, sourceModuleKey: "purchase_vendor_credits", recordType: "user" },
      { key: "vendor_reference", label: "Vendor's credit note", type: "text", operators: TEXT_OPERATORS },
      { key: "reason", label: "Reason", type: "text", operators: TEXT_OPERATORS },
      { key: "currency", label: "Currency", type: "text", operators: TEXT_OPERATORS },
      { key: "total", label: "Total", type: "number", operators: NUMBER_OPERATORS },
      { key: "credit_remaining", label: "Credit left", type: "number", operators: NUMBER_OPERATORS },
      { key: "credit_date", label: "Credit date", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.purchase_vendor_credits,
  },
  finance_payments: {
    key: "finance_payments",
    label: "Payments",
    route: "/dashboard/finance/payments",
    columns: [
      { key: "number", label: "Number" },
      { key: "paid_on", label: "Paid on" },
      { key: "party_name", label: "Customer or vendor" },
      { key: "documents", label: "For" },
      { key: "kind", label: "Kind" },
      { key: "method", label: "Method" },
      { key: "reference", label: "Reference" },
      { key: "status", label: "Status" },
      { key: "amount", label: "Amount" },
    ],
    filterFields: [
      { key: "number", label: "Number", type: "text", operators: TEXT_OPERATORS },
      { key: "direction", label: "Direction", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "received", label: "Received" }, { value: "made", label: "Made" },
      ] },
      { key: "kind", label: "Kind", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "payment", label: "Payment" }, { value: "refund", label: "Refund" },
      ] },
      { key: "status", label: "Status", type: "select", operators: SELECT_OPERATORS, options: [
        { value: "posted", label: "Posted" }, { value: "void", label: "Void" },
      ] },
      { key: "party_name", label: "Customer or vendor", type: "text", operators: TEXT_OPERATORS },
      { key: "method", label: "Method", type: "select", operators: SELECT_OPERATORS, picklistKey: "payment_method" },
      { key: "reference", label: "Reference", type: "text", operators: TEXT_OPERATORS },
      { key: "created_by", label: "Recorded by", type: "relation", operators: RELATION_OPERATORS, sourceModuleKey: "finance_payments", recordType: "user" },
      { key: "currency", label: "Currency", type: "text", operators: TEXT_OPERATORS },
      { key: "amount", label: "Amount", type: "number", operators: NUMBER_OPERATORS },
      { key: "paid_on", label: "Paid on", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.finance_payments,
  },
  catalog_products: {
    key: "catalog_products",
    label: "Products",
    route: "/dashboard/catalog/products",
    columns: CATALOG_PRODUCT_COLUMNS,
    filterFields: [
      { key: "name", label: "Name", type: "text", operators: TEXT_OPERATORS },
      { key: "slug", label: "Slug", type: "text", operators: TEXT_OPERATORS },
      { key: "sku", label: "SKU", type: "text", operators: TEXT_OPERATORS },
      { key: "barcode", label: "Barcode", type: "text", operators: TEXT_OPERATORS },
      { key: "category_name", label: "Category", type: "text", operators: TEXT_OPERATORS },
      { key: "unit", label: "Unit", type: "select", operators: SELECT_OPERATORS, picklistKey: "unit" },
      { key: "currency", label: "Currency", type: "text", operators: TEXT_OPERATORS },
      { key: "public_unit_price", label: "Price", type: "number", operators: NUMBER_OPERATORS },
      { key: "cost_price", label: "Cost", type: "number", operators: NUMBER_OPERATORS },
      {
        key: "stock_status",
        label: "Stock status",
        type: "select",
        operators: SELECT_OPERATORS,
        options: [
          { value: "untracked", label: "Untracked" },
          { value: "in_stock", label: "In stock" },
          { value: "out_of_stock", label: "Out of stock" },
          { value: "preorder", label: "Preorder" },
        ],
      },
      { key: "stock_quantity", label: "Stock quantity", type: "number", operators: NUMBER_OPERATORS },
      { key: "is_public", label: "Public", type: "select", operators: ["is"], options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      { key: "is_active", label: "Active", type: "select", operators: ["is"], options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      { key: "created_at", label: "Created", type: "date", operators: DATE_OPERATORS },
      { key: "updated_at", label: "Updated", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.catalog_products,
  },
  catalog_services: {
    key: "catalog_services",
    label: "Services",
    route: "/dashboard/catalog/services",
    columns: CATALOG_SERVICE_COLUMNS,
    filterFields: [
      { key: "name", label: "Name", type: "text", operators: TEXT_OPERATORS },
      { key: "slug", label: "Slug", type: "text", operators: TEXT_OPERATORS },
      { key: "sku", label: "SKU", type: "text", operators: TEXT_OPERATORS },
      { key: "category_name", label: "Category", type: "text", operators: TEXT_OPERATORS },
      { key: "unit", label: "Unit", type: "select", operators: SELECT_OPERATORS, picklistKey: "unit" },
      { key: "currency", label: "Currency", type: "text", operators: TEXT_OPERATORS },
      { key: "public_unit_price", label: "Price", type: "number", operators: NUMBER_OPERATORS },
      { key: "cost_price", label: "Cost", type: "number", operators: NUMBER_OPERATORS },
      { key: "is_public", label: "Public", type: "select", operators: ["is"], options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      { key: "is_active", label: "Active", type: "select", operators: ["is"], options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      { key: "created_at", label: "Created", type: "date", operators: DATE_OPERATORS },
      { key: "updated_at", label: "Updated", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.catalog_services,
  },
  admin_users: {
    key: "admin_users",
    label: "User management",
    route: SETTINGS_ROUTES.users,
    columns: USER_COLUMNS,
    filterFields: [
      { key: "first_name", label: "First name", type: "text", operators: TEXT_OPERATORS },
      { key: "last_name", label: "Last name", type: "text", operators: TEXT_OPERATORS },
      { key: "email", label: "Email", type: "text", operators: TEXT_OPERATORS },
      { key: "team_name", label: "Team", type: "text", operators: TEXT_OPERATORS },
      { key: "role_name", label: "Role", type: "text", operators: TEXT_OPERATORS },
      {
        key: "auth_mode",
        label: "Sign-in mode",
        type: "select",
        operators: SELECT_OPERATORS,
        options: [
          { value: "manual_only", label: "Manual only" },
          { value: "manual_or_google", label: "Manual + SSO" },
        ],
      },
      {
        key: "is_active",
        label: "Status",
        type: "select",
        operators: SELECT_OPERATORS,
        options: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
      },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.admin_users,
  },
};

function isFieldEnabled(fieldKey: string, fieldConfigs: ModuleFieldConfig[] = []) {
  if (isProtectedFieldKey(fieldKey)) return true;
  const config = fieldConfigs.find((item) => item.field_key === fieldKey);
  return config ? config.is_enabled : true;
}

function applyFieldConfigs(definition: ModuleViewDefinition, fieldConfigs: ModuleFieldConfig[] = []): ModuleViewDefinition {
  if (!fieldConfigs.length) {
    return definition;
  }
  const columns = definition.columns.filter((column) => isFieldEnabled(column.key, fieldConfigs));
  const filterFields = definition.filterFields.filter((field) => isFieldEnabled(field.key, fieldConfigs));
  const visibleColumns = definition.defaultConfig.visible_columns.filter((column) => isFieldEnabled(column, fieldConfigs));

  return {
    ...definition,
    columns,
    filterFields,
    defaultConfig: {
      ...definition.defaultConfig,
      visible_columns: visibleColumns.length ? visibleColumns : columns.slice(0, 1).map((column) => column.key),
    },
  };
}

export function getModuleViewDefinition(moduleKey: string): ModuleViewDefinition | null {
  return MODULE_VIEW_DEFINITIONS[moduleKey] ?? null;
}

export function isCustomFieldColumnKey(columnKey: string) {
  return columnKey.startsWith(CUSTOM_FIELD_COLUMN_PREFIX);
}

export function getCustomFieldColumnKey(fieldKey: string) {
  return `${CUSTOM_FIELD_COLUMN_PREFIX}${fieldKey}`;
}

export function getCustomFieldKeyFromColumn(columnKey: string) {
  return isCustomFieldColumnKey(columnKey)
    ? columnKey.slice(CUSTOM_FIELD_COLUMN_PREFIX.length)
    : columnKey;
}

export function getReadableColumnLabel(columnKey: string, columnOptions: TableColumnOption[] = []) {
  const explicit = columnOptions.find((option) => option.key === columnKey);
  if (explicit) {
    return explicit.label;
  }

  return formatSnakeCaseLabel(getCustomFieldKeyFromColumn(columnKey));
}

export function resolveVisibleColumns(
  definition: ModuleViewDefinition | null,
  draftConfig: SavedViewConfig,
  defaultConfig: SavedViewConfig,
) {
  const allowedKeys = new Set((definition?.columns ?? []).map((column) => column.key));
  const draftColumns = (draftConfig.visible_columns ?? []).filter((column) => allowedKeys.has(column));
  if (draftColumns.length) {
    return draftColumns;
  }
  return defaultConfig.visible_columns.filter((column) => allowedKeys.has(column));
}

export function resolveSavedViewFilters(
  definition: ModuleViewDefinition | null,
  filters: SavedViewConfig["filters"],
): SavedViewConfig["filters"] {
  const allowedFields = new Set((definition?.filterFields ?? []).map((field) => field.key));
  const filterConditions = (conditions: unknown): SavedViewCondition[] => {
    if (!Array.isArray(conditions)) return [];
    return conditions.filter((condition): condition is SavedViewCondition => {
      if (!condition || typeof condition !== "object") return false;
      const field = (condition as { field?: unknown }).field;
      return typeof field === "string" && allowedFields.has(field);
    });
  };

  return {
    ...filters,
    conditions: filterConditions(filters?.conditions),
    all_conditions: filterConditions(filters?.all_conditions),
    any_conditions: filterConditions(filters?.any_conditions),
  };
}

export function buildModuleViewDefinition(
  moduleKey: string,
  customFields: CustomFieldDefinition[] = [],
  fieldConfigs: ModuleFieldConfig[] = [],
): ModuleViewDefinition | null {
  const baseDefinition = getModuleViewDefinition(moduleKey);
  if (!baseDefinition) {
    return null;
  }

  if (!CUSTOM_FIELD_SUPPORTED_MODULES.has(moduleKey) || !customFields.length) {
    return applyFieldConfigs(baseDefinition, fieldConfigs);
  }

  const customColumns: TableColumnOption[] = customFields
    .filter((field) => field.is_active)
    .sort((left, right) => left.sort_order - right.sort_order || left.id - right.id)
    .map((field) => ({
      key: getCustomFieldColumnKey(field.field_key),
      label: field.label,
    }));

  const customFilterFields: ModuleFilterField[] = customFields
    .filter((field) => field.is_active)
    .sort((left, right) => left.sort_order - right.sort_order || left.id - right.id)
    .map((field) => withOperators(filterFieldFor(field, getCustomFieldColumnKey(field.field_key)), baseDefinition.key))
    .filter((field): field is ModuleFilterField => field !== null);

  return {
    ...applyFieldConfigs(
      {
        ...baseDefinition,
        columns: [...baseDefinition.columns, ...customColumns],
        filterFields: [...baseDefinition.filterFields, ...customFilterFields],
      },
      fieldConfigs,
    ),
  };
}

/** Operators for a field-system filter, by the filter type `filterFieldFor` chose (13b §3.4). */
function withOperators(field: ModuleFilterField | null, sourceModuleKey: string): ModuleFilterField | null {
  if (!field) return null;
  const operators: Record<ModuleFilterFieldType, SavedViewFilterOperator[]> = {
    text: TEXT_OPERATORS,
    number: NUMBER_OPERATORS,
    date: DATE_OPERATORS,
    select: SELECT_OPERATORS,
    relation: RELATION_OPERATORS,
  };
  return {
    ...field,
    operators: field.operators ?? operators[field.type],
    ...(field.type === "relation" ? { sourceModuleKey } : {}),
  };
}

export function buildCustomModuleViewDefinition(module: CustomModuleDefinition, fieldConfigs: ModuleFieldConfig[] = []): ModuleViewDefinition {
  const activeFields = module.fields
    .filter((field) => field.is_active)
    .sort((left, right) => left.sort_order - right.sort_order || left.id - right.id);
  const columns: TableColumnOption[] = [
    { key: "title", label: "Title" },
    ...activeFields.map((field) => ({ key: field.key, label: field.label })),
    { key: "created_at", label: "Created" },
    { key: "updated_at", label: "Updated" },
  ];
  const defaultColumns = [
    "title",
    ...activeFields.filter((field) => field.display_in_list).slice(0, 8).map((field) => field.key),
  ];

  return applyFieldConfigs({
    key: module.key,
    label: getModuleDisplayName(module.key, module.description ?? module.name),
    route: `/dashboard/custom/${module.key}`,
    columns,
    filterFields: [
      { key: "title", label: "Title", type: "text", operators: TEXT_OPERATORS },
      { key: "created_at", label: "Created", type: "date", operators: DATE_OPERATORS },
      { key: "updated_at", label: "Updated", type: "date", operators: DATE_OPERATORS },
      ...activeFields
        .map((field) => withOperators(filterFieldFor({ ...field, field_key: field.key }, field.key), module.key))
        .filter((field): field is ModuleFilterField => field !== null),
    ],
    defaultConfig: {
      visible_columns: defaultColumns.length ? defaultColumns : ["title"],
      filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
      sort: null,
    },
  }, fieldConfigs);
}
