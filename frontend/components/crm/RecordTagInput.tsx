"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { apiFetch } from "@/lib/api";

type Props = {
  value: string[];
  onChange: (tags: string[]) => void;
  moduleKey: string;
  action: "create" | "edit";
  disabled?: boolean;
  inputId?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
};

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;

function normalizeTag(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

async function searchTags(moduleKey: string, action: Props["action"], query: string) {
  const params = new URLSearchParams({ module_key: moduleKey, action, query, limit: "10" });
  const res = await apiFetch(`/linked-record-options/tags?${params.toString()}`);
  const body = await res.json().catch(() => ({ results: [] }));
  if (!res.ok) throw new Error("Tag suggestions could not be loaded.");
  return (Array.isArray(body?.results) ? body.results : [])
    .map((item: { name?: unknown }) => typeof item.name === "string" ? item.name : "")
    .filter(Boolean) as string[];
}

export default function RecordTagInput({
  value,
  onChange,
  moduleKey,
  action,
  disabled = false,
  inputId,
  ariaDescribedBy,
  ariaInvalid = false,
}: Props) {
  const generatedId = useId();
  const resolvedInputId = inputId ?? `${generatedId}-input`;
  const listboxId = `${generatedId}-options`;
  const errorId = `${generatedId}-error`;
  const [draft, setDraft] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const debouncedDraft = useDebouncedValue(draft, 200);
  const query = useQuery({
    queryKey: ["record-tag-options", moduleKey, action, debouncedDraft],
    queryFn: () => searchTags(moduleKey, action, debouncedDraft),
    enabled: !disabled && isOpen && debouncedDraft.trim().length > 0,
    staleTime: 30_000,
  });

  function addTag(rawTag: string) {
    const tag = normalizeTag(rawTag);
    if (!tag) return;
    if (tag.length > MAX_TAG_LENGTH) {
      setError(`Tags must be ${MAX_TAG_LENGTH} characters or fewer.`);
      return;
    }
    if (value.length >= MAX_TAGS) {
      setError(`This record can have at most ${MAX_TAGS} tags.`);
      return;
    }
    if (value.some((current) => current.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
      setDraft("");
      setError(null);
      return;
    }
    onChange([...value, tag]);
    setDraft("");
    setError(null);
    setIsOpen(false);
    setActiveIndex(-1);
  }

  const suggestions = (query.data ?? []).filter(
    (suggestion) => !value.some((current) => current.toLocaleLowerCase() === suggestion.toLocaleLowerCase()),
  );
  const normalizedDraft = normalizeTag(draft);
  const options = suggestions.length ? suggestions : normalizedDraft && !query.isLoading ? [normalizedDraft] : [];

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
      addTag(options[activeIndex]);
      return;
    }
    if (event.key !== "Enter" && event.key !== ",") return;
    event.preventDefault();
    addTag(draft);
  }

  return (
    <div className="space-y-2">
      {value.length ? (
        <div className="flex flex-wrap gap-2" aria-label="Selected tags">
          {value.map((tag) => (
            <Chip key={tag.toLocaleLowerCase()} className="gap-1 py-1 pr-1">
              {tag}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-4 w-4 rounded-full"
                disabled={disabled}
                onClick={() => onChange(value.filter((current) => current !== tag))}
                aria-label={`Remove ${tag} tag`}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </Button>
            </Chip>
          ))}
        </div>
      ) : null}

      <div className="relative">
        <Input
          id={resolvedInputId}
          value={draft}
          disabled={disabled || value.length >= MAX_TAGS}
          placeholder="Type a tag and press Enter"
          onFocus={() => setIsOpen(true)}
          onBlur={() => window.setTimeout(() => {
            setIsOpen(false);
            setActiveIndex(-1);
          }, 120)}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
            setIsOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen && Boolean(draft.trim())}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 && options[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
          aria-invalid={ariaInvalid || Boolean(error)}
          aria-describedby={[ariaDescribedBy, error ? errorId : undefined].filter(Boolean).join(" ") || undefined}
          autoComplete="off"
        />
        {isOpen && draft.trim() ? (
          <div id={listboxId} role="listbox" aria-label="Tag suggestions" className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 rounded-[var(--radius-control)] border border-line-default bg-surface-raised py-1 shadow-[var(--shadow-panel)]">
            {query.isLoading ? <div role="status" className="px-3 py-2 text-sm text-copy-muted">Searching…</div> : null}
            {query.error ? (
              <div role="alert" className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-state-danger">
                <span>Tag suggestions could not be loaded.</span>
                <Button type="button" variant="outline" size="sm" disabled={query.isFetching} onMouseDown={(event) => event.preventDefault()} onClick={() => void query.refetch()}>
                  Try again
                </Button>
              </div>
            ) : null}
            {suggestions.map((tag, optionIndex) => (
              <button
                key={tag.toLocaleLowerCase()}
                id={`${listboxId}-${optionIndex}`}
                type="button"
                role="option"
                aria-selected={optionIndex === activeIndex}
                className="block w-full px-3 py-2 text-left text-sm text-copy-primary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus aria-selected:bg-action-primary-muted"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(optionIndex)}
                onClick={() => addTag(tag)}
              >
                {tag}
              </button>
            ))}
            {!query.isLoading && !suggestions.length && normalizedDraft ? (
              <button
                id={`${listboxId}-0`}
                type="button"
                role="option"
                aria-selected={activeIndex === 0}
                className="block w-full px-3 py-2 text-left text-sm text-copy-secondary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus aria-selected:bg-action-primary-muted aria-selected:text-copy-primary"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(0)}
                onClick={() => addTag(draft)}
              >
                Create “{normalizedDraft}”
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? <p id={errorId} role="alert" className="text-xs text-state-danger">{error}</p> : null}
    </div>
  );
}
