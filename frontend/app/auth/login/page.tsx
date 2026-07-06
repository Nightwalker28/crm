"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { AnimatedShinyText } from "@/components/ui/AnimatedShinyText";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";

type SignInForm = {
  email: string;
  password: string;
};

type LoginStep = "login" | "mfa_challenge" | "mfa_setup";

const emptySignIn: SignInForm = {
  email: "",
  password: "",
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6.5a5.6 5.6 0 0 1-2.4 3.7v2.7h3.5c2-1.9 3.2-4.6 3.2-7.9z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.8-3a7.2 7.2 0 0 1-10.7-3.8H1.7v2.8A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.4 14.3a7.1 7.1 0 0 1 0-4.6V6.9H1.7a12 12 0 0 0 0 10.2z" />
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3A11.9 11.9 0 0 0 1.7 6.9l3.7 2.8A7.2 7.2 0 0 1 12 4.8z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [microsoftLoading, setMicrosoftLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signIn, setSignIn] = useState<SignInForm>(emptySignIn);
  const [loginStep, setLoginStep] = useState<LoginStep>("login");
  const [mfaToken, setMfaToken] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBackupCode, setMfaBackupCode] = useState("");
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaOtpAuthUri, setMfaOtpAuthUri] = useState("");
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = useState<string[]>([]);

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

  async function handleMicrosoftLogin() {
    try {
      setError(null);
      setMicrosoftLoading(true);
      const res = await apiFetch("/auth/microsoft");
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      window.location.href = data.auth_url;
    } catch (loginError) {
      setError(getErrorMessage(loginError, "Failed to start Microsoft sign-in"));
      setMicrosoftLoading(false);
    }
  }

  async function handleSsoLogin() {
    try {
      setError(null);
      setSsoLoading(true);
      const email = signIn.email.trim();
      const res = await apiFetch("/auth/sso/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(email ? { email } : {}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.detail ?? data?.message ?? `Status ${res.status}`);
      }
      window.location.href = data.auth_url;
    } catch (loginError) {
      setError(getErrorMessage(loginError, "Failed to start SSO sign-in"));
      setSsoLoading(false);
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

      if (data?.status === "mfa_required" && typeof data.mfa_token === "string") {
        setMfaToken(data.mfa_token);
        setMfaCode("");
        setMfaBackupCode("");
        setLoginStep("mfa_challenge");
        return;
      }

      if (data?.status === "mfa_setup_required") {
        await startMfaSetup();
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch (loginError) {
      setError(getErrorMessage(loginError, "Failed to sign in"));
    } finally {
      setFormLoading(false);
    }
  }

  async function startMfaSetup() {
    setMfaLoading(true);
    try {
      const res = await apiFetch("/auth/mfa/setup", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail ?? data?.message ?? `Status ${res.status}`);
      setMfaSecret(data.secret ?? "");
      setMfaOtpAuthUri(data.otpauth_uri ?? "");
      setMfaCode("");
      setMfaRecoveryCodes([]);
      setLoginStep("mfa_setup");
    } catch (setupError) {
      setLoginStep("login");
      setMfaSecret("");
      setMfaOtpAuthUri("");
      setMfaCode("");
      setMfaRecoveryCodes([]);
      setError(getErrorMessage(setupError, "Failed to start MFA setup"));
    } finally {
      setMfaLoading(false);
    }
  }

  async function handleMfaChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMfaLoading(true);
    try {
      const res = await apiFetch("/auth/mfa/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mfa_token: mfaToken,
          code: mfaCode.trim() || null,
          backup_code: mfaBackupCode.trim() || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail ?? data?.message ?? `Status ${res.status}`);
      router.replace("/dashboard");
      router.refresh();
    } catch (challengeError) {
      setError(getErrorMessage(challengeError, "Failed to verify MFA"));
    } finally {
      setMfaLoading(false);
    }
  }

  async function handleEnableMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMfaLoading(true);
    try {
      const res = await apiFetch("/auth/mfa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: mfaCode.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail ?? data?.message ?? `Status ${res.status}`);
      setMfaRecoveryCodes(Array.isArray(data?.backup_codes) ? data.backup_codes : []);
    } catch (enableError) {
      setError(getErrorMessage(enableError, "Failed to enable MFA"));
    } finally {
      setMfaLoading(false);
    }
  }

  return (
    <>
      <h1 className="mb-3 bg-linear-to-b from-gray-50 to-gray-300 bg-clip-text text-7xl font-lynk text-transparent">
        Lynk
      </h1>

      <p className="mb-6 text-sm text-slate-200/80">Sign in with your provisioned account.</p>

      {loginStep === "login" ? (
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
          disabled={formLoading || googleLoading || microsoftLoading || ssoLoading}
          className="w-full cursor-pointer rounded-md border border-white/20 bg-white px-4 py-3 text-sm font-medium text-black transition-all hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {formLoading ? "Signing in..." : "Sign in with email"}
        </button>
      </form>
      ) : null}

      {loginStep === "mfa_challenge" ? (
        <form className="space-y-4 text-left" onSubmit={handleMfaChallenge}>
          <div className="rounded-md border border-amber-800/50 bg-amber-950/30 px-3 py-3 text-sm text-amber-100">
            Enter your authenticator code or one recovery code to finish signing in.
          </div>
          <div className="space-y-2">
            <Label htmlFor="mfa-code">Authenticator Code</Label>
            <Input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mfa-backup-code">Recovery Code</Label>
            <Input
              id="mfa-backup-code"
              value={mfaBackupCode}
              onChange={(event) => setMfaBackupCode(event.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={mfaLoading || (!mfaCode.trim() && !mfaBackupCode.trim())}
            className="w-full cursor-pointer rounded-md border border-white/20 bg-white px-4 py-3 text-sm font-medium text-black transition-all hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mfaLoading ? "Verifying..." : "Verify MFA"}
          </button>
        </form>
      ) : null}

      {loginStep === "mfa_setup" ? (
        <form className="space-y-4 text-left" onSubmit={handleEnableMfa}>
          {mfaRecoveryCodes.length ? (
            <>
              <div className="rounded-md border border-emerald-800/50 bg-emerald-950/30 px-3 py-3 text-sm text-emerald-100">
                MFA is enabled. Save these recovery codes before continuing.
              </div>
              <div className="grid gap-2 rounded-md border border-neutral-800 bg-neutral-950/70 p-3 font-mono text-xs text-neutral-200">
                {mfaRecoveryCodes.map((code) => <div key={code}>{code}</div>)}
              </div>
              <button
                type="button"
                onClick={() => {
                  router.replace("/dashboard");
                  router.refresh();
                }}
                className="w-full cursor-pointer rounded-md border border-white/20 bg-white px-4 py-3 text-sm font-medium text-black transition-all hover:bg-white/90"
              >
                Continue to dashboard
              </button>
            </>
          ) : (
            <>
              <div className="rounded-md border border-amber-800/50 bg-amber-950/30 px-3 py-3 text-sm text-amber-100">
                Your tenant requires MFA. Add this secret to an authenticator app, then enter the 6-digit code.
              </div>
              <div className="rounded-md border border-neutral-800 bg-neutral-950/70 p-3">
                <div className="text-xs uppercase tracking-wide text-neutral-500">Secret</div>
                <div className="mt-2 break-all font-mono text-sm text-neutral-100">{mfaSecret}</div>
              </div>
              {mfaOtpAuthUri ? (
                <a className="block break-all text-xs text-neutral-400 underline-offset-4 hover:underline" href={mfaOtpAuthUri}>
                  Open authenticator setup link
                </a>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="setup-mfa-code">Authenticator Code</Label>
                <Input
                  id="setup-mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value)}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={mfaLoading || !mfaCode.trim()}
                className="w-full cursor-pointer rounded-md border border-white/20 bg-white px-4 py-3 text-sm font-medium text-black transition-all hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {mfaLoading ? "Enabling..." : "Enable MFA"}
              </button>
            </>
          )}
        </form>
      ) : null}

      {loginStep === "login" ? <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-[0.25em] text-slate-400/70">
        <div className="h-px flex-1 bg-white/10" />
        <span>or</span>
        <div className="h-px flex-1 bg-white/10" />
      </div> : null}

      {loginStep === "login" ? (
      <>
      <button
        type="button"
        onClick={handleSsoLogin}
        disabled={googleLoading || microsoftLoading || formLoading || ssoLoading}
        className="group relative mt-2 w-full cursor-pointer overflow-hidden rounded-md border border-white/25 bg-neutral-950/90 px-4 py-3 text-sm font-medium text-neutral-50 shadow-[0_0_15px_rgba(0,0,0,0.45)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-white/60 hover:shadow-[0_12px_25px_rgba(0,0,0,0.65)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="relative z-10 flex items-center justify-center gap-3">
          <AnimatedShinyText shimmerWidth={40}>
            {ssoLoading ? "Redirecting..." : "Continue with SSO"}
          </AnimatedShinyText>
        </span>
      </button>

      <button
        onClick={handleGoogleLogin}
        disabled={googleLoading || microsoftLoading || formLoading || ssoLoading}
        className="group relative mt-2 w-full cursor-pointer overflow-hidden rounded-md border border-white/25 bg-neutral-950/90 px-4 py-3 text-sm font-medium text-neutral-50 shadow-[0_0_15px_rgba(0,0,0,0.45)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-white/60 hover:shadow-[0_12px_25px_rgba(0,0,0,0.65)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 bg-[radial-gradient(circle_at_15%_20%,rgba(255,255,255,0.10),transparent_65%),radial-gradient(circle_at_85%_80%,rgba(255,255,255,0.06),transparent_65%)] group-hover:opacity-100" />

        <span className="relative z-10 flex items-center justify-center gap-3">
          <GoogleMark />
          <AnimatedShinyText shimmerWidth={40}>
            {googleLoading ? "Redirecting..." : "Sign in with Google"}
          </AnimatedShinyText>
        </span>
      </button>

      <button
        onClick={handleMicrosoftLogin}
        disabled={googleLoading || microsoftLoading || formLoading || ssoLoading}
        className="group relative mt-3 w-full cursor-pointer overflow-hidden rounded-md border border-white/25 bg-neutral-950/90 px-4 py-3 text-sm font-medium text-neutral-50 shadow-[0_0_15px_rgba(0,0,0,0.45)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-white/60 hover:shadow-[0_12px_25px_rgba(0,0,0,0.65)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="relative z-10 flex items-center justify-center gap-3">
          <span className="grid h-5 w-5 grid-cols-2 gap-0.5" aria-hidden="true">
            <span className="bg-[#f25022]" />
            <span className="bg-[#7fba00]" />
            <span className="bg-[#00a4ef]" />
            <span className="bg-[#ffb900]" />
          </span>
          <AnimatedShinyText shimmerWidth={40}>
            {microsoftLoading ? "Redirecting..." : "Sign in with Microsoft"}
          </AnimatedShinyText>
        </span>
      </button>
      </>
      ) : null}

      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
    </>
  );
}
