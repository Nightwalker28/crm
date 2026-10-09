"use client";

import type { FormEvent } from "react";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AuthAtmosphere } from "@/components/auth/AuthAtmosphere";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/ui/TextLink";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CLIENT_TOKEN_STORAGE_KEY, clientLogin } from "@/hooks/useClientPortal";

function getError() {
  return "That email and password do not match an account. Check them and try again.";
}

function safeClientRedirect(value: string | null) {
  if (!value || value.startsWith("//")) return "/client";
  if (value === "/client" || value.startsWith("/client/")) return value;
  return "/client";
}

function pageTokenFromRedirect(redirect: string) {
  const match = redirect.match(/^\/client\/pages\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function ClientLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = useMemo(() => safeClientRedirect(searchParams.get("redirect")), [searchParams]);
  const tenantSlug = useMemo(
    () => searchParams.get("tenant") || searchParams.get("tenant_slug"),
    [searchParams],
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await clientLogin({
        email,
        password,
        page_token: pageTokenFromRedirect(redirect),
        tenant_slug: tenantSlug,
      });
      window.localStorage.setItem(CLIENT_TOKEN_STORAGE_KEY, result.access_token);
      router.replace(redirect);
      router.refresh();
    } catch {
      setError(getError());
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      {/* The same mark as `/auth/login`, and a subtitle that names which door this is —
          ruling 3: one front door for the product, not one indistinguishable page. */}
      <h1 className="mb-3 bg-linear-to-b from-copy-primary to-copy-secondary bg-clip-text font-lynk text-7xl text-transparent">
        Lynk
      </h1>

      <p className="mb-6 text-sm text-copy-secondary">Sign in to see your quotes, orders and invoices.</p>

      <form className="space-y-4 text-left" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="client-login-email">Email</Label>
          <Input
            id="client-login-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="client-login-password">Password</Label>
          <Input
            id="client-login-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-4 text-sm">
        <TextLink href={tenantSlug ? `/client/forgot?tenant=${encodeURIComponent(tenantSlug)}` : "/client/forgot"}>
          Forgot your password?
        </TextLink>
      </p>

      {error ? <p role="alert" className="mt-3 text-xs text-state-danger">{error}</p> : null}
    </>
  );
}

export default function ClientLoginPage() {
  return (
    <AuthAtmosphere>
      <Suspense fallback={<p className="text-sm text-copy-secondary">Loading sign in…</p>}>
        <ClientLoginContent />
      </Suspense>
    </AuthAtmosphere>
  );
}
