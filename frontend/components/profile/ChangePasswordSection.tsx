"use client";

import { useState } from "react";
import { toast } from "sonner";

import { PasswordPolicyHint, usePasswordPolicy } from "@/components/auth/NewPasswordForm";
import { FormSection } from "@/components/forms/RecordFormLayout";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";

type Errors = { current?: string; next?: string; confirm?: string; form?: string };

function errorText(detail: unknown): { field: keyof Errors; message: string } {
  if (detail && typeof detail === "object" && (detail as { code?: string }).code === "current_password_invalid") {
    return { field: "current", message: "Current password is incorrect" };
  }
  if (typeof detail === "string" && detail) return { field: "next", message: detail };
  return { field: "form", message: "The password could not be changed. Try again." };
}

/**
 * The signed-in user's own password change (13 F0.7 B3). The server signs every other
 * device out and gives this browser a fresh session, so the page stays usable.
 */
export function ChangePasswordSection({ passwordSet, onChanged }: { passwordSet: boolean; onChanged: () => void }) {
  const policy = usePasswordPolicy();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (newPassword !== confirmPassword) {
      setErrors({ confirm: "Passwords do not match" });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const res = await apiFetch("/auth/password/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: passwordSet ? currentPassword : null, new_password: newPassword }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 429) {
        setErrors({ form: "Too many attempts. Wait a few minutes, then try again." });
        return;
      }
      if (!res.ok) {
        const { field, message } = errorText(data?.detail);
        setErrors({ [field]: message });
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password changed. Your other devices are signed out.");
      onChanged();
    } catch {
      setErrors({ form: "The password could not be changed. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSection
      title="Password"
      description={
        passwordSet
          ? "Changing your password signs you out on every other device."
          : "You sign in with a provider. Set a password to also sign in with your email."
      }
    >
      <FieldGroup className="grid gap-4 md:grid-cols-3">
        {passwordSet ? (
          <Field data-invalid={Boolean(errors.current) || undefined}>
            <FieldLabel htmlFor="profile-current-password">Current password</FieldLabel>
            <Input
              id="profile-current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              aria-invalid={Boolean(errors.current) || undefined}
            />
            {errors.current ? <FieldError>{errors.current}</FieldError> : null}
          </Field>
        ) : null}
        <Field data-invalid={Boolean(errors.next) || undefined}>
          <FieldLabel htmlFor="profile-new-password">New password</FieldLabel>
          <Input
            id="profile-new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            aria-invalid={Boolean(errors.next) || undefined}
          />
          {errors.next ? <FieldError>{errors.next}</FieldError> : <PasswordPolicyHint policy={policy} />}
        </Field>
        <Field data-invalid={Boolean(errors.confirm) || undefined}>
          <FieldLabel htmlFor="profile-confirm-password">Confirm new password</FieldLabel>
          <Input
            id="profile-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            aria-invalid={Boolean(errors.confirm) || undefined}
          />
          {errors.confirm ? <FieldError>{errors.confirm}</FieldError> : null}
        </Field>
      </FieldGroup>
      {errors.form ? <p role="alert" className="mt-3 text-sm text-state-danger">{errors.form}</p> : null}
      <Button
        className="mt-4 w-fit"
        type="button"
        onClick={() => void handleSubmit()}
        disabled={busy || !newPassword || !confirmPassword || (passwordSet && !currentPassword)}
      >
        {busy ? "Changing…" : passwordSet ? "Change password" : "Set password"}
      </Button>
    </FormSection>
  );
}
