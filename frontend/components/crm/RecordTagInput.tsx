"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { apiFetch } from "@/lib/api";

type Props = {
  value: string[];
  onChange: (tags: string[]) => void;
  moduleKey: string;
  action: "create" | "edit";
  disabled?: boolean;
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
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return (Array.isArray(body?.results) ? body.results : [])
    .map((item: { name?: unknown }) => typeof item.name === "string" ? item.name : "")
    .filter(Boolean) as string[];
}

export default function RecordTagInput({ value, onChange, moduleKey, action, disabled = false }: Props) {
  const [draft, setDraft] = useState("");
  const [isOpen, setIsOpen] = useState(false);
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
      setError(`A Lead can have at most ${MAX_TAGS} tags.`);
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
  }

  const suggestions = (query.data ?? []).filter(
    (suggestion) => !value.some((current) => current.toLocaleLowerCase() === suggestion.toLocaleLowerCase()),
  );

  return (
    <div className="space-y-2">
      {value.length ? (
        <div className="flex flex-wrap gap-2">
          {value.map((tag) => (
            <span key={tag.toLocaleLowerCase()} className="inline-flex items-center gap-1 rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-200">
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
                <X className="h-3 w-3" />
              </Button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="relative">
        <Input
          value={draft}
          disabled={disabled || value.length >= MAX_TAGS}
          placeholder="Type a tag and press Enter"
          onFocus={() => setIsOpen(true)}
          onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
            setIsOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== ",") return;
            event.preventDefault();
            addTag(draft);
          }}
        />
        {isOpen && draft.trim() ? (
          <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 rounded-md border border-neutral-800 bg-neutral-950 py-1 shadow-2xl">
            {query.isLoading ? <div className="px-3 py-2 text-sm text-neutral-500">Searching…</div> : null}
            {query.error ? <div className="px-3 py-2 text-sm text-red-300">Failed to load tag suggestions.</div> : null}
            {suggestions.map((tag) => (
              <button
                key={tag.toLocaleLowerCase()}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-neutral-100 hover:bg-neutral-900"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addTag(tag)}
              >
                {tag}
              </button>
            ))}
            {!query.isLoading && !suggestions.length ? (
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-900"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addTag(draft)}
              >
                Create “{normalizeTag(draft)}”
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-xs text-red-300">{error}</p> : null}
    </div>
  );
}
