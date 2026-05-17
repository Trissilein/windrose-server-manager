import { useEffect, useMemo, useRef, useState } from "react";
import type { LogCategory, LogEvent } from "../types";

// ── Category metadata ────────────────────────────────────────────────────────

interface CatMeta {
  label: string;
  color: string;        // CSS color for the chip + log line accent
  bg: string;           // rgba background for chip
  border: string;       // rgba border for chip
}

const CAT_META: Record<LogCategory, CatMeta> = {
  // Server lifecycle — blau
  ServerInfo:      { label: "Server-Info",    color: "#7b8aff", bg: "rgba(91,106,240,0.12)",  border: "rgba(91,106,240,0.35)" },
  ServerReady:     { label: "Bereit",          color: "#34c97e", bg: "rgba(52,201,126,0.12)",  border: "rgba(52,201,126,0.35)" },
  Auth:            { label: "Auth",            color: "#7b8aff", bg: "rgba(91,106,240,0.12)",  border: "rgba(91,106,240,0.35)" },
  Registration:    { label: "Registrierung",   color: "#7b8aff", bg: "rgba(91,106,240,0.12)",  border: "rgba(91,106,240,0.35)" },
  Shutdown:        { label: "Shutdown",        color: "#f0b429", bg: "rgba(240,180,41,0.12)",  border: "rgba(240,180,41,0.35)" },
  // World / Map — grün
  WorldLoad:       { label: "Welt",            color: "#34c97e", bg: "rgba(52,201,126,0.10)",  border: "rgba(52,201,126,0.30)" },
  MapLoad:         { label: "Map",             color: "#34c97e", bg: "rgba(52,201,126,0.10)",  border: "rgba(52,201,126,0.30)" },
  // Network — cyan
  ConnectionInfo:  { label: "Verbindung",      color: "#4dd0e1", bg: "rgba(77,208,225,0.10)",  border: "rgba(77,208,225,0.30)" },
  RegionPing:      { label: "Ping",            color: "#4dd0e1", bg: "rgba(77,208,225,0.10)",  border: "rgba(77,208,225,0.30)" },
  // Players — lila
  PlayerConnect:   { label: "Beitritt",        color: "#b39ddb", bg: "rgba(179,157,219,0.12)", border: "rgba(179,157,219,0.35)" },
  PlayerDisconnect:{ label: "Verlassen",       color: "#b39ddb", bg: "rgba(179,157,219,0.12)", border: "rgba(179,157,219,0.35)" },
  // Backup — orange
  BackupStart:     { label: "Backup Start",    color: "#f0b429", bg: "rgba(240,180,41,0.10)",  border: "rgba(240,180,41,0.30)" },
  BackupDone:      { label: "Backup Ende",     color: "#f0b429", bg: "rgba(240,180,41,0.10)",  border: "rgba(240,180,41,0.30)" },
  // Issues — rot/gelb
  Error:           { label: "Fehler",          color: "#e05252", bg: "rgba(224,82,82,0.12)",   border: "rgba(224,82,82,0.35)" },
  Warning:         { label: "Warnung",         color: "#f0b429", bg: "rgba(240,180,41,0.12)",  border: "rgba(240,180,41,0.35)" },
  // Noise — grau
  BootNoise:       { label: "Boot-Noise",      color: "#666e99", bg: "rgba(102,110,153,0.10)", border: "rgba(102,110,153,0.30)" },
  Unknown:         { label: "Sonstige",        color: "#666e99", bg: "rgba(102,110,153,0.10)", border: "rgba(102,110,153,0.30)" },
};

const ALL_CATEGORIES: LogCategory[] = [
  "ServerReady", "ServerInfo", "Auth", "Registration", "Shutdown",
  "WorldLoad", "MapLoad",
  "ConnectionInfo", "RegionPing",
  "PlayerConnect", "PlayerDisconnect",
  "BackupStart", "BackupDone",
  "Error", "Warning",
  "BootNoise", "Unknown",
];

