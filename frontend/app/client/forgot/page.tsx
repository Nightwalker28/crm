"use client";

import type { FormEvent } from "react";
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AuthAtmosphere } from "@/components/auth/AuthAtmosphere";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/ui/TextLink";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { forgotClientPassword } from "@/hooks/useClientPortal";

/** *Forgot your password?* (13d §3.7): the answer is the same whether or not the address has an account. */
function ClientForgotContent() {
  const searchParams = useSearchParams();
  const tenantSlug = useMemo(() => searchParams.get("tenant") || searchParams.get("tenant_slug"), [searchParams]);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loginHref = tenantSlug ? `/client/login?tenant=${encodeURIComponent(tenantSlug)}` : "/client/login";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await forgotClientPassword({ email: email.trim(), tenant_slug: tenantSlug });
      setSent(result.detail);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your request could not be sent. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="mb-3 bg-linear-to-b from-copy-primary to-copy-secondary bg-clip-text font-lynk text-7xl text-transparent">
        Lynk
      </h1>
      {sent ? (
        <div className="space-y-4 text-left">
          <p role="status" className="text-sm text-copy-secondary">{sent}</p>
          <Button asChild variant="outline" className="w-full"><Link href={loginHref}>Back to sign in</Link></Button>
        </div>
      ) : (
        <>
          <p className="mb-6 text-sm text-copy-secondary">Enter the email you sign in with, and we will send you a link to choose a new password.</p>
          <form className="space-y-4 text-left" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="client-forgot-email">Email</Label>
              <Input id="client-forgot-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</Button>
          </form>
          <p className="mt-4 text-sm"><TextLink href={loginHref}>Back to sign in</TextLink></p>
        </>
      )}
      {error ? <p role="alert" className="mt-3 text-xs text-state-danger">{error}</p> : null}
    </>
  );
}

export default function ClientForgotPage() {
  return (
    <AuthAtmosphere>
      <Suspense fallback={<p className="text-sm text-copy-secondary">Loading…</p>}>
        <ClientForgotContent />
      </Suspense>
    </AuthAtmosphere>
  );
}
