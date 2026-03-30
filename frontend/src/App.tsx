import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { AgentId, BusinessProfile, ChatMessage, ChatThread } from "./types";
import {
  fixMissingSpaceAfterSentenceEnd,
  parseNdjsonStream,
  splitAssistantReply,
  stripMarkdownBoldMarkers,
} from "./chatUtils";
import { normalizeItSupport } from "./profileUtils";
import ProfileModal from "./ProfileModal";
import {
  clearPersistedChatState,
  loadPersistedChatState,
  persistChatState,
} from "./chatPersistence";
import "./App.css";

const SETUP_FIRST_MESSAGE = "Hello! I am a new user!";

function initialMainChatState(): { threads: ChatThread[]; activeId: string | null } {
  const s = loadPersistedChatState();
  return {
    threads: s.threads,
    activeId:
      s.activeThreadId ??
      (s.threads.length > 0
        ? [...s.threads].sort((a, b) => b.updatedAt - a.updatedAt)[0].id
        : null),
  };
}

function assistantBubbleLabel(agent?: AgentId): string {
  if (agent === "incident") return "Incident Response Agent";
  return "Email Protection Agent";
}

export default function App() {
  const initialChat = useMemo(() => initialMainChatState(), []);
  const [onboardingMessages, setOnboardingMessages] = useState<ChatMessage[]>(
    [],
  );
  const [mainThreads, setMainThreads] = useState<ChatThread[]>(
    initialChat.threads,
  );
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialChat.activeId,
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(
    null,
  );
  const [keyOk, setKeyOk] = useState<boolean | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [setupStarted, setSetupStarted] = useState(false);
  const [completionGateActive, setCompletionGateActive] = useState(false);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const chatInsuranceInputRef = useRef<HTMLInputElement>(null);
  const [insuranceChatUploadBusy, setInsuranceChatUploadBusy] = useState(false);
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile | null>(
    null,
  );

  const loadingMeta = onboardingComplete === null;
  const showMainApp =
    onboardingComplete === true && !completionGateActive;
  const inSetup = onboardingComplete === false;

  const activeThread = mainThreads.find((t) => t.id === activeThreadId);
  const activeMainMessages = activeThread?.messages ?? [];
  const activeAgent: AgentId = activeThread?.agent ?? "email";
  const canChangeAgentForChat = activeMainMessages.length === 0;
  const displayMessages = showMainApp ? activeMainMessages : onboardingMessages;

  const setActiveThreadAgent = (next: AgentId) => {
    if (!activeThreadId) return;
    setMainThreads((threads) =>
      threads.map((t) =>
        t.id === activeThreadId ? { ...t, agent: next } : t,
      ),
    );
  };

  const scrollChatToBottom = useCallback(() => {
    const el = messagesScrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, []);

  useEffect(() => {
    scrollChatToBottom();
  }, [displayMessages, busy, scrollChatToBottom]);

  useLayoutEffect(() => {
    if (!completionGateActive) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    const snap = () => {
      el.scrollTop = el.scrollHeight;
    };
    snap();
    requestAnimationFrame(snap);
  }, [completionGateActive, onboardingMessages]);

  useEffect(() => {
    if (!showMainApp || loadingMeta) return;
    if (mainThreads.length > 0) return;
    const id = crypto.randomUUID();
    setMainThreads([
      {
        id,
        title: "New chat",
        messages: [],
        updatedAt: Date.now(),
        agent: "email",
      },
    ]);
    setActiveThreadId(id);
  }, [showMainApp, loadingMeta, mainThreads.length]);

  useEffect(() => {
    if (!showMainApp) return;
    persistChatState({ threads: mainThreads, activeThreadId });
  }, [showMainApp, mainThreads, activeThreadId]);

  const syncBusinessProfile = useCallback(async () => {
    try {
      const pr = await fetch("/api/profile");
      if (!pr.ok) throw new Error("profile");
      const prof = (await pr.json()) as BusinessProfile;
      setBusinessProfile({
        ...prof,
        policy_exclusions: prof.policy_exclusions ?? "",
        insurance_declarations_original_name:
          prof.insurance_declarations_original_name ?? "",
        insurance_declarations_relpath:
          prof.insurance_declarations_relpath ?? "",
        it_support: normalizeItSupport(prof.it_support ?? ""),
      });
    } catch {
      setBusinessProfile(null);
    }
  }, []);

  const refreshMeta = useCallback(async () => {
    try {
      const [h, o] = await Promise.all([
        fetch("/api/health").then((r) => r.json()),
        fetch("/api/onboarding").then((r) => r.json()),
      ]);
      setKeyOk(!!h.key_configured);
      setOnboardingComplete(!!o.complete);
    } catch {
      setKeyOk(false);
      setOnboardingComplete(null);
    }
    await syncBusinessProfile();
  }, [syncBusinessProfile]);

  useEffect(() => {
    void refreshMeta();
  }, [refreshMeta]);

  const sendMessage = async (
    text: string,
    opts?: { allowBeforeSetup?: boolean; skipBusyCheck?: boolean },
  ) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!opts?.skipBusyCheck && busy) return;
    if (onboardingComplete === null) return;
    if (completionGateActive) return;
    if (
      onboardingComplete === false &&
      !setupStarted &&
      !opts?.allowBeforeSetup
    ) {
      return;
    }

    const inMainChat =
      onboardingComplete === true && !completionGateActive;
    if (inMainChat && !activeThreadId) return;

    const wasIncomplete = onboardingComplete === false;
    const hadSetupStarted =
      setupStarted || !!opts?.allowBeforeSetup;

    const threadIdForRequest = activeThreadId;

    const agentForRequest: AgentId =
      onboardingComplete === false
        ? "email"
        : (mainThreads.find((t) => t.id === threadIdForRequest)?.agent ??
          "email");

    setBusy(true);
    const userId = crypto.randomUUID();
    const asstId = crypto.randomUUID();
    const userMsg: ChatMessage = {
      id: userId,
      role: "user",
      content: trimmed,
    };
    const asstMsg: ChatMessage = {
      id: asstId,
      role: "assistant",
      content: "",
      assistantAgent: agentForRequest,
    };

    const patchAssistantContent = (mapFn: (prev: string) => string) => {
      if (!inMainChat) {
        setOnboardingMessages((m) =>
          m.map((row) =>
            row.id === asstId ? { ...row, content: mapFn(row.content) } : row,
          ),
        );
        return;
      }
      if (!threadIdForRequest) return;
      setMainThreads((threads) =>
        threads.map((t) =>
          t.id === threadIdForRequest
            ? {
                ...t,
                updatedAt: Date.now(),
                messages: t.messages.map((row) =>
                  row.id === asstId
                    ? { ...row, content: mapFn(row.content) }
                    : row,
                ),
              }
            : t,
        ),
      );
    };

    if (!inMainChat) {
      setOnboardingMessages((m) => [...m, userMsg, asstMsg]);
    } else if (threadIdForRequest) {
      setMainThreads((threads) =>
        threads.map((t) => {
          if (t.id !== threadIdForRequest) return t;
          const isFirst = t.messages.length === 0;
          const title =
            isFirst && trimmed
              ? trimmed.length > 48
                ? `${trimmed.slice(0, 48)}…`
                : trimmed
              : t.title;
          return {
            ...t,
            title,
            updatedAt: Date.now(),
            messages: [...t.messages, userMsg, asstMsg],
          };
        }),
      );
    }

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: agentForRequest,
          message: trimmed,
          thread_id: threadIdForRequest ?? undefined,
        }),
      });

      if (!res.ok) {
        const detail = await res
          .json()
          .catch(() => ({ detail: res.statusText }));
        const msg =
          typeof detail === "object" && detail && "detail" in detail
            ? String((detail as { detail: unknown }).detail)
            : "Request failed.";
        patchAssistantContent(() => `Error: ${msg}`);
        return;
      }

      if (!res.body) {
        patchAssistantContent(() => "Error: No response body.");
        return;
      }

      let streamed = "";
      const { error } = await parseNdjsonStream(res.body, (chunk) => {
        streamed += chunk;
        patchAssistantContent((c) => c + chunk);
      });

      if (error) {
        patchAssistantContent(
          (c) =>
            c + (c ? "\n\n" : "") + `Error: ${error}`,
        );
      } else {
        streamed = fixMissingSpaceAfterSentenceEnd(streamed);
        patchAssistantContent(() => streamed);
        const parts = splitAssistantReply(streamed);
        if (parts) {
          const secondId = crypto.randomUUID();
          const secondMsg: ChatMessage = {
            id: secondId,
            role: "assistant",
            content: parts.second,
            assistantAgent: agentForRequest,
          };
          if (!inMainChat) {
            setOnboardingMessages((m) => {
              const i = m.findIndex((row) => row.id === asstId);
              if (i === -1) return m;
              const next = [...m];
              next[i] = { ...next[i], content: parts.first };
              next.splice(i + 1, 0, secondMsg);
              return next;
            });
          } else if (threadIdForRequest) {
            setMainThreads((threads) =>
              threads.map((t) => {
                if (t.id !== threadIdForRequest) return t;
                const mi = t.messages.findIndex((row) => row.id === asstId);
                if (mi === -1) return t;
                const nm = [...t.messages];
                nm[mi] = { ...nm[mi], content: parts.first };
                nm.splice(mi + 1, 0, secondMsg);
                return { ...t, messages: nm, updatedAt: Date.now() };
              }),
            );
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error.";
      patchAssistantContent(() => `Error: ${msg}`);
    } finally {
      setBusy(false);
      try {
        const [h, o] = await Promise.all([
          fetch("/api/health").then((r) => r.json()),
          fetch("/api/onboarding").then((r) => r.json()),
        ]);
        setKeyOk(!!h.key_configured);
        setOnboardingComplete(!!o.complete);
        if (wasIncomplete && o.complete === true && hadSetupStarted) {
          setCompletionGateActive(true);
        }
      } catch {
        setKeyOk(false);
        setOnboardingComplete(null);
      }
      await syncBusinessProfile();
      window.setTimeout(() => void syncBusinessProfile(), 500);
    }
  };

  const uploadInsuranceFromChat = useCallback(
    async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      setInsuranceChatUploadBusy(true);
      try {
        const res = await fetch("/api/profile/insurance-declarations", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          const msg =
            typeof d === "object" && d && "detail" in d
              ? String((d as { detail: unknown }).detail)
              : res.statusText;
          throw new Error(msg);
        }
        await refreshMeta();
        void sendMessage(`📎 ${file.name}`, { skipBusyCheck: true });
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Upload failed.");
      } finally {
        setInsuranceChatUploadBusy(false);
      }
    },
    [refreshMeta, sendMessage],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const t = input;
    setInput("");
    void sendMessage(t);
  };

  const startSetup = () => {
    if (busy || setupStarted) return;
    setSetupStarted(true);
    void sendMessage(SETUP_FIRST_MESSAGE, { allowBeforeSetup: true });
  };

  const goToHomeAfterSetup = () => {
    setOnboardingMessages([]);
    setCompletionGateActive(false);
    const id = crypto.randomUUID();
    setMainThreads((prev) => [
      {
        id,
        title: "New chat",
        messages: [],
        updatedAt: Date.now(),
        agent: "email",
      },
      ...prev,
    ]);
    setActiveThreadId(id);
  };

  const newMainChat = () => {
    const id = crypto.randomUUID();
    setMainThreads((prev) => [
      {
        id,
        title: "New chat",
        messages: [],
        updatedAt: Date.now(),
        agent: "email",
      },
      ...prev,
    ]);
    setActiveThreadId(id);
  };

  const deleteThread = (threadId: string) => {
    if (
      !window.confirm(
        "Delete this chat? The messages will be removed from this device. This cannot be undone.",
      )
    ) {
      return;
    }
    setMainThreads((prev) => {
      const next = prev.filter((t) => t.id !== threadId);
      if (next.length === 0) {
        const id = crypto.randomUUID();
        const fresh: ChatThread = {
          id,
          title: "New chat",
          messages: [],
          updatedAt: Date.now(),
          agent: "email",
        };
        setActiveThreadId(id);
        return [fresh];
      }
      setActiveThreadId((aid) => {
        if (aid !== threadId) return aid;
        const sorted = [...next].sort((a, b) => b.updatedAt - a.updatedAt);
        return sorted[0].id;
      });
      return next;
    });
  };

  const chatDisabled =
    busy ||
    loadingMeta ||
    completionGateActive ||
    (inSetup && !setupStarted) ||
    (showMainApp && !activeThreadId);

  const renderChatShell = (opts: {
    setupMode: boolean;
    hideComposer: boolean;
    messages: ChatMessage[];
  }) => {
    const showOnboardingFileUpload =
      opts.setupMode &&
      setupStarted &&
      !opts.hideComposer &&
      businessProfile !== null &&
      businessProfile.has_cyber_insurance !== false;

    const onboardingFileUploadEnabled =
      showOnboardingFileUpload &&
      businessProfile !== null &&
      businessProfile.has_cyber_insurance === true &&
      !businessProfile.insurance_declarations_onboarding_done &&
      !chatDisabled &&
      !insuranceChatUploadBusy;

    return (
      <main className="chat-shell">
        <div className="messages" ref={messagesScrollRef}>
          {opts.messages.length === 0 && opts.setupMode && setupStarted && (
            <div className="empty">
              <p>Continue the conversation to finish setup.</p>
            </div>
          )}
          {opts.messages.length === 0 && showMainApp && (
            <div className="empty">
              <p>
                Choose an agent above, then ask a question. Responses stream in
                as they are generated.
              </p>
            </div>
          )}
          {opts.messages.map((m) => (
            <div
              key={m.id}
              className={`bubble ${m.role === "user" ? "user" : "assistant"}`}
            >
              <span className="bubble-label">
                {m.role === "user"
                  ? "You"
                  : assistantBubbleLabel(m.assistantAgent)}
              </span>
              <div
                className={
                  m.role === "user" && m.content.startsWith("📎")
                    ? "bubble-text bubble-file"
                    : "bubble-text"
                }
              >
                {m.role === "assistant"
                  ? stripMarkdownBoldMarkers(m.content) ||
                    (busy ? "…" : "")
                  : m.content || (busy ? "…" : "")}
              </div>
            </div>
          ))}
        </div>

        {!opts.hideComposer && (
          <form className="composer" onSubmit={onSubmit}>
            <textarea
              className="input"
              rows={2}
              placeholder={
                inSetup && !setupStarted
                  ? "Click “Start setup” first…"
                  : "Type a message…"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const t = e.currentTarget.value;
                  setInput("");
                  void sendMessage(t);
                }
              }}
              disabled={chatDisabled}
            />
            <div className="composer-actions">
              {showOnboardingFileUpload && (
                <>
                  <input
                    ref={chatInsuranceInputRef}
                    type="file"
                    accept=".pdf,.txt,application/pdf,text/plain"
                    className="sr-only"
                    aria-label="Upload a file"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void uploadInsuranceFromChat(f);
                    }}
                  />
                  <button
                    type="button"
                    className="btn secondary composer-attach"
                    disabled={!onboardingFileUploadEnabled}
                    title="Upload a file (PDF or TXT)"
                    onClick={() => chatInsuranceInputRef.current?.click()}
                  >
                    {insuranceChatUploadBusy ? "Uploading…" : "Upload"}
                  </button>
                </>
              )}
              <button type="submit" className="btn primary" disabled={chatDisabled}>
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        )}
        {((showMainApp && !opts.setupMode) ||
          (opts.setupMode && !opts.hideComposer)) && (
          <p className="chat-disclaimer" role="note">
            This assistant shares best practices from authoritative sources,
            including the United States Federal Trade Commission (FTC) and the
            Cybersecurity and Infrastructure Security Agency (CISA). The
            agent&apos;s guidance should not be interpreted as legal advice or act as
            a substitute for your legal counsel, IT team, or cybersecurity insurer.
          </p>
        )}
      </main>
    );
  };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <h1>Cybersecurity Agentic AI Toolkit</h1>
            <p className="subtitle">
              {loadingMeta
                ? "Loading…"
                : completionGateActive
                  ? "Setup complete"
                  : (() => {
                      const bn = (businessProfile?.business_name || "").trim();
                      if (bn) {
                        return `Email protection & incident response guidance for ${bn}`;
                      }
                      if (showMainApp) {
                        return "Email protection & incident response guidance";
                      }
                      if (inSetup) return "First-time setup";
                      return "";
                    })()}
            </p>
          </div>
        </div>
        <div className="header-meta">
          {showMainApp && (
            <button
              type="button"
              className="btn ghost header-profile"
              onClick={() => setProfileOpen(true)}
            >
              Profile
            </button>
          )}
          {keyOk === false && (
            <span className="pill warn">API key missing in .env</span>
          )}
          {keyOk === true && <span className="pill ok">Connected</span>}
        </div>
      </header>

      {loadingMeta && (
        <div className="app-loading" role="status">
          Loading…
        </div>
      )}

      {completionGateActive && !loadingMeta && (
        <div className="completion-gate">
          <p className="completion-gate-lead">
            You&apos;re all set. When you&apos;re ready, open the home screen to
            choose an agent and manage your business profile.
          </p>
          {renderChatShell({
            setupMode: true,
            hideComposer: true,
            messages: onboardingMessages,
          })}
          <div className="completion-gate-actions">
            <button
              type="button"
              className="btn primary completion-home-btn"
              onClick={goToHomeAfterSetup}
            >
              Go to Home
            </button>
          </div>
          <p className="chat-disclaimer completion-gate-disclaimer" role="note">
            This assistant shares best practices from authoritative sources,
            including the United States Federal Trade Commission (FTC) and the
            Cybersecurity and Infrastructure Security Agency (CISA). The
            agent&apos;s guidance should not be interpreted as legal advice or act as
            a substitute for your legal counsel, IT team, or cybersecurity insurer.
          </p>
        </div>
      )}

      {showMainApp && !loadingMeta && (
        <>
          <ProfileModal
            open={profileOpen}
            onClose={() => setProfileOpen(false)}
            onSaved={() => void refreshMeta()}
            onResetComplete={() => {
              clearPersistedChatState();
              setOnboardingMessages([]);
              setMainThreads([]);
              setActiveThreadId(null);
              setSetupStarted(false);
              setCompletionGateActive(false);
              setProfileOpen(false);
              void refreshMeta();
            }}
          />

          <div className="main-with-sidebar">
            <aside className="chat-sidebar" aria-label="Chat history">
              <div className="chat-sidebar-head">
                <span className="chat-sidebar-title">Chats</span>
                <button
                  type="button"
                  className="btn ghost chat-sidebar-new"
                  onClick={newMainChat}
                  disabled={busy}
                >
                  New chat
                </button>
              </div>
              <ul className="chat-sidebar-list">
                {[...mainThreads]
                  .sort((a, b) => b.updatedAt - a.updatedAt)
                  .map((t) => (
                    <li key={t.id}>
                      <div
                        className={
                          t.id === activeThreadId
                            ? "chat-thread-row active"
                            : "chat-thread-row"
                        }
                      >
                        <button
                          type="button"
                          className="chat-thread-item"
                          onClick={() => setActiveThreadId(t.id)}
                        >
                          {t.title || "New chat"}
                        </button>
                        <button
                          type="button"
                          className="chat-thread-delete"
                          aria-label="Delete chat"
                          title="Delete chat"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteThread(t.id);
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  ))}
              </ul>
            </aside>

            <div className="main-column">
              <div className="agent-bar">
                <span className="agent-label">Agent</span>
                <div
                  className="segmented"
                  role="tablist"
                  aria-label={
                    canChangeAgentForChat
                      ? "Choose agent for this chat"
                      : "Agent for this chat (fixed for this conversation)"
                  }
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeAgent === "email"}
                    className={activeAgent === "email" ? "active" : ""}
                    onClick={() => setActiveThreadAgent("email")}
                    disabled={busy || !canChangeAgentForChat}
                    title={
                      canChangeAgentForChat
                        ? undefined
                        : "Start a new chat to switch agents"
                    }
                  >
                    Email Protection
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeAgent === "incident"}
                    className={activeAgent === "incident" ? "active" : ""}
                    onClick={() => setActiveThreadAgent("incident")}
                    disabled={busy || !canChangeAgentForChat}
                    title={
                      canChangeAgentForChat
                        ? undefined
                        : "Start a new chat to switch agents"
                    }
                  >
                    Incident Response
                  </button>
                </div>
              </div>

              {renderChatShell({
                setupMode: false,
                hideComposer: false,
                messages: activeMainMessages,
              })}
            </div>
          </div>
        </>
      )}

      {inSetup && !loadingMeta && !setupStarted && (
        <div className="setup-splash">
          <div className="setup-splash-card">
            <h2 className="setup-splash-title">Welcome</h2>
            <p className="setup-splash-lead">
              We’ll ask a few questions about your business and email security so
              we can give you tailored guidance. This only takes a few minutes.
            </p>
            <button
              type="button"
              className="btn primary setup-splash-cta"
              onClick={startSetup}
              disabled={busy}
            >
              Start setup
            </button>
          </div>
        </div>
      )}

      {inSetup && !loadingMeta && setupStarted && (
        <>
          {renderChatShell({
            setupMode: true,
            hideComposer: false,
            messages: onboardingMessages,
          })}
        </>
      )}
    </div>
  );
}
