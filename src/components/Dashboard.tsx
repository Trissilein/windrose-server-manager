import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import type { AppConfig, LogEvent, PlayerHistoryEntry, PlayerInfo, ServerState, WorldLaunchOption } from "../types";

interface Props {
  config: AppConfig;
  onNavigate: (tab: string) => void;
}

function formatUptime(startedAt: string | null): string {
  if (!startedAt) return "–";
  const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  return formatDuration(diff);
}

function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(safeSeconds / 86400);
  const h = Math.floor((safeSeconds % 86400) / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = safeSeconds % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatSessionDuration(startedAt: string): string {
  return formatDuration((Date.now() - new Date(startedAt).getTime()) / 1000);
}

function formatTotalPlaytime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "–";
  try {
    return new Date(iso).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "–";
  }
}

function historySortValue(entry: PlayerHistoryEntry): number {
  const lastSession = entry.last_session_ended_at ?? entry.last_session_started_at ?? entry.last_seen_at;
  return new Date(lastSession).getTime();
}

function formatMemory(mb: number): string {
  if (mb === 0) return "–";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function formatJoinTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatCreationTime(unixSecs: number): string {
  if (!unixSecs) return "";
  return new Date(unixSecs * 1000).toLocaleDateString("de-DE");
}

// ── World-Auswahl-Dialog ─────────────────────────────────────────────────────

interface WorldPickerProps {
  worlds: WorldLaunchOption[];
  aliases: Record<string, string>;
  onConfirm: (worldId: string) => void;
  onCancel: () => void;
}

function WorldPicker({ worlds, aliases, onConfirm, onCancel }: WorldPickerProps) {
  const [selected, setSelected] = useState(worlds[0]?.id ?? "");

  function displayName(w: WorldLaunchOption) {
    return aliases[w.id] ?? w.alias ?? w.world_name ?? w.id.slice(0, 8) + "…";
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
    }}>
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 12, padding: 28, minWidth: 340, maxWidth: 480,
      }}>
        <h3 style={{ marginBottom: 16, fontSize: 16, fontWeight: 700 }}>Welt auswählen</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {worlds.map((w) => (
            <label key={w.id} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px", borderRadius: 8, cursor: "pointer",
              background: selected === w.id ? "var(--surface2)" : "transparent",
              border: `1px solid ${selected === w.id ? "var(--accent)" : "var(--border)"}`,
            }}>
              <input
                type="radio" name="world" value={w.id}
                checked={selected === w.id}
                onChange={() => setSelected(w.id)}
                style={{ accentColor: "var(--accent)" }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{displayName(w)}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {w.id.slice(0, 12)}… · {w.world_name}
                  {w.creation_time > 0 && ` · ${formatCreationTime(w.creation_time)}`}
                </div>
              </div>
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onCancel}>Abbrechen</button>
          <button className="btn btn-primary" onClick={() => onConfirm(selected)} disabled={!selected}>
            Starten
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ProgressBar ──────────────────────────────────────────────────────────────

function ProgressBar({ value, color = "var(--accent)" }: { value: number; color?: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div style={{
      height: 6, background: "var(--surface2)", borderRadius: 3, overflow: "hidden",
    }}>
      <div style={{
        height: "100%", width: `${pct}%`, background: color,
        borderRadius: 3, transition: "width 0.4s ease",
      }} />
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function Dashboard({ config, onNavigate }: Props) {
  const [state, setState] = useState<ServerState>({
    status: "Stopped",
    pid: null,
    started_at: null,
    invite_code: null,
    version: null,
    player_count: null,
    max_players: null,
    players: [],
    cpu_percent: 0,
    memory_mb: 0,
    server_name: null,
    password: null,
    world_id: null,
  });
  const [uptime, setUptime] = useState("–");
  const [recentEvents, setRecentEvents] = useState<LogEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [kickingPlayer, setKickingPlayer] = useState<string | null>(null);
  const [playerHistory, setPlayerHistory] = useState<Record<string, Record<string, PlayerHistoryEntry>>>(
    config.player_history ?? {},
  );

  // World picker state
  const [worldPickerWorlds, setWorldPickerWorlds] = useState<WorldLaunchOption[] | null>(null);
  const [backingUp, setBackingUp] = useState(false);

  // Update state
  const [updating, setUpdating] = useState(false);
  const [updateLog, setUpdateLog] = useState<string[]>([]);
  const updateLogRef = useRef<HTMLDivElement>(null);
  const lastWorldIdRef = useRef<string | null>(null);

  useEffect(() => {
    api.getStatus().then((currentState) => {
      setState(currentState);
      if (currentState.world_id) lastWorldIdRef.current = currentState.world_id;
    }).catch(console.error);
  }, []);

  useEffect(() => {
    setPlayerHistory(config.player_history ?? {});
  }, [config.player_history]);

  async function refreshPlayerHistory() {
    try {
      const latest = await api.loadAppConfig();
      setPlayerHistory(latest.player_history ?? {});
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    const unlisten1 = listen<ServerState>("server-status", (e) => {
      setState(e.payload);
      if (e.payload.world_id) lastWorldIdRef.current = e.payload.world_id;
      if (e.payload.status === "Stopped") {
        void refreshPlayerHistory();
      }
    });
    const unlisten2 = listen<LogEvent>("log-event", (e) => {
      const ev = e.payload;
      if (ev.category === "BootNoise" || ev.category === "Unknown") return;
      setRecentEvents((prev) => [ev, ...prev].slice(0, 8));
      if (ev.category === "PlayerConnect" || ev.category === "PlayerDisconnect") {
        void refreshPlayerHistory();
      }
    });
    const unlisten3 = listen<string | null>("update-log", (e) => {
      setUpdateLog((prev) => [...prev, e.payload ?? ""].slice(-100));
      // Auto-scroll to bottom
      setTimeout(() => {
        if (updateLogRef.current) {
          updateLogRef.current.scrollTop = updateLogRef.current.scrollHeight;
        }
      }, 20);
    });
    const unlisten4 = listen<string | null>("version-mismatch", async (e) => {
      if (!config.auto_update_on_demand || !config.steamcmd_path) return;
      const worldId = e.payload ?? lastWorldIdRef.current;
      setUpdateLog([]);
      setUpdating(true);
      try {
        await api.stopServer();
        await api.runServerUpdate();
        if (worldId && config.server_path) {
          await api.startServer(config.server_path, worldId);
        }
      } catch (err) {
        setError(`Auto-Update fehlgeschlagen: ${String(err)}`);
      } finally {
        setUpdating(false);
      }
    });
    return () => {
      unlisten1.then((f) => f());
      unlisten2.then((f) => f());
      unlisten3.then((f) => f());
      unlisten4.then((f) => f());
    };
  }, [config]);

  useEffect(() => {
    const id = setInterval(() => setUptime(formatUptime(state.started_at)), 1000);
    return () => clearInterval(id);
  }, [state.started_at]);

  async function handleStartClick() {
    if (!config.server_path) {
      setError("Server-Pfad nicht konfiguriert.");
      return;
    }
    setError(null);

    try {
      const worlds = await api.getWorldsForLaunch(config.server_path, config.world_aliases);
      if (worlds.length === 0) {
        setError("Keine Welt gefunden — bitte zuerst im Welten-Manager eine Welt anlegen.");
        return;
      }
      // Always show picker so user can confirm/select the world
      setWorldPickerWorlds(worlds);
    } catch (e) {
      setError(`Start fehlgeschlagen: ${String(e)}`);
    }
  }

  async function handleWorldConfirm(worldId: string) {
    setWorldPickerWorlds(null);
    setError(null);
    try {
      await api.startServer(config.server_path, worldId);
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

  async function handleKick(player: PlayerInfo) {
    setKickingPlayer(player.name);
    try {
      await api.kickPlayer(player.name, player.client_login_name);
    } catch (e) {
      setError(`Kick fehlgeschlagen: ${String(e)}`);
    } finally {
      setKickingPlayer(null);
    }
  }

  async function handleUpdate() {
    setUpdateLog([]);
    setUpdating(true);
    setError(null);
    try {
      await api.runServerUpdate();
    } catch (e) {
      setError(`Update fehlgeschlagen: ${String(e)}`);
    } finally {
      setUpdating(false);
    }
  }

  async function handleBackup() {
    if (!config.server_path || !config.backup_path) return;
    try {
      const serverCfg = await api.readServerConfig(config.server_path);
      const worldId = serverCfg.ServerDescription_Persistent.WorldIslandId;
      if (!worldId) return;
      setBackingUp(true);
      const alias = config.world_aliases[worldId];
      await api.backupWorld(config.server_path, worldId, config.backup_path, alias);
    } catch (e) {
      setError(`Backup fehlgeschlagen: ${String(e)}`);
    } finally {
      setBackingUp(false);
    }
  }

  async function copyInviteCode() {
    if (!state.invite_code) return;
    await navigator.clipboard.writeText(state.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const statusColor =
    state.status === "Running" ? "var(--green)"
    : state.status === "Stopped" ? "var(--red)"
    : "var(--yellow)";

  const statusLabel: Record<string, string> = {
    Stopped: "Gestoppt",
    Starting: "Startet…",
    Running: "Läuft",
    Stopping: "Stoppt…",
  };

  const canStart = state.status === "Stopped";
  const canStop = state.status === "Running" || state.status === "Starting";
  const isRunning = state.status === "Running";
  const cpuColor = state.cpu_percent > 80 ? "var(--red)" : state.cpu_percent > 60 ? "var(--yellow)" : "var(--accent)";
  const historyWorldId = state.world_id ?? lastWorldIdRef.current;
  const currentWorldHistory = historyWorldId ? Object.values(playerHistory[historyWorldId] ?? {}) : [];
  const onlineNames = new Set(state.players.map((p) => p.name));
  const sortedPlayerHistory = [...currentWorldHistory].sort((a, b) => {
    const aOnline = onlineNames.has(a.name) ? 1 : 0;
    const bOnline = onlineNames.has(b.name) ? 1 : 0;
    if (aOnline !== bOnline) return bOnline - aOnline;
    return historySortValue(b) - historySortValue(a);
  });

  return (
    <div className="dashboard">
      {worldPickerWorlds && (
        <WorldPicker
          worlds={worldPickerWorlds}
          aliases={config.world_aliases}
          onConfirm={handleWorldConfirm}
          onCancel={() => setWorldPickerWorlds(null)}
        />
      )}

      {/* ── Status-Header ── */}
      <div className="status-card">
        <div className="status-indicator" style={{ background: statusColor }} />
        <div className="status-info">
          <span className="status-label">{statusLabel[state.status]}</span>
          {state.version && <span className="status-version">v{state.version}</span>}
          {isRunning && <span className="status-uptime">{uptime}</span>}
        </div>
        <div className="status-actions">
          <button className="btn btn-primary" onClick={handleStartClick} disabled={!canStart || updating}>
            Start
          </button>
          <button className="btn btn-danger" onClick={handleStop} disabled={!canStop || updating}>
            Stop
          </button>
          <button className="btn btn-small" onClick={handleUpdate} disabled={!canStart || updating} title="Server via SteamCMD aktualisieren">
            {updating ? "Aktualisiere…" : "Update"}
          </button>
          {config.backup_path && (
            <button className="btn btn-small" onClick={handleBackup} disabled={backingUp || updating} title="Aktive Welt sichern">
              {backingUp ? "…" : "Backup"}
            </button>
          )}
        </div>
      </div>

      {!config.server_path && (
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

      {/* ── Update-Log ── */}
      {updateLog.length > 0 && (
        <div className="update-log-section">
          <div className="update-log-header">
            <span>{updating ? "Aktualisierung läuft…" : "Update abgeschlossen"}</span>
            {!updating && (
              <button className="btn btn-small" onClick={() => setUpdateLog([])}>Schließen</button>
            )}
          </div>
          <div className="update-log" ref={updateLogRef}>
            {updateLog.map((line, i) => (
              <div key={i} className="update-log-line">{line}</div>
            ))}
          </div>
        </div>
      )}

      {/* ── 3-Spalten-Panels ── */}
      <div className="dash-panels">

        {/* Server-Info */}
        <div className="dash-panel">
          <div className="dash-panel-title">Server-Info</div>

          <div className="info-row">
            <span className="info-label">Name</span>
            <span className="info-val">{state.server_name ?? "–"}</span>
          </div>

          <div className="info-row">
            <span className="info-label">Welt</span>
            <span className="info-val" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
              {state.world_id
                ? (config.world_aliases[state.world_id] ?? state.world_id.slice(0, 12) + "…")
                : "–"}
            </span>
          </div>

          <div className="info-row">
            <span className="info-label">Invite Code</span>
            <span className="info-val invite-row">
              <span>{state.invite_code ?? "–"}</span>
              {state.invite_code && (
                <button className="btn btn-small" onClick={copyInviteCode} style={{ marginLeft: 6 }}>
                  {copied ? "✓" : "⎘"}
                </button>
              )}
            </span>
          </div>

          <div className="info-row">
            <span className="info-label">Passwort</span>
            <span className="info-val" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {state.password
                ? (showPassword ? state.password : "••••••••")
                : "–"}
              {state.password && (
                <button
                  className="btn btn-small"
                  onClick={() => setShowPassword((v) => !v)}
                  title={showPassword ? "Verbergen" : "Anzeigen"}
                >
                  {showPassword ? "🙈" : "👁"}
                </button>
              )}
            </span>
          </div>

          <div className="info-row">
            <span className="info-label">Uptime</span>
            <span className="info-val">{isRunning ? uptime : "–"}</span>
          </div>

          <div className="info-row">
            <span className="info-label">PID</span>
            <span className="info-val" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
              {state.pid ?? "–"}
            </span>
          </div>
        </div>

        {/* Metriken */}
        <div className="dash-panel">
          <div className="dash-panel-title">Ressourcen</div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span className="info-label">CPU</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: cpuColor }}>
                {isRunning ? `${state.cpu_percent.toFixed(1)}%` : "–"}
              </span>
            </div>
            <ProgressBar value={state.cpu_percent} color={cpuColor} />
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span className="info-label">RAM</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {isRunning ? formatMemory(state.memory_mb) : "–"}
              </span>
            </div>
            <ProgressBar
              value={isRunning && state.memory_mb > 0 ? Math.min(100, (state.memory_mb / 8192) * 100) : 0}
              color="var(--accent-hover)"
            />
          </div>
        </div>

        {/* Aktuelle Spieler */}
        <div className="dash-panel">
          <div className="dash-panel-title" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Aktuell online</span>
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>
              {isRunning
                ? `${state.players.length} / ${state.max_players ?? "?"}`
                : "–"}
            </span>
          </div>

          {state.players.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
              {isRunning ? "Keine Spieler online" : "Server gestoppt"}
            </p>
          ) : (
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              {state.players.map((p) => (
                <li key={p.name} style={{
                  display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 8,
                  padding: "6px 8px", borderRadius: 6,
                  background: "var(--surface2)", fontSize: 13,
                }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {p.client_name ? `${p.name} von ${p.client_name}` : p.name}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: 11 }}>
                      seit {formatJoinTime(p.joined_at)} · {formatSessionDuration(p.joined_at)}
                    </div>
                  </div>
                  <button
                    className="btn btn-small btn-danger-soft"
                    onClick={() => handleKick(p)}
                    disabled={kickingPlayer === p.name}
                    title={`${p.name} kicken`}
                    style={{ fontSize: 11, padding: "2px 8px" }}
                  >
                    {kickingPlayer === p.name ? "…" : "Kick"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Spieler-Historie ── */}
      <div className="events-section player-history-section">
        <h3>Zuletzt auf dem Server</h3>
        {!historyWorldId ? (
          <p className="empty-hint">Keine Welt aktiv</p>
        ) : sortedPlayerHistory.length === 0 ? (
          <p className="empty-hint">Noch keine Spieler-Historie für diese Welt</p>
        ) : (
          <div className="player-history-list">
            {sortedPlayerHistory.map((entry) => {
              const online = onlineNames.has(entry.name);
              const lastSession = online
                ? entry.last_session_started_at
                : entry.last_session_ended_at ?? entry.last_seen_at;
              return (
                <div key={entry.name} className={`player-history-row ${online ? "player-online" : ""}`}>
                  <div className="player-history-main">
                    <span className="player-history-name">{entry.name}</span>
                    {online && <span className="badge badge-active">Online</span>}
                  </div>
                  <div className="player-history-stat">
                    <span>Gerät</span>
                    <strong>{entry.last_client_name ?? "–"}</strong>
                  </div>
                  <div className="player-history-stat">
                    <span>Letzte Session</span>
                    <strong>{formatDateTime(lastSession)}</strong>
                  </div>
                  <div className="player-history-stat">
                    <span>Gesamtspielzeit</span>
                    <strong>{formatTotalPlaytime(entry.total_play_seconds)}</strong>
                  </div>
                  <div className="player-history-stat">
                    <span>Verbindungen</span>
                    <strong>{entry.connect_count}</strong>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Log-Feed ── */}
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
