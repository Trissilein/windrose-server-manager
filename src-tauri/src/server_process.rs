use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter};

use crate::log_parser;
use crate::types::{ServerState, ServerStatus};

pub struct ServerProcess {
    pub state: Arc<Mutex<ServerState>>,
    child_pid: Arc<Mutex<Option<u32>>>,
}

impl ServerProcess {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(ServerState::default())),
            child_pid: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn get_state(&self) -> ServerState {
        self.state.lock().await.clone()
    }

    pub async fn start(&self, server_root: &str, app: AppHandle) -> Result<(), String> {
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
        }
        let _ = app.emit("server-status", self.state.lock().await.clone());

        let mut cmd = Command::new(&exe);
        cmd.arg("-log");
        cmd.current_dir(server_root);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Windows: CREATE_NEW_PROCESS_GROUP + ABOVE_NORMAL_PRIORITY_CLASS
        #[cfg(target_os = "windows")]
        {
            #[allow(unused_imports)]
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x00000200 | 0x00008000);
        }

        let mut child = cmd.spawn().map_err(|e| format!("Server konnte nicht gestartet werden: {e}"))?;
        let pid = child.id().unwrap_or(0);

        {
            let mut stored_pid = self.child_pid.lock().await;
            *stored_pid = Some(pid);
        }
        {
            let mut state = self.state.lock().await;
            state.pid = Some(pid);
        }

        let stdout = child.stdout.take().unwrap();
        let state_clone = self.state.clone();
        let pid_clone = self.child_pid.clone();
        let app_clone = app.clone();

        // Spawn stdout reader task
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                let event = log_parser::parse_line(&line);

                // Update state from key log events
                {
                    let mut state = state_clone.lock().await;
                    match event.category {
                        crate::types::LogCategory::ServerReady => {
                            state.status = ServerStatus::Running;
                        }
                        crate::types::LogCategory::ConnectionInfo => {
                            // Extract invite code from summary like "Invite Code: 890b6ba5"
                            if let Some(code) = event.summary.strip_prefix("Invite Code: ") {
                                state.invite_code = Some(code.to_string());
                            }
                        }
                        crate::types::LogCategory::ServerInfo => {
                            if let Some(ver) = event.summary.strip_prefix("Server Version: ") {
                                state.version = Some(ver.trim().to_string());
                            }
                        }
                        crate::types::LogCategory::Shutdown => {
                            state.status = ServerStatus::Stopping;
                        }
                        _ => {}
                    }
                    let _ = app_clone.emit("server-status", state.clone());
                }

                let _ = app_clone.emit("log-event", &event);
            }

            // Process exited
            let mut state = state_clone.lock().await;
            state.status = ServerStatus::Stopped;
            state.pid = None;
            state.invite_code = None;
            state.player_count = None;
            *pid_clone.lock().await = None;
            let _ = app_clone.emit("server-status", state.clone());
        });

        // Wait for child in separate task
        tokio::spawn(async move {
            let _ = child.wait().await;
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

        // Graceful shutdown via CTRL_BREAK_EVENT
        #[cfg(target_os = "windows")]
        {
            use windows_sys::Win32::System::Console::GenerateConsoleCtrlEvent;
            unsafe {
                GenerateConsoleCtrlEvent(1, pid); // CTRL_BREAK_EVENT = 1
            }
        }

        // Wait up to 30 seconds for graceful exit
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if self.child_pid.lock().await.is_none() {
                break;
            }
            if Instant::now() > deadline {
                // Force kill
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
}
