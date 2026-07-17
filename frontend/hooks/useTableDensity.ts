"use client";

import { useSyncExternalStore } from "react";

export type TableDensity = "comfortable" | "compact";

const STORAGE_KEY = "lynk:table-density";
const CHANGE_EVENT = "lynk:table-density-change";

function subscribe(onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

function getSnapshot(): TableDensity {
  return window.localStorage.getItem(STORAGE_KEY) === "compact" ? "compact" : "comfortable";
}

export function setTableDensity(density: TableDensity) {
  window.localStorage.setItem(STORAGE_KEY, density);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useTableDensity(): TableDensity {
  return useSyncExternalStore<TableDensity>(subscribe, getSnapshot, () => "comfortable");
}
