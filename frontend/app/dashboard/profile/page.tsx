"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Textarea } from "@/components/ui/textarea";
import { resolveMediaUrl } from "@/lib/media";
import TimezonePicker from "@/components/ui/TimezonePicker";

type ProfileResponse = {
  first_name?: string | null;
  last_name?: string | null;
  email: string;
  photo_url?: string | null;
  phone_number?: string | null;
  job_title?: string | null;
  timezone?: string | null;
  bio?: string | null;
  team_name?: string | null;
  role_name?: string | null;
  mfa_enabled?: boolean;
  mfa_required?: boolean;
};

type ProfileForm = {
  first_name: string;
  last_name: string;
  photo_url: string;
  phone_number: string;
  job_title: string;
  timezone: string;
  bio: string;
};

const emptyForm: ProfileForm = {
  first_name: "",
  last_name: "",
  photo_url: "",
  phone_number: "",
  job_title: "",
  timezone: "",
  bio: "",
};

export default function ProfilePage() {
  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [email, setEmail] = useState("");
  const [teamName, setTeamName] = useState<string | null>(null);
  const [roleName, setRoleName] = useState<string | null>(null);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaOtpAuthUri, setMfaOtpAuthUri] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBackupCode, setMfaBackupCode] = useState("");
  const [mfaPassword, setMfaPassword] = useState("");
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = useState<string[]>([]);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiFetch("/users/me");
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(body?.detail ?? `Failed with ${res.status}`);
        }
        if (cancelled) return;

        const data = body as ProfileResponse;
        setForm({
          first_name: data.first_name ?? "",
          last_name: data.last_name ?? "",
          photo_url: data.photo_url ?? "",
          phone_number: data.phone_number ?? "",
          job_title: data.job_title ?? "",
          timezone: data.timezone ?? "",
          bio: data.bio ?? "",
        });
        setEmail(data.email ?? "");
        setTeamName(data.team_name ?? null);
        setRoleName(data.role_name ?? null);
        setMfaEnabled(Boolean(data.mfa_enabled));
        setMfaRequired(Boolean(data.mfa_required));
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load profile");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);

      const payload = {
        first_name: form.first_name.trim() || null,
        last_name: form.last_name.trim() || null,
        photo_url: form.photo_url.trim() || null,
        phone_number: form.phone_number.trim() || null,
        job_title: form.job_title.trim() || null,
        timezone: form.timezone.trim() || null,
        bio: form.bio.trim() || null,
      };

      const res = await apiFetch("/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.detail ?? `Failed with ${res.status}`);
      }

      sessionStorage.setItem("lynk_user", JSON.stringify(body));
      toast.success("Profile updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  async function handlePhotoUpload(file: File) {
    try {
      setUploadingPhoto(true);
      setError(null);

      const formData = new FormData();
      formData.append("file", file);

      const res = await apiFetch("/users/me/photo", {
        method: "POST",
        body: formData,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.detail ?? `Failed with ${res.status}`);
      }

      setForm((current) => ({ ...current, photo_url: body.photo_url ?? "" }));
      if (body?.user) {
        sessionStorage.setItem("lynk_user", JSON.stringify(body.user));
      }
      toast.success("Profile image uploaded.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to upload profile image");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleStartMfaSetup() {
    try {
      setMfaBusy(true);
      setError(null);
      const res = await apiFetch("/auth/mfa/setup", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      setMfaSecret(body.secret ?? "");
      setMfaOtpAuthUri(body.otpauth_uri ?? "");
      setMfaCode("");
      setMfaRecoveryCodes([]);
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Failed to start MFA setup");
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleEnableMfa() {
    try {
      setMfaBusy(true);
      setError(null);
      const res = await apiFetch("/auth/mfa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: mfaCode.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      setMfaEnabled(true);
      setMfaRecoveryCodes(Array.isArray(body?.backup_codes) ? body.backup_codes : []);
      setMfaCode("");
      toast.success("MFA enabled.");
    } catch (enableError) {
      setError(enableError instanceof Error ? enableError.message : "Failed to enable MFA");
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleDisableMfa() {
    try {
      setMfaBusy(true);
      setError(null);
      const res = await apiFetch("/auth/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: mfaPassword,
          code: mfaCode.trim() || null,
          backup_code: mfaBackupCode.trim() || null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      setMfaEnabled(false);
      setMfaSecret("");
      setMfaOtpAuthUri("");
      setMfaCode("");
      setMfaBackupCode("");
      setMfaPassword("");
      toast.success("MFA disabled.");
    } catch (disableError) {
      setError(disableError instanceof Error ? disableError.message : "Failed to disable MFA");
    } finally {
      setMfaBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="Profile"
        description="Manage your personal details and account-facing profile information."
      />

      {error ? (
        <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <Card className="px-5 py-5">
        {loading ? (
          <div className="text-sm text-neutral-500">Loading profile...</div>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                <div className="text-xs uppercase tracking-wide text-neutral-500">Email</div>
                <div className="mt-2 text-sm text-neutral-100">{email}</div>
              </div>
              <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                <div className="text-xs uppercase tracking-wide text-neutral-500">Team</div>
                <div className="mt-2 text-sm text-neutral-100">{teamName || "Unassigned"}</div>
              </div>
              <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                <div className="text-xs uppercase tracking-wide text-neutral-500">Role</div>
                <div className="mt-2 text-sm text-neutral-100">{roleName || "Unassigned"}</div>
              </div>
            </div>

            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>First Name</FieldLabel>
                <Input value={form.first_name} onChange={(event) => setForm((current) => ({ ...current, first_name: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Last Name</FieldLabel>
                <Input value={form.last_name} onChange={(event) => setForm((current) => ({ ...current, last_name: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Job Title</FieldLabel>
                <Input value={form.job_title} onChange={(event) => setForm((current) => ({ ...current, job_title: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Phone Number</FieldLabel>
                <Input value={form.phone_number} onChange={(event) => setForm((current) => ({ ...current, phone_number: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Timezone</FieldLabel>
                <TimezonePicker
                  value={form.timezone}
                  onChange={(value) => setForm((current) => ({ ...current, timezone: value }))}
                  placeholder="Search country or city"
                />
                <FieldDescription>Search by country or city. The platform stores the actual timezone value for display conversion.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Photo URL</FieldLabel>
                <Input value={form.photo_url} onChange={(event) => setForm((current) => ({ ...current, photo_url: event.target.value }))} placeholder="https://..." />
                <div className="mt-3 flex items-center gap-3">
                  {form.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={resolveMediaUrl(form.photo_url)}
                      alt="Profile preview"
                      className="h-12 w-12 rounded-lg border border-neutral-800 object-cover"
                    />
                  ) : null}
                  <label className="inline-flex cursor-pointer items-center rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900">
                    {uploadingPhoto ? "Uploading..." : "Upload Photo"}
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void handlePhotoUpload(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
              </Field>
              <Field className="md:col-span-2">
                <FieldLabel>Bio</FieldLabel>
                <Textarea value={form.bio} onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))} rows={4} />
                <FieldDescription>This is lightweight profile context for now. Permissions and auditability land in later phases.</FieldDescription>
              </Field>
            </FieldGroup>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save Profile"}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="px-5 py-5">
        <div className="mb-4 flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-neutral-100">Account Security</h2>
          <p className="text-sm text-neutral-500">Manage local app MFA for manual CRM sign-in.</p>
        </div>

        {loading ? (
          <div className="text-sm text-neutral-500">Loading security settings...</div>
        ) : (
          <div className="grid gap-4">
            <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
              <div className="text-xs uppercase tracking-wide text-neutral-500">MFA Status</div>
              <div className="mt-2 text-sm text-neutral-100">
                {mfaEnabled ? "Enabled" : mfaRequired ? "Required by tenant policy" : "Off"}
              </div>
            </div>

            {!mfaEnabled ? (
              <div className="grid gap-4">
                {!mfaSecret ? (
                  <Button type="button" onClick={() => void handleStartMfaSetup()} disabled={mfaBusy}>
                    {mfaBusy ? "Starting..." : "Set Up MFA"}
                  </Button>
                ) : (
                  <div className="grid gap-3">
                    <div className="rounded-md border border-neutral-800 bg-neutral-950/60 p-3">
                      <div className="text-xs uppercase tracking-wide text-neutral-500">Authenticator Secret</div>
                      <div className="mt-2 break-all font-mono text-sm text-neutral-100">{mfaSecret}</div>
                    </div>
                    {mfaOtpAuthUri ? (
                      <a href={mfaOtpAuthUri} className="text-sm text-neutral-300 underline-offset-4 hover:underline">
                        Open authenticator setup link
                      </a>
                    ) : null}
                    <Field>
                      <FieldLabel>Authenticator Code</FieldLabel>
                      <Input value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" />
                    </Field>
                    <Button type="button" onClick={() => void handleEnableMfa()} disabled={mfaBusy || !mfaCode.trim()}>
                      {mfaBusy ? "Enabling..." : "Enable MFA"}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                <Field>
                  <FieldLabel>Current Password</FieldLabel>
                  <Input type="password" value={mfaPassword} onChange={(event) => setMfaPassword(event.target.value)} />
                </Field>
                <Field>
                  <FieldLabel>Authenticator Code</FieldLabel>
                  <Input value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" />
                </Field>
                <Field>
                  <FieldLabel>Recovery Code</FieldLabel>
                  <Input value={mfaBackupCode} onChange={(event) => setMfaBackupCode(event.target.value)} />
                </Field>
                <div className="md:col-span-3">
                  <Button type="button" variant="outline" onClick={() => void handleDisableMfa()} disabled={mfaBusy || !mfaPassword || (!mfaCode.trim() && !mfaBackupCode.trim())}>
                    {mfaBusy ? "Disabling..." : "Disable MFA"}
                  </Button>
                </div>
              </div>
            )}

            {mfaRecoveryCodes.length ? (
              <div className="rounded-md border border-emerald-800/50 bg-emerald-950/20 p-3">
                <div className="mb-2 text-sm font-semibold text-emerald-100">Recovery Codes</div>
                <div className="grid gap-1 font-mono text-xs text-emerald-50">
                  {mfaRecoveryCodes.map((code) => <span key={code}>{code}</span>)}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}
