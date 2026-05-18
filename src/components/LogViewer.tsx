import { useEffect, useMemo, useRef, useState } from "react";
import type { LogCategory, LogEvent } from "../types";

// ── Category metadata ────────────────────────────────────────────────────────

interface CatMeta {
  label: string;
  icon: string;
  color: string;
  bg: string;
  border: string;
}

const CAT_META: Record<LogCategory, CatMeta> = {
  ServerInfo:      { label: "Server-Info",    icon: "ℹ",  color: "#7b8aff", bg: "rgba(91,106,240,0.12)",  border: "rgba(91,106,240,0.35)" },
  ServerReady:     { label: "Bereit",          icon: "✓",  color: "#34c97e", bg: "rgba(52,201,126,0.12)",  border: "rgba(52,201,126,0.35)" },
  Auth:            { label: "Auth",            icon: "🔑", color: "#7b8aff", bg: "rgba(91,106,240,0.12)",  border: "rgba(91,106,240,0.35)" },
  Registration:    { label: "Registrierung",   icon: "📋", color: "#7b8aff", bg: "rgba(91,106,240,0.12)",  border: "rgba(91,106,240,0.35)" },
  Shutdown:        { label: "Shutdown",        icon: "■",  color: "#f0b429", bg: "rgba(240,180,41,0.12)",  border: "rgba(240,180,41,0.35)" },
  WorldLoad:       { label: "Welt",            icon: "🌍", color: "#34c97e", bg: "rgba(52,201,126,0.10)",  border: "rgba(52,201,126,0.30)" },
  MapLoad:         { label: "Karte",           icon: "🗺",  color: "#34c97e", bg: "rgba(52,201,126,0.10)",  border: "rgba(52,201,126,0.30)" },
  ConnectionInfo:  { label: "Verbindung",      icon: "🔗", color: "#4dd0e1", bg: "rgba(77,208,225,0.10)",  border: "rgba(77,208,225,0.30)" },
  RegionPing:      { label: "Ping",            icon: "📡", color: "#4dd0e1", bg: "rgba(77,208,225,0.10)",  border: "rgba(77,208,225,0.30)" },
  PlayerConnect:   { label: "Beitritt",        icon: "→",  color: "#b39ddb", bg: "rgba(179,157,219,0.12)", border: "rgba(179,157,219,0.35)" },
  PlayerDisconnect:{ label: "Verlassen",       icon: "←",  color: "#b39ddb", bg: "rgba(179,157,219,0.12)", border: "rgba(179,157,219,0.35)" },
  BackupStart:     { label: "Backup Start",    icon: "↓",  color: "#f0b429", bg: "rgba(240,180,41,0.10)",  border: "rgba(240,180,41,0.30)" },
  BackupDone:      { label: "Backup Ende",     icon: "✓",  color: "#f0b429", bg: "rgba(240,180,41,0.10)",  border: "rgba(240,180,41,0.30)" },
  Error:           { label: "Fehler",          icon: "✕",  color: "#e05252", bg: "rgba(224,82,82,0.12)",   border: "rgba(224,82,82,0.35)" },
  Warning:         { label: "Warnung",         icon: "⚠",  color: "#f0b429", bg: "rgba(240,180,41,0.12)",  border: "rgba(240,180,41,0.35)" },
  Performance:     { label: "Performance",     icon: "⚡", color: "#ff4444", bg: "rgba(255,68,68,0.12)",   border: "rgba(255,68,68,0.35)" },
  BootNoise:       { label: "Boot-Noise",      icon: "·",  color: "#666e99", bg: "rgba(102,110,153,0.10)", border: "rgba(102,110,153,0.30)" },
  VersionMismatch: { label: "Vers.-Mismatch",  icon: "⚠",  color: "#ffaa00", bg: "rgba(255,170,0,0.12)",   border: "rgba(255,170,0,0.35)" },
  Unknown:         { label: "Sonstige",        icon: "·",  color: "#666e99", bg: "rgba(102,110,153,0.10)", border: "rgba(102,110,153,0.30)" },
};

const ALL_CATEGORIES: LogCategory[] = [
  "ServerReady", "ServerInfo", "Auth", "Registration", "Shutdown",
  "WorldLoad", "MapLoad",
  "ConnectionInfo", "RegionPing",
  "PlayerConnect", "PlayerDisconnect",
  "BackupStart", "BackupDone",
  "Error", "Warning", "Performance", "VersionMismatch",
  "BootNoise", "Unknown",
];

const DEFAULT_HIDDEN: Set<LogCategory> = new Set(["BootNoise", "Unknown"]);

