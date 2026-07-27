"use client";

import { useId, useState, type KeyboardEvent, type Ref } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { apiFetch } from "@/lib/api";

export type LinkedRecordType = "contact" | "organization" | "opportunity" | "quote" | "order" | "document" | "user" | "team";

export type LinkedRecordFilters = {
  contactId?: number | null;
  organizationId?: number | null;
  opportunityId?: number | null;
  quoteId?: number | null;
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
  raw?: unknown;
};

type Props = {
  inputId?: string;
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
): Promise<LinkedRecordOption[]> {
  const params = new URLSearchParams({ page: "1", page_size: "10", query: search });
  appendRelationshipFilters(params, filters);
  let endpoint = "";

  if (recordType === "contact") {
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
  return results.map((record: Record<string, unknown>) => {
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
      const client = typeof record.client === "string" ? record.client : null;
      const stage = typeof record.sales_stage === "string" ? record.sales_stage.replace(/_/g, " ") : null;
      return {
        id: Number(record.opportunity_id),
        label: name,
        description: [client, stage].filter(Boolean).join(" · ") || null,
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
}: Props) {
  const generatedListboxId = useId();
  const listboxId = `${generatedListboxId}-options`;
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debouncedSearch = useDebouncedValue(displayValue.trim(), 250);
  const query = useQuery({
    queryKey: [queryKeyPrefix, recordType, debouncedSearch, filters, linkedModuleKey, linkedEntityId, sourceModuleKey, sourceAction],
    queryFn: () => searchLinkedRecords(recordType, debouncedSearch, filters, linkedModuleKey, linkedEntityId, sourceModuleKey, sourceAction),
    enabled: !disabled && isOpen && debouncedSearch.length > 0,
    staleTime: 30_000,
  });
  const options = query.data ?? [];

  function selectOption(option: LinkedRecordOption) {
    onSelect(option);
    setIsOpen(false);
    setActiveIndex(-1);
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
      if (!options.length) return;
      setActiveIndex((current) => {
        if (event.key === "ArrowDown") return current >= options.length - 1 ? 0 : current + 1;
        return current <= 0 ? options.length - 1 : current - 1;
      });
      return;
    }
    if (event.key === "Enter" && isOpen && activeIndex >= 0 && options[activeIndex]) {
      event.preventDefault();
      selectOption(options[activeIndex]);
    }
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <Input
          id={inputId}
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
          aria-expanded={isOpen && Boolean(displayValue.trim())}
          aria-controls={listboxId}
          aria-activedescendant={
            activeIndex >= 0 && options[activeIndex]
              ? `${listboxId}-${recordType}-${options[activeIndex].id}`
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
            aria-label="Clear linked record"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {isOpen && displayValue.trim() ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={`${placeholder} results`}
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 rounded-[var(--radius-control)] border border-line-default bg-surface-raised shadow-xl"
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
                  key={`${recordType}-${option.id}`}
                  id={`${listboxId}-${recordType}-${option.id}`}
                  type="button"
                  role="option"
                  aria-selected={optionIndex === activeIndex}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-copy-secondary hover:bg-surface-muted hover:text-copy-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary aria-selected:bg-action-primary-muted aria-selected:text-copy-primary"
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
        </div>
      ) : null}
    </div>
  );
}
