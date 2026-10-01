'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * The tools a user has chosen for Accord. Stored in this browser only until a backend exists;
 * the dashboard says so wherever the selection is shown.
 */
const KEY = 'accord:selected-tools';
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: string[] } = { raw: null, value: [] };

function read(): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return cache.value;
  }
  if (raw !== cache.raw) {
    let value: string[] = [];
    try {
      const parsed = JSON.parse(raw ?? '[]');
      value = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      value = [];
    }
    cache = { raw, value };
  }
  return cache.value;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => event.key === KEY && listener();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const EMPTY: string[] = [];

export function useSelectedTools() {
  const selected = useSyncExternalStore(subscribe, read, () => EMPTY);
  const setSelected = useCallback((next: string[]) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: the selection simply won't persist.
    }
    listeners.forEach((listener) => listener());
  }, []);
  const toggle = useCallback(
    (id: string) => setSelected(read().includes(id) ? read().filter((v) => v !== id) : [...read(), id]),
    [setSelected],
  );
  return { selected, toggle, setSelected };
}
