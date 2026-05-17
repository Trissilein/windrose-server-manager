import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import type { AppConfig, ServerDescriptionFile, ServerDescriptionPersistent, ServerState } from "../types";

const REGIONS = ["EU", "NA", "AS", "SA", "OCE"];

interface Props {
  config: AppConfig;
}

export default function ServerConfig({ config }: Props) {
  const [desc, setDesc] = useState<ServerDescriptionFile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [serverRunning, setServerRunning] = useState(false);

  useEffect(() => {
    if (!config.server_path) return;
    api.readServerConfig(config.server_path).then(setDesc).catch((e) => setError(String(e)));
  }, [config.server_path]);

  useEffect(() => {
    api.getStatus().then((s) => setServerRunning(s.status !== "Stopped")).catch(() => {});
    const unlisten = listen<ServerState>("server-status", (e) => {
      setServerRunning(e.payload.status !== "Stopped");
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  function update<K extends keyof ServerDescriptionPersistent>(
    key: K,
    value: ServerDescriptionPersistent[K]
  ) {
    if (!desc) return;
    setDesc({
      ...desc,
      ServerDescription_Persistent: { ...desc.ServerDescription_Persistent, [key]: value },
    });
    setDirty(true);
  }

  async function save() {
    if (!desc || !config.server_path) return;
    setSaving(true);
    setError(null);
    try {
      await api.writeServerConfig(config.server_path, desc);
      setDirty(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function revert() {
    if (!config.server_path) return;
    const fresh = await api.readServerConfig(config.server_path);
    setDesc(fresh);
    setDirty(false);
  }

  if (!config.server_path) {
    return <div className="empty-hint">Server-Pfad nicht konfiguriert. Bitte zuerst in Einstellungen setzen.</div>;
  }

  if (!desc) {
    return <div className="empty-hint">{error ?? "Lade Konfiguration…"}</div>;
  }

  const d = desc.ServerDescription_Persistent;
  const disabled = serverRunning;

  return (
    <div className="config-form">
      {serverRunning && (
        <div className="warning-banner">
          Server läuft — Config ist schreibgeschützt. Server stoppen zum Bearbeiten.
        </div>
      )}

      <div className="form-grid">
        <label className="form-field">
          <span>Server-Name</span>
          <input
            type="text"
            value={d.ServerName}
            disabled={disabled}
            onChange={(e) => update("ServerName", e.target.value)}
          />
        </label>

        <label className="form-field">
          <span>Passwort</span>
          <div className="input-row">
            <input
              type="text"
              value={d.Password}
              disabled={disabled}
              onChange={(e) => update("Password", e.target.value)}
            />
            <button
              className={`btn btn-small ${d.IsPasswordProtected ? "btn-primary" : ""}`}
              disabled={disabled}
              onClick={() => update("IsPasswordProtected", !d.IsPasswordProtected)}
            >
              {d.IsPasswordProtected ? "Aktiv" : "Inaktiv"}
            </button>
          </div>
        </label>

        <label className="form-field">
          <span>Max. Spieler (1–10)</span>
          <div className="slider-row">
            <input
              type="range"
              min={1}
              max={10}
              value={d.MaxPlayerCount}
              disabled={disabled}
              onChange={(e) => update("MaxPlayerCount", Number(e.target.value))}
            />
            <span className="slider-value">{d.MaxPlayerCount}</span>
          </div>
        </label>

        <label className="form-field">
          <span>Region</span>
          <select
            value={d.UserSelectedRegion}
            disabled={disabled}
            onChange={(e) => update("UserSelectedRegion", e.target.value)}
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>

        <label className="form-field form-toggle">
          <span>Direktverbindung (LAN)</span>
          <input
            type="checkbox"
            checked={d.UseDirectConnection}
            disabled={disabled}
            onChange={(e) => update("UseDirectConnection", e.target.checked)}
          />
        </label>

        {d.UseDirectConnection && (
          <>
            <label className="form-field">
              <span>Server-IP (LAN)</span>
              <input
                type="text"
                placeholder="z.B. 192.168.1.100"
                value={d.DirectConnectionServerAddress}
                disabled={disabled}
                onChange={(e) => update("DirectConnectionServerAddress", e.target.value)}
              />
            </label>

            <label className="form-field">
              <span>Server-Port</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={d.DirectConnectionServerPort}
                disabled={disabled}
                onChange={(e) => update("DirectConnectionServerPort", Number(e.target.value))}
              />
            </label>
          </>
        )}

        <label className="form-field form-toggle">
          <span>Auto-Backup bei Absturz</span>
          <input
            type="checkbox"
            checked={d.AutoLoadLatestBackupIfHasBroken}
            disabled={disabled}
            onChange={(e) => update("AutoLoadLatestBackupIfHasBroken", e.target.checked)}
          />
        </label>

        <div className="form-field form-readonly">
          <span>Invite Code</span>
          <span className="readonly-value">{d.InviteCode || "–"}</span>
        </div>

        <div className="form-field form-readonly">
          <span>Aktive Welt-ID</span>
          <span className="readonly-value monospace">{d.WorldIslandId || "–"}</span>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">Gespeichert ✓</div>}

      <div className="form-actions">
        <button
          className="btn btn-primary"
          disabled={!dirty || saving || disabled}
          onClick={save}
        >
          {saving ? "Speichere…" : "Speichern"}
        </button>
        {dirty && (
          <button className="btn" disabled={saving || disabled} onClick={revert}>
            Verwerfen
          </button>
        )}
      </div>
    </div>
  );
}
