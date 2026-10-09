"use client";

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";

type PasswordPolicy = { min_length: number; requirements: string[] };

/** The workspace password policy, for showing the rules before the server enforces them. */
export function usePasswordPolicy() {
  const [policy, setPolicy] = useState<PasswordPolicy | null>(null);
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const res = await apiFetch("/auth/password-policy");
        if (!res.ok) return;
        const data = (await res.json()) as PasswordPolicy;
        if (mounted && Array.isArray(data.requirements)) setPolicy(data);
      } catch {
        // The server's check is the one that counts.
      }
    })();
    return () => { mounted = false; };
  }, []);
  return policy;
}

/** The same checks the server makes, so most mistakes are caught before the request. */
export function passwordPolicyError(password: string, confirm: string, policy: PasswordPolicy | null) {
  const minLength = policy?.min_length ?? 12;
  if (password.length < minLength) return `Use at least ${minLength} characters.`;
  if (!/[a-z]/.test(password)) return "Include a lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Include a capital letter.";
  if (!/[0-9]/.test(password)) return "Include a number.";
  if (new Set(password).size === 1) return "Use more than one character.";
  if (password !== confirm) return "The two passwords do not match.";
  return null;
}

/**
 * A new password and its confirmation (13d §3.7): setup, reset and change all ask the same
 * thing in the same words.
 */
export function ClientPasswordFields({
  idPrefix,
  password,
  confirm,
  onPasswordChange,
  onConfirmChange,
  policy,
  label = "New password",
}: {
  idPrefix: string;
  password: string;
  confirm: string;
  onPasswordChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
  policy: PasswordPolicy | null;
  label?: string;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-password`}>{label}</Label>
        <Input id={`${idPrefix}-password`} type="password" autoComplete="new-password" value={password}
          onChange={(event) => onPasswordChange(event.target.value)} required />
        {policy ? (
          <ul className="space-y-1 text-xs text-copy-secondary">
            {policy.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}
          </ul>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-confirm`}>Type it again</Label>
        <Input id={`${idPrefix}-confirm`} type="password" autoComplete="new-password" value={confirm}
          onChange={(event) => onConfirmChange(event.target.value)} required />
      </div>
    </>
  );
}
