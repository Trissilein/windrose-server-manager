use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter};

use crate::log_parser;
use crate::types::{LogCategory, PlayerInfo, ServerStartInfo, ServerState, ServerStatus};

pub struct ServerProcess {
    pub state: Arc<Mutex<ServerState>>,
    child_pid: Arc<Mutex<Option<u32>>>,
    child_stdin: Arc<Mutex<Option<tokio::process::ChildStdin>>>,
}

impl ServerProcess {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(ServerState::default())),
            child_pid: Arc::new(Mutex::new(None)),
            child_stdin: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn get_state(&self) -> ServerState {
        self.state.lock().await.clone()
    }

    pub async fn start(
        &self,
        server_root: &str,
        server_info: Option<ServerStartInfo>,
        app: AppHandle,
    ) -> Result<(), String> {
        {
            let state = self.state.lock().await;
            if state.status != ServerStatus::Stopped {
                return Err("Server läuft bereits".to_string());
            }
        }

        let exe = Path::new(server_root)
            .join("R5")
            .join("Binaries")
            .join("Win64")
            .join("WindroseServer-Win64-Shipping.exe");

        if !exe.exists() {
            return Err(format!("Server-Exe nicht gefunden: {}", exe.display()));
        }

        {
            let mut state = self.state.lock().await;
            state.status = ServerStatus::Starting;
            state.started_at = Some(chrono::Local::now().to_rfc3339());
            if let Some(ref info) = server_info {
                state.server_name = Some(info.server_name.clone());
                state.invite_code = if info.invite_code.is_empty() { None } else { Some(info.invite_code.clone()) };
                state.password = if info.password.is_empty() { None } else { Some(info.password.clone()) };
                state.max_players = Some(info.max_player_count);
                state.world_id = if info.world_id.is_empty() { None } else { Some(info.world_id.clone()) };
            }
        }
        let _ = app.emit("server-status", self.state.lock().await.clone());

        let mut cmd = Command::new(&exe);
        cmd.arg("-log");
        cmd.current_dir(server_root);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        cmd.stdin(Stdio::piped());

        #[cfg(target_os = "windows")]
        {
            #[allow(unused_imports)]
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x00000200 | 0x00008000);
        }

        let mut child = cmd.spawn().map_err(|e| format!("Server konnte nicht gestartet werden: {e}"))?;
        let pid = child.id().unwrap_or(0);

        *self.child_stdin.lock().await = child.stdin.take();
        {
            *self.child_pid.lock().await = Some(pid);
            self.state.lock().await.pid = Some(pid);
        }

        let stdout = child.stdout.take().unwrap();

        // Drain stderr continuously — if nobody reads the pipe the 64 KB buffer fills up
        // and the server blocks on its stderr write, preventing LAN subsystem init.
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(_)) = lines.next_line().await {}
            });
        }

        let state_clone = self.state.clone();
        let pid_clone = self.child_pid.clone();
        let stdin_clone = self.child_stdin.clone();
        let app_clone = app.clone();

        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                let event = log_parser::parse_line(&line);

                {
                    let mut state = state_clone.lock().await;
                    match event.category {
                        LogCategory::ServerReady => {
                            state.status = ServerStatus::Running;
                        }
                        LogCategory::ConnectionInfo => {
                            if let Some(code) = event.summary.strip_prefix("Invite Code: ") {
                                state.invite_code = Some(code.to_string());
                            }
                        }
                        LogCategory::ServerInfo => {
                            if let Some(ver) = event.summary.strip_prefix("Server Version: ") {
                                state.version = Some(ver.trim().to_string());
                            }
                        }
                        LogCategory::Shutdown => {
                            state.status = ServerStatus::Stopping;
                        }
                        LogCategory::PlayerConnect => {
                            let name = event.summary
                                .strip_prefix("Beitritt: ")
                                .unwrap_or(&event.summary)
                                .trim()
                                .to_string();
                            if !name.is_empty() {
                                if !state.players.iter().any(|p| p.name == name) {
                                    state.players.push(PlayerInfo {
                                        name,
                                        joined_at: chrono::Local::now().to_rfc3339(),
                                    });
                                    state.player_count = Some(state.players.len() as u32);
                                }
                            }
                        }
                        LogCategory::PlayerDisconnect => {
                            let name = event.summary
                                .strip_prefix("Verlassen: ")
                                .or_else(|| event.summary.strip_prefix("Verbindung getrennt: "))
                                .unwrap_or(&event.summary)
                                .trim()
                                .to_string();
                            if !name.is_empty() {
                                state.players.retain(|p| p.name != name);
                                state.player_count = Some(state.players.len() as u32);
                            }
                        }
                        _ => {}
                    }
                    let _ = app_clone.emit("server-status", state.clone());
                }
                let _ = app_clone.emit("log-event", &event);
            }

            {
                let mut state = state_clone.lock().await;
                state.status = ServerStatus::Stopped;
                state.pid = None;
                state.invite_code = None;
                state.player_count = None;
                state.players = Vec::new();
                state.cpu_percent = 0.0;
                state.memory_mb = 0;
                state.world_id = None;
                let _ = app_clone.emit("server-status", state.clone());
            }
            *pid_clone.lock().await = None;
            *stdin_clone.lock().await = None;
        });

        // CPU/RAM metrics polling task
        let metrics_state = self.state.clone();
        let metrics_app = app.clone();
        tokio::spawn(async move {
            use sysinfo::{Pid, ProcessesToUpdate, System};
            let mut sys = System::new();
            let sysinfo_pid = Pid::from_u32(pid);

            // Determine logical CPU count for normalization (cpu_usage() reports 0–num_cpus*100)
            let num_cpus = std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(1) as f32;

            // First refresh for CPU baseline, then wait minimum interval
            sys.refresh_processes(ProcessesToUpdate::Some(&[sysinfo_pid]), false);
            tokio::time::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL).await;

            loop {
                {
                    let state = metrics_state.lock().await;
                    match state.status {
                        ServerStatus::Stopped | ServerStatus::Stopping => break,
                        _ => {}
                    }
                }

                sys.refresh_processes(ProcessesToUpdate::Some(&[sysinfo_pid]), false);

                let (cpu_raw, mem_mb) = match sys.process(sysinfo_pid) {
                    Some(process) => (process.cpu_usage(), process.memory() / 1_048_576),
                    None => break,
                };
                // Normalize to 0–100% across all logical cores
                let cpu = (cpu_raw / num_cpus).clamp(0.0, 100.0);

                {
                    let mut state = metrics_state.lock().await;
                    if state.status == ServerStatus::Stopped {
                        break;
                    }
                    state.cpu_percent = cpu;
                    state.memory_mb = mem_mb;
                    let _ = metrics_app.emit("server-status", state.clone());
                }

                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        });

        tokio::spawn(async move {
            let _ = child.wait().await;
        });

        // Fallback: if process is still alive after 90s but status is still "Starting",
        // the ServerReady pattern didn't match — assume running anyway
        let fallback_state = self.state.clone();
        let fallback_app = app.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(90)).await;
            let mut state = fallback_state.lock().await;
            if state.status == ServerStatus::Starting {
                state.status = ServerStatus::Running;
                let _ = fallback_app.emit("server-status", state.clone());
            }
        });

        Ok(())
    }

    pub async fn stop(&self, app: AppHandle) -> Result<(), String> {
        let pid = {
            let stored = self.child_pid.lock().await;
            match *stored {
                Some(p) => p,
                None => return Err("Server läuft nicht".to_string()),
            }
        };

        {
            let mut state = self.state.lock().await;
            state.status = ServerStatus::Stopping;
            let _ = app.emit("server-status", state.clone());
        }

        #[cfg(target_os = "windows")]
        {
            use windows_sys::Win32::System::Console::GenerateConsoleCtrlEvent;
            unsafe {
                GenerateConsoleCtrlEvent(1, pid);
            }
        }

        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if self.child_pid.lock().await.is_none() {
                break;
            }
            if Instant::now() > deadline {
                #[cfg(target_os = "windows")]
                {
                    use windows_sys::Win32::Foundation::CloseHandle;
                    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
                    unsafe {
                        let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
                        if handle != std::ptr::null_mut() {
                            TerminateProcess(handle, 1);
                            CloseHandle(handle);
                        }
                    }
                }
                break;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }

        Ok(())
    }

    pub async fn kick_player(&self, name: &str) -> Result<(), String> {
        let mut stdin_guard = self.child_stdin.lock().await;
        match stdin_guard.as_mut() {
            Some(stdin) => {
                let cmd_str = format!("kick {}\n", name);
                stdin.write_all(cmd_str.as_bytes()).await
                    .map_err(|e| format!("Stdin-Schreiben fehlgeschlagen: {e}"))?;
                stdin.flush().await
                    .map_err(|e| format!("Stdin-Flush fehlgeschlagen: {e}"))?;
                Ok(())
            }
            None => Err("Server läuft nicht oder Stdin nicht verfügbar".to_string()),
        }
    }
}
