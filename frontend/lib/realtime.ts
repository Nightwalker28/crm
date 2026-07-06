import { apiUrl } from "@/lib/runtime-config";

export type RealtimeStatus = "idle" | "connected" | "reconnecting" | "unsupported";

type RealtimeEventHandlers = Record<string, EventListener>;
type StatusListener = (status: RealtimeStatus) => void;

let source: EventSource | null = null;
let subscriberCount = 0;
let status: RealtimeStatus = "idle";
const statusListeners = new Set<StatusListener>();

function emitStatus(nextStatus: RealtimeStatus) {
  status = nextStatus;
  statusListeners.forEach((listener) => listener(nextStatus));
}

function supportsEventSource() {
  return typeof window !== "undefined" && "EventSource" in window;
}

function ensureSource() {
  if (!supportsEventSource()) {
    emitStatus("unsupported");
    return null;
  }
  if (source) return source;

  source = new EventSource(apiUrl("/platform/realtime/stream"), { withCredentials: true });
  source.addEventListener("open", () => emitStatus("connected"));
  source.addEventListener("error", () => emitStatus("reconnecting"));
  return source;
}

function closeSourceIfIdle() {
  if (subscriberCount > 0 || !source) return;
  source.close();
  source = null;
  emitStatus(supportsEventSource() ? "idle" : "unsupported");
}

export function realtimeInitialStatus(): RealtimeStatus {
  if (typeof window !== "undefined" && !supportsEventSource()) return "unsupported";
  return status;
}

export function subscribeRealtimeStream(
  handlers: RealtimeEventHandlers,
  onStatus?: StatusListener,
) {
  if (onStatus) {
    statusListeners.add(onStatus);
    onStatus(realtimeInitialStatus());
  }

  const currentSource = ensureSource();
  if (!currentSource) {
    return () => {
      if (onStatus) statusListeners.delete(onStatus);
    };
  }

  subscriberCount += 1;
  Object.entries(handlers).forEach(([eventName, handler]) => {
    currentSource.addEventListener(eventName, handler);
  });

  return () => {
    Object.entries(handlers).forEach(([eventName, handler]) => {
      currentSource.removeEventListener(eventName, handler);
    });
    if (onStatus) statusListeners.delete(onStatus);
    subscriberCount = Math.max(0, subscriberCount - 1);
    closeSourceIfIdle();
  };
}
