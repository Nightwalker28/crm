// frontend/lib/moduleViewConfigs.ts
export const __MODULE_CONST___COLUMNS: TableColumnOption[] = [
  { key: "name", label: "Name" },
  { key: "status", label: "Status" },
  { key: "description", label: "Description" },
  { key: "created_time", label: "Created" },
];

export const CUSTOM_FIELD_SUPPORTED_MODULES = new Set([
  // ...
  "__MODULE_KEY__",
]);

export const MODULE_VIEW_DEFAULTS: Record<string, SavedViewConfig> = {
  // ...
  __MODULE_KEY__: {
    visible_columns: ["name", "status", "description", "created_time"],
    filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] },
    sort: null,
  },
};

export const MODULE_VIEW_DEFINITIONS: Record<string, ModuleViewDefinition> = {
  // ...
  __MODULE_KEY__: {
    key: "__MODULE_KEY__",
    label: "__display_name__",
    route: "__route_prefix__",
    columns: __MODULE_CONST___COLUMNS,
    filterFields: [
      { key: "name", label: "Name", type: "text", operators: TEXT_OPERATORS },
      { key: "status", label: "Status", type: "text", operators: TEXT_OPERATORS },
      { key: "description", label: "Description", type: "text", operators: TEXT_OPERATORS },
      { key: "created_time", label: "Created Time", type: "date", operators: DATE_OPERATORS },
    ],
    defaultConfig: MODULE_VIEW_DEFAULTS.__MODULE_KEY__,
  },
};
