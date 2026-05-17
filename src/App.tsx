import { useEffect, useState } from "react";
import { api } from "./api";
import type { AppConfig } from "./types";
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
};

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    api.loadAppConfig().then(setConfig).catch(console.error);
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
        {tab === "dashboard" && <Dashboard config={config} onNavigate={(t) => setTab(t as Tab)} />}
        {tab === "log" && <LogViewer />}
        {tab === "server-config" && <ServerConfig config={config} />}
        {tab === "worlds" && (
          <WorldManager config={config} onAliasChange={handleAliasChange} />
        )}
        {tab === "settings" && (
          <Settings config={config} onChange={handleConfigChange} />
        )}
      </main>
    </div>
  );
}
