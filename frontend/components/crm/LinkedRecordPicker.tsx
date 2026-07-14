"use client";

import { useState } from "react";
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
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
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
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const debouncedSearch = useDebouncedValue(displayValue.trim(), 250);
  const query = useQuery({
    queryKey: [queryKeyPrefix, recordType, debouncedSearch, filters, linkedModuleKey, linkedEntityId, sourceModuleKey, sourceAction],
    queryFn: () => searchLinkedRecords(recordType, debouncedSearch, filters, linkedModuleKey, linkedEntityId, sourceModuleKey, sourceAction),
    enabled: !disabled && isOpen && debouncedSearch.length > 0,
    staleTime: 30_000,
  });

  return (
    <div className="relative">
      <div className="flex gap-2">
        <Input
          value={displayValue}
          disabled={disabled}
          onFocus={() => setIsOpen(true)}
          onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
          onChange={(event) => {
            onDisplayValueChange(event.target.value);
            setIsOpen(true);
          }}
          placeholder={placeholder}
        />
        {valueId ? (
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
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 rounded-md border border-neutral-800 bg-neutral-950 shadow-2xl">
          {query.isLoading ? (
            <div className="px-3 py-2 text-sm text-neutral-500">Searching...</div>
          ) : query.error ? (
            <div className="px-3 py-2 text-sm text-red-300">
              {query.error instanceof Error ? query.error.message : "Failed to search records."}
            </div>
          ) : (query.data ?? []).length ? (
            <div className="max-h-56 overflow-y-auto py-1">
              {(query.data ?? []).map((option) => (
                <button
                  key={`${recordType}-${option.id}`}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-neutral-900"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onSelect(option);
                    setIsOpen(false);
                  }}
                >
                  <span className="min-w-0 truncate text-sm text-neutral-100">{option.label}</span>
                  {option.description ? (
                    <span className="shrink-0 truncate text-xs text-neutral-500">{option.description}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="px-3 py-2 text-sm text-neutral-500">{noResultsText}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
