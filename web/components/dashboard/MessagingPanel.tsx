"use client";

import { useEffect, useRef, useState } from "react";
import { T } from "@/lib/design-tokens";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n-context";
import { htmlLang, type Locale } from "@/lib/i18n";
import Spinner from "./Spinner";
import ThoughtLine, { plainThought } from "./ThoughtLine";
import { useAgentStream } from "@/lib/useAgentStream";

type TFn = (key: string) => string;

type Msg = {
  id: string;
  direction: "inbound" | "outbound";
  channel: string;
  body: string;
  status: string;
  sent_at: string;
  to_address?: string | null;
};

type ProviderInfo = { channel: string; available: boolean; reason: string | null };

type Props = {
  clientId: string;
  clientEmail: string | null;
  initialMessages: Msg[];
  providers: Record<string, ProviderInfo> | null;
};

type Tab = "telegram" | "email";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDay(iso: string, locale: Locale, t: TFn) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t("msg.today");
  if (d.toDateString() === yesterday.toDateString()) return t("msg.yesterday");
  return d.toLocaleDateString(htmlLang(locale), { weekday: "long", month: "short", day: "numeric" });
}

function groupByDay(msgs: Msg[], locale: Locale, t: TFn): Array<{ day: string; messages: Msg[] }> {
  const groups: Map<string, Msg[]> = new Map();
  for (const m of msgs) {
    const key = new Date(m.sent_at).toDateString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }
  return Array.from(groups.entries()).map(([, messages]) => ({
    day: fmtDay(messages[0].sent_at, locale, t),
    messages,
  }));
}

const STATUS_DOT: Record<string, string> = {
  sent:     "#4ade80",
  failed:   "#f87171",
  received: "transparent",
};

