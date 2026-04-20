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
};

export default function TimezonePicker({
  value,
  onChange,
  placeholder = "Search country or city",
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
          type="button"
          variant="outline"
          className="w-full justify-between border-neutral-800 bg-neutral-950/70 text-left font-normal text-neutral-200 hover:bg-neutral-900 hover:text-neutral-100"
        >
          <span className="truncate">
            {selectedOption ? selectedOption.label : value || placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-neutral-500" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[380px] border-white/10 bg-neutral-950 p-0 text-neutral-100">
        <div className="border-b border-white/10 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
              className="border-neutral-800 bg-neutral-900 pl-9 text-neutral-100 placeholder:text-neutral-500"
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
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-white/8"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-neutral-100">{option.label}</div>
                  <div className="truncate text-xs text-neutral-500">{option.value}</div>
                </div>
                {option.value === value ? <Check className="ml-3 h-4 w-4 shrink-0 text-white" /> : null}
              </button>
            ))
          ) : (
            <div className="px-3 py-8 text-center text-sm text-neutral-500">No timezone matched that search.</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
