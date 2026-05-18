import { invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
  BackupInfo,
  LearnedNoiseEntry,
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
  activateWorld: (serverRoot: string, worldId: string) =>
    invoke<void>("activate_world_cmd", { serverRoot, worldId }),
  archiveWorld: (serverRoot: string, worldId: string) =>
    invoke<void>("archive_world_cmd", { serverRoot, worldId }),
  unarchiveWorld: (serverRoot: string, worldId: string) =>
    invoke<void>("unarchive_world_cmd", { serverRoot, worldId }),
  deleteWorld: (serverRoot: string, worldId: string, archived: boolean) =>
    invoke<void>("delete_world_cmd", { serverRoot, worldId, archived }),
  getWorldJson: (serverRoot: string, worldId: string, archived: boolean) =>
    invoke<string>("get_world_json", { serverRoot, worldId, archived }),
  exportWorldZip: (serverRoot: string, worldId: string, archived: boolean, destPath: string) =>
    invoke<void>("export_world_zip_cmd", { serverRoot, worldId, archived, destPath }),
  importWorldZip: (zipPath: string, serverRoot: string) =>
    invoke<string>("import_world_zip_cmd", { zipPath, serverRoot }),

  // Server process
  getStatus: () => invoke<ServerState>("get_status"),
  startServer: (serverRoot: string, worldId?: string) =>
    invoke<void>("start_server", { serverRoot, worldId: worldId ?? null }),
  stopServer: () => invoke<void>("stop_server"),
  kickPlayer: (name: string) => invoke<void>("kick_player", { name }),
  getWorldsForLaunch: (serverRoot: string, aliases: Record<string, string>) =>
    invoke<WorldLaunchOption[]>("get_worlds_for_launch", { serverRoot, aliases }),

  // Learned noise
  getLearnedNoise: () => invoke<LearnedNoiseEntry[]>("get_learned_noise"),
  deleteLearnedNoiseEntry: (prefix: string) =>
    invoke<void>("delete_learned_noise_entry", { prefix }),
  clearLearnedNoise: () => invoke<void>("clear_learned_noise"),

  // Server update (SteamCMD)
  detectSteamcmdPath: () => invoke<string | null>("detect_steamcmd_path"),
  runServerUpdate: () => invoke<void>("run_server_update"),
};
