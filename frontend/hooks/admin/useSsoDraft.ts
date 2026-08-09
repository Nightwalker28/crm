"use client";

import { useEffect, useRef, useState } from "react";

import type { SsoSettings } from "./useUserManagement";

export type SsoDraft = {
  enabled: boolean;
  issuer_url: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  client_id: string;
  client_secret: string;
  auto_provision_users: boolean;
  default_role_id: string;
  default_team_id: string;
  email_claim: string;
  first_name_claim: string;
  last_name_claim: string;
};

const emptyDraft: SsoDraft = { enabled: false, issuer_url: "", authorization_endpoint: "", token_endpoint: "", userinfo_endpoint: "", jwks_uri: "", client_id: "", client_secret: "", auto_provision_users: false, default_role_id: "", default_team_id: "", email_claim: "email", first_name_claim: "given_name", last_name_claim: "family_name" };

function fromSettings(settings: SsoSettings): SsoDraft {
  return { enabled: settings.enabled, issuer_url: settings.issuer_url ?? "", authorization_endpoint: settings.authorization_endpoint ?? "", token_endpoint: settings.token_endpoint ?? "", userinfo_endpoint: settings.userinfo_endpoint ?? "", jwks_uri: settings.jwks_uri ?? "", client_id: settings.client_id ?? "", client_secret: "", auto_provision_users: settings.auto_provision_users, default_role_id: settings.default_role_id ? String(settings.default_role_id) : "", default_team_id: settings.default_team_id ? String(settings.default_team_id) : "", email_claim: settings.email_claim || "email", first_name_claim: settings.first_name_claim ?? "given_name", last_name_claim: settings.last_name_claim ?? "family_name" };
}

export function useSsoDraft(settings: SsoSettings | undefined) {
  const [draft, setDraft] = useState(emptyDraft);
  const [isDirty, setIsDirty] = useState(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!settings || dirtyRef.current) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(fromSettings(settings));
  }, [settings]);

  function update<Key extends keyof SsoDraft>(field: Key, value: SsoDraft[Key]) {
    dirtyRef.current = true;
    setIsDirty(true);
    setDraft((current) => ({ ...current, [field]: value }));
  }
  function reset() {
    if (!settings) return;
    dirtyRef.current = false;
    setIsDirty(false);
    setDraft(fromSettings(settings));
  }
  function markSaved() {
    dirtyRef.current = false;
    setIsDirty(false);
    setDraft((current) => ({ ...current, client_secret: "" }));
  }
  return { draft, isDirty, update, reset, markSaved };
}
