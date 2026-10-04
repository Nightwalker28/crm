"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";

type PasswordPolicy = {
  min_length: number;
  requirements: string[];
};

/** The tenant's password rules, shown under the field. Generic copy if the endpoint fails. */
export function usePasswordPolicy() {
  const [policy, setPolicy] = useState<PasswordPolicy | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch("/auth/password-policy", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as PasswordPolicy;
        if (!controller.signal.aborted && Array.isArray(data.requirements)) setPolicy(data);
      })
      .catch(() => {
        // Keep the generic copy.
      });
    return () => controller.abort();
  }, []);

  return policy;
}

export function PasswordPolicyHint({ policy }: { policy: PasswordPolicy | null }) {
  return policy ? (
    <ul className="space-y-1 text-xs text-copy-secondary">
      {policy.requirements.map((requirement) => (
        <li key={requirement}>{requirement}</li>
      ))}
    </ul>
  ) : (
    <p className="text-xs text-copy-secondary">Password must meet the current security policy.</p>
  );
}

/**
 * New password + confirm, for the invite (`/auth/setup-password`) and forgot-password
 * (`/auth/reset-password`) doors. The page owns the request; this owns the fields, the
 * policy hint and the mismatch check.
 */
export function NewPasswordForm({
  idPrefix,
  submitLabel,
  submittingLabel,
  onSubmit,
}: {
  idPrefix: string;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (password: string) => Promise<void>;
}) {
  const policy = usePasswordPolicy();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    setIsSubmitting(true);
    try {
      await onSubmit(password);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-4 text-left" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-password`}>Password</Label>
        <Input
          id={`${idPrefix}-password`}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <PasswordPolicyHint policy={policy} />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-confirm-password`}>Confirm password</Label>
        <Input
          id={`${idPrefix}-confirm-password`}
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          aria-invalid={mismatch || undefined}
          aria-describedby={mismatch ? `${idPrefix}-mismatch` : undefined}
          required
        />
        {mismatch ? (
          <p id={`${idPrefix}-mismatch`} className="text-xs text-state-danger">
            Passwords do not match
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? submittingLabel : submitLabel}
      </Button>
    </form>
  );
}
