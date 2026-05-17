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

/// Liest den Steam-Installationspfad aus der Windows-Registry und
/// gibt den Windrose-Server-Pfad zurück wenn die Exe gefunden wird.
#[cfg(target_os = "windows")]
pub fn detect_server_path() -> Option<String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let steam_key = hklm
        .open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam")
        .ok()?;
    let install_path: String = steam_key.get_value("InstallPath").ok()?;

    let candidate = PathBuf::from(&install_path)
        .join("steamapps")
        .join("common")
        .join("Windrose")
        .join("R5")
        .join("Builds")
        .join("WindowsServer");

    let exe = candidate
        .join("R5")
        .join("Binaries")
        .join("Win64")
        .join("WindroseServer-Win64-Shipping.exe");

    if exe.exists() {
        Some(candidate.display().to_string())
    } else {
        None
    }
}

#[cfg(not(target_os = "windows"))]
pub fn detect_server_path() -> Option<String> {
    None
}
