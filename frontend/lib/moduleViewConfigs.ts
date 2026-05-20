import type {
  SavedViewCondition,
  SavedViewConfig,
  SavedViewFilterOperator,
} from "@/hooks/useSavedViews";
import type { TableColumnOption } from "@/hooks/useTablePreferences";
import type { ModuleFieldConfig } from "@/hooks/useModuleFieldConfigs";
import { isProtectedFieldKey } from "@/hooks/useModuleFieldConfigs";
import type { CustomFieldDefinition } from "@/hooks/useModuleCustomFields";
import type { CustomModuleDefinition, CustomModuleField } from "@/hooks/useModuleBuilder";
import { getModuleDisplayName } from "@/lib/module-display";
import { SETTINGS_ROUTES } from "@/lib/routes";

export type ModuleFilterFieldType = "text" | "number" | "date" | "select";

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
};

export type ModuleViewDefinition = {
  key: string;
  label: string;
  route: string;
  columns: TableColumnOption[];
  filterFields: ModuleFilterField[];
  defaultConfig: SavedViewConfig;
};

export const CUSTOM_FIELD_COLUMN_PREFIX = "custom:";
export const CUSTOM_FIELD_SUPPORTED_MODULES = new Set([
  "sales_contacts",
  "sales_organizations",
  "sales_opportunities",
  "finance_io",
]);

const TEXT_OPERATORS: SavedViewFilterOperator[] = ["is", "is_not", "contains", "not_contains", "in", "not_in", "is_empty", "is_not_empty"];
const NUMBER_OPERATORS: SavedViewFilterOperator[] = ["is", "is_not", "gt", "gte", "lt", "lte", "in", "not_in", "is_empty", "is_not_empty"];
const DATE_OPERATORS: SavedViewFilterOperator[] = ["is", "is_not", "gt", "gte", "lt", "lte", "in", "not_in", "is_empty", "is_not_empty"];
const SELECT_OPERATORS: SavedViewFilterOperator[] = ["is", "is_not", "in", "not_in", "is_empty", "is_not_empty"];

export const CONTACT_COLUMNS: TableColumnOption[] = [
  { key: "first_name", label: "First Name" },
  { key: "last_name", label: "Last Name" },
  { key: "primary_email", label: "Email" },
  { key: "contact_telephone", label: "Phone" },
  { key: "current_title", label: "Job Title" },
  { key: "organization_name", label: "Account" },
  { key: "region", label: "Region" },
  { key: "country", label: "Country" },
  { key: "linkedin_url", label: "LinkedIn" },
];

export const ORGANIZATION_COLUMNS: TableColumnOption[] = [
  { key: "org_name", label: "Account" },
  { key: "primary_email", label: "Email" },
  { key: "website", label: "Website" },
  { key: "industry", label: "Industry" },
  { key: "annual_revenue", label: "Revenue" },
  { key: "primary_phone", label: "Phone" },
  { key: "billing_country", label: "Country" },
];

export const OPPORTUNITY_COLUMNS: TableColumnOption[] = [
  { key: "opportunity_name", label: "Deal" },
  { key: "client", label: "Client" },
  { key: "sales_stage", label: "Stage" },
  { key: "expected_close_date", label: "Expected Close" },
  { key: "total_cost_of_project", label: "Project Cost" },
  { key: "currency_type", label: "Currency" },
  { key: "created_time", label: "Created" },
];

export const INSERTION_ORDER_COLUMNS: TableColumnOption[] = [
  { key: "io_number", label: "IO Number" },
  { key: "customer_name", label: "Customer" },
  { key: "status", label: "Status" },
  { key: "currency", label: "Currency" },
  { key: "total_amount", label: "Total" },
  { key: "issue_date", label: "Issue Date" },
  { key: "due_date", label: "Due Date" },
  { key: "external_reference", label: "Reference" },
  { key: "user_name", label: "Owner" },
  { key: "updated_at", label: "Updated" },
];

export const CATALOG_PRODUCT_COLUMNS: TableColumnOption[] = [
  { key: "name", label: "Name" },
  { key: "slug", label: "Slug" },
  { key: "sku", label: "SKU" },
  { key: "public_unit_price", label: "Price" },
  { key: "stock_status", label: "Stock" },
  { key: "is_public", label: "Feed" },
  { key: "is_active", label: "Status" },
  { key: "media_url", label: "Media" },
  { key: "updated_at", label: "Updated" },
];

export const CATALOG_SERVICE_COLUMNS: TableColumnOption[] = [
  { key: "name", label: "Name" },
  { key: "slug", label: "Slug" },
  { key: "public_unit_price", label: "Price" },
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
  { key: "auth_mode", label: "Sign-in Mode" },
  { key: "is_active", label: "Status" },
];