export default function MessagingPanel({ clientId, clientEmail, initialMessages, providers }: Props) {
  const { t, locale } = useI18n();
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [prompt, setPrompt] = useState("");
  const [emailTo, setEmailTo] = useState(clientEmail ?? "");   // auto-filled recipient, editable
  const [openEmails, setOpenEmails] = useState<Set<string>>(new Set());  // expanded email cards
  const toggleEmail = (id: string) => setOpenEmails((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const [busy, setBusy] = useState(false);
  const [flowBusy, setFlowBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const draftStream = useAgentStream();
  const drafting = draftStream.running;
  const latestThought = draftStream.thoughts[draftStream.thoughts.length - 1];
  // Separate stream for the one-tap reminder flows so their live thought
  // process renders independently of the AI-draft composer.
  const flowStream = useAgentStream();
  const flowLatest = flowStream.thoughts[flowStream.thoughts.length - 1];

  const telegramOk = !!providers?.["telegram"]?.available;
  const emailOk = !!providers?.["email"]?.available;

  // Default tab: prefer a configured channel.
  const [tab, setTab] = useState<Tab>(telegramOk || !emailOk ? "telegram" : "email");
  const activeOk = tab === "telegram" ? telegramOk : emailOk;
  // Email needs a recipient address; Telegram's recipient comes from linking.
  // The recipient is auto-filled from the client's email but the trainer can edit it.
  const hasEmail = !!emailTo.trim();
  const missingEmail = tab === "email" && emailOk && !hasEmail;
  const canSend = tab === "telegram" ? telegramOk : (emailOk && hasEmail);

  // Scroll to bottom on new messages / tab switch
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, tab]);

  // Supabase realtime — instant updates when the bridge / flows insert rows
  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`messages:${clientId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `client_id=eq.${clientId}` },
        (payload) => {
          const newMsg = payload.new as Msg;
          setMessages((prev) => (prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg]));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clientId]);

  // Thread shows the active tab's channel.
  // The console channel is a dev-only sink and never shown in the card.
  const visible = [...messages]
    .filter((m) => m.channel !== "console" && m.channel === tab)
    .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());

  const groups = groupByDay(visible, locale, t);

  async function runFlow(flow: "daily-reminder" | "weekly-checkin" | "post-session-nudge") {
    setFlowBusy(flow);
    setError(null);
    try {
      // Stream the agent's thought process; the sent message lands via the
      // realtime subscription, but refresh as a fallback once the run is done.
      await flowStream.start(`/api/ai/flow/${flow}/${clientId}/stream`, {});
      const mr = await fetch(`/api/messages/${clientId}`, { cache: "no-store" });
      if (mr.ok) setMessages(await mr.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFlowBusy(null);
    }
  }

  async function generateDraft() {
    setError(null);
    try {
      const result = await draftStream.start(
        `/api/messaging/draft/${clientId}/stream`,
        { channel: tab, brief: prompt.trim() || undefined },
      );
      if (result) {
        if (typeof result.body === "string") setBody(result.body);
        if (tab === "email" && typeof result.subject === "string" && result.subject) {
          setSubject(result.subject);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/messaging/send/${clientId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          provider: tab,
          subject: tab === "email" ? subject : undefined,
          to: tab === "email" ? emailTo.trim() : undefined,
        }),
      });
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      setBody("");
      setSubject("");
      const mr = await fetch(`/api/messages/${clientId}`, { cache: "no-store" });
      if (mr.ok) setMessages(await mr.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tabBtn = (id: Tab, label: string, ok: boolean) => (
    <button
      type="button"
      data-testid={`tab-${id}`}
      onClick={() => { setTab(id); setError(null); }}
      style={{
        fontSize: 12, fontWeight: 600, padding: "6px 14px", borderRadius: 99,
        border: `1px solid ${tab === id ? "rgba(196,148,82,0.4)" : T.border}`,
        background: tab === id ? "rgba(196,148,82,0.18)" : "transparent",
        color: tab === id ? T.text : T.muted, cursor: "pointer",
        display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
      }}
    >
      {label}
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: ok ? "#4ade80" : "#fbbf24", display: "inline-block",
      }} />
    </button>
  );

  return (
    <div className="glass" data-testid="messaging-panel"
      style={{ borderRadius: T.radius.card, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Tabs + status */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {tabBtn("telegram", t("msg.tabTelegram"), telegramOk)}
            {tabBtn("email", t("msg.tabEmail"), emailOk)}
          </div>
          <div data-testid="messaging-status" style={{ fontSize: 11, color: (activeOk && !missingEmail) ? T.muted : "#fbbf24", marginTop: 6 }}>
            {!providers
              ? <span style={{ color: "#fbbf24" }}>{t("msg.serviceDown")}</span>
              : missingEmail
                ? t("msg.noEmail")
                : activeOk
                  ? t(tab === "telegram" ? "msg.mirroring" : "msg.emailMirroring")
                  : t(tab === "telegram" ? "msg.configurePrompt" : "msg.emailConfigure")}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {tab === "telegram" && providers && ([
            ["daily-reminder",     t("msg.dailyReminder")],
            ["weekly-checkin",     t("msg.weeklyCheckin")],
            ["post-session-nudge", t("msg.postSession")],
          ] as const).map(([flow, label]) => (
            <button
              key={flow}
              type="button"
              disabled={flowBusy !== null}
              data-testid={`run-flow-${flow}`}
              onClick={() => runFlow(flow)}
              style={{
                fontSize: 11, padding: "5px 10px", borderRadius: 99,
                border: `1px solid ${T.border}`, background: "transparent",
                color: T.accent,
                cursor: flowBusy !== null ? "not-allowed" : "pointer",
                opacity: flowBusy === flow ? 0.6 : 1, whiteSpace: "nowrap",
              }}
            >
              {flowBusy === flow ? <Spinner emoji="📨" label={plainThought(flowLatest) ?? t("msg.sending")} /> : label}
            </button>
          ))}
        </div>
      </div>

      {/* Live agent thought process while a reminder flow runs */}
      {flowStream.running && flowStream.thoughts.length > 0 && (
        <div
          data-testid="flow-thoughts"
          style={{
            display: "flex", flexDirection: "column", gap: 3,
            background: "rgba(0,0,0,0.22)", border: `1px solid ${T.border}`,
            borderRadius: 8, padding: "9px 11px", maxHeight: 140, overflowY: "auto",
          }}
        >
          {flowStream.thoughts.map((line, i) => (
            <div key={i} style={{
              fontSize: 11, lineHeight: 1.45, color: T.muted,
              opacity: i === flowStream.thoughts.length - 1 ? 1 : 0.5,
            }}>
              <ThoughtLine line={line} />
            </div>
          ))}
        </div>
      )}

      {/* Thread — chat bubbles for Telegram, an email "sent" list for Email */}
      <div
        ref={threadRef}
        style={{ display: "flex", flexDirection: "column", gap: tab === "email" ? 8 : 2, maxHeight: 380, overflowY: "auto", padding: "4px 2px" }}
      >
        {visible.length === 0 && (
          <div data-testid="messages-empty"
            style={{ fontSize: 12, color: T.muted, textAlign: "center", padding: "32px 0" }}>
            {tab === "telegram"
              ? (telegramOk ? t("msg.emptyTelegram") : t("msg.emptyNone"))
              : t("msg.emptyEmail")}
          </div>
        )}

        {groups.map((group) => (
          <div key={group.day} style={{ display: "flex", flexDirection: "column", gap: tab === "email" ? 8 : 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0 8px" }}>
              <div style={{ flex: 1, height: 1, background: T.border }} />
              <span style={{ fontSize: 10, color: T.muted, whiteSpace: "nowrap" }}>{group.day}</span>
              <div style={{ flex: 1, height: 1, background: T.border }} />
            </div>

            {tab === "email"
              ? group.messages.map((m) => {
                  const open = openEmails.has(m.id);
                  return (
                    <div
                      key={m.id}
                      data-testid="email-row"
                      style={{
                        background: "rgba(255,252,245,0.04)",
                        border: `1px solid ${T.border}`,
                        borderLeft: `2px solid ${STATUS_DOT[m.status] ?? T.muted}`,
                        borderRadius: 10,
                        display: "flex", flexDirection: "column",
                      }}
                    >
                      <button
                        type="button"
                        data-testid="email-toggle"
                        onClick={() => toggleEmail(m.id)}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                          background: "transparent", border: "none", textAlign: "left",
                          padding: "11px 14px", cursor: "pointer", width: "100%",
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <span style={{ fontSize: 9, color: T.muted, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", flexShrink: 0 }}>▶</span>
                          <span style={{ fontSize: 11, color: T.muted, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <span style={{ color: T.mutedMid }}>{t("msg.to")}:</span>{" "}
                            <span style={{ fontFamily: T.font.mono }}>{m.to_address ?? clientEmail ?? "—"}</span>
                            {!open && <span style={{ color: T.muted }}>{"  ·  "}{m.body.replace(/\s+/g, " ").slice(0, 60)}{m.body.length > 60 ? "…" : ""}</span>}
                          </span>
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, fontSize: 10, color: T.muted }}>
                          {m.status === "failed" && <span style={{ color: "#f87171" }}>{t("msg.failed")}</span>}
                          <span>{fmtTime(m.sent_at)}</span>
                        </span>
                      </button>
                      {open && (
                        <div style={{ fontSize: 13, lineHeight: 1.55, color: T.text, whiteSpace: "pre-wrap", wordBreak: "break-word", padding: "0 14px 12px 30px" }}>
                          {m.body}
                        </div>
                      )}
                    </div>
                  );
                })
              : group.messages.map((m) => {
                  const isOut = m.direction === "outbound";
                  return (
                    <div
                      key={m.id}
                      data-testid="message-row"
                      style={{
                        display: "flex",
                        justifyContent: isOut ? "flex-end" : "flex-start",
                        marginBottom: 6,
                        paddingLeft: isOut ? 56 : 0,
                        paddingRight: isOut ? 0 : 56,
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", alignItems: isOut ? "flex-end" : "flex-start", gap: 3 }}>
                        <div style={{
                          fontSize: 13, lineHeight: 1.55, padding: "9px 13px",
                          borderRadius: isOut ? "14px 14px 4px 14px" : "4px 14px 14px 14px",
                          background: isOut ? "rgba(196,148,82,0.22)" : "rgba(255,252,245,0.07)",
                          border: `1px solid ${isOut ? "rgba(196,148,82,0.3)" : T.border}`,
                          color: T.text, maxWidth: 380,
                          whiteSpace: "pre-wrap", wordBreak: "break-word",
                        }}>
                          {m.body}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: T.muted }}>
                          <span>{fmtTime(m.sent_at)}</span>
                          {isOut && m.status !== "received" && (
                            <span style={{
                              width: 6, height: 6, borderRadius: "50%",
                              background: STATUS_DOT[m.status] ?? T.muted, display: "inline-block",
                            }} />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
          </div>
        ))}
      </div>

      {/* Composer */}
      <form onSubmit={send} style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
        {tab === "email" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: T.muted, flexShrink: 0 }}>{t("msg.to")}</span>
            <input
              data-testid="message-to"
              type="email"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              placeholder={t("msg.toPlaceholder")}
              style={{
                flex: 1, minWidth: 0,
                background: "rgba(0,0,0,0.25)",
                border: `1px solid ${missingEmail ? "rgba(251,191,36,0.5)" : T.border}`,
                borderRadius: 8, padding: "9px 12px", color: T.text,
                fontFamily: T.font.mono, fontSize: 12, outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
        )}
        {tab === "email" && (
          <input
            data-testid="message-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t("msg.subjectPlaceholder")}
            style={{
              background: "rgba(0,0,0,0.25)", border: `1px solid ${T.border}`,
              borderRadius: 8, padding: "9px 12px", color: T.text,
              fontFamily: T.font.sans, fontSize: 13, outline: "none", boxSizing: "border-box",
            }}
          />
        )}
        <textarea
          data-testid="message-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder={tab === "email" ? t("msg.placeholderEmail") : t("msg.placeholderTelegram")}
          required
          style={{
            background: "rgba(0,0,0,0.25)", border: `1px solid ${T.border}`,
            borderRadius: 8, padding: "10px 12px", color: T.text,
            fontFamily: T.font.sans, fontSize: 13, outline: "none",
            resize: "vertical", minHeight: 90, maxHeight: 220, overflowY: "auto",
            lineHeight: 1.5, boxSizing: "border-box",
          }}
        />

        {/* Prompt → AI draft (grounded in the client's data) */}
        <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
          <input
            data-testid="draft-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !drafting && !busy) { e.preventDefault(); generateDraft(); } }}
            disabled={drafting || busy || !providers}
            placeholder={t("msg.draftHint")}
            style={{
              flex: 1, minWidth: 0,
              background: "rgba(0,0,0,0.25)", border: `1px solid ${T.border}`,
              borderRadius: 8, padding: "8px 11px", color: T.text,
              fontFamily: T.font.sans, fontSize: 12, outline: "none", boxSizing: "border-box",
            }}
          />
          <button
            type="button"
            data-testid="generate-draft"
            onClick={generateDraft}
            disabled={drafting || busy || !providers}
            style={{
              fontSize: 12, padding: "7px 14px", borderRadius: 99,
              border: `1px solid ${T.border}`, background: "transparent",
              color: T.accent, flexShrink: 0, whiteSpace: "nowrap",
              cursor: drafting || busy || !providers ? "not-allowed" : "pointer",
              opacity: drafting || busy || !providers ? 0.7 : 1,
            }}
          >
            {drafting ? <Spinner emoji="✨" label={plainThought(latestThought) ?? t("msg.generating")} /> : `✨ ${t("msg.generateDraft")}`}
          </button>
        </div>

        {/* Live agent thought process while drafting */}
        {drafting && draftStream.thoughts.length > 0 && (
          <div
            data-testid="draft-thoughts"
            style={{
              display: "flex", flexDirection: "column", gap: 3,
              background: "rgba(0,0,0,0.22)", border: `1px solid ${T.border}`,
              borderRadius: 8, padding: "9px 11px", maxHeight: 120, overflowY: "auto",
            }}
          >
            {draftStream.thoughts.map((line, i) => (
              <div key={i} style={{
                fontSize: 11, lineHeight: 1.45, color: T.muted,
                opacity: i === draftStream.thoughts.length - 1 ? 1 : 0.5,
              }}>
                <ThoughtLine line={line} />
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {drafting && (
            <span style={{ fontSize: 11, color: T.muted, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {plainThought(latestThought) ?? t("msg.generating")}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button
            type="submit"
            disabled={busy || drafting || !body.trim() || !providers || !canSend}
            data-testid="message-send"
            style={{
              fontSize: 12, padding: "7px 18px", borderRadius: 99,
              background: canSend
                ? "linear-gradient(135deg, rgba(74,222,128,0.3) 0%, rgba(34,197,94,0.3) 100%)"
                : "linear-gradient(135deg, rgba(140,164,140,0.6) 0%, rgba(80,108,88,0.6) 100%)",
              border: `1px solid ${canSend ? "rgba(74,222,128,0.4)" : "rgba(255,252,245,0.25)"}`,
              color: "#fffdf6", fontWeight: 600,
              cursor: busy || drafting || !body.trim() || !providers || !canSend ? "not-allowed" : "pointer",
              opacity: busy || drafting || !body.trim() || !providers || !canSend ? 0.7 : 1,
              flexShrink: 0, whiteSpace: "nowrap",
            }}
          >
            {busy
              ? <Spinner emoji="📨" label={t("msg.sending")} />
              : tab === "email" ? t("msg.sendEmail") : t("msg.sendTelegram")}
          </button>
        </div>
        {error && (
          <div data-testid="message-error" style={{ fontSize: 11, color: "#f87171", fontFamily: T.font.mono }}>{error}</div>
        )}
      </form>
    </div>
  );
}
