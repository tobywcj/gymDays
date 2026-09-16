"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { GROUPS, type ExerciseRow, type AftLevel } from "@/lib/exercise-library";
import type { ClientHealth, Suitability } from "@/lib/exercise-suitability";
import ExerciseCard from "./ExerciseCard";
import ExerciseChat from "./ExerciseChat";
import SessionBuilder, { type SessionItem } from "./SessionBuilder";
import { MuscleLegend, MuscleIcon, GROUP_ICON } from "./MuscleMap";
import ExerciseImportPanel from "./ExerciseImportPanel";
import AftLevelCard, { type AftState } from "./AftLevelCard";
import AftFilter from "./AftFilter";
import Spinner from "@/components/dashboard/Spinner";
import type { ProviderInfo } from "@/lib/exercise-illustration";

type ClientLite = { id: string; name: string };
type CaveatMap = Record<string, Suitability>;

type Props = {
  rows: ExerciseRow[];
  initialFlaggedIds: string[];
  clients: ClientLite[];
  initialClientId: string | null;
  initialHealth: ClientHealth | null;
  initialCaveats?: CaveatMap;
  fixedClientName?: string | null;
  readOnly?: boolean;
  imgProviders?: ProviderInfo[];
  initialCaveatError?: boolean;   // SSR couldn't load this client's health data
  initialAft?: AftState | null;   // client's stored AFT classification (from SSR)
};

