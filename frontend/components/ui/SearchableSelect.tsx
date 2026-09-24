"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Check, ChevronDown, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { selectTriggerVariants } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * The one threshold, and the reason it is a constant rather than a prop.
 *
 * §7.8: a select whose option count is fixed by the product (lead status, `Active`/`Inactive`)
 * is never searchable — seeing all of them at once *is* the affordance, and a search box over
 * five options is furniture. A select whose length is the tenant's data (owner, customer
 * group, a custom module's `single_select`) is unbounded and gets one. The primitive counts
 * what it was given, so the answer is identical at every call site and moving it is one edit.
 */
export const SEARCHABLE_SELECT_MIN_OPTIONS = 10;

export type SearchableSelectOption = {
  value: string;
  label: string;
  /** A second line under the label — an IANA id, an email. Searched as well as shown. */
  description?: string;
  /** Matched by the search input and never drawn. A timezone's country and aliases. */
  keywords?: string;
  disabled?: boolean;
};

type SearchableSelectProps = {
  /** The control's accessible name. Not drawn — the value is. */
  label: string;
  value: string;
  options: SearchableSelectOption[];
  onValueChange: (value: string) => void;
  /**
   * Draws the closed trigger. `InlineFieldEdit` passes a `StatusValue` so a state field looks
   * the same whether or not it turns out to be editable (R6). Omitted, the option's label is
   * drawn, then the raw value, then the placeholder.
   */
  renderValue?: (selected: SearchableSelectOption | null) => ReactNode;
  placeholder?: string;
  /** `default` is the boxed form control; `ghost` is R6's quiet chevron in the record spine. */
  variant?: "default" | "ghost";
  size?: "sm" | "default";
  disabled?: boolean;
  required?: boolean;
  id?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  contentClassName?: string;
};

/** Cheap enough at these counts, and it keeps `description` and `keywords` in one matcher. */
function matches(option: SearchableSelectOption, query: string) {
  if (!query) return true;
  const haystack = `${option.label} ${option.description ?? ""} ${option.keywords ?? ""}`;
  return haystack.toLowerCase().includes(query);
}

const TYPEAHEAD_RESET_MS = 600;

/**
 * A select that grows a search input when its own option list is long enough to need one.
 *
 * **One DOM shape, always** (§7.8). The search field is rendered or not; the component is
 * not. Radix `Select` cannot host a search input, so this is the `Popover` + filtered listbox
 * form at every count — swapping component *type* at N options would make an element's ARIA
 * contract depend on how much data a tenant happens to have, which is untestable and would
 * break the strip guards. The trigger keeps `role="combobox"` and the options keep
 * `role="option"` precisely so the two forms are indistinguishable to a spec and to a screen
 * reader.
 *
 * It wears `selectTriggerVariants`, so a searchable select and the plain `Select` beside it
 * are one control family (§1.6).
 *
 * **What this is not.** `LinkedRecordPicker` resolves a *record reference* over a server-side
 * search and `UserTeamPicker` is a grouped multi-select across two entity types; both stay.
 * This picks a *field value* from options already in memory. Folding those in would give one
 * primitive four modes, which is where the next author gets lost (§7.8).
 */
