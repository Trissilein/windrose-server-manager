import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import type { AppConfig, BackupInfo, ServerState, WorldInfo } from "../types";

interface Props {
  config: AppConfig;
  onAliasChange: (worldId: string, alias: string) => void;
}

function formatBytes(b: number | null | undefined): string {
  if (b == null) return "";
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number): string {
  if (!ts) return "–";
  return new Date(ts * 1000).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

export default function WorldManager({ config, onAliasChange }: Props) {
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverRunning, setServerRunning] = useState(false);
  const [editAlias, setEditAlias] = useState<{ id: string; value: string } | null>(null);
  const [backupView, setBackupView] = useState<{ worldId: string; alias: string | null; backups: BackupInfo[] } | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  useEffect(() => {
    load();
    api.getStatus().then((s) => setServerRunning(s.status !== "Stopped")).catch(() => {});
    const unlisten = listen<ServerState>("server-status", (e) => {
      const running = e.payload.status !== "Stopped";
      setServerRunning(running);
      if (!running) load();
    });
    return () => { unlisten.then((f) => f()); };
  }, [config.server_path, config.world_aliases]);

  async function load() {
    if (!config.server_path) return;
    setLoading(true);
    try {
      // Read active world id from server description
      let activeId = "";
      try {
        const sd = await api.readServerConfig(config.server_path);
        activeId = sd.ServerDescription_Persistent.WorldIslandId;
      } catch {}
      const result = await api.getWorlds(config.server_path, config.world_aliases, activeId);
      setWorlds(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function flash(msg: string) {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(null), 3000);
  }

  async function handleBackup(world: WorldInfo) {
    if (!config.backup_path) { setError("Backup-Pfad nicht konfiguriert."); return; }
    try {
      const dest = await api.backupWorld(
        config.server_path,
        world.island_id,
        config.backup_path,
        world.alias ?? undefined
      );
      flash(`Backup erstellt: ${dest}`);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleRestore(backup: BackupInfo) {
    if (serverRunning) { setError("Server muss gestoppt sein zum Restore."); return; }
    if (!confirm(`Welt ${backup.world_id} aus Backup ${backup.timestamp} wiederherstellen?`)) return;
    try {
      await api.restoreWorld(backup.path, config.server_path, backup.world_id);
      flash("Welt wiederhergestellt ✓");
      setBackupView(null);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleImport() {
    const selected = await open({ directory: true, multiple: false, title: "Welt-Ordner auswählen" });
    if (!selected || typeof selected !== "string") return;
    try {
      const id = await api.importWorld(selected, config.server_path);
      flash(`Welt importiert: ${id}`);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleShowBackups(world: WorldInfo) {
    const label = world.alias ?? world.island_id;
    try {
      const backups = await api.listBackups(config.backup_path, label);
      setBackupView({ worldId: world.island_id, alias: world.alias, backups });
    } catch (e) {
      setError(String(e));
    }
  }

  function saveAlias() {
    if (!editAlias) return;
    onAliasChange(editAlias.id, editAlias.value.trim());
    setEditAlias(null);
  }

  if (!config.server_path) {
    return <div className="empty-hint">Server-Pfad nicht konfiguriert.</div>;
  }

  return (
    <div className="world-manager">
      <div className="wm-toolbar">
        <button className="btn btn-primary" onClick={handleImport} disabled={serverRunning}>
          Welt importieren…
        </button>
        <button className="btn btn-small" onClick={load}>Aktualisieren</button>
        {serverRunning && <span className="warning-text">Server läuft — Welt-Operationen gesperrt</span>}
      </div>

      {error && <div className="error-banner" onClick={() => setError(null)}>{error} ✕</div>}
      {actionMsg && <div className="success-banner">{actionMsg}</div>}

      {loading ? (
        <div className="empty-hint">Lade Welten…</div>
      ) : worlds.length === 0 ? (
        <div className="empty-hint">Keine Welten gefunden.</div>
      ) : (
        <table className="worlds-table">
          <thead>
            <tr>
              <th>Alias</th>
              <th>Name</th>
              <th>Preset</th>
              <th>Erstellt</th>
              <th>Größe</th>
              <th>Status</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {worlds.map((w) => (
              <tr key={w.island_id} className={w.is_active ? "row-active" : ""}>
                <td>
                  {editAlias?.id === w.island_id ? (
                    <div className="alias-edit">
                      <input
                        autoFocus
                        value={editAlias.value}
                        onChange={(e) => setEditAlias({ ...editAlias, value: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") saveAlias(); if (e.key === "Escape") setEditAlias(null); }}
                      />
                      <button className="btn btn-small" onClick={saveAlias}>✓</button>
                    </div>
                  ) : (
                    <span
                      className="alias-text"
                      title={w.island_id}
                      onClick={() => setEditAlias({ id: w.island_id, value: w.alias ?? "" })}
                    >
                      {w.alias || <span className="muted">{w.island_id.slice(0, 8)}…</span>}
                      {" "}<span className="edit-hint">✎</span>
                    </span>
                  )}
                </td>
                <td>{w.world_name}</td>
                <td>{w.preset_type}</td>
                <td>{formatDate(w.creation_time)}</td>
                <td>{formatBytes(w.folder_size_bytes)}</td>
                <td>
                  {w.is_active ? <span className="badge badge-active">Aktiv</span> : ""}
                </td>
                <td className="action-cell">
                  <button
                    className="btn btn-small"
                    onClick={() => handleBackup(w)}
                    disabled={serverRunning}
                    title="Backup erstellen"
                  >
                    Backup
                  </button>
                  <button
                    className="btn btn-small"
                    onClick={() => handleShowBackups(w)}
                    title="Backups anzeigen"
                  >
                    Historie
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {backupView && (
        <div className="modal-overlay" onClick={() => setBackupView(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Backups — {backupView.alias ?? backupView.worldId.slice(0, 12)}</h3>
            {backupView.backups.length === 0 ? (
              <p className="empty-hint">Keine Backups vorhanden.</p>
            ) : (
              <ul className="backup-list">
                {backupView.backups.map((b) => (
                  <li key={b.path} className="backup-item">
                    <span className="backup-ts">{b.timestamp}</span>
                    <span className="backup-size">{formatBytes(b.size_bytes)}</span>
                    <button
                      className="btn btn-small btn-danger"
                      disabled={serverRunning}
                      onClick={() => handleRestore(b)}
                    >
                      Wiederherstellen
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button className="btn" onClick={() => setBackupView(null)}>Schließen</button>
          </div>
        </div>
      )}
    </div>
  );
}