// Strip known UE5/R5 log prefixes from Unknown/BootNoise lines so the text is readable
// e.g. "R5LogNet: Warning: Something" → "Something"
const LOG_PREFIX_RE = /^[A-Za-z0-9_]+:\s*(?:Warning:|Log:|Error:|Display:)?\s*/;

// Replace runs of 4+ spaces with a line break — UE5 uses spaces for column alignment,
// which makes lines very wide. In RAW mode the original is preserved.
function collapseSpaces(s: string): string {
  return s.replace(/ {4,}/g, "\n");
}

// Aggregation: collapse consecutive log lines with identical category + summary
interface AggLine {
  event: LogEvent;
  count: number;
}

function groupConsecutive(events: LogEvent[]): AggLine[] {
  const result: AggLine[] = [];
  for (const ev of events) {
    const last = result[result.length - 1];
    if (last && last.event.category === ev.category && last.event.summary === ev.summary) {
      last.count++;
    } else {
      result.push({ event: ev, count: 1 });
    }
  }
  return result;
}

function renderSummary(ev: LogEvent, showRaw: boolean): string {
  if (showRaw) return ev.raw_line;
  let text = ev.summary;
  if (ev.category === "Unknown" || ev.category === "BootNoise") {
    text = text.replace(LOG_PREFIX_RE, "").trim() || text;
  }
  return collapseSpaces(text);
}

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
        gap: 4,
        padding: "3px 9px",
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
      <span style={{ fontSize: 10, opacity: 0.9 }}>{meta.icon}</span>
      {meta.label}
      {count > 0 && (
        <span style={{
          background: hidden ? "rgba(102,110,153,0.15)" : meta.bg,
          color: hidden ? "#444c6e" : meta.color,
          borderRadius: 10,
          padding: "0 5px",
          fontSize: 10,
          fontWeight: 700,
          marginLeft: 2,
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
  const [aggregate, setAggregate] = useState(true);
  const [search, setSearch] = useState("");
  const [hiddenCats, setHiddenCats] = useState<Set<LogCategory>>(new Set(DEFAULT_HIDDEN));
  const bottomRef = useRef<HTMLDivElement>(null);
  const searchNeedle = search.trim().toLowerCase();

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "instant" });
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

  const counts = useMemo(() => {
    const map: Partial<Record<LogCategory, number>> = {};
    for (const ev of events) {
      map[ev.category] = (map[ev.category] ?? 0) + 1;
    }
    return map;
  }, [events]);

  const visible = useMemo(
    () => events.filter((e) => {
      if (hiddenCats.has(e.category)) return false;
      if (!searchNeedle) return true;
      const searchable = [
        e.summary,
        e.raw_line,
        e.timestamp ?? "",
        CAT_META[e.category].label,
        e.category,
      ].join("\n").toLowerCase();
      return searchable.includes(searchNeedle);
    }),
    [events, hiddenCats, searchNeedle]
  );

  const aggregated = useMemo<AggLine[]>(
    () => aggregate ? groupConsecutive(visible) : visible.map((ev) => ({ event: ev, count: 1 })),
    [visible, aggregate]
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
          <input
            className="log-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Logs suchen..."
            title="Summary, Raw-Zeile, Zeit oder Kategorie suchen"
          />
          {search && (
            <button className="btn btn-small" onClick={() => setSearch("")} title="Suche löschen">
              ×
            </button>
          )}
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
          <label className="toggle-label">
            <input type="checkbox" checked={aggregate} onChange={(e) => setAggregate(e.target.checked)} />
            Aggregieren
          </label>
        </div>
      </div>

      <div className="log-output">
        {visible.length === 0 && (
          <div className="empty-hint" style={{ paddingTop: 40 }}>
            {events.length === 0
              ? "Warte auf Server-Logs…"
              : search
                ? "Keine Einträge für Suche und aktive Filter"
                : "Keine Einträge für die aktiven Filter"}
          </div>
        )}
        {aggregated.map(({ event: ev, count }, i) => {
          const meta = CAT_META[ev.category];
          return (
            <div
              key={i}
              className={`log-line log-${ev.level.toLowerCase()}`}
              style={{ borderLeft: `2px solid ${meta.color}22` }}
            >
              <span className="log-ts">{ev.timestamp ?? ""}</span>
              <span className="log-cat" style={{ color: meta.color }}>
                {meta.icon} {meta.label}
              </span>
              <span className="log-text">
                {renderSummary(ev, showRaw)}
                {count > 1 && (
                  <span style={{
                    marginLeft: 8,
                    background: "rgba(102,110,153,0.2)",
                    color: "#666e99",
                    borderRadius: 10,
                    padding: "1px 6px",
                    fontSize: 10,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}>
                    ×{count}
                  </span>
                )}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