const DEFAULT_HIDDEN: Set<LogCategory> = new Set(["BootNoise", "Unknown"]);

// ── Sub-components ───────────────────────────────────────────────────────────

interface ChipProps {
  cat: LogCategory;
  count: number;
  hidden: boolean;
  onToggle: () => void;
}

function FilterChip({ cat, count, hidden, onToggle }: ChipProps) {
  const meta = CAT_META[cat];
  return (
    <button
      onClick={onToggle}
      title={hidden ? `${meta.label} einblenden` : `${meta.label} ausblenden`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 10px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
        border: `1px solid ${hidden ? "rgba(102,110,153,0.2)" : meta.border}`,
        background: hidden ? "rgba(102,110,153,0.06)" : meta.bg,
        color: hidden ? "#444c6e" : meta.color,
        opacity: hidden ? 0.6 : 1,
        transition: "all 0.15s",
        textDecoration: hidden ? "line-through" : "none",
        userSelect: "none",
      }}
    >
      {meta.label}
      {count > 0 && (
        <span style={{
          background: hidden ? "rgba(102,110,153,0.15)" : meta.bg,
          color: hidden ? "#444c6e" : meta.color,
          borderRadius: 10,
          padding: "0 5px",
          fontSize: 10,
          fontWeight: 700,
        }}>
          {count > 999 ? "999+" : count}
        </span>
      )}
    </button>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface Props {
  events: LogEvent[];
}

export default function LogViewer({ events }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [hiddenCats, setHiddenCats] = useState<Set<LogCategory>>(new Set(DEFAULT_HIDDEN));
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, autoScroll]);

  function toggleCat(cat: LogCategory) {
    setHiddenCats((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }

  function showAll() { setHiddenCats(new Set()); }
  function hideAll() { setHiddenCats(new Set(ALL_CATEGORIES)); }

  // Count events per category
  const counts = useMemo(() => {
    const map: Partial<Record<LogCategory, number>> = {};
    for (const ev of events) {
      map[ev.category] = (map[ev.category] ?? 0) + 1;
    }
    return map;
  }, [events]);

  const visible = useMemo(
    () => events.filter((e) => !hiddenCats.has(e.category)),
    [events, hiddenCats]
  );

  return (
    <div className="log-viewer">
      <div className="log-toolbar">
        <div className="filter-chips">
          {ALL_CATEGORIES.map((cat) => (
            <FilterChip
              key={cat}
              cat={cat}
              count={counts[cat] ?? 0}
              hidden={hiddenCats.has(cat)}
              onToggle={() => toggleCat(cat)}
            />
          ))}
        </div>
        <div className="log-controls">
          <button className="btn btn-small" onClick={showAll} title="Alle einblenden">Alle</button>
          <button className="btn btn-small" onClick={hideAll} title="Alle ausblenden">Keine</button>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            {visible.length} / {events.length}
          </span>
          <label className="toggle-label">
            <input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} />
            Raw
          </label>
          <label className="toggle-label">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            Scroll
          </label>
        </div>
      </div>

      <div className="log-output">
        {visible.length === 0 && (
          <div className="empty-hint" style={{ paddingTop: 40 }}>
            {events.length === 0
              ? "Warte auf Server-Logs…"
              : "Keine Einträge für die aktiven Filter"}
          </div>
        )}
        {visible.map((ev, i) => {
          const meta = CAT_META[ev.category];
          return (
            <div
              key={i}
              className={`log-line log-${ev.level.toLowerCase()}`}
              style={{ borderLeft: `2px solid ${meta.color}22` }}
            >
              <span className="log-ts">{ev.timestamp ?? ""}</span>
              <span className="log-cat" style={{ color: meta.color }}>
                [{meta.label}]
              </span>
              <span className="log-text">{showRaw ? ev.raw_line : ev.summary}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