export default function ProgrammeLibrary({ rows, initialFlaggedIds, clients, initialClientId, initialHealth, initialCaveats, fixedClientName, readOnly, imgProviders, initialCaveatError, initialAft }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<string>("all");
  const [equip, setEquip] = useState<string>("all");
  // Multi-select AFT colour filter — empty set means "all levels".
  const [aftLevels, setAftLevels] = useState<Set<AftLevel>>(new Set());
  const [aft, setAft] = useState<AftState | null>(initialAft ?? null);

  const toggleAftLevel = (lv: AftLevel) =>
    setAftLevels((prev) => {
      const next = new Set(prev);
      next.has(lv) ? next.delete(lv) : next.add(lv);
      return next;
    });
  const [clientId, setClientId] = useState<string | null>(initialClientId);
  const [health, setHealth] = useState<ClientHealth | null>(initialHealth);
  const [caveats, setCaveats] = useState<CaveatMap>(initialCaveats ?? {});
  const [caveatError, setCaveatError] = useState<boolean>(!!initialCaveatError);
  const [caveatsLoading, setCaveatsLoading] = useState(false);
  const [flagged, setFlagged] = useState<Set<string>>(new Set(initialFlaggedIds));
  const [items, setItems] = useState<SessionItem[]>([]);
  const [showFlagged, setShowFlagged] = useState(false);
  // Single source of truth for the chat drawer — ex + intent in ONE state so the
  // drawer can never mount with the exercise set but the autoAsk intent missing.
  const [chat, setChat] = useState<{ ex: ExerciseRow; autoAsk: "caveat" | null } | null>(null);
  const openChat = (ex: ExerciseRow, autoAsk?: "caveat") => setChat({ ex, autoAsk: autoAsk ?? null });
  const closeChat = () => setChat(null);
  const openEx = chat?.ex ?? null;
  const [imgProvider, setImgProvider] = useState<string>(
    // Default to OpenAI (gpt-image-1); fall back to the first ready/available provider.
    () => (imgProviders?.find((p) => p.id === "openai" && p.ready)
      ?? imgProviders?.find((p) => p.id === "openai")
      ?? imgProviders?.find((p) => p.ready)
      ?? imgProviders?.[0])?.id ?? "openai",
  );

  const clientName = readOnly ? (fixedClientName ?? null) : (clients.find((c) => c.id === clientId)?.name ?? null);

  async function loadCaveats(id: string) {
    setCaveatsLoading(true);
    try {
      const r = await fetch(`/api/client/${id}/caveats`, { method: "POST" });
      if (r.ok) {
        const data = await r.json();
        setHealth(data.health ?? null);
        setCaveats((data.caveats ?? {}) as CaveatMap);
        setCaveatError(false);
      } else {
        // e.g. 500 health_unavailable — surface an error badge instead of
        // letting the cards fall back to a misleading "suitable".
        setCaveats({});
        setCaveatError(true);
      }
    } catch {
      setCaveats({});
      setCaveatError(true);
    } finally {
      setCaveatsLoading(false);
    }
  }

  // Fetch+store caveats whenever a client is in context (mount + change).
  useEffect(() => {
    if (clientId && Object.keys(caveats).length === 0) loadCaveats(clientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function loadAft(id: string) {
    try {
      const r = await fetch(`/api/client/${id}/aft`, { method: "GET" });
      if (r.ok) setAft((await r.json()) as AftState);
      else setAft(null);
    } catch { setAft(null); }
  }

  async function onSelectClient(id: string | null) {
    setClientId(id);
    setCaveats({});
    setHealth(null);
    setCaveatError(false);
    setAft(null);
    if (id) { loadCaveats(id); loadAft(id); }
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("client", id); else url.searchParams.delete("client");
    router.replace(url.pathname + url.search);
  }

  async function toggleFlag(id: string, next: boolean) {
    setFlagged((prev) => { const s = new Set(prev); next ? s.add(id) : s.delete(id); return s; });
    try {
      const r = await fetch(`/api/exercises/${id}/flag`, { method: next ? "POST" : "DELETE" });
      if (!r.ok) throw new Error();
    } catch {
      setFlagged((prev) => { const s = new Set(prev); next ? s.delete(id) : s.add(id); return s; });
    }
  }

  function addToSession(ex: ExerciseRow) {
    setItems((prev) => (prev.some((p) => p.ex.id === ex.id) ? prev : [...prev, { ex, sets: "3", reps: "8-12", notes: "" }]));
  }

  const equipments = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => (r.equipment_options?.length ? r.equipment_options : [r.equipment]).forEach((e) => e && s.add(e)));
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (group !== "all" && r.muscle_group !== group) return false;
      if (aftLevels.size > 0 && !(r.aft_level && aftLevels.has(r.aft_level))) return false;
      if (equip !== "all") {
        const eqs = r.equipment_options?.length ? r.equipment_options : [r.equipment];
        if (!eqs.includes(equip)) return false;
      }
      if (q && !(`${r.name} ${r.name_zh ?? ""}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, search, group, aftLevels, equip]);

  const active = filtered.filter((r) => !flagged.has(r.id));
  const flaggedRows = filtered.filter((r) => flagged.has(r.id));

  const byGroup = useMemo(() => {
    const m = new Map<string, ExerciseRow[]>();
    active.forEach((r) => { const k = r.muscle_group ?? "other"; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); });
    return m;
  }, [active]);

  const orderedKeys = [...GROUPS.map((g) => g.key), ...Array.from(byGroup.keys()).filter((k) => !GROUPS.some((g) => g.key === k))];
  const groupLabel = (k: string) => { const g = GROUPS.find((x) => x.key === k); return g ? (locale === "zh" ? g.label.zh : g.label.en) : k; };

  const filterChip = (on: boolean): React.CSSProperties => ({
    fontSize: 11, padding: "4px 10px", borderRadius: 99, cursor: "pointer",
    border: `1px solid ${on ? "rgba(196,148,82,0.5)" : T.border}`,
    background: on ? "rgba(196,148,82,0.18)" : "transparent", color: on ? "#e4c08c" : T.mutedMid,
  });

  const card = (ex: ExerciseRow, isFlagged: boolean) => (
    <ExerciseCard key={ex.id} ex={ex} clientId={clientId} clientName={clientName}
      caveat={clientId ? (caveats[ex.id] ?? null) : null} caveatLoading={!!clientId && caveatsLoading} caveatError={!!clientId && caveatError} readOnly={readOnly}
      flagged={isFlagged} onOpenChat={(autoAsk) => openChat(ex, autoAsk)} onToggleFlag={toggleFlag} onAddToSession={addToSession}
      imgProvider={imgProvider} />
  );

  const grid = (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {orderedKeys.filter((k) => byGroup.has(k)).map((k) => (
        <div key={k}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#e4c08c", marginBottom: 10 }}>
            {groupLabel(k)} <span style={{ color: T.muted, fontWeight: 400 }}>· {byGroup.get(k)!.length}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
            {byGroup.get(k)!.map((ex) => card(ex, false))}
          </div>
        </div>
      ))}
      {active.length === 0 && <div style={{ fontSize: 12, color: T.muted }}>{t("programme.noResults")}</div>}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* page header card — client selector lives here (trainer only) */}
      {!readOnly && (
        <div className="glass" style={{ borderRadius: T.radius.card, padding: 24, flexShrink: 0, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("programme.pageTitle")}</div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>{t("programme.subtitle")}</div>
          </div>
          {clients.length > 0 && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
              <select value={clientId ?? ""} onChange={(e) => onSelectClient(e.target.value || null)} data-testid="client-select"
                style={{ background: "rgba(0,0,0,0.45)", border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px", color: T.text, fontSize: 12, outline: "none" }}>
                <option value="">{t("programme.generalClient")}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {caveatsLoading && (
                <span data-testid="caveats-loading" style={{ fontSize: 11, color: "#e4c08c", display: "inline-flex", alignItems: "center" }}>
                  <Spinner emoji="⏳" label={t("programme.loadingClient")} />
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* AI exercise research → add to library (trainer only) */}
      {!readOnly && <ExerciseImportPanel />}

      {/* AFT classification — Progress agent analyses where the client sits now */}
      <AftLevelCard
        clientId={clientId}
        clientName={clientName}
        aft={aft}
        onClassified={setAft}
        readOnly={readOnly}
      />

      {/* anatomical filter row */}
      <div className="glass" style={{ borderRadius: T.radius.card, padding: 14, display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("programme.search")}
            style={{ flex: "1 1 200px", background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 8, padding: "7px 10px", color: T.text, fontSize: 12, outline: "none" }} />
        </div>

        {/* muscle-group icons (cf. reference UI) */}
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
          <button onClick={() => setGroup("all")} style={{ ...iconBtn(group === "all"), minWidth: 56 }}>
            <span style={{ fontSize: 18 }}>🏋️</span>
            <span style={iconLabel}>{t("programme.allGroups")}</span>
          </button>
          {GROUPS.map((g) => {
            const ic = GROUP_ICON[g.key];
            return (
              <button key={g.key} onClick={() => setGroup(group === g.key ? "all" : g.key)} data-testid={`group-${g.key}`} style={iconBtn(group === g.key)}>
                {ic ? <MuscleIcon regions={ic.regions} view={ic.view} size={42} active={group === g.key} /> : <span style={{ fontSize: 18 }}>•</span>}
                <span style={iconLabel}>{locale === "zh" ? g.label.zh : g.label.en}</span>
              </button>
            );
          })}
        </div>

        {/* equipment */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={filterChip(equip === "all")} onClick={() => setEquip("all")}>{t("programme.allEquip")}</span>
          {equipments.map((e) => <span key={e} style={filterChip(equip === e)} onClick={() => setEquip(equip === e ? "all" : e)}>{t(`equip.${e}`)}</span>)}

          {/* AI illustration provider — drives the per-card Generate action */}
          {!readOnly && imgProviders && imgProviders.length > 0 && (
            <>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: T.muted }} title={t("illo.providerHint")}>🎨 {t("illo.provider")}</span>
              <select
                value={imgProvider}
                onChange={(e) => setImgProvider(e.target.value)}
                data-testid="illustration-provider"
                style={{ background: "rgba(0,0,0,0.45)", border: `1px solid ${T.border}`, borderRadius: 8, padding: "5px 8px", color: T.text, fontSize: 11, outline: "none" }}
              >
                {imgProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} · {p.kind === "free" ? t("illo.free") : t("illo.paid")}{p.ready ? "" : ` · ${t("illo.notSet")}`}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        <MuscleLegend />

        {/* AFT level filter — multi-select; click several to combine. */}
        <AftFilter
          selected={aftLevels}
          onToggle={toggleAftLevel}
          onClear={() => setAftLevels(new Set())}
          clientLevel={aft?.aft_level ?? null}
        />
      </div>

      {!readOnly ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 16, alignItems: "start" }}>
          {grid}
          <SessionBuilder items={items} setItems={setItems} clients={clients} clientId={clientId} />
        </div>
      ) : grid}

      {flaggedRows.length > 0 && (
        <div className="glass" style={{ borderRadius: T.radius.card, padding: 14 }}>
          <button onClick={() => setShowFlagged((s) => !s)} data-testid="flagged-section-toggle"
            style={{ background: "none", border: "none", cursor: "pointer", color: T.mutedMid, fontSize: 12, fontWeight: 600, display: "flex", gap: 6 }}>
            {showFlagged ? "▾" : "▸"} ⚑ {t("programme.notRecommendedSection")} · {flaggedRows.length}
          </button>
          {showFlagged && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14, marginTop: 12 }}>
              {flaggedRows.map((ex) => card(ex, true))}
            </div>
          )}
        </div>
      )}

      {/* per-exercise chat drawer */}
      {chat && (
        <div onClick={closeChat} data-testid="chat-overlay"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(460px, 100%)", height: "100%", borderRadius: 0,
              borderLeft: `1px solid ${T.border}`, background: "#1e2719",
              boxShadow: "-16px 0 48px rgba(0,0,0,0.55)",
              display: "flex", flexDirection: "column",
            }}>
            <ExerciseChat
              ex={chat.ex}
              clientId={clientId}
              clientName={clientName}
              caveat={clientId ? (caveats[chat.ex.id] ?? null) : null}
              autoAsk={chat.autoAsk}
              onClose={closeChat}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const iconBtn = (on: boolean): React.CSSProperties => ({
  display: "flex", flexDirection: "column", alignItems: "center", gap: 2, flexShrink: 0,
  padding: "6px 8px", borderRadius: 12, cursor: "pointer",
  background: on ? "rgba(196,148,82,0.16)" : "transparent",
  border: `1px solid ${on ? "rgba(196,148,82,0.5)" : "transparent"}`,
});
const iconLabel: React.CSSProperties = { fontSize: 10, color: "rgba(244,237,226,0.65)", whiteSpace: "nowrap" };
