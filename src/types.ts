// TypeScript-Spiegel der Rust-Typen aus src-tauri/src/types.rs
// Serde-Attribute bestimmen die JSON-Feldnamen (PascalCase wo nicht anders angegeben)

export type ServerStatus = "Stopped" | "Starting" | "Running" | "Stopping";

export interface PlayerInfo {
  name: string;
  joined_at: string;
  client_name: string | null;
  client_login_name: string | null;
}

export interface PlayerHistoryEntry {
  name: string;
  first_seen_at: string;
  last_seen_at: string;
  last_session_started_at: string;
  last_session_ended_at: string | null;
  total_play_seconds: number;
  connect_count: number;
  last_client_name: string | null;
}

export interface WorldLaunchOption {
  id: string;
  alias: string | null;
  world_name: string;
  creation_time: number;
}

export interface ServerState {
  status: ServerStatus;
  pid: number | null;
  started_at: string | null;
  invite_code: string | null;
  version: string | null;
  player_count: number | null;
  max_players: number | null;
  players: PlayerInfo[];
  cpu_percent: number;
  memory_mb: number;
  server_name: string | null;
  password: string | null;
  world_id: string | null;
}

export type LogCategory =
  | "BootNoise"
  | "ServerInfo"
  | "WorldLoad"
  | "ServerReady"
  | "RegionPing"
  | "BackupStart"
  | "BackupDone"
  | "ConnectionInfo"
  | "MapLoad"
  | "Auth"
  | "Registration"
  | "Shutdown"
  | "PlayerConnect"
  | "PlayerDisconnect"
  | "Error"
  | "Warning"
  | "Performance"
  | "VersionMismatch"
  | "Unknown";

export type LogLevel = "Info" | "Warning" | "Error" | "Verbose" | "Debug";

export interface LogEvent {
  raw_line: string;
  timestamp: string | null;
  frame: number | null;
  category: LogCategory;
  level: LogLevel;
  summary: string;
}

export interface WorldInfo {
  island_id: string;
  alias: string | null;
  world_name: string;
  preset_type: string;
  creation_time: number;
  is_active: boolean;
  is_archived: boolean;
  folder_size_bytes: number | null;
}

export interface BackupInfo {
  world_id: string;
  timestamp: string;
  path: string;
  size_bytes: number;
}

// ServerDescription.json — Rust serialisiert mit rename_all="PascalCase"
export interface ServerDescriptionFile {
  Version: number;
  DeploymentId: string;
  ServerDescription_Persistent: ServerDescriptionPersistent;
}

export interface ServerDescriptionPersistent {
  PersistentServerId: string;
  InviteCode: string;
  IsPasswordProtected: boolean;
  Password: string;
  ServerName: string;
  WorldIslandId: string;
  MaxPlayerCount: number;
  UserSelectedRegion: string;
  P2pProxyAddress: string;
  UseDirectConnection: boolean;
  DirectConnectionServerAddress: string;
  DirectConnectionServerPort: number;
  DirectConnectionProxyAddress: string;
  AutoLoadLatestBackupIfHasBroken: boolean;
}

// WorldDescription.json
export interface WorldDescriptionFile {
  Version: number;
  WorldDescription: WorldDescription;
}

export interface WorldDescription {
  islandId: string;
  WorldName: string;
  CreationTime: number;
  WorldPresetType: string;
  WorldSettings: WorldSettings;
}

export interface WorldSettings {
  BoolParameters: Record<string, boolean>;
  FloatParameters: Record<string, number>;
  TagParameters: Record<string, { TagName: string }>;
}

export interface LearnedNoiseEntry {
  prefix: string;
  session_count: number;
  max_occurrences: number;
  last_seen: string;
}

// Tool-eigene App-Konfiguration
export interface AppConfig {
  server_path: string;
  backup_path: string;
  world_aliases: Record<string, string>;
  player_history: Record<string, Record<string, PlayerHistoryEntry>>;
  window: WindowConfig;
  learned_noise: LearnedNoiseEntry[];
  steamcmd_path: string | null;
  auto_update_on_start: boolean;
  auto_update_on_demand: boolean;
}

export interface WindowConfig {
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
}
