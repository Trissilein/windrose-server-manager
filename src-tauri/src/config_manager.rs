use std::path::{Path, PathBuf};
use crate::types::{ServerDescriptionFile, WorldDescriptionFile};

pub fn server_description_path(server_root: &str) -> PathBuf {
    Path::new(server_root).join("R5").join("ServerDescription.json")
}

pub fn worlds_dir(server_root: &str) -> PathBuf {
    Path::new(server_root)
        .join("R5")
        .join("Saved")
        .join("SaveProfiles")
        .join("Default")
        .join("RocksDB_v2")
        .join("0.10.0")
        .join("Worlds")
}

pub fn read_server_description(server_root: &str) -> Result<ServerDescriptionFile, String> {
    let path = server_description_path(server_root);
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Kann ServerDescription.json nicht lesen: {e}"))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("JSON-Fehler in ServerDescription.json: {e}"))
}

pub fn write_server_description(server_root: &str, desc: &ServerDescriptionFile) -> Result<(), String> {
    let path = server_description_path(server_root);
    let backup_path = path.with_extension("json.bak");
    if path.exists() {
        std::fs::copy(&path, &backup_path)
            .map_err(|e| format!("Backup von ServerDescription.json fehlgeschlagen: {e}"))?;
    }
    let content = serde_json::to_string_pretty(desc)
        .map_err(|e| format!("JSON-Serialisierung fehlgeschlagen: {e}"))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Kann ServerDescription.json nicht schreiben: {e}"))
}

pub fn read_world_description(world_path: &Path) -> Result<WorldDescriptionFile, String> {
    let path = world_path.join("WorldDescription.json");
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Kann WorldDescription.json nicht lesen: {e}"))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("JSON-Fehler in WorldDescription.json: {e}"))
}

pub fn write_world_description(world_path: &Path, desc: &WorldDescriptionFile) -> Result<(), String> {
    let path = world_path.join("WorldDescription.json");
    let backup_path = path.with_extension("json.bak");
    if path.exists() {
        std::fs::copy(&path, &backup_path)
            .map_err(|e| format!("Backup von WorldDescription.json fehlgeschlagen: {e}"))?;
    }
    let content = serde_json::to_string_pretty(desc)
        .map_err(|e| format!("JSON-Serialisierung fehlgeschlagen: {e}"))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Kann WorldDescription.json nicht schreiben: {e}"))
}
