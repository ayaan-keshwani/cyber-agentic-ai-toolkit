import type { ChatThread } from "./types";

export const CHAT_STORAGE_KEY = "cyberToolkit.chat.v1";

export type PersistedChatState = {
  threads: ChatThread[];
  activeThreadId: string | null;
};

function isChatThread(value: unknown): value is ChatThread {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    typeof t.title === "string" &&
    typeof t.updatedAt === "number" &&
    (t.agent === "email" || t.agent === "incident") &&
    Array.isArray(t.messages)
  );
}

export function loadPersistedChatState(): PersistedChatState {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return { threads: [], activeThreadId: null };
  }
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return { threads: [], activeThreadId: null };
    const data = JSON.parse(raw) as {
      threads?: unknown;
      activeThreadId?: unknown;
    };
    const threads = Array.isArray(data.threads)
      ? data.threads.filter(isChatThread)
      : [];
    const preferred =
      typeof data.activeThreadId === "string" &&
      threads.some((t) => t.id === data.activeThreadId)
        ? data.activeThreadId
        : null;
    const activeThreadId =
      preferred ??
      (threads.length > 0
        ? [...threads].sort((a, b) => b.updatedAt - a.updatedAt)[0].id
        : null);
    return { threads, activeThreadId };
  } catch {
    return { threads: [], activeThreadId: null };
  }
}

export function persistChatState(state: PersistedChatState): void {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota or private mode */
  }
}

export function clearPersistedChatState(): void {
  try {
    localStorage.removeItem(CHAT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
