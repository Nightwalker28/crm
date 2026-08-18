const AUTH_SESSION_EVENT = "lynk:auth-session-change";
const AUTH_SESSION_STORAGE_KEY = "lynk:auth-session-change";

export function publishAuthSessionChange() {
  if (typeof window === "undefined") return;

  window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
  try {
    window.localStorage.setItem(
      AUTH_SESSION_STORAGE_KEY,
      JSON.stringify({ changedAt: Date.now(), nonce: crypto.randomUUID() })
    );
  } catch {
    // The same-tab event still protects the active client when storage is unavailable.
  }
}

export function subscribeToAuthSessionChanges(onChange: (source: "local" | "cross-tab") => void) {
  if (typeof window === "undefined") return () => undefined;

  const handleLocalChange = () => onChange("local");
  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === AUTH_SESSION_STORAGE_KEY) onChange("cross-tab");
  };

  window.addEventListener(AUTH_SESSION_EVENT, handleLocalChange);
  window.addEventListener("storage", handleStorageChange);
  return () => {
    window.removeEventListener(AUTH_SESSION_EVENT, handleLocalChange);
    window.removeEventListener("storage", handleStorageChange);
  };
}
