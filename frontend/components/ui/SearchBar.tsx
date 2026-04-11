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
  className?: string;
};

export default function SearchBar({
  value,
  onChange,
  placeholder = "Search...",
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
          placeholder={placeholder}
          value={value}
          // ✅ CRITICAL FIX: Intercept the event 'e' and only pass the string string 'e.target.value'
          // This prevents the parent state from becoming an [object Object], which causes the .trim() crash.
          onChange={(e) => onChange(e.target.value)}
        />
      </InputGroup>
    </div>
  );
}