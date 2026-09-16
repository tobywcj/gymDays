"use client";

import { useEffect, useMemo, useState } from "react";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";

type Flow = "daily-reminder" | "weekly-checkin" | "post-session-nudge";
type Frequency = "daily" | "weekly";

type Schedule = {
  id: string;
  name: string;
  flow: Flow;
  target_all: boolean;
  client_ids: string[];
  frequency: Frequency;
  hour: number;
  minute: number;
  weekday: number | null;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string;
};

type ClientLite = { id: string; name: string };

const FLOWS: Flow[] = ["daily-reminder", "weekly-checkin", "post-session-nudge"];
const FLOW_GLYPH: Record<Flow, string> = {
  "daily-reminder": "⏰",
  "weekly-checkin": "📋",
  "post-session-nudge": "💬",
};

export default function ScheduledAgents({ clients }: { clients: ClientLite[] }) {
  const { t } = useI18n();
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function refresh() {
    try {
      const r = await fetch("/api/agents/scheduled", { cache: "no-store" });
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      setSchedules((await r.json()).schedules);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => { refresh(); }, []);

  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);

  async function toggle(s: Schedule) {
    try {
      const r = await fetch(`/api/agents/scheduled/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      if (!r.ok) throw new Error(await r.text());
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function remove(s: Schedule) {
    if (!confirm(t("agents.deleteConfirm"))) return;
    try {
      const r = await fetch(`/api/agents/scheduled/${s.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function describe(s: Schedule): string {
    const time = `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
    if (s.frequency === "weekly") {
      return t("agents.everyWeekAt")
        .replace("{day}", t(`agents.weekday.${s.weekday ?? 0}`))
        .replace("{time}", time);
    }
    return t("agents.everyDayAt").replace("{time}", time);
  }

  function recipients(s: Schedule): string {
    if (s.target_all) return t("agents.allClientsLabel");
    const names = s.client_ids.map((id) => clientName.get(id)).filter(Boolean);
    if (names.length <= 2) return names.join(", ");
    return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  }

  return (
    <div
      className="glass"
      style={{
        borderRadius: T.radius.card,
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        position: "relative",
        flexShrink: 0,
      }}
      data-testid="scheduled-agents"
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t("agents.title")}</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{t("agents.subtitle")}</div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          data-testid="agents-new"
          style={{
            marginLeft: "auto",
            fontSize: 12,
            padding: "7px 14px",
            borderRadius: 99,
            background: open ? "transparent" : "linear-gradient(135deg, rgba(140,164,140,0.95) 0%, rgba(92,124,92,0.95) 100%)",
            color: open ? T.mutedMid : "#fffdf6",
            border: `1px solid ${open ? T.border : "rgba(255,252,245,0.25)"}`,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {open ? t("agents.cancel") : `+ ${t("agents.create")}`}
        </button>
      </div>

      {open && (
        <CreateForm
          clients={clients}
          onCreated={() => { setOpen(false); refresh(); }}
        />
      )}

      {err && <div style={{ color: "#f87171", fontSize: 11, fontFamily: T.font.mono }}>{err}</div>}

      {schedules && schedules.length === 0 && !open && (
        <div data-testid="agents-empty" style={{ fontSize: 12, color: T.muted }}>
          {t("agents.empty")}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 360, overflowY: "auto" }}>
        {(schedules ?? []).map((s) => (
          <div
            key={s.id}
            data-testid="agent-schedule-row"
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: "11px 12px",
              borderRadius: T.radius.md,
              background: "rgba(255,252,245,0.025)",
              border: `1px solid ${T.border}`,
              opacity: s.enabled ? 1 : 0.55,
            }}
          >
            <div
              style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                background: "rgba(140,164,140,0.18)",
                border: "1px solid rgba(188,211,184,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
              }}
            >
              {FLOW_GLYPH[s.flow]}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: T.text }}>{s.name}</span>
                <span
                  style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                    padding: "2px 7px", borderRadius: 99,
                    background: s.enabled ? "rgba(140,164,140,0.2)" : "rgba(255,255,255,0.06)",
                    color: s.enabled ? "#bcd3b8" : T.muted,
                  }}
                >
                  {s.enabled ? t("agents.enabled") : t("agents.paused")}
                </span>
              </div>
              <div style={{ fontSize: 11, color: T.mutedMid, marginTop: 3 }}>
                {t(`agents.task.${s.flow}`)} · {describe(s)}
              </div>
              <div style={{ fontSize: 10.5, color: T.muted, marginTop: 1, fontFamily: T.font.mono }}>
                {recipients(s)}
              </div>
            </div>

            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <button
                onClick={() => toggle(s)}
                data-testid="agent-toggle"
                style={pillBtn}
              >{s.enabled ? t("agents.pause") : t("agents.resume")}</button>
              <button
                onClick={() => remove(s)}
                data-testid="agent-delete"
                style={pillBtn}
              >{t("agents.delete")}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateForm({ clients, onCreated }: { clients: ClientLite[]; onCreated: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [flow, setFlow] = useState<Flow>("daily-reminder");
  const [targetAll, setTargetAll] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [weekday, setWeekday] = useState(1);
  const [time, setTime] = useState("18:00");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleClient(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const [hh, mm] = time.split(":").map(Number);
      const r = await fetch("/api/agents/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          flow,
          target_all: targetAll,
          client_ids: targetAll ? [] : [...selected],
          frequency,
          hour: hh,
          minute: mm,
          weekday: frequency === "weekly" ? weekday : null,
          tz_offset_minutes: new Date().getTimezoneOffset(),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      data-testid="agent-create-form"
      style={{
        display: "flex", flexDirection: "column", gap: 12,
        padding: 16, borderRadius: T.radius.md,
        background: "rgba(0,0,0,0.18)", border: `1px solid ${T.border}`,
      }}
    >
      <Field label={t("agents.name")}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("agents.namePlaceholder")}
          required
          data-testid="agent-name"
          style={inputStyle}
        />
      </Field>

      <Field label={t("agents.task")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {FLOWS.map((f) => {
            const on = flow === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFlow(f)}
                data-testid={`agent-flow-${f}`}
                style={{
                  textAlign: "left", padding: "9px 11px", borderRadius: 8, cursor: "pointer",
                  background: on ? "rgba(140,164,140,0.16)" : "transparent",
                  border: `1px solid ${on ? "rgba(188,211,184,0.35)" : T.border}`,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: on ? "#bcd3b8" : T.text }}>
                  {FLOW_GLYPH[f]} {t(`agents.task.${f}`)}
                </div>
                <div style={{ fontSize: 10.5, color: T.muted, marginTop: 2 }}>{t(`agents.taskDesc.${f}`)}</div>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label={t("agents.recipients")}>
        <div style={{ display: "flex", gap: 6, marginBottom: selected.size || !targetAll ? 8 : 0 }}>
          <Toggle on={targetAll} onClick={() => setTargetAll(true)} label={t("agents.allClients")} />
          <Toggle on={!targetAll} onClick={() => setTargetAll(false)} label={t("agents.specificClients")} />
        </div>
        {!targetAll && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} data-testid="agent-client-picker">
            {clients.length === 0 && <span style={{ fontSize: 11, color: T.muted }}>{t("agents.noClients")}</span>}
            {clients.map((c) => {
              const on = selected.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleClient(c.id)}
                  style={{
                    fontSize: 11, padding: "5px 11px", borderRadius: 99, cursor: "pointer",
                    background: on ? "rgba(140,164,140,0.2)" : "transparent",
                    color: on ? "#bcd3b8" : T.mutedMid,
                    border: `1px solid ${on ? "rgba(188,211,184,0.35)" : T.border}`,
                  }}
                >{c.name}</button>
              );
            })}
          </div>
        )}
      </Field>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Field label={t("agents.schedule")}>
          <div style={{ display: "flex", gap: 6 }}>
            <Toggle on={frequency === "daily"} onClick={() => setFrequency("daily")} label={t("agents.daily")} />
            <Toggle on={frequency === "weekly"} onClick={() => setFrequency("weekly")} label={t("agents.weekly")} />
          </div>
        </Field>

        {frequency === "weekly" && (
          <Field label={t("agents.day")}>
            <select
              value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value))}
              data-testid="agent-weekday"
              style={{ ...inputStyle, paddingRight: 8 }}
            >
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>{t(`agents.weekday.${d}`)}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label={t("agents.time")}>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            data-testid="agent-time"
            style={inputStyle}
          />
        </Field>
      </div>

      <div style={{ fontSize: 10, color: T.muted }}>{t("agents.timezoneNote")}</div>

      <button
        type="submit"
        disabled={busy}
        data-testid="agent-submit"
        style={{
          alignSelf: "flex-start", fontSize: 12, padding: "8px 16px", borderRadius: 99,
          background: "linear-gradient(135deg, rgba(140,164,140,0.95) 0%, rgba(92,124,92,0.95) 100%)",
          color: "#fffdf6", border: "1px solid rgba(255,252,245,0.25)", fontWeight: 600,
          cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? t("agents.saving") : t("agents.save")}
      </button>
      {err && <div data-testid="agent-form-error" style={{ fontSize: 11, color: "#f87171", fontFamily: T.font.mono }}>{err}</div>}
    </form>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 11.5, padding: "7px 13px", borderRadius: 99, cursor: "pointer",
        background: on ? "rgba(140,164,140,0.2)" : "transparent",
        color: on ? "#bcd3b8" : T.mutedMid,
        border: `1px solid ${on ? "rgba(188,211,184,0.35)" : T.border}`,
        fontWeight: 600,
      }}
    >{label}</button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 10, color: T.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>
      {label}
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.25)",
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  padding: "9px 11px",
  color: T.text,
  fontFamily: T.font.mono,
  fontSize: 12,
  outline: "none",
};

const pillBtn: React.CSSProperties = {
  fontSize: 11,
  padding: "5px 11px",
  borderRadius: 99,
  border: `1px solid ${T.border}`,
  background: "transparent",
  color: T.mutedMid,
  cursor: "pointer",
};
