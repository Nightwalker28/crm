import { getModuleDefinition, getModuleRegistryLabel, type ModuleGroupKey } from "@/lib/module-registry";

export type ModuleCategory =
  | "Workspace"
  | "Sales"
  | "Products & Services"
  | "Finance"
  | "Reports"
  | "Support"
  | "Platform"
  | "Other";

const GROUP_CATEGORIES: Record<ModuleGroupKey, ModuleCategory> = {
  workspace: "Workspace",
  sales: "Sales",
  catalog: "Products & Services",
  support: "Support",
  finance: "Finance",
  reports: "Reports",
  settings: "Platform",
  other: "Other",
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
  const mappedName = getModuleRegistryLabel(moduleName);
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

  const definition = getModuleDefinition(moduleName);
  return definition ? GROUP_CATEGORIES[definition.group] : "Other";
}
