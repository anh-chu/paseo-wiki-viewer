import { useSyncExternalStore } from "react";

export interface OpenRequest {
  workspaceId: string;
  url: string;
  seq: number;
  at: number;
}

let latest: OpenRequest | null = null;
let seq = 0;
const listeners = new Set<() => void>();

// "Show in sidebar" in a file tab lands here; the Wiki Viewer panel for that workspace picks it up.
export function requestOpen(workspaceId: string, url: string) {
  latest = { workspaceId, url, seq: ++seq, at: Date.now() };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOpenRequest(workspaceId: string): OpenRequest | null {
  const request = useSyncExternalStore(subscribe, () => latest);
  return request?.workspaceId === workspaceId ? request : null;
}
