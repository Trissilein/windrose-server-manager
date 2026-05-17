import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { LogCategory, LogEvent } from "../types";

const CATEGORY_LABELS: Record<LogCategory, string> = {
  BootNoise: "Boot",
  ServerInfo: "Info",
  WorldLoad: "Welt",
  ServerReady: "Bereit",
  RegionPing: "Ping",
  BackupStart: "Backup",
  BackupDone: "Backup",
  ConnectionInfo: "Verbindung",
  MapLoad: "Map",
  Auth: "Auth",
  Registration: "Registr.",
  Shutdown: "Shutdown",
  PlayerConnect: "Connect",
  PlayerDisconnect: "Disconnect",
  Error: "Fehler",
  Warning: "Warnung",
  Unknown: "Sonstige",
};

const ALL_CATEGORIES: LogCategory[] = [
  "ServerInfo", "WorldLoad", "ServerReady", "RegionPing", "BackupStart",
  "BackupDone", "ConnectionInfo", "MapLoad", "Auth", "Registration",
  "Shutdown", "PlayerConnect", "PlayerDisconnect", "Error", "Warning", "Unknown",
];

export default function LogViewer() {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [showRaw, setShowRaw] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [hiddenCats, setHiddenCats] = useState<Set<LogCategory>>(
    new Set(["BootNoise", "Unknown"] as LogCategory[])
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = listen<LogEvent>("log-event", (e) => {
      setEvents((prev) => [...prev, e.payload].slice(-2000));
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, autoScroll]);

  function toggleCat(cat: LogCategory) {
    setHiddenCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  const visible = events.filter((e) => !hiddenCats.has(e.category));

  return (
    <div className="log-viewer">
      <div className="log-toolbar">
        <div className="filter-chips">
          {ALL_CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={`chip ${hiddenCats.has(cat) ? "chip-off" : "chip-on"}`}
              onClick={() => toggleCat(cat)}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
        <div className="log-controls">
          <label className="toggle-label">
            <input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} />
            Raw
          </label>
          <label className="toggle-label">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            Auto-Scroll
          </label>
          <button className="btn btn-small" onClick={() => setEvents([])}>
            Leeren
          </button>
        </div>
      </div>

      <div className="log-output">
        {visible.length === 0 && (
          <div className="empty-hint">Warte auf Server-Logs…</div>
        )}
        {visible.map((ev, i) => (
          <div key={i} className={`log-line log-${ev.level.toLowerCase()}`}>
            <span className="log-ts">{ev.timestamp ?? ""}</span>
            <span className={`log-cat log-cat-${ev.category.toLowerCase()}`}>
              [{CATEGORY_LABELS[ev.category]}]
            </span>
            <span className="log-text">{showRaw ? ev.raw_line : ev.summary}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
