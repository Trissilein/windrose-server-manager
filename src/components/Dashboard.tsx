import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import type { AppConfig, LogEvent, ServerState } from "../types";

interface Props {
  config: AppConfig;
  onNavigate: (tab: string) => void;
}

function formatUptime(startedAt: string | null): string {
  if (!startedAt) return "–";
  const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function Dashboard({ config, onNavigate }: Props) {
  const [state, setState] = useState<ServerState>({
    status: "Stopped",
    pid: null,
    started_at: null,
    invite_code: null,
    version: null,
    player_count: null,
    max_players: null,
  });
  const [uptime, setUptime] = useState("–");
  const [recentEvents, setRecentEvents] = useState<LogEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getStatus().then(setState).catch(console.error);
  }, []);

  useEffect(() => {
    const unlisten1 = listen<ServerState>("server-status", (e) => setState(e.payload));
    const unlisten2 = listen<LogEvent>("log-event", (e) => {
      const ev = e.payload;
      if (ev.category === "BootNoise" || ev.category === "Unknown") return;
      setRecentEvents((prev) => [ev, ...prev].slice(0, 8));
    });
    return () => {
      unlisten1.then((f) => f());
      unlisten2.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setUptime(formatUptime(state.started_at)), 1000);
    return () => clearInterval(id);
  }, [state.started_at]);

  async function handleStart() {
    if (!config.server_path) {
      setError("Server-Pfad nicht konfiguriert.");
      return;
    }
    setError(null);
    try {
      await api.startServer(config.server_path);
    } catch (e) {
      setError(`Start fehlgeschlagen: ${String(e)}`);
    }
  }

  async function handleStop() {
    setError(null);
    try {
      await api.stopServer();
    } catch (e) {
      setError(`Stop fehlgeschlagen: ${String(e)}`);
    }
  }

  async function copyInviteCode() {
    if (!state.invite_code) return;
    await navigator.clipboard.writeText(state.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const statusColor =
    state.status === "Running"
      ? "var(--green)"
      : state.status === "Stopped"
      ? "var(--red)"
      : "var(--yellow)";

  const statusLabel: Record<string, string> = {
    Stopped: "Gestoppt",
    Starting: "Startet…",
    Running: "Läuft",
    Stopping: "Stoppt…",
  };

  const canStart = state.status === "Stopped";
  const canStop = state.status === "Running" || state.status === "Starting";
  const noPath = !config.server_path;

  return (
    <div className="dashboard">
      <div className="status-card">
        <div className="status-indicator" style={{ background: statusColor }} />
        <div className="status-info">
          <span className="status-label">{statusLabel[state.status]}</span>
          {state.version && <span className="status-version">v{state.version}</span>}
        </div>
        <div className="status-actions">
          <button className="btn btn-primary" onClick={handleStart} disabled={!canStart}>
            Start
          </button>
          <button className="btn btn-danger" onClick={handleStop} disabled={!canStop}>
            Stop
          </button>
        </div>
      </div>

      {noPath && (
        <div className="warning-banner" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span>Server-Pfad nicht konfiguriert.</span>
          <button className="btn btn-small" onClick={() => onNavigate("settings")}>
            Einstellungen öffnen
          </button>
        </div>
      )}

      {error && (
        <div className="error-banner" onClick={() => setError(null)}>
          {error} <span style={{ float: "right", opacity: 0.6 }}>✕</span>
        </div>
      )}

      <div className="info-grid">
        <div className="info-card">
          <div className="info-label">Uptime</div>
          <div className="info-value">{state.status === "Running" ? uptime : "–"}</div>
        </div>
        <div className="info-card">
          <div className="info-label">PID</div>
          <div className="info-value">{state.pid ?? "–"}</div>
        </div>
        <div className="info-card">
          <div className="info-label">Spieler</div>
          <div className="info-value">
            {state.player_count != null
              ? `${state.player_count} / ${state.max_players ?? "?"}`
              : "–"}
          </div>
        </div>
        <div className="info-card">
          <div className="info-label">Invite Code</div>
          <div className="info-value invite-row">
            <span>{state.invite_code ?? "–"}</span>
            {state.invite_code && (
              <button className="btn btn-small" onClick={copyInviteCode}>
                {copied ? "✓" : "Kopieren"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="events-section">
        <h3>Letzte Ereignisse</h3>
        {recentEvents.length === 0 ? (
          <p className="empty-hint">Noch keine Ereignisse</p>
        ) : (
          <ul className="event-list">
            {recentEvents.map((ev, i) => (
              <li key={i} className={`event-item event-${ev.level.toLowerCase()}`}>
                <span className="event-time">{ev.timestamp ?? ""}</span>
                <span className="event-summary">{ev.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
