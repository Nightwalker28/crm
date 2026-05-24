// frontend/hooks/useModuleFieldConfigs.ts
const MODULE_PROTECTED_FIELD_KEYS: Record<string, Set<string>> = {
  // ...
  __MODULE_KEY__: new Set(["name"]),
};
