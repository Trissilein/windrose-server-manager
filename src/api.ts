import { invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
  BackupInfo,
  ServerDescriptionFile,
  ServerState,
  WorldDescriptionFile,
  WorldInfo,
  WorldLaunchOption,
} from "./types";

export const api = {
  // App config
  loadAppConfig: () => invoke<AppConfig>("load_app_config"),
  saveAppConfig: (config: AppConfig) => invoke<void>("save_app_config", { config }),
  detectServerPath: () => invoke<string | null>("detect_server_path"),

  // Server config
  readServerConfig: (serverRoot: string) =>
    invoke<ServerDescriptionFile>("read_server_config", { serverRoot }),
  writeServerConfig: (serverRoot: string, config: ServerDescriptionFile) =>
    invoke<void>("write_server_config", { serverRoot, config }),

  // World config
  readWorldConfig: (worldPath: string) =>
    invoke<WorldDescriptionFile>("read_world_config", { worldPath }),
  writeWorldConfig: (worldPath: string, config: WorldDescriptionFile) =>
    invoke<void>("write_world_config", { worldPath, config }),

  // Worlds
  getWorlds: (serverRoot: string, aliases: Record<string, string>, activeWorldId: string) =>
    invoke<WorldInfo[]>("get_worlds", { serverRoot, aliases, activeWorldId }),
  backupWorld: (serverRoot: string, worldId: string, backupRoot: string, alias?: string) =>
    invoke<string>("backup_world_cmd", { serverRoot, worldId, backupRoot, alias: alias ?? null }),
  restoreWorld: (backupPath: string, serverRoot: string, worldId: string) =>
    invoke<void>("restore_world_cmd", { backupPath, serverRoot, worldId }),
  importWorld: (sourcePath: string, serverRoot: string) =>
    invoke<string>("import_world_cmd", { sourcePath, serverRoot }),
  listBackups: (backupRoot: string, worldIdOrAlias: string) =>
    invoke<BackupInfo[]>("list_backups", { backupRoot, worldIdOrAlias }),

  // Server process
  getStatus: () => invoke<ServerState>("get_status"),
  startServer: (serverRoot: string, worldId?: string) =>
    invoke<void>("start_server", { serverRoot, worldId: worldId ?? null }),
  stopServer: () => invoke<void>("stop_server"),
  kickPlayer: (name: string) => invoke<void>("kick_player", { name }),
  getWorldsForLaunch: (serverRoot: string, aliases: Record<string, string>) =>
    invoke<WorldLaunchOption[]>("get_worlds_for_launch", { serverRoot, aliases }),
};
