"use client";

import { useState, useRef, useEffect } from "react";
import { SlidersHorizontal, Check } from "lucide-react";

type FilterButtonProps = {
  field: string;
  setField: (f: string) => void;
};

const SEARCH_FIELDS = [
  "campaign_name",
  "client_name",
  "cpl",
  "start_date",
  "end_date",
  "campaign_type",
  "account_manager",
  "total_leads",
  "quarter",
];

export default function FilterButton({ field, setField }: FilterButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [ref]);

  return (
    <div className="relative" ref={ref}>

      <button
        onClick={() => setOpen((o) => !o)}
        className="p-2 rounded-md bg-neutral-800 border border-neutral-700 
                   hover:bg-neutral-900 hover:border-neutral-600 transition"
      >
        <SlidersHorizontal size={16} className="text-zinc-400" />
      </button>


      {open && (
        <div className="absolute right-0 top-11 bg-neutral-900 border border-neutral-700 
                        rounded-lg p-3 w-72 shadow-2xl z-50">

          <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-xs">
            {SEARCH_FIELDS.map((f) => {
              const isActive = field === f;
              return (
                <button
                  key={f}
                  onClick={() => {
                    setField(f);
                    setOpen(false);
                  }}
                  className={`flex items-center gap-2 px-1 py-1 rounded-md hover:bg-neutral-800 transition text-left ${
                    isActive ? "bg-neutral-800 border border-neutral-700" : ""
                  }`}
                >

                  <div
                    className={`h-3.5 w-3.5 rounded-lg border flex items-center justify-center transition ${
                      isActive
                        ? "border-blue-400 bg-blue-500/20"
                        : "border-neutral-600"
                    }`}
                  >
                    {isActive && (
                      <Check size={9} className="text-blue-400" strokeWidth={3} />
                    )}
                  </div>

                  <span className="text-neutral-200 truncate">
                    {f.replace(/_/g, " ")
                      .charAt(0)
                      .toUpperCase() + f.replace(/_/g, " ").slice(1)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}