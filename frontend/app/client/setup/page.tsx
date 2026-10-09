"use client";

import type { FormEvent } from "react";
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { AuthAtmosphere } from "@/components/auth/AuthAtmosphere";
import { ClientPasswordFields, passwordPolicyError, usePasswordPolicy } from "@/components/client-portal/ClientPasswordFields";
import { Button } from "@/components/ui/button";
import { clientSetupInfo, setupClientPassword } from "@/hooks/useClientPortal";

function loginHref(tenantSlug: string | null) {
  return tenantSlug ? `/client/login?tenant=${encodeURIComponent(tenantSlug)}` : "/client/login";
}

function ClientSetupContent() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const tenantSlug = useMemo(() => searchParams.get("tenant") || searchParams.get("tenant_slug"), [searchParams]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const policy = usePasswordPolicy();
  // 13d §3.7: whose invitation this is, in plain words.
  const info = useQuery({
    queryKey: ["client-setup-info", token],
    queryFn: () => clientSetupInfo({ token, tenant_slug: tenantSlug }),
    enabled: token.length >= 16,
    retry: false,
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const problem = passwordPolicyError(password, confirm, policy);
    if (problem) {
      setError(problem);
      return;
    }
    setStatus("saving");
    try {
      await setupClientPassword({ token, password, tenant_slug: tenantSlug });
      setStatus("done");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your password could not be set. Try again.");
      setStatus("idle");
    }
  }

  const company = info.data?.company_name;
  const broken = !token || info.isError;
  return (
    <>
      <h1 className="mb-3 bg-linear-to-b from-copy-primary to-copy-secondary bg-clip-text font-lynk text-7xl text-transparent">
        Lynk
      </h1>
      <p className="mb-1 text-sm font-medium text-copy-primary">
        {company ? `Set your password to sign in to ${company}` : "Set your password"}
      </p>
      <p className="mb-6 text-sm text-copy-secondary">
        {info.data?.email ? `You will sign in as ${info.data.email}.` : "Choose the password for your client account."}
      </p>

      {broken ? (
        <p role="alert" className="text-sm text-state-danger">
          This setup link is invalid or has expired. Ask the person who invited you for a new one.
        </p>
      ) : status === "done" ? (
        <div className="rounded-[var(--radius-control)] border border-state-success/40 bg-state-success-muted px-3 py-3 text-left">
          <p className="text-sm text-copy-primary">Your password is set.</p>
          <Button asChild className="mt-4 w-full">
            <Link href={loginHref(tenantSlug)}>Sign in</Link>
          </Button>
        </div>
      ) : (
        <form className="space-y-4 text-left" onSubmit={handleSubmit}>
          <ClientPasswordFields idPrefix="client-setup" label="Password" password={password} confirm={confirm}
            onPasswordChange={setPassword} onConfirmChange={setConfirm} policy={policy} />
          <Button type="submit" className="w-full" disabled={status === "saving"}>
            {status === "saving" ? "Saving…" : "Set password"}
          </Button>
        </form>
      )}

      {error ? <p role="alert" className="mt-3 text-xs text-state-danger">{error}</p> : null}
    </>
  );
}

export default function ClientSetupPage() {
  return (
    <AuthAtmosphere>
      <Suspense fallback={<p className="text-sm text-copy-secondary">Loading…</p>}>
        <ClientSetupContent />
      </Suspense>
    </AuthAtmosphere>
  );
}
