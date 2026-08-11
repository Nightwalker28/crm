"use client";

import { useState } from "react";
import { Copy, Globe2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Dialog, DialogBackdrop, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { useDomainSettings } from "@/hooks/admin/useIdentitySettings";
import { formatDateTime } from "@/lib/datetime";

export default function DomainsSettingsPage() {
  const settings = useDomainSettings();
  const [hostname, setHostname] = useState("");
  const [deleting, setDeleting] = useState<{ id: number; hostname: string } | null>(null);

  async function add() {
    if (!hostname.trim()) return;
    try { await settings.createTenantDomain({ hostname: hostname.trim(), is_primary: settings.tenantDomains.length === 0 }); setHostname(""); } catch { /* mutation preserves the draft and reports safely */ }
  }
  async function copy(value: string | null, label: string) {
    if (!value) return;
    try { await navigator.clipboard.writeText(value); toast.success(`${label} copied.`); } catch { toast.error(`${label} could not be copied.`); }
  }
  async function verify(domainId: number) {
    try { await settings.verifyTenantDomain(domainId); } catch { /* mutation refreshes status and reports safely */ }
  }

  return (
    <div className="flex flex-col gap-5 text-copy-primary">
      <Card className="px-4 py-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-center gap-3"><Globe2 className="size-4 text-copy-secondary" /><div><h2 className="text-sm font-semibold">Custom domains</h2><p className="text-xs text-copy-muted">Verify ownership with the generated TXT record before using tenant SSO.</p></div></div>
            <form className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-lg" onSubmit={(event) => { event.preventDefault(); void add(); }}><label className="min-w-0 flex-1"><span className="sr-only">Custom domain</span><Input value={hostname} onChange={(event) => setHostname(event.target.value)} placeholder="crm.example.com" disabled={settings.isSaving} /></label><Button type="submit" disabled={settings.isSaving || !hostname.trim()}>Add Domain</Button></form>
          </div>
          {settings.isLoading ? <p aria-live="polite" className="text-sm text-copy-muted">Loading custom domains…</p> : settings.tenantDomains.length ? <div className="grid gap-3 xl:grid-cols-2">{settings.tenantDomains.map((domain) => (
            <section key={domain.id} className="flex min-w-0 flex-col gap-4 rounded-[var(--radius-control)] border border-line-default bg-surface-muted p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><h3 className="break-all text-sm font-semibold">{domain.hostname}</h3><div className="mt-2 flex gap-2"><span className={domain.status === "verified" ? "rounded-[var(--radius-control)] bg-state-success-muted px-2 py-0.5 text-xs text-state-success" : domain.status === "failed" ? "rounded-[var(--radius-control)] bg-state-danger-muted px-2 py-0.5 text-xs text-state-danger" : "rounded-[var(--radius-control)] bg-state-warning-muted px-2 py-0.5 text-xs text-state-warning"}>{domain.status.charAt(0).toUpperCase() + domain.status.slice(1)}</span>{domain.is_primary ? <span className="rounded-[var(--radius-control)] bg-surface-raised px-2 py-0.5 text-xs">Primary</span> : null}</div></div><div className="flex gap-2"><Button variant="secondary" onClick={() => void verify(domain.id)} disabled={settings.isSaving || domain.status === "verified"}>Verify</Button><Button variant="ghost" size="icon-sm" aria-label={`Remove ${domain.hostname}`} onClick={() => setDeleting({ id: domain.id, hostname: domain.hostname })}><Trash2 className="size-4" /></Button></div></div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs font-medium text-copy-label">Record type</dt><dd className="mt-1 text-copy-secondary">TXT</dd></div><div><dt className="text-xs font-medium text-copy-label">Last checked</dt><dd className="mt-1 text-copy-secondary">{domain.last_checked_at ? formatDateTime(domain.last_checked_at) : "Never"}</dd></div><DnsValue label="Host / name" value={domain.txt_record_name} onCopy={() => void copy(domain.txt_record_name, "DNS host")} /><DnsValue label="Expected value" value={domain.txt_record_value ?? ""} onCopy={() => void copy(domain.txt_record_value, "DNS value")} /></dl>
              {domain.status === "failed" ? <p className="text-xs text-state-danger" role="status">DNS proof was not found. Confirm the TXT host and value, allow for propagation, then verify again.</p> : domain.verified_at ? <p className="text-xs text-copy-muted">Verified {formatDateTime(domain.verified_at)}</p> : null}
            </section>
          ))}</div> : <EmptyState icon={Globe2} title="No custom domains yet" description="Add a CRM hostname to generate the TXT record required for ownership verification." />}
        </div>
      </Card>
      <Dialog open={deleting !== null} onClose={() => { if (!settings.isSaving) setDeleting(null); }}><DialogBackdrop /><div className="fixed inset-0 z-[30] flex items-center justify-center p-4"><DialogPanel size="sm"><DialogHeader><DialogTitle>Remove custom domain?</DialogTitle></DialogHeader><DialogDescription className="mt-2">Removing <strong>{deleting?.hostname}</strong> may interrupt SSO routing.</DialogDescription><DialogFooter className="mt-5"><Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" disabled={settings.isSaving} onClick={async () => { if (!deleting) return; try { await settings.deleteTenantDomain(deleting.id); setDeleting(null); } catch { /* keep confirmation open */ } }}>{settings.isSaving ? "Removing…" : "Remove domain"}</Button></DialogFooter></DialogPanel></div></Dialog>
    </div>
  );
}

function DnsValue({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return <div className="min-w-0 sm:col-span-2"><dt className="text-xs font-medium text-copy-label">{label}</dt><dd className="mt-1 flex min-w-0 gap-2"><code className="min-w-0 flex-1 break-all text-copy-secondary">{value}</code><Button variant="ghost" size="icon-sm" aria-label={`Copy ${label}`} onClick={onCopy}><Copy className="size-4" /></Button></dd></div>;
}
