use std::path::Path;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

const WINDROSE_APP_ID: &str = "4129620";

/// Häufige SteamCMD-Installationspfade auf Windows
pub fn detect_steamcmd() -> Option<String> {
    let candidates = [
        r"C:\Program Files\SteamCMD\steamcmd.exe",  // winget install Valve.SteamCMD
        r"C:\SteamCMD\steamcmd.exe",
        r"C:\steamcmd\steamcmd.exe",
        r"C:\Program Files (x86)\Steam\steamcmd.exe",
        r"C:\Program Files\Steam\steamcmd.exe",
        r"C:\Games\SteamCMD\steamcmd.exe",
    ];
    for c in &candidates {
        if Path::new(c).exists() {
            return Some(c.to_string());
        }
    }
    None
}

/// Führt `steamcmd +force_install_dir <server_root> +login anonymous +app_update <id> validate +quit` aus
/// und streamt jede Ausgabezeile als "update-log"-Event an die UI.
pub async fn run_update(steamcmd_path: &str, server_root: &str, app: &AppHandle) -> Result<(), String> {
    let emit = |line: &str| {
        let _ = app.emit("update-log", line.to_string());
    };

    // Only check existence for absolute paths — bare "steamcmd" relies on PATH
    let path = Path::new(steamcmd_path);
    if path.is_absolute() && !path.exists() {
        return Err(format!("SteamCMD nicht gefunden: {steamcmd_path}"));
    }

    emit("SteamCMD Update wird gestartet…");

    let mut cmd = Command::new(steamcmd_path);
    cmd.args([
        "+force_install_dir", server_root,
        "+login", "anonymous",
        "+app_update", WINDROSE_APP_ID, "validate",
        "+quit",
    ]);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn()
        .map_err(|e| format!("SteamCMD konnte nicht gestartet werden: {e}"))?;

    let stdout = child.stdout.take().ok_or("stdout nicht verfügbar")?;

    // stderr drainieren damit der Prozess nicht blockiert
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(_)) = lines.next_line().await {}
        });
    }

    let app_clone = app.clone();
    let stdout_task = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_clone.emit("update-log", line);
        }
    });

    let status = child.wait().await
        .map_err(|e| format!("SteamCMD-Fehler beim Warten: {e}"))?;
    let _ = stdout_task.await;

    // Exit code 7 = SteamCMD updated itself and relaunched — the actual app_update
    // ran in the re-launched process. Treat as success.
    let exit_code = status.code();
    if status.success() || exit_code == Some(7) {
        emit("✓ Update abgeschlossen.");
        Ok(())
    } else {
        let msg = format!("SteamCMD beendet mit Exit-Code {:?}", exit_code);
        emit(&msg);
        Err(msg)
    }
}
