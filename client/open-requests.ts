import { useSyncExternalStore } from "react";

export interface OpenRequest {
  workspaceId: string;
  path: string;
  seq: number;
  at: number;
}

let latest: OpenRequest | null = null;
let seq = 0;
const listeners = new Set<() => void>();

// Chat link clicks land here; the Wiki Viewer panel for that workspace picks them up.
export function requestOpen(workspaceId: string, path: string) {
  latest = { workspaceId, path, seq: ++seq, at: Date.now() };
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
