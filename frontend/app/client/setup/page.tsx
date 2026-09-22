"use client";

import type { FormEvent } from "react";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AuthAtmosphere } from "@/components/auth/AuthAtmosphere";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <>
      <h1 className="mb-3 bg-linear-to-b from-copy-primary to-copy-secondary bg-clip-text font-lynk text-7xl text-transparent">
        Lynk
      </h1>

      <p className="mb-6 text-sm text-copy-secondary">Create the password for your client portal access.</p>

      {status === "done" ? (
        <div className="rounded-[var(--radius-control)] border border-state-success/40 bg-state-success-muted px-3 py-3 text-left">
          <p className="text-sm text-state-success">Password set. You can now sign in from any shared client page.</p>
          <Button asChild className="mt-4 w-full">
            <Link href={loginHref(tenantSlug)}>Go to client sign in</Link>
          </Button>
        </div>
      ) : (
        <form className="space-y-4 text-left" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="client-setup-password">Password</Label>
            <Input id="client-setup-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            {passwordPolicy ? (
              <ul className="space-y-1 text-xs text-copy-secondary">
                {passwordPolicy.requirements.map((requirement) => (
                  <li key={requirement}>{requirement}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-copy-secondary">Password must meet the current security policy.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="client-setup-confirm">Confirm password</Label>
            <Input id="client-setup-confirm" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
          </div>
          <Button type="submit" className="w-full" disabled={status === "saving"}>
            {status === "saving" ? "Saving…" : "Set password"}
          </Button>
        </form>
      )}

      {error ? <p className="mt-3 text-xs text-state-danger">{error}</p> : null}
    </>
  );
}

export default function ClientSetupPage() {
  return (
    <AuthAtmosphere>
      <Suspense fallback={<p className="text-sm text-copy-secondary">Loading setup link…</p>}>
        <ClientSetupContent />
      </Suspense>
    </AuthAtmosphere>
  );
}
