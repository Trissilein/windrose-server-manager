import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import type { AppConfig, LogEvent } from "./types";
import Dashboard from "./components/Dashboard";
import LogViewer from "./components/LogViewer";
import ServerConfig from "./components/ServerConfig";
import WorldManager from "./components/WorldManager";
import Settings from "./components/Settings";
import "./App.css";

type Tab = "dashboard" | "log" | "server-config" | "worlds" | "settings";

const TAB_LABELS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "log", label: "Logs" },
  { id: "server-config", label: "Server-Config" },
  { id: "worlds", label: "Welten" },
  { id: "settings", label: "Einstellungen" },
];

const DEFAULT_CONFIG: AppConfig = {
  server_path: "",
  backup_path: "",
  world_aliases: {},
  window: { x: null, y: null, width: 1200, height: 800 },
  learned_noise: [],
  steamcmd_path: null,
  auto_update_on_start: false,
  auto_update_on_demand: false,
};

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [logEvents, setLogEvents] = useState<LogEvent[]>([]);

  useEffect(() => {
    api.loadAppConfig().then(setConfig).catch(console.error);
  }, []);

  // Global log-event buffer — persists across tab switches (max 500 entries)
  useEffect(() => {
    const unlisten = listen<LogEvent>("log-event", (e) => {
      setLogEvents((prev) => [...prev, e.payload].slice(-500));
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  function handleConfigChange(next: AppConfig) {
    setConfig(next);
  }

  function handleAliasChange(worldId: string, alias: string) {
    const next: AppConfig = {
      ...config,
      world_aliases: { ...config.world_aliases, [worldId]: alias },
    };
    if (!alias) delete next.world_aliases[worldId];
    setConfig(next);
    api.saveAppConfig(next).catch(console.error);
  }

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div className="app-title">
          <span className="app-title-text">Windrose</span>
          <span className="app-title-sub">Server Manager</span>
        </div>
        <ul className="nav-list">
          {TAB_LABELS.map(({ id, label }) => (
            <li key={id}>
              <button
                className={`nav-item ${tab === id ? "nav-active" : ""}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main className="main-content">
        {/* All tabs stay mounted — CSS visibility preserves state across tab switches */}
        <div style={{ display: tab === "dashboard" ? "block" : "none", height: "100%" }}>
          <Dashboard config={config} onNavigate={(t) => setTab(t as Tab)} />
        </div>
        <div style={{ display: tab === "log" ? "block" : "none", height: "100%" }}>
          <LogViewer events={logEvents} />
        </div>
        <div style={{ display: tab === "server-config" ? "block" : "none", height: "100%" }}>
          <ServerConfig config={config} />
        </div>
        <div style={{ display: tab === "worlds" ? "block" : "none", height: "100%" }}>
          <WorldManager config={config} onAliasChange={handleAliasChange} />
        </div>
        <div style={{ display: tab === "settings" ? "block" : "none", height: "100%" }}>
          <Settings config={config} onChange={handleConfigChange} />
        </div>
      </main>
    </div>
  );
}
