import { getModuleRegistryLabel } from "@/lib/module-registry";

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