export function SearchableSelect({
  label,
  value,
  options,
  onValueChange,
  renderValue,
  placeholder = "Select",
  variant = "default",
  size = "default",
  disabled,
  required,
  id,
  ariaDescribedBy,
  ariaInvalid,
  searchPlaceholder = "Search",
  emptyMessage = "Nothing matched that search.",
  className,
  contentClassName,
}: SearchableSelectProps) {
  const reactId = useId();
  const listboxId = `${id ?? reactId}-listbox`;
  const optionId = (index: number) => `${id ?? reactId}-option-${index}`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /**
   * The active option, remembered *with the query it was chosen under*.
   *
   * Filtering moves the list out from under the index — arrowing to the seventh row and then
   * typing would leave Enter committing something off-screen — so a stale pairing falls back
   * to the selected option rather than being corrected by an effect. Deriving it during
   * render is also what keeps this out of `setState`-in-`useEffect` territory.
   */
  const [active, setActive] = useState<{ index: number; forQuery: string | null }>({
    index: -1,
    forQuery: null,
  });

  const listRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const typeahead = useRef({ buffer: "", at: 0 });

  const searchable = options.length >= SEARCHABLE_SELECT_MIN_OPTIONS;
  const selected = options.find((option) => option.value === value) ?? null;

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!searchable || !normalized) return options;
    return options.filter((option) => matches(option, normalized));
  }, [options, query, searchable]);

  const fallbackIndex = useMemo(() => {
    const selectedIndex = visible.findIndex((option) => option.value === value);
    if (selectedIndex >= 0) return selectedIndex;
    return visible.findIndex((option) => !option.disabled);
  }, [visible, value]);

  const activeIndex =
    active.forQuery === query && active.index >= 0 && active.index < visible.length
      ? active.index
      : fallbackIndex;

  const setActiveIndex = useCallback(
    (index: number) => setActive({ index, forQuery: query }),
    [query],
  );

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const commit = useCallback(
    (option: SearchableSelectOption) => {
      if (option.disabled) return;
      setOpen(false);
      setQuery("");
      if (option.value !== value) onValueChange(option.value);
    },
    [onValueChange, value],
  );

  function move(delta: number) {
    if (!visible.length) return;
    // Skips disabled rows rather than parking on one, and stops at the ends rather than
    // wrapping — a list of 400 timezones that loops to the top reads as a broken key.
    let next = activeIndex < 0 ? (delta > 0 ? -1 : visible.length) : activeIndex;
    for (let step = 0; step < visible.length; step += 1) {
      next += delta;
      if (next < 0 || next >= visible.length) return;
      if (!visible[next]?.disabled) {
        setActiveIndex(next);
        return;
      }
    }
  }

  /**
   * Shared by the search input and the listbox, because exactly one of them holds focus while
   * the popover is open and both drive the same active index.
   */
  function handleListKeyDown(event: KeyboardEvent<HTMLElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        return;
      case "Home":
        event.preventDefault();
        setActiveIndex(visible.findIndex((option) => !option.disabled));
        return;
      case "End":
        event.preventDefault();
        setActiveIndex(visible.findLastIndex((option) => !option.disabled));
        return;
      case "Enter":
      case " ": {
        // Space types a space in the search field; only the listbox reads it as a commit.
        if (event.key === " " && searchable) return;
        const option = visible[activeIndex];
        if (!option) return;
        event.preventDefault();
        commit(option);
        return;
      }
      case "Tab":
        // Radix restores focus to the trigger on close, so Tab leaves the control rather than
        // stranding focus in a portal.
        setOpen(false);
        return;
      default:
        break;
    }

    // Typeahead, for the form that has no search field. `Select` gave the operator this and
    // dropping it would make the short list the *worse* keyboard control of the two.
    if (searchable || event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const now = Date.now();
    typeahead.current.buffer =
      now - typeahead.current.at > TYPEAHEAD_RESET_MS
        ? event.key.toLowerCase()
        : typeahead.current.buffer + event.key.toLowerCase();
    typeahead.current.at = now;
    const hit = visible.findIndex(
      (option) => !option.disabled && option.label.toLowerCase().startsWith(typeahead.current.buffer),
    );
    if (hit >= 0) setActiveIndex(hit);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          setActive({ index: -1, forQuery: null });
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listboxId : undefined}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-required={required}
          disabled={disabled}
          data-slot="searchable-select-trigger"
          data-size={size}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
            }
          }}
          className={cn(selectTriggerVariants({ variant }), className)}
        >
          {/* `block truncate` rather than a flex row: a button's UA `text-align: center` would
              otherwise centre a short value in a full-width form control. */}
          <span className="block min-w-0 truncate text-left">
            {renderValue
              ? renderValue(selected)
              : (selected?.label ?? value ?? "") || (
                  <span className="text-copy-muted">{placeholder}</span>
                )}
          </span>
          <ChevronDown className={cn("size-4 shrink-0", variant !== "ghost" && "opacity-50")} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        data-slot="searchable-select-content"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          // Radix would focus the first tabbable child; the listbox has to take focus in the
          // unsearchable form or the arrow keys have nowhere to land.
          (searchable ? searchRef.current : listRef.current)?.focus();
        }}
        className={cn(
          "w-[min(22rem,calc(100vw-2rem))] min-w-[var(--radix-popover-trigger-width)] border-line-default p-0",
          contentClassName,
        )}
      >
        {searchable ? (
          <div className="border-b border-line-subtle p-2">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-copy-muted"
              />
              <Input
                ref={searchRef}
                // A textbox, not a second combobox: the trigger owns that role, and two of
                // them in one control makes `getByRole("combobox", { name })` ambiguous. The
                // name is bare "Search" for the same reason one level down — an accessible
                // name of `Search <field>` contains the field's own name as a substring, and
                // `getByLabel` matches substrings, so every searchable field would go
                // ambiguous the moment its popover opened. The listbox it controls carries
                // the field name, which is where a screen reader wants it anyway.
                aria-label="Search"
                aria-controls={listboxId}
                aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleListKeyDown}
                placeholder={searchPlaceholder}
                className="pl-9"
              />
            </div>
          </div>
        ) : null}
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={label}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          tabIndex={searchable ? -1 : 0}
          onKeyDown={searchable ? undefined : handleListKeyDown}
          className="max-h-72 overflow-y-auto p-1 outline-none custom-scrollbar"
        >
          {visible.length ? (
            visible.map((option, index) => (
              <div
                key={option.value}
                id={optionId(index)}
                role="option"
                data-index={index}
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                data-active={index === activeIndex || undefined}
                onClick={() => commit(option)}
                onPointerMove={() => setActiveIndex(index)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-control-sm)] px-2 py-1.5 text-sm text-copy-primary select-none",
                  // The active row is where the keyboard is (aria-activedescendant), so it is drawn as
                  // focus: the fill alone is 1.24:1 dark / 1.08:1 light against the popover (§2.3).
                  "data-[active=true]:bg-accent data-[active=true]:text-accent-foreground data-[active=true]:ring-2 data-[active=true]:ring-inset data-[active=true]:ring-focus",
                  option.disabled && "pointer-events-none text-copy-disabled opacity-60",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">{option.label}</span>
                  {option.description ? (
                    <span className="block truncate text-xs text-copy-muted">
                      {option.description}
                    </span>
                  ) : null}
                </span>
                {option.value === value ? (
                  <Check aria-hidden="true" className="size-4 shrink-0 text-copy-muted" />
                ) : null}
              </div>
            ))
          ) : (
            // Two different facts, and conflating them is §7.9's shape at a small scale: a
            // search that matched nothing is not a field with nothing to choose from.
            <div className="px-2 py-8 text-center text-sm text-copy-muted">
              {query.trim() ? emptyMessage : "There is nothing to choose from yet."}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
