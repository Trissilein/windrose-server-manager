use std::path::PathBuf;
use crate::types::AppConfig;

fn config_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("WindroseServerManager").join("config.json")
}

pub fn load() -> AppConfig {
    let path = config_path();
    if !path.exists() {
        return AppConfig::default();
    }
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => AppConfig::default(),
    }
}

pub fn save(config: &AppConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Kann Config-Ordner nicht erstellen: {e}"))?;
    }
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("JSON-Serialisierung fehlgeschlagen: {e}"))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Kann Config nicht schreiben: {e}"))
}
