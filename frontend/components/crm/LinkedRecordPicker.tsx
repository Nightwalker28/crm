"use client";

import { useId, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/currency";
import { formatSnakeCaseLabel } from "@/lib/module-display";

export type LinkedRecordType = "contact" | "organization" | "opportunity" | "quote" | "order" | "document" | "user" | "team" | "global" | "catalog_item" | "inventory_product" | "vendor";

export type LinkedRecordFilters = {
  contactId?: number | null;
  organizationId?: number | null;
  opportunityId?: number | null;
  quoteId?: number | null;
  /** `catalog_item` only: offer items priced in the document's currency. */
  currency?: string | null;
};

export type LinkedRecordOption = {
  id: number;
  label: string;
  description?: string | null;
  contact_id?: number | null;
  organization_id?: number | null;
  organization_name?: string | null;
  opportunity_id?: number | null;
  quote_id?: number | null;
  module_key?: string;
  module_label?: string;
  entity_id?: string;
  href?: string;
  raw?: unknown;
};

function optionIdentity(recordType: LinkedRecordType, option: LinkedRecordOption) {
  // Both kinds of identity can repeat an id: a product and a service may both be `7`.
  if (recordType === "global" || recordType === "catalog_item") {
    return `${option.module_key ?? "unknown"}-${option.entity_id ?? option.id}`;
  }
  return String(option.id);
}

type Props = {
  /** Ties a visible `FieldLabel htmlFor` to the input. Prefer this. */
  inputId?: string;
  /** Only where no visible label exists (design.md 8): a placeholder is not a name. */
  ariaLabel?: string;
  inputRef?: Ref<HTMLInputElement>;
  recordType: LinkedRecordType;
  valueId: number | null;
  displayValue: string;
  onDisplayValueChange: (value: string) => void;
  onSelect: (option: LinkedRecordOption) => void;
  onClear: () => void;
  placeholder: string;
  disabled?: boolean;
  queryKeyPrefix?: string;
  noResultsText?: string;
  filters?: LinkedRecordFilters;
  linkedModuleKey?: string;
  linkedEntityId?: string | number | null;
  sourceModuleKey?: string;
  sourceAction?: "create" | "edit" | "view";
  allowClear?: boolean;
  allowedModuleKeys?: string[];
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  /** Names the clear button. Defaults to "Clear linked record". */
  clearLabel?: string;
  /** Keys the picker did not use (it uses Enter only to choose an open option). */
  onInputKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** `data-*` attributes for the input, so a grid can find and focus its cells. */
  inputDataAttributes?: Record<`data-${string}`, string | number>;
  /**
   * *Create "…"* as the list's last option (13b Phase 5, F3.7): the caller opens the target's
   * quick create, prefilled with the typed text, and selects the new record when it is saved.
   */
  createOption?: {
    /** The option's text for what was typed, e.g. `Create contact "Ada"`. */
    label: (text: string) => string;
    onCreate: (text: string) => void;
  };
  /**
   * Search with an empty query on focus, so an empty field already lists what the endpoint
   * suggests — the vendor picker's most recent vendors (13c §3.5, H18). Typing narrows it.
   */
  suggestOnFocus?: boolean;
};

function appendRelationshipFilters(params: URLSearchParams, filters?: LinkedRecordFilters) {
  const conditions = [
    filters?.contactId ? { field: "contact_id", operator: "is", value: filters.contactId } : null,
    filters?.organizationId ? { field: "organization_id", operator: "is", value: filters.organizationId } : null,
    filters?.opportunityId ? { field: "opportunity_id", operator: "is", value: filters.opportunityId } : null,
    filters?.quoteId ? { field: "quote_id", operator: "is", value: filters.quoteId } : null,
  ].filter(Boolean);
  if (conditions.length) params.set("filters_all", JSON.stringify(conditions));
}

async function searchLinkedRecords(
  recordType: LinkedRecordType,
  search: string,
  filters?: LinkedRecordFilters,
  linkedModuleKey?: string,
  linkedEntityId?: string | number | null,
  sourceModuleKey?: string,
  sourceAction: "create" | "edit" | "view" = "create",
  allowedModuleKeys?: string[],
): Promise<LinkedRecordOption[]> {
  const params = new URLSearchParams({ page: "1", page_size: "10", query: search });
  appendRelationshipFilters(params, filters);
  let endpoint = "";

  if (recordType === "global") {
    endpoint = `/global-search?query=${encodeURIComponent(search)}&limit_per_module=5`;
  } else if (recordType === "catalog_item") {
    const catalogParams = new URLSearchParams({ query: search, limit: "10" });
    if (filters?.currency) catalogParams.set("currency", filters.currency);
    endpoint = `/catalog/items/search?${catalogParams.toString()}`;
  } else if (recordType === "inventory_product") {
    endpoint = `/inventory/products/search?query=${encodeURIComponent(search)}&limit=10`;
  } else if (recordType === "vendor") {
    endpoint = `/purchasing/vendors/search?query=${encodeURIComponent(search)}&limit=10`;
  } else if (recordType === "contact") {
    endpoint = `/sales/contacts/search?${params.toString()}`;
  } else if (recordType === "organization") {
    endpoint = `/sales/organizations/search/${encodeURIComponent(search)}?page=1&page_size=10`;
  } else if (recordType === "opportunity") {
    endpoint = `/sales/opportunities/search?${params.toString()}`;
  } else if (recordType === "quote") {
    endpoint = `/sales/quotes/search?${params.toString()}`;
  } else if (recordType === "order") {
    endpoint = `/sales/orders/search?${params.toString()}`;
  } else if (recordType === "document") {
    const documentParams = new URLSearchParams({ search, limit: "10" });
    if (linkedModuleKey && linkedEntityId != null) {
      documentParams.set("module_key", linkedModuleKey);
      documentParams.set("entity_id", String(linkedEntityId));
    }
    endpoint = `/documents?${documentParams.toString()}`;
  } else if (recordType === "team") {
    const teamParams = new URLSearchParams({ query: search, module_key: sourceModuleKey ?? "", action: sourceAction });
    endpoint = `/linked-record-options/teams?${teamParams.toString()}`;
  } else {
    const userParams = new URLSearchParams({ query: search, module_key: sourceModuleKey ?? "", action: sourceAction });
    endpoint = `/linked-record-options/users?${userParams.toString()}`;
  }

  const res = await apiFetch(endpoint);
  const body = await res.json().catch(() => ({ results: [] }));
  if (!res.ok) {
    throw new Error("We could not search linked records.");
  }

  const results = Array.isArray(body?.results) ? body.results : [];
  return results.filter((record: Record<string, unknown>) => (
    recordType !== "global" || !allowedModuleKeys?.length || allowedModuleKeys.includes(String(record.module_key || ""))
  )).map((record: Record<string, unknown>) => {
    if (recordType === "global") {
      const entityId = String(record.record_id ?? "");
      return {
        id: Number(entityId),
        entity_id: entityId,
        label: typeof record.title === "string" ? record.title : "Unnamed record",
        description: [record.module_label, record.subtitle].filter((value) => typeof value === "string" && value).join(" · ") || null,
        module_key: typeof record.module_key === "string" ? record.module_key : undefined,
        module_label: typeof record.module_label === "string" ? record.module_label : undefined,
        href: typeof record.href === "string" ? record.href : undefined,
        raw: record,
      };
    }
    if (recordType === "catalog_item") {
      const kind = record.kind === "service" ? "service" : "product";
      const price = formatMoney(record.unit_price as string | number, typeof record.currency === "string" ? record.currency : undefined, { maximumFractionDigits: 2 });
      const unit = typeof record.unit === "string" && record.unit !== "unit" ? record.unit : null;
      return {
        id: Number(record.id),
        entity_id: String(record.id),
        module_key: kind === "product" ? "catalog_products" : "catalog_services",
        label: typeof record.name === "string" ? record.name : "Unnamed item",
        description: [
          kind === "product" ? "Product" : "Service",
          typeof record.sku === "string" ? record.sku : null,
          price ? (unit ? `${price} / ${unit}` : price) : null,
        ].filter(Boolean).join(" · "),
        raw: record,
      };
    }
    if (recordType === "vendor") {
      // A vendor is an Account flagged as one (E4); it opens as the Account it is.
      return { id: Number(record.id), entity_id: String(record.id), module_key: "sales_organizations",
        label: typeof record.label === "string" ? record.label : "Vendor",
        description: typeof record.email === "string" ? record.email : null, raw: record };
    }
    if (recordType === "inventory_product") {
      return { id: Number(record.id), entity_id: String(record.id), module_key: "catalog_products",
        label: typeof record.name === "string" ? record.name : "Product",
        description: typeof record.sku === "string" ? record.sku : null, raw: record };
    }

    if (recordType === "contact") {
      const firstName = typeof record.first_name === "string" ? record.first_name : "";
      const lastName = typeof record.last_name === "string" ? record.last_name : "";
      const email = typeof record.primary_email === "string" ? record.primary_email : "";
      const organizationName = typeof record.organization_name === "string" ? record.organization_name : null;
      const label = `${firstName} ${lastName}`.trim() || email || "Unnamed contact";
      return {
        id: Number(record.contact_id),
        label,
        description: organizationName || email || null,
        contact_id: Number(record.contact_id),
        organization_id: typeof record.organization_id === "number" ? record.organization_id : null,
        organization_name: organizationName,
        raw: record,
      };
    }

    if (recordType === "organization") {
      const name = typeof record.org_name === "string" ? record.org_name : "Unnamed account";
      const email = typeof record.primary_email === "string" ? record.primary_email : null;
      const website = typeof record.website === "string" ? record.website : null;
      return {
        id: Number(record.org_id),
        label: name,
        description: email || website,
        organization_id: Number(record.org_id),
        raw: record,
      };
    }

    if (recordType === "opportunity") {
      const name = typeof record.opportunity_name === "string" ? record.opportunity_name : "Unnamed deal";
      const account = typeof record.organization_name === "string" ? record.organization_name : null;
      const stageRef = record.pipeline_stage as { label?: unknown } | null | undefined;
      const stage =
        typeof stageRef?.label === "string"
          ? stageRef.label
          : typeof record.sales_stage === "string" && record.sales_stage
            ? formatSnakeCaseLabel(record.sales_stage)
            : null;
      return {
        id: Number(record.opportunity_id),
        label: name,
        description: [account, stage].filter(Boolean).join(" · ") || null,
        contact_id: typeof record.contact_id === "number" ? record.contact_id : null,
        organization_id: typeof record.organization_id === "number" ? record.organization_id : null,
        opportunity_id: Number(record.opportunity_id),
        raw: record,
      };
    }

    if (recordType === "quote") {
      return {
        id: Number(record.quote_id),
        label: typeof record.quote_number === "string" ? record.quote_number : "Unnamed quote",
        description: typeof record.customer_name === "string" ? record.customer_name : null,
        contact_id: typeof record.contact_id === "number" ? record.contact_id : null,
        organization_id: typeof record.organization_id === "number" ? record.organization_id : null,
        opportunity_id: typeof record.opportunity_id === "number" ? record.opportunity_id : null,
        quote_id: Number(record.quote_id),
        raw: record,
      };
    }

    if (recordType === "order") {
      return {
        id: Number(record.id),
        label: typeof record.order_number === "string" ? record.order_number : "Unnamed order",
        description: typeof record.status === "string" ? record.status.replace(/_/g, " ") : null,
        contact_id: typeof record.contact_id === "number" ? record.contact_id : null,
        organization_id: typeof record.organization_id === "number" ? record.organization_id : null,
        opportunity_id: typeof record.opportunity_id === "number" ? record.opportunity_id : null,
        quote_id: typeof record.quote_id === "number" ? record.quote_id : null,
        raw: record,
      };
    }

    if (recordType === "document") {
      return {
        id: Number(record.id),
        label: typeof record.title === "string" ? record.title : "Untitled document",
        description: typeof record.original_filename === "string" ? record.original_filename : null,
        raw: record,
      };
    }

    if (recordType === "team") {
      return {
        id: Number(record.id),
        label: typeof record.label === "string" ? record.label : "Unnamed team",
        raw: record,
      };
    }

    return {
      id: Number(record.id),
      label: typeof record.label === "string" ? record.label : "Unnamed user",
      description: typeof record.email === "string" ? record.email : null,
      raw: record,
    };
  });
}

export default function LinkedRecordPicker({
  inputId,
  ariaLabel,
  inputRef,
  recordType,
  valueId,
  displayValue,
  onDisplayValueChange,
  onSelect,
  onClear,
  placeholder,
  disabled = false,
  queryKeyPrefix = "linked-record-picker",
  noResultsText = "No records matched this search.",
  filters,
  linkedModuleKey,
  linkedEntityId,
  sourceModuleKey,
  sourceAction = "create",
  allowClear = true,
  allowedModuleKeys,
  ariaDescribedBy,
  ariaInvalid,
  clearLabel = "Clear linked record",
  onInputKeyDown,
  inputDataAttributes,
  createOption,
  suggestOnFocus = false,
}: Props) {
  const generatedListboxId = useId();
  const listboxId = `${generatedListboxId}-options`;
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const debouncedSearch = useDebouncedValue(displayValue.trim(), 250);
  const query = useQuery({
    queryKey: [queryKeyPrefix, recordType, debouncedSearch, filters, linkedModuleKey, linkedEntityId, sourceModuleKey, sourceAction, allowedModuleKeys],
    queryFn: () => searchLinkedRecords(recordType, debouncedSearch, filters, linkedModuleKey, linkedEntityId, sourceModuleKey, sourceAction, allowedModuleKeys),
    enabled: !disabled && isOpen && (debouncedSearch.length > 0 || suggestOnFocus),
    staleTime: 30_000,
  });
  const options = query.data ?? [];
  const typed = displayValue.trim();
  // The create option follows the results, so the arrows reach it last. It waits for the
  // search to settle, so it never sits where a result is about to appear, and a field that
  // already holds a record is not offering to make another.
  // Nor does it offer a record the results already have by that exact name.
  const exactMatch = options.some((option) => option.label.trim().toLowerCase() === typed.toLowerCase());
  const createIndex = createOption && typed && valueId == null && !exactMatch && !query.isFetching && !query.error ? options.length : -1;
  const optionCount = options.length + (createIndex >= 0 ? 1 : 0);
  const createOptionId = `${listboxId}-${recordType}-create`;

  function selectOption(option: LinkedRecordOption) {
    onSelect(option);
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function chooseCreate() {
    if (!createOption || !typed) return;
    setIsOpen(false);
    setActiveIndex(-1);
    createOption.onCreate(typed);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      if (!optionCount) return;
      setActiveIndex((current) => {
        if (event.key === "ArrowDown") return current >= optionCount - 1 ? 0 : current + 1;
        return current <= 0 ? optionCount - 1 : current - 1;
      });
      return;
    }
    if (event.key === "Enter" && isOpen && activeIndex >= 0 && options[activeIndex]) {
      event.preventDefault();
      selectOption(options[activeIndex]);
      return;
    }
    if (event.key === "Enter" && isOpen && activeIndex >= 0 && activeIndex === createIndex) {
      event.preventDefault();
      chooseCreate();
      return;
    }
    onInputKeyDown?.(event);
  }

  const isListOpen = isOpen && (Boolean(displayValue.trim()) || (suggestOnFocus && options.length > 0));

  // The list is a popover anchored to the field rather than an absolutely positioned child,
  // so a scroll container around the field (a line-items grid, an editor panel) cannot clip
  // it. Focus stays in the input: the popover neither takes it on open nor returns it.
  return (
    <Popover open={isListOpen} onOpenChange={(open) => { if (!open) setIsOpen(false); }}>
      <PopoverAnchor asChild>
      <div ref={anchorRef} className="flex gap-2">
        <Input
          {...inputDataAttributes}
          id={inputId}
          aria-label={ariaLabel}
          ref={inputRef}
          value={displayValue}
          disabled={disabled}
          onFocus={() => setIsOpen(true)}
          onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
          onKeyDown={handleKeyDown}
          onChange={(event) => {
            onDisplayValueChange(event.target.value);
            setIsOpen(true);
            setActiveIndex(-1);
          }}
          placeholder={placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isListOpen}
          aria-controls={listboxId}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-activedescendant={
            activeIndex >= 0 && options[activeIndex]
              ? `${listboxId}-${recordType}-${optionIdentity(recordType, options[activeIndex])}`
              : activeIndex >= 0 && activeIndex === createIndex
                ? createOptionId
                : undefined
          }
          autoComplete="off"
        />
        {valueId && allowClear ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClear}
            aria-label={clearLabel}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      </PopoverAnchor>

      <PopoverContent
        // The input is the combobox and this only hosts its listbox, so it is not a dialog.
        role="presentation"
        data-slot="linked-record-picker-content"
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
        className="w-(--radix-popover-trigger-width) rounded-[var(--radius-control)] border-line-default bg-surface-raised p-0"
      >
        <div
          id={listboxId}
          role="listbox"
          aria-label={`${placeholder} results`}
        >
          {query.isLoading ? (
            <div role="status" className="px-3 py-2 text-sm text-copy-muted">Searching…</div>
          ) : query.error ? (
            <div role="alert" className="px-3 py-2 text-sm text-state-danger">
              We could not search these records. Try again.
            </div>
          ) : options.length ? (
            <div className="max-h-56 overflow-y-auto py-1">
              {options.map((option, optionIndex) => (
                <button
                  key={`${recordType}-${optionIdentity(recordType, option)}`}
                  id={`${listboxId}-${recordType}-${optionIdentity(recordType, option)}`}
                  type="button"
                  role="option"
                  aria-selected={optionIndex === activeIndex}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-copy-secondary hover:bg-surface-muted hover:text-copy-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus aria-selected:bg-action-primary-muted aria-selected:text-copy-primary"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(optionIndex)}
                  onClick={() => selectOption(option)}
                >
                  <span className="min-w-0 truncate text-sm text-copy-primary">{option.label}</span>
                  {option.description ? (
                    <span className="shrink-0 truncate text-xs text-copy-muted">{option.description}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <div role="status" className="px-3 py-2 text-sm text-copy-muted">{noResultsText}</div>
          )}
          {createIndex >= 0 && createOption ? (
            <button
              id={createOptionId}
              type="button"
              role="option"
              aria-selected={activeIndex === createIndex}
              className="flex w-full items-center gap-2 border-t border-line-default px-3 py-2 text-left text-sm text-action-primary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus aria-selected:bg-action-primary-muted"
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(createIndex)}
              onClick={chooseCreate}
            >
              <Plus className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">{createOption.label(typed)}</span>
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