export const MODULE_VIEW_DEFAULTS: Record<string, SavedViewConfig> = {
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
  sales_contacts: {
    visible_columns: ["first_name", "last_name", "primary_email", "contact_telephone", "organization_name", "linkedin_url"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
    sort: null,
  },
  sales_organizations: {
    visible_columns: ["org_name", "primary_email", "website", "industry"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
    sort: null,
  },
  sales_opportunities: {
    visible_columns: ["opportunity_name", "client", "sales_stage", "expected_close_date", "total_cost_of_project"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
    sort: null,
  },
  finance_io: {
    visible_columns: ["io_number", "customer_name", "status", "total_amount", "due_date"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [], status: "all" },
    sort: null,
  },
  catalog_products: {
    visible_columns: ["name", "slug", "sku", "public_unit_price", "stock_status", "is_public", "is_active", "media_url", "updated_at"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
    sort: null,
  },
  catalog_services: {
    visible_columns: ["name", "slug", "public_unit_price", "is_public", "is_active", "media_url", "updated_at"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
    sort: null,
  },
  admin_users: {
    visible_columns: ["name", "team_name", "role_name", "email", "is_active"],
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
  tasks: {
    key: "tasks",
    label: "Tasks",
    route: "/dashboard/tasks",
    columns: [
      { key: "title", label: "Title" },
      { key: "priority", label: "Priority" },
      { key: "status", label: "Status" },
      { key: "assigned_by_name", label: "Assigned By" },
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
          { value: "todo", label: "To Do" },
          { value: "in_progress", label: "In Progress" },
          { value: "blocked", label: "Blocked" },
          { value: "completed", label: "Completed" },
        ],
      },
      { key: "due_at", label: "Due Date", type: "date", operators: DATE_OPERATORS },
      { key: "start_at", label: "Start Date", type: "date", operators: DATE_OPERATORS },
      { key: "assigned_at", label: "Assigned At", type: "date", operators: DATE_OPERATORS },
      { key: "created_at", label: "Created At", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.tasks,
  },
  sales_contacts: {
    key: "sales_contacts",
    label: "Contacts",
    route: "/dashboard/sales/contacts",
    columns: CONTACT_COLUMNS,
    filterFields: [
      { key: "first_name", label: "First Name", type: "text", operators: TEXT_OPERATORS },
      { key: "last_name", label: "Last Name", type: "text", operators: TEXT_OPERATORS },
      { key: "primary_email", label: "Email", type: "text", operators: TEXT_OPERATORS },
      { key: "contact_telephone", label: "Phone", type: "text", operators: TEXT_OPERATORS },
      { key: "current_title", label: "Job Title", type: "text", operators: TEXT_OPERATORS },
      { key: "organization_name", label: "Account", type: "text", operators: TEXT_OPERATORS },
      { key: "region", label: "Region", type: "text", operators: TEXT_OPERATORS },
      { key: "country", label: "Country", type: "text", operators: TEXT_OPERATORS },
      { key: "linkedin_url", label: "LinkedIn", type: "text", operators: TEXT_OPERATORS },
      { key: "created_time", label: "Created Time", type: "date", operators: DATE_OPERATORS },
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
      { key: "industry", label: "Industry", type: "text", operators: TEXT_OPERATORS },
      { key: "annual_revenue", label: "Revenue", type: "number", operators: NUMBER_OPERATORS },
      { key: "primary_phone", label: "Phone", type: "text", operators: TEXT_OPERATORS },
      { key: "billing_country", label: "Country", type: "text", operators: TEXT_OPERATORS },
      { key: "created_time", label: "Created Time", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.sales_organizations,
  },
  sales_opportunities: {
    key: "sales_opportunities",
    label: "Deals",
    route: "/dashboard/sales/opportunities",
    columns: OPPORTUNITY_COLUMNS,
    filterFields: [
      { key: "opportunity_name", label: "Deal", type: "text", operators: TEXT_OPERATORS },
      { key: "client", label: "Client", type: "text", operators: TEXT_OPERATORS },
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
          { value: "closed_won", label: "Closed Won" },
          { value: "closed_lost", label: "Closed Lost" },
        ],
      },
      { key: "expected_close_date", label: "Expected Close", type: "date", operators: DATE_OPERATORS },
      { key: "total_cost_of_project", label: "Project Cost", type: "number", operators: NUMBER_OPERATORS },
      { key: "currency_type", label: "Currency", type: "text", operators: TEXT_OPERATORS },
      { key: "target_geography", label: "Target Geography", type: "text", operators: TEXT_OPERATORS },
      { key: "created_time", label: "Created Time", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.sales_opportunities,
  },
  finance_io: {
    key: "finance_io",
    label: "Insertion Orders",
    route: "/dashboard/finance/insertion-orders",
    columns: INSERTION_ORDER_COLUMNS,
    filterFields: [
      { key: "io_number", label: "IO Number", type: "text", operators: TEXT_OPERATORS },
      { key: "customer_name", label: "Customer", type: "text", operators: TEXT_OPERATORS },
      {
        key: "status",
        label: "Status",
        type: "select",
        operators: SELECT_OPERATORS,
        options: [
          { value: "draft", label: "Draft" },
          { value: "issued", label: "Issued" },
          { value: "active", label: "Active" },
          { value: "completed", label: "Completed" },
          { value: "cancelled", label: "Cancelled" },
          { value: "imported", label: "Imported" },
        ],
      },
      { key: "currency", label: "Currency", type: "text", operators: TEXT_OPERATORS },
      { key: "total_amount", label: "Total", type: "number", operators: NUMBER_OPERATORS },
      { key: "issue_date", label: "Issue Date", type: "date", operators: DATE_OPERATORS },
      { key: "due_date", label: "Due Date", type: "date", operators: DATE_OPERATORS },
      { key: "external_reference", label: "Reference", type: "text", operators: TEXT_OPERATORS },
      { key: "counterparty_reference", label: "Counterparty Ref", type: "text", operators: TEXT_OPERATORS },
      { key: "updated_at", label: "Updated", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.finance_io,
  },
  catalog_products: {
    key: "catalog_products",
    label: "Products",
    route: "/dashboard/catalog/products",
    columns: CATALOG_PRODUCT_COLUMNS,
    filterFields: [],
    defaultConfig: MODULE_VIEW_DEFAULTS.catalog_products,
  },
  catalog_services: {
    key: "catalog_services",
    label: "Services",
    route: "/dashboard/catalog/services",
    columns: CATALOG_SERVICE_COLUMNS,
    filterFields: [],
    defaultConfig: MODULE_VIEW_DEFAULTS.catalog_services,
  },
  admin_users: {
    key: "admin_users",
    label: "User Management",
    route: SETTINGS_ROUTES.users,
    columns: USER_COLUMNS,
    filterFields: [
      { key: "first_name", label: "First Name", type: "text", operators: TEXT_OPERATORS },
      { key: "last_name", label: "Last Name", type: "text", operators: TEXT_OPERATORS },
      { key: "email", label: "Email", type: "text", operators: TEXT_OPERATORS },
      { key: "team_name", label: "Team", type: "text", operators: TEXT_OPERATORS },
      { key: "role_name", label: "Role", type: "text", operators: TEXT_OPERATORS },
      {
        key: "auth_mode",
        label: "Sign-in Mode",
        type: "select",
        operators: SELECT_OPERATORS,
        options: [
          { value: "manual_only", label: "Manual only" },
          { value: "manual_or_google", label: "Manual + Google" },
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

  const rawKey = getCustomFieldKeyFromColumn(columnKey);
  return rawKey
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
    .map((field) => ({
      key: getCustomFieldColumnKey(field.field_key),
      label: field.label,
      type:
        field.field_type === "number"
          ? "number"
          : field.field_type === "date"
            ? "date"
            : field.field_type === "boolean"
              ? "select"
              : "text",
      operators:
        field.field_type === "number"
          ? NUMBER_OPERATORS
          : field.field_type === "date"
            ? DATE_OPERATORS
            : field.field_type === "boolean"
              ? SELECT_OPERATORS
              : TEXT_OPERATORS,
      options:
        field.field_type === "boolean"
          ? [
              { value: "true", label: "True" },
              { value: "false", label: "False" },
            ]
          : undefined,
    }));

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

function customModuleFieldType(field: CustomModuleField): ModuleFilterFieldType {
  if (field.field_type === "number" || field.field_type === "currency") return "number";
  if (field.field_type === "date" || field.field_type === "datetime") return "date";
  if (field.field_type === "boolean" || field.field_type === "single_select" || field.field_type === "multi_select") return "select";
  return "text";
}

function customModuleOperators(field: CustomModuleField): SavedViewFilterOperator[] {
  const type = customModuleFieldType(field);
  if (type === "number") return NUMBER_OPERATORS;
  if (type === "date") return DATE_OPERATORS;
  if (type === "select") return SELECT_OPERATORS;
  return TEXT_OPERATORS;
}

export function buildCustomModuleViewDefinition(module: CustomModuleDefinition, fieldConfigs: ModuleFieldConfig[] = []): ModuleViewDefinition {
  const activeFields = module.fields
    .filter((field) => field.is_active)
    .sort((left, right) => left.sort_order - right.sort_order || left.id - right.id);
  const columns: TableColumnOption[] = [
    { key: "title", label: "Title" },
    ...activeFields.map((field) => ({ key: field.key, label: field.label })),
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
      ...activeFields.map((field) => ({
        key: field.key,
        label: field.label,
        type: customModuleFieldType(field),
        operators: customModuleOperators(field),
        options:
          field.field_type === "boolean"
            ? [
                { value: "true", label: "True" },
                { value: "false", label: "False" },
              ]
            : (field.validation_json?.options ?? []).map((option) => ({ value: option, label: option })),
      })),
    ],
    defaultConfig: {
      visible_columns: defaultColumns.length ? defaultColumns : ["title"],
      filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
      sort: null,
    },
  }, fieldConfigs);
}
