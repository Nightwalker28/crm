"use client";

import type { FormEvent } from "react";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setupClientPassword } from "@/hooks/useClientPortal";
import { apiFetch } from "@/lib/api";

function getError() {
  return "The password could not be set. Check the requirements or request a new setup link.";
}

function loginHref(tenantSlug: string | null) {
  return tenantSlug ? `/client/login?tenant=${encodeURIComponent(tenantSlug)}` : "/client/login";
}

type PasswordPolicy = {
  min_length: number;
  requirements: string[];
};

function passwordPolicyError(password: string, policy: PasswordPolicy | null) {
  const minLength = policy?.min_length ?? 12;
  if (password.length < minLength) return `Password must be at least ${minLength} characters long.`;
  if (!/[a-z]/.test(password)) return "Password must include at least one lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Password must include at least one uppercase letter.";
  if (!/[0-9]/.test(password)) return "Password must include at least one number.";
  if (new Set(password).size === 1) return "Password cannot use the same character repeatedly.";
  return null;
}

function ClientSetupContent() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const tenantSlug = useMemo(() => searchParams.get("tenant") || searchParams.get("tenant_slug"), [searchParams]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [passwordPolicy, setPasswordPolicy] = useState<PasswordPolicy | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadPasswordPolicy() {
      try {
        const res = await apiFetch("/auth/password-policy");
        if (!res.ok) return;
        const data = (await res.json()) as PasswordPolicy;
        if (isMounted && Array.isArray(data.requirements)) {
          setPasswordPolicy(data);
        }
      } catch {
        // Backend validation remains authoritative if the policy endpoint is unavailable.
      }
    }

    loadPasswordPolicy();
    return () => {
      isMounted = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!token) {
      setError("Setup token is missing.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    const policyError = passwordPolicyError(password, passwordPolicy);
    if (policyError) {
      setError(policyError);
      return;
    }
    setStatus("saving");
    try {
      await setupClientPassword({ token, password, tenant_slug: tenantSlug });
      setStatus("done");
    } catch {
      setError(getError());
      setStatus("idle");
    }
  }

  return (
    <main className="min-h-screen bg-app px-4 py-10 text-copy-primary">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md flex-col justify-center">
        <div className="mb-8">
          <div className="mb-3 font-lynk text-4xl text-copy-primary">Lynk</div>
          <h1 className="text-2xl font-semibold">Set client password</h1>
          <p className="mt-2 text-sm text-copy-secondary">Create the password for your client portal access.</p>
        </div>

        {status === "done" ? (
          <div className="rounded-[var(--radius-card)] border border-state-success/40 bg-state-success-muted p-4">
            <div className="text-sm text-state-success">Password set. You can now sign in from any shared client page.</div>
            <Button asChild className="mt-4">
              <Link href={loginHref(tenantSlug)}>Go to client login</Link>
            </Button>
          </div>
        ) : (
          <form className="space-y-4 rounded-[var(--radius-card)] border border-line-default bg-surface p-5" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="client-setup-password" className="mb-2 block text-sm font-medium">Password</label>
              <Input id="client-setup-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
              {passwordPolicy ? (
                <ul className="mt-2 space-y-1 text-xs text-copy-secondary">
                  {passwordPolicy.requirements.map((requirement) => (
                    <li key={requirement}>{requirement}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-copy-secondary">Password must meet the current security policy.</p>
              )}
            </div>
            <div>
              <label htmlFor="client-setup-confirm" className="mb-2 block text-sm font-medium">Confirm password</label>
              <Input id="client-setup-confirm" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={status === "saving"}>
              {status === "saving" ? "Saving..." : "Set Password"}
            </Button>
            {error ? <p className="text-sm text-state-danger">{error}</p> : null}
          </form>
        )}
      </div>
    </main>
  );
}

export default function ClientSetupPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-app p-8 text-sm text-copy-secondary">Loading setup link...</main>}>
      <ClientSetupContent />
    </Suspense>
  );
}
