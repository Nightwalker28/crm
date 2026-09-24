"use client";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Search } from "lucide-react";

type SearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** The accessible name. Defaults to the placeholder, which is always a verb phrase here
   *  ("Search leads"), because a search field has no visible label (design.md 8). */
  label?: string;
  className?: string;
};

export default function SearchBar({
  value,
  onChange,
  placeholder = "Search…",
  label,
  className = "",
}: SearchBarProps) {
  return (
    <div className={`w-full md:w-64 ${className}`}>
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          type="text"
          aria-label={label ?? placeholder.replace(/…$/, "")}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </InputGroup>
    </div>
  );
}