"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { AnimatedShinyText } from "@/components/ui/AnimatedShinyText";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";

type AuthMode = "signin" | "signup";

type SignInForm = {
  email: string;
  password: string;
};

type SignUpForm = {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  confirmPassword: string;
};

const emptySignIn: SignInForm = {
  email: "",
  password: "",
};

const emptySignUp: SignUpForm = {
  first_name: "",
  last_name: "",
  email: "",
  password: "",
  confirmPassword: "",
};

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [signIn, setSignIn] = useState<SignInForm>(emptySignIn);
  const [signUp, setSignUp] = useState<SignUpForm>(emptySignUp);

  async function handleGoogleLogin() {
    try {
      setError(null);
      setSuccess(null);
      setGoogleLoading(true);

      const res = await apiFetch("/auth/google");
      if (!res.ok) throw new Error(`Status ${res.status}`);

      const data = await res.json();
      window.location.href = data.auth_url;
    } catch (err: any) {
      setError(err.message ?? "Failed to start Google sign-in");
      setGoogleLoading(false);
    }
  }

  async function handleManualSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setFormLoading(true);

    try {
      const res = await apiFetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signIn),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.detail ?? data?.message ?? `Status ${res.status}`);
      }

      router.replace("/dashboard/users");
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? "Failed to sign in");
    } finally {
      setFormLoading(false);
    }
  }

  async function handleManualSignUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (signUp.password !== signUp.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setFormLoading(true);
    try {
      const payload = {
        first_name: signUp.first_name.trim() || null,
        last_name: signUp.last_name.trim() || null,
        email: signUp.email.trim(),
        password: signUp.password,
      };

      const res = await apiFetch("/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.detail ?? data?.message ?? `Status ${res.status}`);
      }

      setSuccess(data?.message ?? "Account created and pending admin approval");
      setMode("signin");
      setSignIn({ email: payload.email, password: "" });
      setSignUp(emptySignUp);
    } catch (err: any) {
      setError(err.message ?? "Failed to sign up");
    } finally {
      setFormLoading(false);
    }
  }

  const modeButtonClass = (target: AuthMode) =>
    `flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      mode === target
        ? "bg-white text-black"
        : "bg-transparent text-neutral-300 hover:text-white"
    }`;

  return (
    <>
      <h1 className="mb-3 bg-linear-to-b from-gray-50 to-gray-300 bg-clip-text text-7xl font-lynk text-transparent">
        Lynk
      </h1>

      <p className="mb-5 text-sm text-slate-200/80">Powered by Acumen Intelligence.</p>

      <div className="mb-5 flex rounded-md border border-white/10 bg-black/30 p-1">
        <button type="button" className={modeButtonClass("signin")} onClick={() => setMode("signin")}>
          Sign In
        </button>
        <button type="button" className={modeButtonClass("signup")} onClick={() => setMode("signup")}>
          Sign Up
        </button>
      </div>

      {mode === "signin" ? (
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
      ) : (
        <form className="space-y-4 text-left" onSubmit={handleManualSignUp}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="signup-first-name">First Name</Label>
              <Input
                id="signup-first-name"
                type="text"
                autoComplete="given-name"
                value={signUp.first_name}
                onChange={(event) => setSignUp((current) => ({ ...current, first_name: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-last-name">Last Name</Label>
              <Input
                id="signup-last-name"
                type="text"
                autoComplete="family-name"
                value={signUp.last_name}
                onChange={(event) => setSignUp((current) => ({ ...current, last_name: event.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="signup-email">Email</Label>
            <Input
              id="signup-email"
              type="email"
              autoComplete="email"
              value={signUp.email}
              onChange={(event) => setSignUp((current) => ({ ...current, email: event.target.value }))}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="signup-password">Password</Label>
            <Input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              value={signUp.password}
              onChange={(event) => setSignUp((current) => ({ ...current, password: event.target.value }))}
              required
            />
            <p className="text-xs text-slate-300/80">Use at least 12 characters.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="signup-confirm-password">Confirm Password</Label>
            <Input
              id="signup-confirm-password"
              type="password"
              autoComplete="new-password"
              value={signUp.confirmPassword}
              onChange={(event) =>
                setSignUp((current) => ({ ...current, confirmPassword: event.target.value }))
              }
              required
            />
          </div>

          <button
            type="submit"
            disabled={formLoading || googleLoading}
            className="w-full cursor-pointer rounded-md border border-white/20 bg-white px-4 py-3 text-sm font-medium text-black transition-all hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {formLoading ? "Creating account..." : "Create account"}
          </button>
        </form>
      )}

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
          <img
            src="https://www.svgrepo.com/show/475656/google-color.svg"
            alt="google"
            className="h-5 w-5"
          />
          <AnimatedShinyText shimmerWidth={40}>
            {googleLoading ? "Redirecting..." : "Sign in with Google"}
          </AnimatedShinyText>
        </span>
      </button>

      {success && <p className="mt-3 text-xs text-emerald-300">{success}</p>}
      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
    </>
  );
}
