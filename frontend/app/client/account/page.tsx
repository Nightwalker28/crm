"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { ClientPasswordFields, passwordPolicyError, usePasswordPolicy } from "@/components/client-portal/ClientPasswordFields";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageShell } from "@/components/ui/PageShell";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { changeClientPassword, useClientMe } from "@/hooks/useClientPortal";

/** *Change password*, from the portal's account menu (13d §3.7). */
export default function ClientAccountPage() {
  const me = useClientMe();
  const policy = usePasswordPolicy();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      await changeClientPassword({ current_password: current, new_password: password });
      setCurrent("");
      setPassword("");
      setConfirm("");
      toast.success("Your password is changed.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your password could not be changed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell
      title="Your account"
      description={me.data ? `You sign in as ${me.data.email}.` : undefined}
      isLoading={me.isLoading}
      hasError={Boolean(me.error)}
      onRetry={() => me.refetch()}
      backHref="/client"
      backLabel="Return to the portal"
    >
      <Card className="max-w-md p-6">
        <SectionHeading>Change password</SectionHeading>
        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="client-account-current">Current password</Label>
            <Input id="client-account-current" type="password" autoComplete="current-password" value={current}
              onChange={(event) => setCurrent(event.target.value)} required />
          </div>
          <ClientPasswordFields idPrefix="client-account" password={password} confirm={confirm} onPasswordChange={setPassword}
            onConfirmChange={setConfirm} policy={policy} />
          {error ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Change password"}</Button>
        </form>
      </Card>
    </PageShell>
  );
}
