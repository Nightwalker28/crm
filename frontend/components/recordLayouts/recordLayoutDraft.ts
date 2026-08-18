import type {
  RecordLayoutDefinition,
  RecordLayoutFieldDefinition,
  RecordLayoutSectionDefinition,
} from "@/hooks/useRecordLayoutAdmin";
import type { RecordLayoutRegion, RecordLayoutWidth } from "@/lib/contracts/recordLayouts";

/**
 * Pure draft edits for the layout builder.
 *
 * Every operation returns a new definition with dense 0..n-1 positions — the same
 * normalisation the backend applies before storing — so the draft the builder previews is
 * byte-identical to the draft it publishes, and dirty checking is a plain value compare.
 */

function renumber(definition: RecordLayoutDefinition): RecordLayoutDefinition {
  return {
    ...definition,
    sections: definition.sections
      .slice()
      .sort((left, right) => left.position - right.position)
      .map((section, sectionIndex) => ({
        ...section,
        position: sectionIndex,
        fields: section.fields
          .slice()
          .sort((left, right) => left.position - right.position)
          .map((field, fieldIndex) => ({ ...field, position: fieldIndex })),
      })),
  };
}

export function normalizeDefinition(definition: RecordLayoutDefinition): RecordLayoutDefinition {
  return renumber(definition);
}

export function definitionsEqual(left: RecordLayoutDefinition, right: RecordLayoutDefinition): boolean {
  return JSON.stringify(renumber(left)) === JSON.stringify(renumber(right));
}

export function placedFieldKeys(definition: RecordLayoutDefinition): Set<string> {
  return new Set(definition.sections.flatMap((section) => section.fields.map((field) => field.field_key)));
}

function mapSections(
  definition: RecordLayoutDefinition,
  update: (section: RecordLayoutSectionDefinition) => RecordLayoutSectionDefinition,
): RecordLayoutDefinition {
  return renumber({ ...definition, sections: definition.sections.map(update) });
}

function mapField(
  definition: RecordLayoutDefinition,
  fieldKey: string,
  update: (field: RecordLayoutFieldDefinition) => RecordLayoutFieldDefinition,
): RecordLayoutDefinition {
  return mapSections(definition, (section) => ({
    ...section,
    fields: section.fields.map((field) => (field.field_key === fieldKey ? update(field) : field)),
  }));
}

/**
 * Swaps an item with its neighbour and restamps `position` from the new index. The restamp
 * is the point: `renumber` sorts by `position`, so returning a reordered array with stale
 * positions would put everything straight back where it was.
 */
function moveWithin<T extends { position: number }>(items: T[], index: number, direction: "up" | "down"): T[] {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = items.slice();
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next.map((item, itemIndex) => ({ ...item, position: itemIndex }));
}

export function moveField(
  definition: RecordLayoutDefinition,
  sectionId: string,
  fieldKey: string,
  direction: "up" | "down",
): RecordLayoutDefinition {
  return mapSections(definition, (section) => {
    if (section.id !== sectionId) return section;
    const ordered = section.fields.slice().sort((left, right) => left.position - right.position);
    const index = ordered.findIndex((field) => field.field_key === fieldKey);
    return { ...section, fields: moveWithin(ordered, index, direction) };
  });
}

/** Moves a field to the end of another section — the non-drag equivalent of dropping it there. */
export function moveFieldToSection(
  definition: RecordLayoutDefinition,
  fieldKey: string,
  targetSectionId: string,
): RecordLayoutDefinition {
  const field = definition.sections
    .flatMap((section) => section.fields)
    .find((candidate) => candidate.field_key === fieldKey);
  if (!field) return definition;

  return mapSections(definition, (section) => {
    if (section.id === targetSectionId) {
      if (section.fields.some((candidate) => candidate.field_key === fieldKey)) return section;
      return { ...section, fields: [...section.fields, { ...field, position: section.fields.length }] };
    }
    return { ...section, fields: section.fields.filter((candidate) => candidate.field_key !== fieldKey) };
  });
}

export function addFieldToSection(
  definition: RecordLayoutDefinition,
  sectionId: string,
  fieldKey: string,
): RecordLayoutDefinition {
  if (placedFieldKeys(definition).has(fieldKey)) return definition;
  return mapSections(definition, (section) =>
    section.id === sectionId
      ? {
          ...section,
          fields: [
            ...section.fields,
            {
              field_key: fieldKey,
              position: section.fields.length,
              width: "full",
              visible: true,
              required_override: null,
              readonly: null,
            },
          ],
        }
      : section,
  );
}

export function removeField(definition: RecordLayoutDefinition, fieldKey: string): RecordLayoutDefinition {
  return mapSections(definition, (section) => ({
    ...section,
    fields: section.fields.filter((field) => field.field_key !== fieldKey),
  }));
}

export function setFieldWidth(
  definition: RecordLayoutDefinition,
  fieldKey: string,
  width: RecordLayoutWidth,
): RecordLayoutDefinition {
  return mapField(definition, fieldKey, (field) => ({ ...field, width }));
}

export function setFieldVisible(
  definition: RecordLayoutDefinition,
  fieldKey: string,
  visible: boolean,
): RecordLayoutDefinition {
  return mapField(definition, fieldKey, (field) => ({ ...field, visible }));
}

/** `null` means "inherit whatever the field itself declares", which is the default. */
export function setFieldRequiredOverride(
  definition: RecordLayoutDefinition,
  fieldKey: string,
  required: boolean,
): RecordLayoutDefinition {
  return mapField(definition, fieldKey, (field) => ({ ...field, required_override: required ? true : null }));
}

export function moveSection(
  definition: RecordLayoutDefinition,
  sectionId: string,
  direction: "up" | "down",
): RecordLayoutDefinition {
  const ordered = definition.sections.slice().sort((left, right) => left.position - right.position);
  const index = ordered.findIndex((section) => section.id === sectionId);
  return renumber({ ...definition, sections: moveWithin(ordered, index, direction) });
}

export function updateSection(
  definition: RecordLayoutDefinition,
  sectionId: string,
  patch: Partial<Pick<RecordLayoutSectionDefinition, "label" | "region" | "collapsed_by_default">>,
): RecordLayoutDefinition {
  return mapSections(definition, (section) => (section.id === sectionId ? { ...section, ...patch } : section));
}

/** Section ids must match `^[a-z][a-z0-9_-]*$` and be unique inside the layout. */
export function sectionIdFromLabel(label: string, existingIds: Iterable<string>): string {
  const taken = new Set(existingIds);
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+/, "").replace(/_+$/g, "");
  const base = slug.slice(0, 90) || "section";
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${taken.size + 1}`;
}

export function addSection(
  definition: RecordLayoutDefinition,
  label: string,
  region: RecordLayoutRegion = "main",
): RecordLayoutDefinition {
  const trimmed = label.trim();
  if (!trimmed) return definition;
  return renumber({
    ...definition,
    sections: [
      ...definition.sections,
      {
        id: sectionIdFromLabel(trimmed, definition.sections.map((section) => section.id)),
        label: trimmed.slice(0, 150),
        position: definition.sections.length,
        region,
        collapsed_by_default: false,
        fields: [],
      },
    ],
  });
}

/** Removing a section removes its fields from the layout; they return to the palette. */
export function removeSection(definition: RecordLayoutDefinition, sectionId: string): RecordLayoutDefinition {
  if (definition.sections.length <= 1) return definition;
  return renumber({ ...definition, sections: definition.sections.filter((section) => section.id !== sectionId) });
}
