import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import type { AppConfig } from "../types";

interface Props {
  config: AppConfig;
  onChange: (config: AppConfig) => void;
}

export default function Settings({ config, onChange }: Props) {
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectingSteam, setDetectingSteam] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickServerPath() {
    const dir = await open({ directory: true, multiple: false, title: "Server-Rootverzeichnis wählen" });
    if (dir && typeof dir === "string") onChange({ ...config, server_path: dir });
  }

  async function pickBackupPath() {
    const dir = await open({ directory: true, multiple: false, title: "Backup-Ordner wählen" });
    if (dir && typeof dir === "string") onChange({ ...config, backup_path: dir });
  }

  async function autoDetect() {
    setDetecting(true);
    setError(null);
    try {
      const detected = await api.detectServerPath();
      if (detected) {
        const backupPath = detected + "\\Backups";
        onChange({ ...config, server_path: detected, backup_path: backupPath });
      } else {
        setError("Steam-Installation nicht gefunden. Bitte Pfad manuell auswählen.");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setDetecting(false);
    }
  }

  async function pickSteamcmdPath() {
    const file = await open({
      multiple: false,
      title: "steamcmd.exe auswählen",
      filters: [{ name: "Executable", extensions: ["exe"] }],
    });
    if (file && typeof file === "string") onChange({ ...config, steamcmd_path: file });
  }

  async function autoDetectSteamcmd() {
    setDetectingSteam(true);
    setError(null);
    try {
      const detected = await api.detectSteamcmdPath();
      if (detected) {
        onChange({ ...config, steamcmd_path: detected });
      } else {
        setError("SteamCMD nicht gefunden. Bitte manuell auswählen (steamcmd.exe).");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setDetectingSteam(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.saveAppConfig(config);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="config-form">
      <h3>Einstellungen</h3>

      <div className="form-grid">
        <label className="form-field">
          <span>Server-Root-Verzeichnis</span>
          <div className="input-row">
            <input
              type="text"
              value={config.server_path}
              readOnly
              placeholder="Noch nicht gesetzt"
            />
            <button className="btn btn-small" onClick={autoDetect} disabled={detecting}>
              {detecting ? "Suche…" : "Auto-Erkennen"}
            </button>
            <button className="btn btn-small" onClick={pickServerPath}>
              Durchsuchen…
            </button>
          </div>
          <small className="form-hint">
            Ordner mit <code>R5\Binaries\Win64\WindroseServer-Win64-Shipping.exe</code>
          </small>
        </label>

        <label className="form-field">
          <span>Backup-Verzeichnis</span>
          <div className="input-row">
            <input
              type="text"
              value={config.backup_path}
              readOnly
              placeholder="Noch nicht gesetzt"
            />
            <button className="btn btn-small" onClick={pickBackupPath}>
              Durchsuchen…
            </button>
          </div>
          <small className="form-hint">
            Tool-eigene Backups (getrennt von den Server-Auto-Backups in RocksDB_v2_Backups)
          </small>
        </label>
        <label className="form-field">
          <span>SteamCMD-Pfad</span>
          <div className="input-row">
            <input
              type="text"
              value={config.steamcmd_path ?? ""}
              readOnly
              placeholder="Noch nicht gesetzt"
            />
            <button className="btn btn-small" onClick={autoDetectSteamcmd} disabled={detectingSteam}>
              {detectingSteam ? "Suche…" : "Auto-Erkennen"}
            </button>
            <button className="btn btn-small" onClick={pickSteamcmdPath}>
              Durchsuchen…
            </button>
          </div>
          <small className="form-hint">
            Optional — wenn SteamCMD im PATH ist (z.B. via <code>winget install Valve.SteamCMD</code>), kann dieses Feld leer bleiben.
          </small>
        </label>

        <label className="form-field form-toggle">
          <span>Vor jedem Start automatisch aktualisieren</span>
          <input
            type="checkbox"
            checked={config.auto_update_on_start}
            onChange={(e) => onChange({ ...config, auto_update_on_start: e.target.checked })}
          />
        </label>

        <label className="form-field form-toggle">
          <span>Bei Version-Mismatch automatisch aktualisieren (nur wenn 0 Spieler)</span>
          <input
            type="checkbox"
            checked={config.auto_update_on_demand}
            onChange={(e) => onChange({ ...config, auto_update_on_demand: e.target.checked })}
          />
        </label>
      </div>

      {error && <div className="error-banner" onClick={() => setError(null)}>{error} ✕</div>}
      {success && <div className="success-banner">Gespeichert ✓</div>}

      <div className="form-actions">
        <button className="btn btn-primary" disabled={saving} onClick={save}>
          {saving ? "Speichere…" : "Speichern"}
        </button>
      </div>
    </div>
  );
}
