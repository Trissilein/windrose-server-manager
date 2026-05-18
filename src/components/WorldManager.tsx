import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
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

function worldLabel(w: WorldInfo | { alias: string | null; island_id: string }, maxLen = 12): string {
  return w.alias ?? w.island_id.slice(0, maxLen) + "…";
}

function formatDate(ts: number): string {
  if (!ts) return "–";
  return new Date(ts * 1000).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

// ── JSON-Viewer Modal ────────────────────────────────────────────────────────

function JsonViewerModal({
  world,
  json,
  onClose,
}: { world: WorldInfo; json: string; onClose: () => void }) {
  let formatted = json;
  try { formatted = JSON.stringify(JSON.parse(json), null, 2); } catch {}

  const displayName = worldLabel(world);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ minWidth: 560, maxWidth: 720 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>WorldDescription.json — {displayName}</h3>
          <button className="btn btn-small" onClick={onClose}>✕</button>
        </div>
        <pre style={{
          background: "#0a0c12",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 14,
          fontSize: 11,
          fontFamily: "var(--mono)",
          overflowY: "auto",
          maxHeight: "60vh",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          color: "var(--text)",
          margin: 0,
        }}>
          {formatted}
        </pre>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function WorldManager({ config, onAliasChange }: Props) {
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverRunning, setServerRunning] = useState(false);
  const [editAlias, setEditAlias] = useState<{ id: string; value: string } | null>(null);
  const [backupView, setBackupView] = useState<{ worldId: string; alias: string | null; backups: BackupInfo[] } | null>(null);
  const [jsonView, setJsonView] = useState<{ world: WorldInfo; json: string } | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [archivedExpanded, setArchivedExpanded] = useState(false);

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

  async function handleActivate(world: WorldInfo) {
    if (serverRunning) { setError("Server muss gestoppt sein zum Aktivieren."); return; }
    try {
      await api.activateWorld(config.server_path, world.island_id);
      flash(`Welt aktiviert: ${worldLabel(world)}`);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleArchive(world: WorldInfo) {
    if (serverRunning) { setError("Server muss gestoppt sein zum Archivieren."); return; }
    if (world.is_active) { setError("Die aktive Welt kann nicht archiviert werden."); return; }
    if (!confirm(`Welt "${worldLabel(world)}" archivieren? Sie kann später wieder aktiviert werden.`)) return;
    try {
      await api.archiveWorld(config.server_path, world.island_id);
      flash("Welt archiviert");
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleUnarchive(world: WorldInfo) {
    try {
      await api.unarchiveWorld(config.server_path, world.island_id);
      flash(`Welt wiederhergestellt: ${worldLabel(world)}`);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete(world: WorldInfo) {
    if (serverRunning && !world.is_archived) { setError("Server muss gestoppt sein zum Löschen."); return; }
    if (world.is_active) { setError("Die aktive Welt kann nicht gelöscht werden."); return; }
    const label = worldLabel(world);
    if (!confirm(`Welt "${label}" endgültig löschen? Diese Aktion kann nicht rückgängig gemacht werden!`)) return;
    try {
      await api.deleteWorld(config.server_path, world.island_id, world.is_archived);
      flash(`Welt gelöscht: ${label}`);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleViewJson(world: WorldInfo) {
    try {
      const json = await api.getWorldJson(config.server_path, world.island_id, world.is_archived);
      setJsonView({ world, json });
    } catch (e) {
      setError(String(e));
    }
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
    const selected = await open({
      multiple: false,
      title: "Welt-ZIP auswählen",
      filters: [{ name: "Windrose Welt-Export", extensions: ["zip"] }],
    });
    if (!selected || typeof selected !== "string") return;
    try {
      const id = await api.importWorldZip(selected, config.server_path);
      flash(`Welt importiert: ${id}`);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleExport(world: WorldInfo) {
    const defaultName = `${worldLabel(world)}_${new Date().toLocaleDateString("sv-SE")}.zip`;
    const dest = await save({
      title: "Welt exportieren",
      defaultPath: defaultName,
      filters: [{ name: "ZIP-Archiv", extensions: ["zip"] }],
    });
    if (!dest) return;
    try {
      await api.exportWorldZip(config.server_path, world.island_id, world.is_archived, dest);
      flash(`Exportiert: ${dest}`);
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

  const activeWorlds = worlds.filter((w) => !w.is_archived);
  const archivedWorlds = worlds.filter((w) => w.is_archived);

  return (
    <div className="world-manager">
      <div className="wm-toolbar">
        <button className="btn btn-primary" onClick={handleImport} disabled={serverRunning}>
          Welt importieren (ZIP)…
        </button>
        <button className="btn btn-small" onClick={load}>Aktualisieren</button>
        {serverRunning && <span className="warning-text">Server läuft — manche Operationen gesperrt</span>}
      </div>

      {error && <div className="error-banner" onClick={() => setError(null)}>{error} ✕</div>}
      {actionMsg && <div className="success-banner">{actionMsg}</div>}

      {loading ? (
        <div className="empty-hint">Lade Welten…</div>
      ) : activeWorlds.length === 0 ? (
        <div className="empty-hint">Keine Welten gefunden.</div>
      ) : (
        <table className="worlds-table">
          <thead>
            <tr>
              <th>Alias / ID</th>
              <th>Name</th>
              <th>Preset</th>
              <th>Erstellt</th>
              <th>Größe</th>
              <th>Status</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {activeWorlds.map((w) => (
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
                  {w.is_active && <span className="badge badge-active">Aktiv</span>}
                </td>
                <td className="action-cell">
                  <button
                    className="btn btn-small btn-primary"
                    onClick={() => handleActivate(w)}
                    disabled={serverRunning || w.is_active}
                    title={w.is_active ? "Bereits aktiv" : "Als aktive Welt setzen"}
                  >
                    Aktivieren
                  </button>
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
                    title="Backup-Historie"
                  >
                    Historie
                  </button>
                  <button
                    className="btn btn-small"
                    onClick={() => handleViewJson(w)}
                    title="WorldDescription.json anzeigen"
                  >
                    JSON
                  </button>
                  <button
                    className="btn btn-small"
                    onClick={() => handleExport(w)}
                    title="Welt als ZIP exportieren"
                  >
                    Exportieren
                  </button>
                  <button
                    className="btn btn-small"
                    onClick={() => handleArchive(w)}
                    disabled={serverRunning || w.is_active}
                    title={w.is_active ? "Aktive Welt kann nicht archiviert werden" : "Archivieren"}
                  >
                    Archivieren
                  </button>
                  <button
                    className="btn btn-small btn-danger-soft"
                    onClick={() => handleDelete(w)}
                    disabled={serverRunning || w.is_active}
                    title={w.is_active ? "Aktive Welt kann nicht gelöscht werden" : "Endgültig löschen"}
                  >
                    Löschen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── Archived worlds section ── */}
      {archivedWorlds.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <button
            className="btn btn-small"
            onClick={() => setArchivedExpanded((v) => !v)}
            style={{ marginBottom: 10, fontSize: 12, color: "var(--muted)" }}
          >
            {archivedExpanded ? "▾" : "▸"} Archivierte Welten ({archivedWorlds.length})
          </button>
          {archivedExpanded && (
            <table className="worlds-table" style={{ opacity: 0.85 }}>
              <thead>
                <tr>
                  <th>Alias / ID</th>
                  <th>Name</th>
                  <th>Erstellt</th>
                  <th>Größe</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {archivedWorlds.map((w) => (
                  <tr key={w.island_id}>
                    <td>
                      <span className="muted" title={w.island_id}>
                        {worldLabel(w, 8)}
                      </span>
                    </td>
                    <td>{w.world_name}</td>
                    <td>{formatDate(w.creation_time)}</td>
                    <td>{formatBytes(w.folder_size_bytes)}</td>
                    <td className="action-cell">
                      <button
                        className="btn btn-small btn-primary"
                        onClick={() => handleUnarchive(w)}
                        title="Zurück in aktive Welten"
                      >
                        Entarchivieren
                      </button>
                      <button
                        className="btn btn-small"
                        onClick={() => handleViewJson(w)}
                        title="WorldDescription.json anzeigen"
                      >
                        JSON
                      </button>
                      <button
                        className="btn btn-small"
                        onClick={() => handleExport(w)}
                        title="Welt als ZIP exportieren"
                      >
                        Exportieren
                      </button>
                      <button
                        className="btn btn-small btn-danger-soft"
                        onClick={() => handleDelete(w)}
                        title="Endgültig löschen"
                      >
                        Löschen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Backup-Historie Modal ── */}
      {backupView && (
        <div className="modal-overlay" onClick={() => setBackupView(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Backups — {worldLabel({ alias: backupView.alias, island_id: backupView.worldId })}</h3>
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
            <button className="btn" style={{ marginTop: 12 }} onClick={() => setBackupView(null)}>Schließen</button>
          </div>
        </div>
      )}

      {/* ── JSON-Viewer Modal ── */}
      {jsonView && (
        <JsonViewerModal
          world={jsonView.world}
          json={jsonView.json}
          onClose={() => setJsonView(null)}
        />
      )}
    </div>
  );
}
