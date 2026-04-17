"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { AnimatedShinyText } from "@/components/ui/AnimatedShinyText";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";

type SignInForm = {
  email: string;
  password: string;
};

const emptySignIn: SignInForm = {
  email: "",
  password: "",
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function LoginPage() {
  const router = useRouter();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signIn, setSignIn] = useState<SignInForm>(emptySignIn);

  async function handleGoogleLogin() {
    try {
      setError(null);
      setGoogleLoading(true);

      const res = await apiFetch("/auth/google");
      if (!res.ok) throw new Error(`Status ${res.status}`);

      const data = await res.json();
      window.location.href = data.auth_url;
    } catch (loginError) {
      setError(getErrorMessage(loginError, "Failed to start Google sign-in"));
      setGoogleLoading(false);
    }
  }

  async function handleManualSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFormLoading(true);

    try {
      const res = await apiFetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signIn),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = data?.detail;
        if (detail && typeof detail === "object" && detail.code === "password_setup_required") {
          if (typeof detail.setup_link === "string" && detail.setup_link) {
            window.location.href = detail.setup_link;
            return;
          }
          throw new Error(detail.message ?? "This account still needs a password setup link.");
        }

        const detailMessage =
          typeof detail === "string"
            ? detail
            : typeof detail?.message === "string"
              ? detail.message
              : data?.message;
        throw new Error(detailMessage ?? `Status ${res.status}`);
      }

      router.replace("/dashboard");
      router.refresh();
    } catch (loginError) {
      setError(getErrorMessage(loginError, "Failed to sign in"));
    } finally {
      setFormLoading(false);
    }
  }

  return (
    <>
      <h1 className="mb-3 bg-linear-to-b from-gray-50 to-gray-300 bg-clip-text text-7xl font-lynk text-transparent">
        Lynk
      </h1>

      <p className="mb-6 text-sm text-slate-200/80">Sign in with your provisioned account.</p>

      <form className="space-y-4 text-left" onSubmit={handleManualSignIn}>
        <div className="space-y-2">
          <Label htmlFor="signin-email">Email</Label>
          <Input
            id="signin-email"
            type="email"
            autoComplete="email"
            value={signIn.email}
            onChange={(event) => setSignIn((current) => ({ ...current, email: event.target.value }))}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="signin-password">Password</Label>
          <Input
            id="signin-password"
            type="password"
            autoComplete="current-password"
            value={signIn.password}
            onChange={(event) => setSignIn((current) => ({ ...current, password: event.target.value }))}
            required
          />
        </div>

        <button
          type="submit"
          disabled={formLoading || googleLoading}
          className="w-full cursor-pointer rounded-md border border-white/20 bg-white px-4 py-3 text-sm font-medium text-black transition-all hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {formLoading ? "Signing in..." : "Sign in with email"}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-[0.25em] text-slate-400/70">
        <div className="h-px flex-1 bg-white/10" />
        <span>or</span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <button
        onClick={handleGoogleLogin}
        disabled={googleLoading || formLoading}
        className="group relative mt-2 w-full cursor-pointer overflow-hidden rounded-md border border-white/25 bg-neutral-950/90 px-4 py-3 text-sm font-medium text-neutral-50 shadow-[0_0_15px_rgba(0,0,0,0.45)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-white/60 hover:shadow-[0_12px_25px_rgba(0,0,0,0.65)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 bg-[radial-gradient(circle_at_15%_20%,rgba(255,255,255,0.10),transparent_65%),radial-gradient(circle_at_85%_80%,rgba(255,255,255,0.06),transparent_65%)] group-hover:opacity-100" />

        <span className="relative z-10 flex items-center justify-center gap-3">
          <Image
            src="https://www.svgrepo.com/show/475656/google-color.svg"
            alt="google"
            width={20}
            height={20}
            className="h-5 w-5"
          />
          <AnimatedShinyText shimmerWidth={40}>
            {googleLoading ? "Redirecting..." : "Sign in with Google"}
          </AnimatedShinyText>
        </span>
      </button>

      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
    </>
  );
}
