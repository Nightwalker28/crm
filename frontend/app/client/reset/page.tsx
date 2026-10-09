"use client";

import type { FormEvent } from "react";
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AuthAtmosphere } from "@/components/auth/AuthAtmosphere";
import { ClientPasswordFields, passwordPolicyError, usePasswordPolicy } from "@/components/client-portal/ClientPasswordFields";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/ui/TextLink";
import { resetClientPassword } from "@/hooks/useClientPortal";

/** The emailed reset link's page (13d §3.7): single use, for an hour. */
function ClientResetContent() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const tenantSlug = useMemo(() => searchParams.get("tenant") || searchParams.get("tenant_slug"), [searchParams]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const policy = usePasswordPolicy();
  const query = tenantSlug ? `?tenant=${encodeURIComponent(tenantSlug)}` : "";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const problem = passwordPolicyError(password, confirm, policy);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await resetClientPassword({ token, password, tenant_slug: tenantSlug });
      setDone(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your password could not be changed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="mb-3 bg-linear-to-b from-copy-primary to-copy-secondary bg-clip-text font-lynk text-7xl text-transparent">
        Lynk
      </h1>
      <p className="mb-6 text-sm text-copy-secondary">Choose a new password for your client account.</p>
      {!token ? (
        <p role="alert" className="text-sm text-state-danger">
          This reset link is incomplete. <TextLink href={`/client/forgot${query}`}>Ask for a new one</TextLink>.
        </p>
      ) : done ? (
        <div className="space-y-4 text-left">
          <p role="status" className="text-sm text-copy-secondary">Your password is changed. Sign in with the new one.</p>
          <Button asChild className="w-full"><Link href={`/client/login${query}`}>Sign in</Link></Button>
        </div>
      ) : (
        <form className="space-y-4 text-left" onSubmit={handleSubmit}>
          <ClientPasswordFields idPrefix="client-reset" password={password} confirm={confirm} onPasswordChange={setPassword}
            onConfirmChange={setConfirm} policy={policy} />
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Change password"}</Button>
        </form>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-xs text-state-danger">
          {error} {error.includes("expired") ? <TextLink href={`/client/forgot${query}`}>Ask for a new link</TextLink> : null}
        </p>
      ) : null}
    </>
  );
}

export default function ClientResetPage() {
  return (
    <AuthAtmosphere>
      <Suspense fallback={<p className="text-sm text-copy-secondary">Loading…</p>}>
        <ClientResetContent />
      </Suspense>
    </AuthAtmosphere>
  );
}
