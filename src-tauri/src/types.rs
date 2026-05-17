use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// === ServerDescription.json ===

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct ServerDescriptionFile {
    pub version: u32,
    pub deployment_id: String,
    #[serde(rename = "ServerDescription_Persistent")]
    pub server_description_persistent: ServerDescriptionPersistent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct ServerDescriptionPersistent {
    pub persistent_server_id: String,
    pub invite_code: String,
    pub is_password_protected: bool,
    pub password: String,
    pub server_name: String,
    pub world_island_id: String,
    pub max_player_count: u32,
    pub user_selected_region: String,
    #[serde(rename = "P2pProxyAddress")]
    pub p2p_proxy_address: String,
    pub use_direct_connection: bool,
    pub direct_connection_server_address: String,
    pub direct_connection_server_port: i32,
    pub direct_connection_proxy_address: String,
    pub auto_load_latest_backup_if_has_broken: bool,
}

// === WorldDescription.json ===

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct WorldDescriptionFile {
    pub version: u32,
    pub world_description: WorldDescription,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct WorldDescription {
    #[serde(rename = "islandId")]
    pub island_id: String,
    pub world_name: String,
    pub creation_time: f64,
    pub world_preset_type: String,
    pub world_settings: WorldSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct WorldSettings {
    pub bool_parameters: HashMap<String, bool>,
    pub float_parameters: HashMap<String, f64>,
    pub tag_parameters: HashMap<String, TagValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct TagValue {
    pub tag_name: String,
}

// === App Config (tool-eigene Konfiguration) ===

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub server_path: String,
    pub backup_path: String,
    pub world_aliases: HashMap<String, String>,
    #[serde(default)]
    pub window: WindowConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowConfig {
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

impl Default for WindowConfig {
    fn default() -> Self {
        Self {
            x: None,
            y: None,
            width: Some(1200),
            height: Some(800),
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server_path: String::new(),
            backup_path: String::new(),
            world_aliases: HashMap::new(),
            window: WindowConfig::default(),
        }
    }
}

// === Server Status ===

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub enum ServerStatus {
    Stopped,
    Starting,
    Running,
    Stopping,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerInfo {
    pub name: String,
    pub joined_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldLaunchOption {
    pub id: String,
    pub alias: Option<String>,
    pub world_name: String,
    pub creation_time: f64,
}

// Passed from lib.rs to server_process::start() — config snapshot at launch time
#[derive(Debug, Clone)]
pub struct ServerStartInfo {
    pub server_name: String,
    pub invite_code: String,
    pub password: String,
    pub max_player_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerState {
    pub status: ServerStatus,
    pub pid: Option<u32>,
    pub started_at: Option<String>,
    pub invite_code: Option<String>,
    pub version: Option<String>,
    pub player_count: Option<u32>,
    pub max_players: Option<u32>,
    pub players: Vec<PlayerInfo>,
    pub cpu_percent: f32,
    pub memory_mb: u64,
    pub server_name: Option<String>,
    pub password: Option<String>,
}

impl Default for ServerState {
    fn default() -> Self {
        Self {
            status: ServerStatus::Stopped,
            pid: None,
            started_at: None,
            invite_code: None,
            version: None,
            player_count: None,
            max_players: None,
            players: Vec::new(),
            cpu_percent: 0.0,
            memory_mb: 0,
            server_name: None,
            password: None,
        }
    }
}

// === Log Events ===

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub enum LogCategory {
    BootNoise,
    ServerInfo,
    WorldLoad,
    ServerReady,
    RegionPing,
    BackupStart,
    BackupDone,
    ConnectionInfo,
    MapLoad,
    Auth,
    Registration,
    Shutdown,
    PlayerConnect,
    PlayerDisconnect,
    Error,
    Warning,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub enum LogLevel {
    Info,
    Warning,
    Error,
    Verbose,
    Debug,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEvent {
    pub timestamp: Option<String>,
    pub frame: Option<u32>,
    pub category: LogCategory,
    pub level: LogLevel,
    pub summary: String,
    pub raw_line: String,
}

// === World Info (für die UI) ===

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldInfo {
    pub island_id: String,
    pub alias: Option<String>,
    pub world_name: String,
    pub preset_type: String,
    pub creation_time: f64,
    pub is_active: bool,
    pub folder_size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupInfo {
    pub world_id: String,
    pub timestamp: String,
    pub path: String,
    pub size_bytes: u64,
}
