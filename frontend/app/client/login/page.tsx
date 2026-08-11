"use client";

import type { FormEvent } from "react";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CLIENT_TOKEN_STORAGE_KEY, clientLogin } from "@/hooks/useClientPortal";

function getError() {
  return "Sign-in failed. Check your credentials and try again.";
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
    <main className="min-h-screen bg-app px-4 py-10 text-copy-primary">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md flex-col justify-center">
        <div className="mb-8">
          <div className="mb-3 font-lynk text-4xl text-copy-primary">Lynk</div>
          <h1 className="text-2xl font-semibold">Client sign in</h1>
          <p className="mt-2 text-sm text-copy-secondary">Sign in to view personalized pricing for shared pages.</p>
        </div>

        <form className="space-y-4 rounded-[var(--radius-card)] border border-line-default bg-surface p-5" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="client-login-email" className="mb-2 block text-sm font-medium">Email</label>
            <Input id="client-login-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </div>
          <div>
            <label htmlFor="client-login-password" className="mb-2 block text-sm font-medium">Password</label>
            <Input id="client-login-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign In"}
          </Button>
          {error ? <p className="text-sm text-state-danger">{error}</p> : null}
        </form>
      </div>
    </main>
  );
}

export default function ClientLoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-app p-8 text-sm text-copy-secondary">Loading sign in...</main>}>
      <ClientLoginContent />
    </Suspense>
  );
}
