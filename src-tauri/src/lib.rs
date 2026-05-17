mod app_config;
mod config_manager;
mod log_parser;
mod server_process;
mod tray;
mod world_manager;

pub mod types;

use std::sync::Arc;
use tokio::sync::Mutex;

use server_process::ServerProcess;
use types::{AppConfig, BackupInfo, ServerStartInfo, WorldInfo, WorldLaunchOption};

// ── App-Config ────────────────────────────────────────────────────────────────

#[tauri::command]
fn load_app_config() -> AppConfig {
    app_config::load()
}

#[tauri::command]
fn save_app_config(config: AppConfig) -> Result<(), String> {
    app_config::save(&config)
}

#[tauri::command]
fn detect_server_path() -> Option<String> {
    app_config::detect_server_path()
}

// ── Server-Config ─────────────────────────────────────────────────────────────

#[tauri::command]
fn read_server_config(server_root: String) -> Result<types::ServerDescriptionFile, String> {
    config_manager::read_server_description(&server_root)
}

#[tauri::command]
fn write_server_config(server_root: String, config: types::ServerDescriptionFile) -> Result<(), String> {
    config_manager::write_server_description(&server_root, &config)
}

// ── World-Config ──────────────────────────────────────────────────────────────

#[tauri::command]
fn read_world_config(world_path: String) -> Result<types::WorldDescriptionFile, String> {
    use std::path::Path;
    config_manager::read_world_description(Path::new(&world_path))
}

#[tauri::command]
fn write_world_config(world_path: String, config: types::WorldDescriptionFile) -> Result<(), String> {
    use std::path::Path;
    config_manager::write_world_description(Path::new(&world_path), &config)
}

// ── World-Manager ─────────────────────────────────────────────────────────────

#[tauri::command]
fn get_worlds(server_root: String, aliases: std::collections::HashMap<String, String>, active_world_id: String) -> Result<Vec<WorldInfo>, String> {
    world_manager::scan_worlds(&server_root, &aliases, &active_world_id)
}

#[tauri::command]
fn backup_world_cmd(server_root: String, world_id: String, backup_root: String, alias: Option<String>) -> Result<String, String> {
    world_manager::backup_world(&server_root, &world_id, &backup_root, alias.as_deref())
}

#[tauri::command]
fn restore_world_cmd(backup_path: String, server_root: String, world_id: String) -> Result<(), String> {
    world_manager::restore_world(&backup_path, &server_root, &world_id)
}

#[tauri::command]
fn import_world_cmd(source_path: String, server_root: String) -> Result<String, String> {
    world_manager::import_world(&source_path, &server_root)
}

#[tauri::command]
fn list_backups(backup_root: String, world_id_or_alias: String) -> Result<Vec<BackupInfo>, String> {
    let base = std::path::PathBuf::from(&backup_root).join(&world_id_or_alias);
    if !base.exists() {
        return Ok(vec![]);
    }
    let mut backups = Vec::new();
    for entry in std::fs::read_dir(&base).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            let size = world_manager_dir_size(&path).ok();
            backups.push(BackupInfo { world_id: world_id_or_alias.clone(), path: path.display().to_string(), timestamp: name, size_bytes: size.unwrap_or(0) });
        }
    }
    backups.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(backups)
}

fn world_manager_dir_size(path: &std::path::Path) -> Result<u64, std::io::Error> {
    let mut total = 0u64;
    for entry in std::fs::read_dir(path)?.flatten() {
        let p = entry.path();
        if p.is_file() {
            total += entry.metadata()?.len();
        } else if p.is_dir() {
            total += world_manager_dir_size(&p)?;
        }
    }
    Ok(total)
}

// ── Server-Process ────────────────────────────────────────────────────────────

#[tauri::command]
async fn get_status(state: tauri::State<'_, Arc<Mutex<ServerProcess>>>) -> Result<types::ServerState, String> {
    Ok(state.lock().await.get_state().await)
}

#[tauri::command]
async fn start_server(
    server_root: String,
    world_id: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<ServerProcess>>>,
) -> Result<(), String> {
    // If a specific world was selected, write it to the server config first
    if let Some(ref wid) = world_id {
        if let Ok(mut cfg) = config_manager::read_server_description(&server_root) {
            cfg.server_description_persistent.world_island_id = wid.clone();
            let _ = config_manager::write_server_description(&server_root, &cfg);
        }
    }

    // Load current server config to populate dashboard info at launch
    let server_info = config_manager::read_server_description(&server_root).ok().map(|cfg| {
        let p = &cfg.server_description_persistent;
        ServerStartInfo {
            server_name: p.server_name.clone(),
            invite_code: p.invite_code.clone(),
            password: p.password.clone(),
            max_player_count: p.max_player_count,
            world_id: p.world_island_id.clone(),
        }
    });

    state.lock().await.start(&server_root, server_info, app).await
}

#[tauri::command]
async fn stop_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<ServerProcess>>>,
) -> Result<(), String> {
    state.lock().await.stop(app).await
}

#[tauri::command]
async fn kick_player(
    name: String,
    state: tauri::State<'_, Arc<Mutex<ServerProcess>>>,
) -> Result<(), String> {
    state.lock().await.kick_player(&name).await
}

// ── World-Management Commands ──────────────────────────────────────────────────

#[tauri::command]
fn activate_world_cmd(server_root: String, world_id: String) -> Result<(), String> {
    world_manager::activate_world(&server_root, &world_id)
}

#[tauri::command]
fn archive_world_cmd(server_root: String, world_id: String) -> Result<(), String> {
    world_manager::archive_world(&server_root, &world_id)
}

#[tauri::command]
fn unarchive_world_cmd(server_root: String, world_id: String) -> Result<(), String> {
    world_manager::unarchive_world(&server_root, &world_id)
}

#[tauri::command]
fn delete_world_cmd(server_root: String, world_id: String, archived: bool) -> Result<(), String> {
    world_manager::delete_world(&server_root, &world_id, archived)
}

#[tauri::command]
fn get_world_json(server_root: String, world_id: String, archived: bool) -> Result<String, String> {
    world_manager::get_world_json(&server_root, &world_id, archived)
}

#[tauri::command]
fn get_worlds_for_launch(
    server_root: String,
    aliases: std::collections::HashMap<String, String>,
) -> Result<Vec<WorldLaunchOption>, String> {
    let worlds = world_manager::scan_worlds(&server_root, &aliases, "")?;
    Ok(worlds.into_iter().filter(|w| !w.is_archived).map(|w| WorldLaunchOption {
        id: w.island_id,
        alias: w.alias,
        world_name: w.world_name,
        creation_time: w.creation_time,
    }).collect())
}

// ── Entry Point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let server_process = Arc::new(Mutex::new(ServerProcess::new()));

    tauri::Builder::default()
        .manage(server_process)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            tray::setup_tray(&app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_app_config,
            save_app_config,
            detect_server_path,
            read_server_config,
            write_server_config,
            read_world_config,
            write_world_config,
            get_worlds,
            backup_world_cmd,
            restore_world_cmd,
            import_world_cmd,
            list_backups,
            activate_world_cmd,
            archive_world_cmd,
            unarchive_world_cmd,
            delete_world_cmd,
            get_world_json,
            get_status,
            start_server,
            stop_server,
            kick_player,
            get_worlds_for_launch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
