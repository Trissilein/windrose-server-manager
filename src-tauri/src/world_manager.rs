use std::path::{Path, PathBuf};
use crate::config_manager;
use crate::types::WorldInfo;

// Active worlds: {worlds_dir}/{world_id}/
// Archived worlds: {worlds_dir}/_archived/{world_id}/

pub fn scan_worlds(
    server_root: &str,
    aliases: &std::collections::HashMap<String, String>,
    active_world_id: &str,
) -> Result<Vec<WorldInfo>, String> {
    let worlds_path = config_manager::worlds_dir(server_root);
    if !worlds_path.exists() {
        return Ok(vec![]);
    }

    let mut worlds = Vec::new();

    // Active worlds
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
        let (world_name, preset_type, creation_time) = read_world_meta(&path);
        worlds.push(WorldInfo {
            alias: aliases.get(&island_id).cloned(),
            is_active: island_id == active_world_id,
            is_archived: false,
            island_id,
            world_name,
            preset_type,
            creation_time,
            folder_size_bytes: dir_size(&path).ok(),
        });
    }

    // Archived worlds — optional subfolder, silently skipped if missing
    let archived_path = worlds_path.join("_archived");
    if archived_path.is_dir() {
        if let Ok(archived_entries) = std::fs::read_dir(&archived_path) {
            for entry in archived_entries.flatten() {
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
                let (world_name, preset_type, creation_time) = read_world_meta(&path);
                worlds.push(WorldInfo {
                    alias: aliases.get(&island_id).cloned(),
                    is_active: false,
                    is_archived: true,
                    island_id,
                    world_name,
                    preset_type,
                    creation_time,
                    folder_size_bytes: dir_size(&path).ok(),
                });
            }
        }
    }

    Ok(worlds)
}

fn read_world_meta(path: &Path) -> (String, String, f64) {
    match config_manager::read_world_description(path) {
        Ok(desc) => (
            desc.world_description.world_name.clone(),
            desc.world_description.world_preset_type.clone(),
            desc.world_description.creation_time,
        ),
        Err(_) => ("(unbekannt)".to_string(), "?".to_string(), 0.0),
    }
}

/// Write the WorldIslandId in ServerDescription.json to make a world the active one.
pub fn activate_world(server_root: &str, world_id: &str) -> Result<(), String> {
    let mut desc = config_manager::read_server_description(server_root)?;
    desc.server_description_persistent.world_island_id = world_id.to_string();
    config_manager::write_server_description(server_root, &desc)
}

/// Move a world folder to the _archived/ subdirectory.
pub fn archive_world(server_root: &str, world_id: &str) -> Result<(), String> {
    let worlds = config_manager::worlds_dir(server_root);
    let src = worlds.join(world_id);
    if !src.exists() {
        return Err(format!("Welt-Ordner nicht gefunden: {}", src.display()));
    }
    let archive_dir = worlds.join("_archived");
    std::fs::create_dir_all(&archive_dir)
        .map_err(|e| format!("Kann Archiv-Ordner nicht erstellen: {e}"))?;
    let dst = archive_dir.join(world_id);
    if dst.exists() {
        return Err(format!("Welt {} ist bereits archiviert", world_id));
    }
    std::fs::rename(&src, &dst)
        .map_err(|e| format!("Archivieren fehlgeschlagen: {e}"))?;
    Ok(())
}

/// Move an archived world back to the active worlds directory.
pub fn unarchive_world(server_root: &str, world_id: &str) -> Result<(), String> {
    let worlds = config_manager::worlds_dir(server_root);
    let src = worlds.join("_archived").join(world_id);
    if !src.exists() {
        return Err(format!("Archivierte Welt nicht gefunden: {}", src.display()));
    }
    let dst = worlds.join(world_id);
    if dst.exists() {
        return Err(format!("Welt {} existiert bereits im aktiven Verzeichnis", world_id));
    }
    std::fs::rename(&src, &dst)
        .map_err(|e| format!("Entarchivieren fehlgeschlagen: {e}"))?;
    Ok(())
}

/// Permanently delete a world folder (active or archived).
pub fn delete_world(server_root: &str, world_id: &str, archived: bool) -> Result<(), String> {
    let worlds = config_manager::worlds_dir(server_root);
    let path = if archived {
        worlds.join("_archived").join(world_id)
    } else {
        worlds.join(world_id)
    };
    if !path.exists() {
        return Err(format!("Welt-Ordner nicht gefunden: {}", path.display()));
    }
    std::fs::remove_dir_all(&path)
        .map_err(|e| format!("Löschen fehlgeschlagen: {e}"))?;
    Ok(())
}

/// Read the raw WorldDescription.json content for display.
pub fn get_world_json(server_root: &str, world_id: &str, archived: bool) -> Result<String, String> {
    let worlds = config_manager::worlds_dir(server_root);
    let world_path = if archived {
        worlds.join("_archived").join(world_id)
    } else {
        worlds.join(world_id)
    };
    let json_path = world_path.join("WorldDescription.json");
    std::fs::read_to_string(&json_path)
        .map_err(|e| format!("Kann WorldDescription.json nicht lesen: {e}"))
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
