"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getTimezoneOptions } from "@/lib/timezones";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  triggerId?: string;
  ariaLabel?: string;
};

export default function TimezonePicker({
  value,
  onChange,
  placeholder = "Search country or city",
  triggerId,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const options = useMemo(() => getTimezoneOptions(), []);

  const selectedOption = options.find((option) => option.value === value);
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options.slice(0, 100);
    return options.filter((option) => option.searchText.includes(normalizedQuery)).slice(0, 100);
  }, [options, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={triggerId}
          aria-label={ariaLabel}
          type="button"
          variant="outline"
          className="w-full justify-between text-left font-normal"
        >
          <span className="truncate">
            {selectedOption ? selectedOption.label : value || placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-copy-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(380px,calc(100vw-2rem))] border-line-default bg-surface-raised p-0 text-copy-primary">
        <div className="border-b border-line-subtle p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-copy-muted" />
            <Input
              aria-label="Search timezones"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
              className="pl-9"
            />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto p-2 custom-scrollbar">
          {filteredOptions.length ? (
            filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-center justify-between rounded-[var(--radius-control-sm)] px-3 py-2 text-left text-sm text-copy-secondary transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-copy-primary">{option.label}</div>
                  <div className="truncate text-xs text-copy-muted">{option.value}</div>
                </div>
                {option.value === value ? <Check className="ml-3 h-4 w-4 shrink-0 text-primary" /> : null}
              </button>
            ))
          ) : (
            <div className="px-3 py-8 text-center text-sm text-copy-muted">No timezone matched that search.</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
