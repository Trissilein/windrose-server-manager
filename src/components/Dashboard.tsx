import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import type { AppConfig, LogEvent, PlayerHistoryEntry, PlayerInfo, ServerState, WorldLaunchOption } from "../types";

interface Props {
  config: AppConfig;
  onNavigate: (tab: string) => void;
  onConfigChange: (config: AppConfig) => void;
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

function sessionSeconds(startedAt: string | null, endedAt: string | null = null): number {
  if (!startedAt) return 0;
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 1000));
}

function formatSessionDuration(startedAt: string | null, endedAt: string | null = null): string {
  if (!startedAt) return "–";
  return formatDuration(sessionSeconds(startedAt, endedAt));
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

function formatCreationTime(unixSecs: number): string {
  if (!unixSecs) return "";
  return new Date(unixSecs * 1000).toLocaleDateString("de-DE");
}

interface PlayerPanelEntry {
  name: string;
  online: boolean;
  player: PlayerInfo | null;
  history: PlayerHistoryEntry | null;
}

type PendingAction =
  | { kind: "stop" }
  | { kind: "kick"; entry: PlayerPanelEntry }
  | { kind: "hide"; entry: PlayerPanelEntry }
  | { kind: "reset"; entry: PlayerPanelEntry }
  | null;

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

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p style={{ lineHeight: 1.5, color: "var(--text)", marginBottom: 20 }}>{message}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn" onClick={onCancel}>Abbrechen</button>
          <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function Dashboard({ config, onNavigate, onConfigChange }: Props) {
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
  const [playerHistory, setPlayerHistory] = useState<Record<string, Record<string, PlayerHistoryEntry>>>(
    config.player_history ?? {},
  );
  const [hiddenPlayers, setHiddenPlayers] = useState<Record<string, string[]>>(config.hidden_players ?? {});
  const [showHiddenPlayers, setShowHiddenPlayers] = useState(false);
  const [openPlayerMenu, setOpenPlayerMenu] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

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

  useEffect(() => {
    setHiddenPlayers(config.hidden_players ?? {});
  }, [config.hidden_players]);

  async function refreshPlayerData(syncApp = false) {
    try {
      const latest = await api.loadAppConfig();
      setPlayerHistory(latest.player_history ?? {});
      setHiddenPlayers(latest.hidden_players ?? {});
      if (syncApp) {
        onConfigChange(latest);
      }
      return latest;
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  const historyWorldId = state.world_id ?? lastWorldIdRef.current;
  const worldPlayerHistory = historyWorldId ? Object.values(playerHistory[historyWorldId] ?? {}) : [];
  const hiddenPlayerNames = historyWorldId ? new Set(hiddenPlayers[historyWorldId] ?? []) : new Set<string>();

  const playerEntries: PlayerPanelEntry[] = (() => {
    const historyByName = new Map(worldPlayerHistory.map((entry) => [entry.name, entry]));
    const liveByName = new Map(state.players.map((player) => [player.name, player]));
    const names = new Set<string>([...historyByName.keys(), ...liveByName.keys()]);

    return Array.from(names)
      .map((name) => {
        const player = liveByName.get(name) ?? null;
        const history = historyByName.get(name) ?? null;
        return {
          name,
          online: player !== null,
          player,
          history,
        };
      })
      .sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        const aSort = a.online ? new Date(a.player!.joined_at).getTime() : historySortValue(a.history!);
        const bSort = b.online ? new Date(b.player!.joined_at).getTime() : historySortValue(b.history!);
        return bSort - aSort;
      });
  })();

  const visiblePlayerEntries = playerEntries.filter((entry) => !hiddenPlayerNames.has(entry.name));
  const hiddenPlayerEntries = playerEntries.filter((entry) => hiddenPlayerNames.has(entry.name));
  const onlinePlayerCount = state.players.length;
  const displayStatus = state.status === "Running"
    ? (onlinePlayerCount > 0 ? "Active" : "Idle")
    : state.status;

  async function reloadPlayerPanel() {
    await refreshPlayerData(true);
  }

  async function setPlayerVisibility(entry: PlayerPanelEntry, hidden: boolean) {
    if (!historyWorldId) {
      setError("Keine aktive Welt gefunden.");
      return;
    }
    try {
      await api.setPlayerHidden(historyWorldId, entry.name, hidden);
      await reloadPlayerPanel();
      setOpenPlayerMenu(null);
      if (!hidden) {
        setShowHiddenPlayers(true);
      }
    } catch (err) {
      setError(`Player-Panel konnte nicht aktualisiert werden: ${String(err)}`);
    }
  }

  async function resetPlayerData(entry: PlayerPanelEntry) {
    if (!historyWorldId) {
      setError("Keine aktive Welt gefunden.");
      return;
    }
    try {
      await api.resetPlayerHistoryEntry(historyWorldId, entry.name);
      await reloadPlayerPanel();
      setOpenPlayerMenu(null);
    } catch (err) {
      setError(`Player-Daten konnten nicht zurückgesetzt werden: ${String(err)}`);
    }
  }

  async function performPendingAction(action: PendingAction) {
    if (!action) return;

    setPendingAction(null);
    setError(null);
    switch (action.kind) {
      case "stop":
        try {
          await api.stopServer();
        } catch (err) {
          setError(`Stop fehlgeschlagen: ${String(err)}`);
        }
        break;
      case "kick":
        try {
          await api.kickPlayer(action.entry.name, action.entry.player?.client_login_name ?? null);
        } catch (err) {
          setError(`Kick fehlgeschlagen: ${String(err)}`);
        }
        break;
      case "hide":
        await setPlayerVisibility(action.entry, true);
        break;
      case "reset":
        await resetPlayerData(action.entry);
        break;
    }
  }

  useEffect(() => {
    const unlisten1 = listen<ServerState>("server-status", (e) => {
      setState(e.payload);
      if (e.payload.world_id) lastWorldIdRef.current = e.payload.world_id;
      if (e.payload.status === "Stopped") {
        void refreshPlayerData();
      }
    });
    const unlisten2 = listen<LogEvent>("log-event", (e) => {
      const ev = e.payload;
      if (ev.category === "BootNoise" || ev.category === "Unknown") return;
      setRecentEvents((prev) => [ev, ...prev].slice(0, 8));
      if (ev.category === "PlayerConnect" || ev.category === "PlayerDisconnect") {
        void refreshPlayerData();
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
    displayStatus === "Active" ? "var(--green)"
    : displayStatus === "Idle" ? "var(--yellow)"
    : state.status === "Stopped" ? "var(--red)"
    : "var(--yellow)";

  const statusLabel: Record<string, string> = {
    Stopped: "Gestoppt",
    Starting: "Startet…",
    Idle: "Idle",
    Active: "Active",
    Stopping: "Stoppt…",
  };

  const canStart = state.status === "Stopped";
  const canStop = state.status === "Running" || state.status === "Starting";
  const isRunning = state.status === "Running";
  const cpuColor = state.cpu_percent > 80 ? "var(--red)" : state.cpu_percent > 60 ? "var(--yellow)" : "var(--accent)";
  const playerPanelTitleCount = historyWorldId
    ? `${onlinePlayerCount}${state.max_players ? ` / ${state.max_players}` : ""}`
    : "–";

  function getPlayerSessionStart(entry: PlayerPanelEntry): string | null {
    if (entry.online) return entry.player?.joined_at ?? null;
    return entry.history?.last_session_started_at ?? null;
  }

  function getPlayerSessionEnd(entry: PlayerPanelEntry): string | null {
    if (entry.online) return null;
    return entry.history?.last_session_ended_at ?? null;
  }

  function getPlayerSessionLabel(entry: PlayerPanelEntry): string {
    return formatSessionDuration(getPlayerSessionStart(entry), getPlayerSessionEnd(entry));
  }

  function getPlayerLastConnectLabel(entry: PlayerPanelEntry): string {
    const connectedAt = getPlayerSessionStart(entry);
    return connectedAt ? formatDateTime(connectedAt) : "–";
  }

  function getPlayerLastSeenLabel(entry: PlayerPanelEntry): string {
    if (entry.online) return "Jetzt aktiv";
    return entry.history?.last_seen_at ? formatDateTime(entry.history.last_seen_at) : "–";
  }

  function getPlayerTotalPlaySeconds(entry: PlayerPanelEntry): number {
    const historySeconds = entry.history?.total_play_seconds ?? 0;
    const currentSeconds = entry.online ? sessionSeconds(entry.player?.joined_at ?? null) : 0;
    return historySeconds + currentSeconds;
  }

  function getPlayerDeviceLabel(entry: PlayerPanelEntry): string {
    if (entry.online) {
      return entry.player?.client_name ?? entry.history?.last_client_name ?? "–";
    }
    return entry.history?.last_client_name ?? "–";
  }

  function renderPlayerCard(entry: PlayerPanelEntry, hidden: boolean) {
    const menuOpen = openPlayerMenu === entry.name;
    const totalPlaytime = formatTotalPlaytime(getPlayerTotalPlaySeconds(entry));
    const visibilityLabel = hidden ? "Einblenden" : "Ausblenden";
    const canKick = entry.online;

    return (
      <div key={entry.name} className={`player-card ${entry.online ? "player-online" : "player-offline"} ${hidden ? "player-hidden" : ""}`}>
        <div className="player-card-head">
          <div className="player-card-name-wrap">
            <span className="player-card-name">{entry.name}</span>
            <span className={`badge ${entry.online ? "badge-active" : "badge-muted"}`}>
              {entry.online ? "Online" : "Offline"}
            </span>
          </div>
          <div className="player-card-actions">
            <button
              className="btn btn-small player-menu-toggle"
              onClick={() => setOpenPlayerMenu(menuOpen ? null : entry.name)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="Aktionen"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="player-menu" role="menu">
                {canKick && (
                  <button
                    className="player-menu-item"
                    onClick={() => {
                      setOpenPlayerMenu(null);
                      setPendingAction({ kind: "kick", entry });
                    }}
                  >
                    Kick
                  </button>
                )}
                <button
                  className="player-menu-item"
                  onClick={() => {
                    setOpenPlayerMenu(null);
                    if (hidden) {
                      void setPlayerVisibility(entry, false);
                    } else {
                      setPendingAction({ kind: "hide", entry });
                    }
                  }}
                >
                  {visibilityLabel}
                </button>
                <button
                  className="player-menu-item player-menu-item-danger"
                  onClick={() => {
                    setOpenPlayerMenu(null);
                    setPendingAction({ kind: "reset", entry });
                  }}
                >
                  Daten zurücksetzen
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="player-card-subline">
          <span>{entry.online ? `Online seit ${getPlayerLastConnectLabel(entry)}` : `Zuletzt verbunden ${getPlayerLastConnectLabel(entry)}`}</span>
          <span>{entry.online ? getPlayerSessionLabel(entry) : `Zuletzt aktiv ${getPlayerLastSeenLabel(entry)}`}</span>
        </div>

        <div className="player-card-grid">
          <div className="player-card-stat">
            <span>Session</span>
            <strong>{getPlayerSessionLabel(entry)}</strong>
          </div>
          <div className="player-card-stat">
            <span>Gesamt</span>
            <strong>{totalPlaytime}</strong>
          </div>
          <div className="player-card-stat">
            <span>Letzter Connect</span>
            <strong>{getPlayerLastConnectLabel(entry)}</strong>
          </div>
          <div className="player-card-stat">
            <span>Zuletzt aktiv</span>
            <strong>{getPlayerLastSeenLabel(entry)}</strong>
          </div>
          <div className="player-card-stat">
            <span>Verbindungen</span>
            <strong>{entry.history?.connect_count ?? (entry.online ? 1 : 0)}</strong>
          </div>
          <div className="player-card-stat">
            <span>Gerät</span>
            <strong>{getPlayerDeviceLabel(entry)}</strong>
          </div>
        </div>
      </div>
    );
  }

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
      {pendingAction && (
        <ConfirmDialog
          title={
            pendingAction.kind === "stop" ? "Server stoppen"
            : pendingAction.kind === "kick" ? `Kick für ${pendingAction.entry.name}`
            : pendingAction.kind === "hide" ? `${pendingAction.entry.name} ausblenden`
            : `Daten von ${pendingAction.entry.name} zurücksetzen`
          }
          message={
            pendingAction.kind === "stop"
              ? "Den Server wirklich stoppen?"
              : pendingAction.kind === "kick"
                ? `Spieler ${pendingAction.entry.name} wirklich vom Server entfernen?`
                : pendingAction.kind === "hide"
                  ? `Das Player-Panel für ${pendingAction.entry.name} wird ausgeblendet. Du kannst es später wieder einblenden.`
                  : `Die gespeicherten Player-Daten für ${pendingAction.entry.name} werden gelöscht.`
          }
          confirmLabel={
            pendingAction.kind === "stop" ? "Stoppen"
            : pendingAction.kind === "kick" ? "Kick"
            : pendingAction.kind === "hide" ? "Ausblenden"
            : "Zurücksetzen"
          }
          danger
          onConfirm={() => { void performPendingAction(pendingAction); }}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {/* ── Status-Header ── */}
      <div className="status-card">
        <div className="status-indicator" style={{ background: statusColor }} />
        <div className="status-info">
          <span className="status-label">{statusLabel[displayStatus]}</span>
          {state.version && <span className="status-version">v{state.version}</span>}
          {isRunning && <span className="status-uptime">{uptime}</span>}
        </div>
        <div className="status-actions">
          <button className="btn btn-primary" onClick={handleStartClick} disabled={!canStart || updating}>
            Start
          </button>
          <button className="btn btn-danger" onClick={() => setPendingAction({ kind: "stop" })} disabled={!canStop || updating}>
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

        {/* Player */}
        <div className="dash-panel player-panel">
          <div className="dash-panel-title" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>Player</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                {playerPanelTitleCount}
              </span>
              {hiddenPlayerEntries.length > 0 && (
                <button
                  className="btn btn-small"
                  onClick={() => setShowHiddenPlayers((value) => !value)}
                >
                  {showHiddenPlayers ? "Ausgeblendete verbergen" : `${hiddenPlayerEntries.length} ausgeblendet`}
                </button>
              )}
            </div>
          </div>

          {!historyWorldId ? (
            <p className="empty-hint">Keine Welt aktiv</p>
          ) : playerEntries.length === 0 ? (
            <p className="empty-hint">Noch keine Player-Historie für diese Welt</p>
          ) : (
            <>
              {visiblePlayerEntries.length === 0 && hiddenPlayerEntries.length > 0 && !showHiddenPlayers ? (
                <div className="player-empty-state">
                  <p className="empty-hint">Alle Player ausgeblendet</p>
                  <button className="btn btn-small" onClick={() => setShowHiddenPlayers(true)}>
                    Ausgeblendete anzeigen
                  </button>
                </div>
              ) : (
                <div className="player-card-list">
                  {visiblePlayerEntries.map((entry) => renderPlayerCard(entry, false))}
                </div>
              )}

              {showHiddenPlayers && hiddenPlayerEntries.length > 0 && (
                <div className="player-hidden-section">
                  <div className="player-hidden-header">Ausgeblendete Player</div>
                  <div className="player-card-list">
                    {hiddenPlayerEntries.map((entry) => renderPlayerCard(entry, true))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
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
