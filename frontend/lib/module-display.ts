import { getModuleRegistryLabel } from "@/lib/module-registry";

/**
 * The one function allowed to build a label from a key (design.md §3.5, §3.6) — an enum value,
 * a field key, an event type. Sentence case: `closed_won` is "Closed won", `lead.created` is
 * "Lead created". Only the first letter is raised, so an acronym already in the key survives.
 */
export function formatSnakeCaseLabel(value: string): string {
  const words = value
    .replace(/^custom_\d+_/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
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
