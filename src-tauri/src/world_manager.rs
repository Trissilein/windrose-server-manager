use std::path::{Path, PathBuf};
use crate::config_manager;
use crate::types::WorldInfo;

pub fn scan_worlds(server_root: &str, aliases: &std::collections::HashMap<String, String>, active_world_id: &str) -> Result<Vec<WorldInfo>, String> {
    let worlds_path = config_manager::worlds_dir(server_root);
    if !worlds_path.exists() {
        return Ok(vec![]);
    }

    let mut worlds = Vec::new();
    let entries = std::fs::read_dir(&worlds_path)
        .map_err(|e| format!("Kann Worlds-Ordner nicht lesen: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let island_id = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        if island_id.is_empty() || island_id.len() != 32 {
            continue;
        }

        let (world_name, preset_type, creation_time) =
            match config_manager::read_world_description(&path) {
                Ok(desc) => (
                    desc.world_description.world_name.clone(),
                    desc.world_description.world_preset_type.clone(),
                    desc.world_description.creation_time,
                ),
                Err(_) => ("(unbekannt)".to_string(), "?".to_string(), 0.0),
            };

        let folder_size = dir_size(&path).ok();

        worlds.push(WorldInfo {
            alias: aliases.get(&island_id).cloned(),
            is_active: island_id == active_world_id,
            island_id,
            world_name,
            preset_type,
            creation_time,
            folder_size_bytes: folder_size,
        });
    }

    Ok(worlds)
}

pub fn backup_world(server_root: &str, world_id: &str, backup_root: &str, alias: Option<&str>) -> Result<String, String> {
    let source = config_manager::worlds_dir(server_root).join(world_id);
    if !source.exists() {
        return Err(format!("Welt-Ordner existiert nicht: {}", source.display()));
    }

    let label = alias.unwrap_or(world_id);
    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let dest = PathBuf::from(backup_root).join(label).join(&timestamp);

    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("Kann Backup-Ordner nicht erstellen: {e}"))?;

    copy_dir_recursive(&source, &dest)?;

    Ok(dest.display().to_string())
}

pub fn restore_world(backup_path: &str, server_root: &str, world_id: &str) -> Result<(), String> {
    let source = PathBuf::from(backup_path);
    let dest = config_manager::worlds_dir(server_root).join(world_id);

    if dest.exists() {
        std::fs::remove_dir_all(&dest)
            .map_err(|e| format!("Kann bestehenden Welt-Ordner nicht loeschen: {e}"))?;
    }
    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("Kann Ziel-Ordner nicht erstellen: {e}"))?;

    copy_dir_recursive(&source, &dest)
}

pub fn import_world(source_path: &str, server_root: &str) -> Result<String, String> {
    let source = PathBuf::from(source_path);
    validate_world_folder(&source)?;

    let world_desc = config_manager::read_world_description(&source)?;
    let island_id = world_desc.world_description.island_id.clone();

    let dest = config_manager::worlds_dir(server_root).join(&island_id);
    if dest.exists() {
        return Err(format!("Welt mit ID {island_id} existiert bereits. Bitte zuerst loeschen oder umbenennen."));
    }

    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("Kann Ziel-Ordner nicht erstellen: {e}"))?;

    copy_dir_recursive(&source, &dest)?;

    Ok(island_id)
}

fn validate_world_folder(path: &Path) -> Result<(), String> {
    if !path.join("WorldDescription.json").exists() {
        return Err("WorldDescription.json fehlt — kein gueltiger Welt-Ordner".to_string());
    }
    if !path.join("CURRENT").exists() {
        return Err("CURRENT-Datei fehlt — keine gueltige RocksDB-Struktur".to_string());
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    for entry in std::fs::read_dir(src).map_err(|e| format!("Lesefehler: {e}"))?.flatten() {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            std::fs::create_dir_all(&dst_path)
                .map_err(|e| format!("Ordner erstellen fehlgeschlagen: {e}"))?;
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Datei kopieren fehlgeschlagen: {e}"))?;
        }
    }
    Ok(())
}

fn dir_size(path: &Path) -> Result<u64, std::io::Error> {
    let mut total = 0;
    for entry in std::fs::read_dir(path)?.flatten() {
        let p = entry.path();
        if p.is_file() {
            total += entry.metadata()?.len();
        } else if p.is_dir() {
            total += dir_size(&p)?;
        }
    }
    Ok(total)
}
