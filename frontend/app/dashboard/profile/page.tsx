"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { Textarea } from "@/components/ui/textarea";
import { resolveMediaUrl } from "@/lib/media";
import TimezonePicker from "@/components/ui/TimezonePicker";
import { useConfirm } from "@/hooks/useConfirm";
import { cacheSidebarUser } from "@/hooks/useSidebarUser";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

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

const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export default function ProfilePage() {
  const { confirm } = useConfirm();
  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [savedForm, setSavedForm] = useState<ProfileForm>(emptyForm);
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
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(savedForm);

  useUnsavedChangesGuard(dirty, saving);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setLoadFailed(false);
        setError(null);
        const res = await apiFetch("/users/me");
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error("profile_load_failed");
        }
        if (cancelled) return;

        const data = body as ProfileResponse;
        const nextForm = {
          first_name: data.first_name ?? "",
          last_name: data.last_name ?? "",
          photo_url: data.photo_url ?? "",
          phone_number: data.phone_number ?? "",
          job_title: data.job_title ?? "",
          timezone: data.timezone ?? "",
          bio: data.bio ?? "",
        };
        setForm(nextForm);
        setSavedForm(nextForm);
        setEmail(data.email ?? "");
        setTeamName(data.team_name ?? null);
        setRoleName(data.role_name ?? null);
        setMfaEnabled(Boolean(data.mfa_enabled));
        setMfaRequired(Boolean(data.mfa_required));
      } catch {
        if (!cancelled) {
          setLoadFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadVersion]);

  async function handleSave() {
    if (!dirty || saving) return;
    try {
      setSaving(true);
      setError(null);

      const normalizedForm: ProfileForm = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        photo_url: form.photo_url.trim(),
        phone_number: form.phone_number.trim(),
        job_title: form.job_title.trim(),
        timezone: form.timezone.trim(),
        bio: form.bio.trim(),
      };
      const payload = {
        first_name: normalizedForm.first_name || null,
        last_name: normalizedForm.last_name || null,
        photo_url: normalizedForm.photo_url || null,
        phone_number: normalizedForm.phone_number || null,
        job_title: normalizedForm.job_title || null,
        timezone: normalizedForm.timezone || null,
        bio: normalizedForm.bio || null,
      };

      const res = await apiFetch("/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error("profile_save_failed");
      }

      setForm(normalizedForm);
      setSavedForm(normalizedForm);
      cacheSidebarUser(body);
      toast.success("Profile updated.");
    } catch {
      setError("We could not save your profile. Review the information and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePhotoUpload(file: File) {
    if (!PROFILE_IMAGE_TYPES.has(file.type)) {
      setError("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size === 0) {
      setError("Choose a non-empty image.");
      return;
    }
    if (file.size > PROFILE_IMAGE_MAX_BYTES) {
      setError("Choose an image no larger than 5 MB.");
      return;
    }
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
        throw new Error("profile_photo_failed");
      }

      const nextPhotoUrl = typeof body?.photo_url === "string" ? body.photo_url : "";
      setForm((current) => ({ ...current, photo_url: nextPhotoUrl }));
      setSavedForm((current) => ({ ...current, photo_url: nextPhotoUrl }));
      if (body?.user) {
        cacheSidebarUser(body.user);
      }
      toast.success("Profile image uploaded.");
    } catch {
      setError("We could not upload this profile image. Choose a supported image and try again.");
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
      if (!res.ok) throw new Error("mfa_setup_failed");
      setMfaSecret(body.secret ?? "");
      setMfaOtpAuthUri(body.otpauth_uri ?? "");
      setMfaCode("");
      setMfaRecoveryCodes([]);
    } catch {
      setError("We could not start MFA setup. Try again or contact an administrator.");
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
      if (!res.ok) throw new Error("mfa_enable_failed");
      setMfaEnabled(true);
      setMfaRecoveryCodes(Array.isArray(body?.backup_codes) ? body.backup_codes : []);
      setMfaCode("");
      toast.success("MFA enabled.");
    } catch {
      setError("We could not verify that authenticator code. Check the code and try again.");
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleDisableMfa() {
    const confirmed = await confirm({
      title: "Disable multi-factor authentication?",
      description: mfaRequired
        ? "Your organization requires MFA. Disabling it will require setup again before your next manual sign-in."
        : "This removes your authenticator secret and unused recovery codes, reducing protection for manual sign-in.",
      confirmLabel: "Disable MFA",
      variant: "destructive",
    });
    if (!confirmed) return;
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
      await res.json().catch(() => null);
      if (!res.ok) throw new Error("mfa_disable_failed");
      setMfaEnabled(false);
      setMfaSecret("");
      setMfaOtpAuthUri("");
      setMfaCode("");
      setMfaBackupCode("");
      setMfaPassword("");
      setMfaRecoveryCodes([]);
      toast.success("MFA disabled.");
    } catch {
      setError("We could not disable MFA. Check your password and verification code, then try again.");
    } finally {
      setMfaBusy(false);
    }
  }

  if (loading) return <RouteLoadingState label="profile" />;
  if (loadFailed) {
    return (
      <RouteErrorState
        title="Unable to load profile"
        description="Your profile could not be loaded. Check your connection and try again."
        reset={() => setLoadVersion((current) => current + 1)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Profile" description="Manage your personal details, preferences, profile image, and sign-in security." />

      {error ? (
        <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          {error}
        </div>
      ) : null}

      <Card role="region" aria-labelledby="profile-identity-heading">
        <CardHeader>
          <div>
            <h2 id="profile-identity-heading" className="text-lg font-semibold text-copy-primary">Account identity</h2>
            <p className="mt-1 text-sm text-copy-muted">Organization-managed account assignments.</p>
          </div>
        </CardHeader>
        <CardBody>
          <dl className="grid gap-3 md:grid-cols-3">
            <SummaryTile label="Email" value={email} />
            <SummaryTile label="Team" value={teamName || "Unassigned"} />
            <SummaryTile label="Role" value={roleName || "Unassigned"} />
          </dl>
        </CardBody>
      </Card>

      <Card role="region" aria-labelledby="profile-details-heading">
        <CardHeader>
          <div>
            <h2 id="profile-details-heading" className="text-lg font-semibold text-copy-primary">Personal details</h2>
            <p className="mt-1 text-sm text-copy-muted">Information used throughout your CRM workspace.</p>
          </div>
        </CardHeader>
        <CardBody>
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="profile-first-name">First name</FieldLabel>
              <Input id="profile-first-name" value={form.first_name} onChange={(event) => setForm((current) => ({ ...current, first_name: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-last-name">Last name</FieldLabel>
              <Input id="profile-last-name" value={form.last_name} onChange={(event) => setForm((current) => ({ ...current, last_name: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-job-title">Job title</FieldLabel>
              <Input id="profile-job-title" value={form.job_title} onChange={(event) => setForm((current) => ({ ...current, job_title: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-phone-number">Phone number</FieldLabel>
              <Input id="profile-phone-number" type="tel" value={form.phone_number} onChange={(event) => setForm((current) => ({ ...current, phone_number: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-timezone">Timezone</FieldLabel>
              <TimezonePicker
                triggerId="profile-timezone"
                ariaLabel="Timezone"
                value={form.timezone}
                onChange={(value) => setForm((current) => ({ ...current, timezone: value }))}
                placeholder="Search country or city"
              />
              <FieldDescription>Used to convert dates and times throughout the workspace.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-photo-url">Photo URL</FieldLabel>
              <Input id="profile-photo-url" value={form.photo_url} onChange={(event) => setForm((current) => ({ ...current, photo_url: event.target.value }))} placeholder="https://..." />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {form.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={resolveMediaUrl(form.photo_url)}
                    alt="Profile image preview"
                    className="h-12 w-12 rounded-[var(--radius-control)] border border-line-default object-cover"
                  />
                ) : null}
                <Button asChild type="button" variant="outline">
                  <label htmlFor="profile-photo-upload" className={uploadingPhoto ? "pointer-events-none opacity-60" : "cursor-pointer"}>
                    <Upload />
                    {uploadingPhoto ? "Uploading…" : "Upload photo"}
                  </label>
                </Button>
                <Input
                  id="profile-photo-upload"
                  aria-label="Upload profile photo"
                  type="file"
                  disabled={uploadingPhoto}
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handlePhotoUpload(file);
                    event.currentTarget.value = "";
                  }}
                />
              </div>
              <FieldDescription>JPG, PNG, or WebP up to 5 MB. Uploading saves the image immediately.</FieldDescription>
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="profile-bio">Bio</FieldLabel>
              <Textarea id="profile-bio" value={form.bio} onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))} rows={4} />
              <FieldDescription>Optional context shown with your internal profile.</FieldDescription>
            </Field>
          </FieldGroup>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-5">
            <span className="text-sm text-copy-muted">{dirty ? "You have unsaved profile changes." : "Profile changes are saved."}</span>
            <Button onClick={() => void handleSave()} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card role="region" aria-labelledby="profile-security-heading">
        <CardHeader>
          <div>
            <h2 id="profile-security-heading" className="text-lg font-semibold text-copy-primary">Account security</h2>
            <p className="mt-1 text-sm text-copy-muted">Manage multi-factor authentication for manual CRM sign-in.</p>
          </div>
          <MfaStatusPill enabled={mfaEnabled} required={mfaRequired} />
        </CardHeader>
        <CardBody>
          {!mfaEnabled ? (
            <div className="grid gap-4">
              {!mfaSecret ? (
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-copy-primary">Authenticator app</h3>
                    <p className="mt-1 text-sm text-copy-muted">Add a second verification step to manual sign-in.</p>
                  </div>
                  <Button type="button" onClick={() => void handleStartMfaSetup()} disabled={mfaBusy}>
                    <ShieldCheck />
                    {mfaBusy ? "Starting…" : "Set up MFA"}
                  </Button>
                </div>
              ) : (
                <div className="grid gap-4">
                  <div className="rounded-[var(--radius-control)] border border-state-warning/40 bg-state-warning-muted p-4">
                    <div className="text-xs font-medium uppercase tracking-wide text-state-warning">Authenticator secret</div>
                    <div className="mt-2 break-all font-mono text-sm text-copy-primary">{mfaSecret}</div>
                    <p className="mt-2 text-xs text-copy-secondary">Treat this secret like a password. Add it to your authenticator before continuing.</p>
                  </div>
                  {mfaOtpAuthUri ? (
                    <a href={mfaOtpAuthUri} className="w-fit rounded-sm text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Open authenticator setup link
                    </a>
                  ) : null}
                  <Field className="max-w-sm">
                    <FieldLabel htmlFor="profile-mfa-enable-code">Authenticator code</FieldLabel>
                    <Input id="profile-mfa-enable-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" />
                  </Field>
                  <Button className="w-fit" type="button" onClick={() => void handleEnableMfa()} disabled={mfaBusy || !mfaCode.trim()}>
                    {mfaBusy ? "Enabling…" : "Enable MFA"}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-4">
              <p className="text-sm leading-6 text-copy-secondary">
                Disabling MFA requires your current password and either an authenticator or recovery code.
              </p>
              <FieldGroup className="grid gap-4 md:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="profile-mfa-password">Current password</FieldLabel>
                  <Input id="profile-mfa-password" type="password" value={mfaPassword} onChange={(event) => setMfaPassword(event.target.value)} autoComplete="current-password" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="profile-mfa-disable-code">Authenticator code</FieldLabel>
                  <Input id="profile-mfa-disable-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="profile-mfa-recovery-code">Recovery code</FieldLabel>
                  <Input id="profile-mfa-recovery-code" value={mfaBackupCode} onChange={(event) => setMfaBackupCode(event.target.value)} autoComplete="off" />
                </Field>
              </FieldGroup>
              <Button className="w-fit" type="button" variant="destructive" onClick={() => void handleDisableMfa()} disabled={mfaBusy || !mfaPassword || (!mfaCode.trim() && !mfaBackupCode.trim())}>
                {mfaBusy ? "Disabling…" : "Disable MFA"}
              </Button>
            </div>
          )}

          {mfaRecoveryCodes.length ? (
            <div role="status" className="mt-5 rounded-[var(--radius-control)] border border-state-success/40 bg-state-success-muted p-4">
              <div className="text-sm font-semibold text-state-success">Save these recovery codes now</div>
              <p className="mt-1 text-sm text-copy-secondary">Each code can be used once if your authenticator is unavailable.</p>
              <div className="mt-3 grid gap-1 font-mono text-xs text-copy-primary sm:grid-cols-2">
                {mfaRecoveryCodes.map((code) => <span key={code}>{code}</span>)}
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-copy-muted">{label}</dt>
      <dd className="mt-2 break-words text-sm text-copy-primary">{value}</dd>
    </div>
  );
}

function MfaStatusPill({ enabled, required }: { enabled: boolean; required: boolean }) {
  if (enabled) {
    return <Pill bg="bg-state-success-muted" text="text-state-success" border="border-state-success/40">MFA enabled</Pill>;
  }
  if (required) {
    return <Pill bg="bg-state-warning-muted" text="text-state-warning" border="border-state-warning/40">MFA required</Pill>;
  }
  return <Pill>MFA off</Pill>;
}
