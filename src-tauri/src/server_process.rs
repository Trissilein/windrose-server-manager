use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::types::{
    LearnedNoiseEntry, LogCategory, PlayerHistoryEntry, PlayerInfo, ServerStartInfo, ServerState,
    ServerStatus,
};
use crate::{app_config, log_parser, noise_learner};

#[derive(Debug, Clone)]
struct JoinRequestHint {
    raw_name: String,
    client_name: String,
    seen_at: Instant,
}

#[derive(Debug, Clone)]
struct LaunchContext {
    server_root: String,
    server_info: Option<ServerStartInfo>,
    learned_noise: Vec<LearnedNoiseEntry>,
}

const HEALTH_CHECK_INTERVAL_SECS: u64 = 30;
const HEALTH_SIGNAL_STALE_AFTER_SECS: u64 = 45;
const HEALTH_MISS_THRESHOLD: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub enum RecoveryMode {
    Healthy,
    Retrying,
    BlockedByPlayers,
    Restarting,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoveryStatus {
    pub mode: RecoveryMode,
    pub consecutive_misses: u32,
    pub threshold: u32,
    pub last_health_signal_at: Option<String>,
    pub last_check_at: Option<String>,
    pub last_reason: Option<String>,
    pub players_online: u32,
}

#[derive(Debug, Clone)]
struct RecoveryTracker {
    consecutive_misses: u32,
    last_health_signal_at: Option<Instant>,
    last_health_signal_label: Option<String>,
    last_check_at: Option<String>,
    last_reason: Option<String>,
}

impl RecoveryTracker {
    fn new() -> Self {
        Self {
            consecutive_misses: 0,
            last_health_signal_at: None,
            last_health_signal_label: None,
            last_check_at: None,
            last_reason: None,
        }
    }

    fn note_signal(&mut self, reason: &str) {
        self.consecutive_misses = 0;
        self.last_health_signal_at = Some(Instant::now());
        self.last_health_signal_label = Some(chrono::Local::now().to_rfc3339());
        self.last_check_at = Some(chrono::Local::now().to_rfc3339());
        self.last_reason = Some(reason.to_string());
    }

    fn note_bootstrap(&mut self) {
        self.note_signal("bootstrap");
    }

    fn note_miss(&mut self, reason: &str) {
        self.consecutive_misses = self
            .consecutive_misses
            .saturating_add(1)
            .min(HEALTH_MISS_THRESHOLD);
        self.last_check_at = Some(chrono::Local::now().to_rfc3339());
        self.last_reason = Some(reason.to_string());
    }

    fn is_signal_fresh(&self) -> bool {
        self.last_health_signal_at
            .map(|instant| instant.elapsed() <= Duration::from_secs(HEALTH_SIGNAL_STALE_AFTER_SECS))
            .unwrap_or(false)
    }

    fn snapshot(&self, players_online: u32, mode: RecoveryMode) -> RecoveryStatus {
        RecoveryStatus {
            mode,
            consecutive_misses: self.consecutive_misses,
            threshold: HEALTH_MISS_THRESHOLD,
            last_health_signal_at: self.last_health_signal_label.clone(),
            last_check_at: self.last_check_at.clone(),
            last_reason: self.last_reason.clone(),
            players_online,
        }
    }
}

fn session_seconds(started_at: &str, ended_at: &str) -> u64 {
    let started = chrono::DateTime::parse_from_rfc3339(started_at);
    let ended = chrono::DateTime::parse_from_rfc3339(ended_at);
    match (started, ended) {
        (Ok(started), Ok(ended)) => {
            ended.signed_duration_since(started).num_seconds().max(0) as u64
        }
        _ => 0,
    }
}

fn record_player_connect(
    world_id: &str,
    name: &str,
    connected_at: &str,
    client_name: Option<&str>,
) {
    if world_id.trim().is_empty() || name.trim().is_empty() {
        return;
    }

    let mut cfg = app_config::load();
    let world_history = cfg.player_history.entry(world_id.to_string()).or_default();
    let entry = world_history
        .entry(name.to_string())
        .or_insert_with(|| PlayerHistoryEntry {
            name: name.to_string(),
            first_seen_at: connected_at.to_string(),
            last_seen_at: connected_at.to_string(),
            last_session_started_at: connected_at.to_string(),
            last_session_ended_at: None,
            total_play_seconds: 0,
            connect_count: 0,
            last_client_name: client_name.map(|value| value.to_string()),
        });

    entry.last_seen_at = connected_at.to_string();
    entry.last_session_started_at = connected_at.to_string();
    entry.last_session_ended_at = None;
    entry.connect_count = entry.connect_count.saturating_add(1);
    entry.last_client_name = client_name.map(|value| value.to_string());

    let _ = app_config::save(&cfg);
}

fn record_player_disconnect(world_id: &str, player: &PlayerInfo, disconnected_at: &str) {
    if world_id.trim().is_empty() || player.name.trim().is_empty() {
        return;
    }

    let mut cfg = app_config::load();
    let world_history = cfg.player_history.entry(world_id.to_string()).or_default();
    let entry = world_history
        .entry(player.name.clone())
        .or_insert_with(|| PlayerHistoryEntry {
            name: player.name.clone(),
            first_seen_at: player.joined_at.clone(),
            last_seen_at: disconnected_at.to_string(),
            last_session_started_at: player.joined_at.clone(),
            last_session_ended_at: None,
            total_play_seconds: 0,
            connect_count: 1,
            last_client_name: player.client_name.clone(),
        });

    entry.last_seen_at = disconnected_at.to_string();
    entry.last_session_started_at = player.joined_at.clone();
    entry.last_session_ended_at = Some(disconnected_at.to_string());
    entry.total_play_seconds = entry
        .total_play_seconds
        .saturating_add(session_seconds(&player.joined_at, disconnected_at));
    entry.last_client_name = player.client_name.clone();

    let _ = app_config::save(&cfg);
}

fn close_open_player_sessions(world_id: Option<String>, players: &[PlayerInfo], ended_at: &str) {
    let Some(world_id) = world_id else {
        return;
    };
    for player in players {
        record_player_disconnect(&world_id, player, ended_at);
    }
}

fn player_name_from_connect_summary(summary: &str) -> String {
    if let Some(name) = summary.strip_prefix("Beitritt: ") {
        return name.trim().to_string();
    }
    if let Some(name) = summary.strip_suffix(" hat sich eingeloggt") {
        return name.trim().to_string();
    }
    summary.trim().to_string()
}

fn player_name_from_disconnect_summary(summary: &str) -> String {
    if let Some(name) = summary.strip_prefix("Verlassen: ") {
        return name.trim().to_string();
    }
    if let Some(name) = summary.strip_prefix("Verbindung getrennt: ") {
        return name.trim().to_string();
    }
    if let Some(name) = summary.strip_suffix(" hat den Server verlassen") {
        return name.trim().to_string();
    }
    if let Some(name) = summary
        .strip_prefix("Verbindung zu ")
        .and_then(|s| s.strip_suffix(" wurde getrennt"))
    {
        return name.trim().to_string();
    }
    summary.trim().to_string()
}

fn client_name_from_join_request(raw_name: &str) -> String {
    static MACHINE_SUFFIX_RE: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"(?i)-[0-9a-f]{32}$").unwrap());

    MACHINE_SUFFIX_RE.replace(raw_name.trim(), "").to_string()
}

fn push_join_request_hint(pending: &mut Vec<JoinRequestHint>, raw_name: String) {
    let now = Instant::now();
    pending.retain(|hint| now.duration_since(hint.seen_at) <= Duration::from_secs(60));

    if pending.iter().any(|hint| hint.raw_name == raw_name) {
        return;
    }

    pending.push(JoinRequestHint {
        client_name: client_name_from_join_request(&raw_name),
        raw_name,
        seen_at: now,
    });
}

fn pop_join_request_hint(pending: &mut Vec<JoinRequestHint>) -> Option<JoinRequestHint> {
    let now = Instant::now();
    pending.retain(|hint| now.duration_since(hint.seen_at) <= Duration::from_secs(60));
    if pending.is_empty() {
        None
    } else {
        Some(pending.remove(0))
    }
}

fn server_log_dir(server_root: &str) -> PathBuf {
    Path::new(server_root).join("R5").join("Saved").join("Logs")
}

fn newest_log_file(log_dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(log_dir)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("log") {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, path))
        })
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

async fn process_log_line(
    line: &str,
    state_clone: &Arc<Mutex<ServerState>>,
    pending_join_requests: &Arc<Mutex<Vec<JoinRequestHint>>>,
    app_clone: &AppHandle,
    noise_learner: &mut noise_learner::NoiseLearner,
) {
    let mut event = log_parser::parse_line(line);
    let mut recovery_signal: Option<&'static str> = None;
    let mut recovery_probe: Option<(&'static str, bool)> = None;
    let mut recovery_eval = false;

    if let Some(raw_name) = log_parser::join_request_name(line) {
        let mut pending = pending_join_requests.lock().await;
        push_join_request_hint(&mut pending, raw_name);
    }

    if matches!(event.category, LogCategory::Unknown | LogCategory::Warning) {
        let content = log_parser::content_of(line);
        if noise_learner.observe(content) {
            event.category = LogCategory::BootNoise;
        }
    }

    {
        let mut state = state_clone.lock().await;
        let mut dirty = false;
        match event.category {
            LogCategory::ServerReady => {
                state.status = ServerStatus::Running;
                dirty = true;
                recovery_signal = Some("ServerReady");
            }
            LogCategory::RegionPing => {
                recovery_signal = Some("RegionPing");
            }
            LogCategory::ConnectionInfo => {
                if let Some(code) = event
                    .summary
                    .strip_prefix("Invite-Code erkannt: ")
                    .or_else(|| event.summary.strip_prefix("Invite Code: "))
                {
                    state.invite_code = Some(code.to_string());
                    dirty = true;
                }
            }
            LogCategory::ServerInfo => {
                if let Some(ver) = event
                    .summary
                    .strip_prefix("Server-Version: ")
                    .or_else(|| event.summary.strip_prefix("Server Version: "))
                {
                    state.version = Some(ver.trim().to_string());
                    dirty = true;
                }
            }
            LogCategory::Shutdown => {
                state.status = ServerStatus::Stopping;
                dirty = true;
            }
            LogCategory::ConnectionFailure => {
                recovery_probe = Some(("ConnectionFailure", true));
            }
            LogCategory::PlayerConnect => {
                let name = player_name_from_connect_summary(&event.summary);
                if !name.is_empty() && !state.players.iter().any(|p| p.name == name) {
                    let join_hint = {
                        let mut pending = pending_join_requests.lock().await;
                        pop_join_request_hint(&mut pending)
                    };
                    let joined_at = chrono::Local::now().to_rfc3339();
                    let client_name = join_hint.as_ref().map(|hint| hint.client_name.clone());
                    let client_login_name = join_hint.as_ref().map(|hint| hint.raw_name.clone());

                    if let Some(client_name) = client_name.as_deref() {
                        event.summary = format!("{name} von {client_name} hat sich eingeloggt");
                    }

                    if let Some(world_id) = state.world_id.as_deref() {
                        record_player_connect(world_id, &name, &joined_at, client_name.as_deref());
                    }
                    state.players.push(PlayerInfo {
                        name,
                        joined_at,
                        client_name,
                        client_login_name,
                    });
                    state.player_count = Some(state.players.len() as u32);
                    dirty = true;
                }
            }
            LogCategory::PlayerDisconnect => {
                let name = player_name_from_disconnect_summary(&event.summary);
                if !name.is_empty() {
                    let player = state.players.iter().find(|p| p.name == name).cloned();
                    if let Some(player) = player {
                        let disconnected_at = chrono::Local::now().to_rfc3339();
                        if let Some(world_id) = state.world_id.as_deref() {
                            record_player_disconnect(world_id, &player, &disconnected_at);
                        }
                        state.players.retain(|p| p.name != name);
                        state.player_count = Some(state.players.len() as u32);
                        dirty = true;
                        if state.players.is_empty() {
                            recovery_eval = true;
                        }
                    }
                }
            }
            LogCategory::VersionMismatch => {
                if state.players.is_empty() {
                    let world_id = state.world_id.clone();
                    let _ = app_clone.emit("version-mismatch", world_id);
                }
            }
            _ => {}
        }
        if dirty {
            let _ = app_clone.emit("server-status", state.clone());
        }
    }

    if let Some(reason) = recovery_signal {
        ServerProcess::schedule_recovery_signal(app_clone.clone(), Duration::from_secs(0), reason);
    }
    if let Some((reason, force_miss)) = recovery_probe {
        ServerProcess::schedule_recovery_probe(
            app_clone.clone(),
            Duration::from_secs(0),
            reason,
            force_miss,
        );
    }
    if recovery_eval {
        ServerProcess::schedule_recovery_evaluation(app_clone.clone(), Duration::from_secs(0));
    }

    let _ = app_clone.emit("log-event", &event);
}

async fn tail_server_log(
    log_dir: PathBuf,
    state_clone: Arc<Mutex<ServerState>>,
    pending_join_requests: Arc<Mutex<Vec<JoinRequestHint>>>,
    app_clone: AppHandle,
    learned_noise: Vec<LearnedNoiseEntry>,
    started_at: SystemTime,
) {
    let mut current_path: Option<PathBuf> = None;
    let mut offset = 0_u64;
    let mut noise_learner = noise_learner::NoiseLearner::new(&learned_noise);

    loop {
        if let Some(path) = newest_log_file(&log_dir) {
            let changed_file = current_path.as_ref() != Some(&path);
            if changed_file {
                offset = std::fs::metadata(&path)
                    .ok()
                    .and_then(|m| {
                        let len = m.len();
                        let modified = m.modified().ok()?;
                        Some(if modified < started_at { len } else { 0 })
                    })
                    .unwrap_or(0);
                current_path = Some(path.clone());
            }

            if let Ok(mut file) = std::fs::File::open(&path) {
                if let Ok(len) = file.metadata().map(|m| m.len()) {
                    if len < offset {
                        offset = 0;
                    }
                    if len > offset && file.seek(SeekFrom::Start(offset)).is_ok() {
                        let mut chunk = String::new();
                        if file.read_to_string(&mut chunk).is_ok() {
                            offset = file.stream_position().unwrap_or(len);
                            for line in chunk.lines().filter(|line| !line.trim().is_empty()) {
                                process_log_line(
                                    line,
                                    &state_clone,
                                    &pending_join_requests,
                                    &app_clone,
                                    &mut noise_learner,
                                )
                                .await;
                            }
                        }
                    }
                }
            }
        }

        {
            let state = state_clone.lock().await;
            if state.status == ServerStatus::Stopped {
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    let new_entries = noise_learner.finalize(&chrono::Local::now().format("%Y-%m-%d").to_string());
    if !new_entries.is_empty() {
        let mut cfg = app_config::load();
        noise_learner::merge_learned(&mut cfg.learned_noise, new_entries);
        let _ = app_config::save(&cfg);
    }
}

pub struct ServerProcess {
    pub state: Arc<Mutex<ServerState>>,
    child_pid: Arc<Mutex<Option<u32>>>,
    child_stdin: Arc<Mutex<Option<tokio::process::ChildStdin>>>,
    pending_join_requests: Arc<Mutex<Vec<JoinRequestHint>>>,
    launch_context: Arc<Mutex<Option<LaunchContext>>>,
    recovery: Arc<Mutex<RecoveryTracker>>,
    recovery_in_progress: Arc<AtomicBool>,
}

impl ServerProcess {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(ServerState::default())),
            child_pid: Arc::new(Mutex::new(None)),
            child_stdin: Arc::new(Mutex::new(None)),
            pending_join_requests: Arc::new(Mutex::new(Vec::new())),
            launch_context: Arc::new(Mutex::new(None)),
            recovery: Arc::new(Mutex::new(RecoveryTracker::new())),
            recovery_in_progress: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn get_state(&self) -> ServerState {
        self.state.lock().await.clone()
    }

    async fn emit_recovery_status(&self, app: &AppHandle) {
        let players_online = self.state.lock().await.players.len() as u32;
        let recovery = self.recovery.lock().await;
        let mode = if self.recovery_in_progress.load(Ordering::SeqCst) {
            RecoveryMode::Restarting
        } else if recovery.consecutive_misses >= HEALTH_MISS_THRESHOLD {
            if players_online > 0 {
                RecoveryMode::BlockedByPlayers
            } else {
                RecoveryMode::Retrying
            }
        } else if recovery.consecutive_misses > 0 {
            RecoveryMode::Retrying
        } else {
            RecoveryMode::Healthy
        };

        let snapshot = recovery.snapshot(players_online, mode);
        let _ = app.emit("recovery-status", snapshot);
    }

    async fn mark_health_signal(&self, app: &AppHandle, reason: &str) {
        {
            let mut recovery = self.recovery.lock().await;
            recovery.note_signal(reason);
        }
        self.emit_recovery_status(app).await;
    }

    async fn note_health_miss(&self, app: &AppHandle, reason: &str) {
        {
            let mut recovery = self.recovery.lock().await;
            recovery.note_miss(reason);
        }
        self.emit_recovery_status(app).await;
    }

    pub(crate) fn schedule_recovery_signal(app: AppHandle, delay: Duration, reason: &'static str) {
        let server_process = app.state::<Arc<Mutex<ServerProcess>>>().inner().clone();
        tauri::async_runtime::spawn(async move {
            if !delay.is_zero() {
                tokio::time::sleep(delay).await;
            }

            let guard = server_process.lock().await;
            guard.mark_health_signal(&app, reason).await;
        });
    }

    async fn maybe_restart_if_degraded(&self, app: AppHandle) {
        let (players_online, status) = {
            let state = self.state.lock().await;
            (state.players.len() as u32, state.status.clone())
        };
        let has_launch_context = self.launch_context.lock().await.is_some();
        let consecutive_misses = self.recovery.lock().await.consecutive_misses;

        let should_restart = consecutive_misses >= HEALTH_MISS_THRESHOLD
            && players_online == 0
            && status != ServerStatus::Stopping
            && has_launch_context;

        if !should_restart {
            self.emit_recovery_status(&app).await;
            return;
        }

        if self.recovery_in_progress.swap(true, Ordering::SeqCst) {
            self.emit_recovery_status(&app).await;
            return;
        }

        {
            let mut recovery = self.recovery.lock().await;
            recovery.last_reason = Some("restart".to_string());
        }
        self.emit_recovery_status(&app).await;

        let server_process = app.state::<Arc<Mutex<ServerProcess>>>().inner().clone();
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            let result = {
                let guard = server_process.lock().await;
                guard.restart_last_launch(app_clone.clone()).await
            };

            {
                let guard = server_process.lock().await;
                guard.recovery_in_progress.store(false, Ordering::SeqCst);
            }

            if let Err(err) = result {
                let _ = app_clone.emit("server-restart-failed", err);
            }
        });
    }

    pub(crate) fn schedule_recovery_probe(app: AppHandle, delay: Duration, reason: &'static str, force_miss: bool) {
        let server_process = app.state::<Arc<Mutex<ServerProcess>>>().inner().clone();
        tauri::async_runtime::spawn(async move {
            if !delay.is_zero() {
                tokio::time::sleep(delay).await;
            }

            let guard = server_process.lock().await;
            guard.run_recovery_probe(app.clone(), reason, force_miss).await;
        });
    }

    pub(crate) fn schedule_recovery_evaluation(app: AppHandle, delay: Duration) {
        let server_process = app.state::<Arc<Mutex<ServerProcess>>>().inner().clone();
        tauri::async_runtime::spawn(async move {
            if !delay.is_zero() {
                tokio::time::sleep(delay).await;
            }

            let guard = server_process.lock().await;
            guard.maybe_restart_if_degraded(app.clone()).await;
        });
    }

    async fn run_recovery_probe(&self, app: AppHandle, reason: &str, force_miss: bool) {
        let is_fresh = {
            let recovery = self.recovery.lock().await;
            recovery.is_signal_fresh()
        };

        let should_mark_signal = !force_miss && is_fresh;
        if should_mark_signal {
            self.mark_health_signal(&app, reason).await;
        } else {
            self.note_health_miss(&app, reason).await;
        }

        self.maybe_restart_if_degraded(app).await;
    }

    pub async fn start(
        &self,
        server_root: &str,
        server_info: Option<ServerStartInfo>,
        learned_noise: Vec<LearnedNoiseEntry>,
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
                state.invite_code = if info.invite_code.is_empty() {
                    None
                } else {
                    Some(info.invite_code.clone())
                };
                state.password = if info.password.is_empty() {
                    None
                } else {
                    Some(info.password.clone())
                };
                state.max_players = Some(info.max_player_count);
                state.world_id = if info.world_id.is_empty() {
                    None
                } else {
                    Some(info.world_id.clone())
                };
            }
        }
        *self.launch_context.lock().await = Some(LaunchContext {
            server_root: server_root.to_string(),
            server_info: server_info.clone(),
            learned_noise: learned_noise.clone(),
        });
        {
            let mut recovery = self.recovery.lock().await;
            *recovery = RecoveryTracker::new();
        }
        self.recovery_in_progress.store(false, Ordering::SeqCst);
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

        let log_started_at = SystemTime::now();
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Server konnte nicht gestartet werden: {e}"))?;
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
        let recovery_clone = self.recovery.clone();
        let log_state = self.state.clone();
        let log_join_requests = self.pending_join_requests.clone();
        let cleanup_join_requests = self.pending_join_requests.clone();
        let log_app = app.clone();
        let log_dir = server_log_dir(server_root);
        tokio::spawn(tail_server_log(
            log_dir,
            log_state,
            log_join_requests,
            log_app,
            learned_noise,
            log_started_at,
        ));

        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(_)) = lines.next_line().await {}

            let was_stopping = {
                let state = state_clone.lock().await;
                state.status == ServerStatus::Stopping
            };

            {
                let mut state = state_clone.lock().await;
                let ended_at = chrono::Local::now().to_rfc3339();
                close_open_player_sessions(state.world_id.clone(), &state.players, &ended_at);
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
            cleanup_join_requests.lock().await.clear();

            if !was_stopping {
                Self::schedule_recovery_probe(
                    app_clone.clone(),
                    Duration::from_secs(0),
                    "process-exit",
                    true,
                );
            }
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

        let health_app = app.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(HEALTH_CHECK_INTERVAL_SECS));
            interval.tick().await;

            loop {
                interval.tick().await;

                let status = {
                    let process = health_app.state::<Arc<Mutex<ServerProcess>>>().inner().clone();
                    let guard = process.lock().await;
                    let state = guard.state.lock().await;
                    state.status.clone()
                };

                match status {
                    ServerStatus::Stopping => break,
                    ServerStatus::Stopped => {
                        let pending_recovery = {
                            let process = health_app.state::<Arc<Mutex<ServerProcess>>>().inner().clone();
                            let guard = process.lock().await;
                            let misses = guard.recovery.lock().await.consecutive_misses;
                            let has_launch_context = guard.launch_context.lock().await.is_some();
                            misses > 0 && has_launch_context
                        };
                        if !pending_recovery {
                            break;
                        }
                        ServerProcess::schedule_recovery_probe(
                            health_app.clone(),
                            Duration::from_secs(0),
                            "process-stopped",
                            true,
                        );
                    }
                    ServerStatus::Starting => continue,
                    ServerStatus::Running => {
                        ServerProcess::schedule_recovery_probe(
                            health_app.clone(),
                            Duration::from_secs(0),
                            "periodic",
                            false,
                        );
                    }
                }
            }
        });

        // Fallback: if process is still alive after 90s but status is still "Starting",
        // the ServerReady pattern didn't match — assume running anyway
        let fallback_state = self.state.clone();
        let fallback_app = app.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(90)).await;
            let players_online = {
                let mut state = fallback_state.lock().await;
                if state.status != ServerStatus::Starting {
                    None
                } else {
                    state.status = ServerStatus::Running;
                    let players_online = state.players.len() as u32;
                    let _ = fallback_app.emit("server-status", state.clone());
                    Some(players_online)
                }
            };

            if let Some(players_online) = players_online {
                let snapshot = {
                    let mut recovery = recovery_clone.lock().await;
                    recovery.note_bootstrap();
                    recovery.snapshot(players_online, RecoveryMode::Healthy)
                };
                let _ = fallback_app.emit("recovery-status", snapshot);
            }
        });

        Ok(())
    }

    async fn restart_last_launch(&self, app: AppHandle) -> Result<(), String> {
        let launch = self
            .launch_context
            .lock()
            .await
            .clone()
            .ok_or_else(|| "Kein gespeicherter Startkontext fuer Wiederverbindung".to_string())?;

        let _ = self.stop(app.clone()).await;
        tokio::time::sleep(Duration::from_secs(2)).await;

        self.start(
            &launch.server_root,
            launch.server_info,
            launch.learned_noise,
            app,
        )
        .await
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
        {
            let mut recovery = self.recovery.lock().await;
            *recovery = RecoveryTracker::new();
        }
        self.recovery_in_progress.store(false, Ordering::SeqCst);

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
                    use windows_sys::Win32::System::Threading::{
                        OpenProcess, TerminateProcess, PROCESS_TERMINATE,
                    };
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

    pub async fn kick_player(&self, name: &str, client_login_name: Option<&str>) -> Result<(), String> {
        let mut stdin_guard = self.child_stdin.lock().await;
        match stdin_guard.as_mut() {
            Some(stdin) => {
                let mut candidates = Vec::new();
                if let Some(client_login_name) = client_login_name {
                    let target = client_login_name.trim();
                    if !target.is_empty() {
                        candidates.push(target.to_string());
                    }
                }
                let account_name = name.trim();
                if !account_name.is_empty() && !candidates.iter().any(|value| value == account_name) {
                    candidates.push(account_name.to_string());
                }

                if candidates.is_empty() {
                    return Err("Kein Kick-Ziel vorhanden".to_string());
                }

                for target in candidates {
                    let formatted_target = if target.contains(' ') {
                        format!("\"{target}\"")
                    } else {
                        target
                    };
                    let cmd_str = format!("kick {formatted_target}\r\n");
                    stdin
                        .write_all(cmd_str.as_bytes())
                        .await
                        .map_err(|e| format!("Stdin-Schreiben fehlgeschlagen: {e}"))?;
                }
                stdin
                    .flush()
                    .await
                    .map_err(|e| format!("Stdin-Flush fehlgeschlagen: {e}"))?;
                Ok(())
            }
            None => Err("Server läuft nicht oder Stdin nicht verfügbar".to_string()),
        }
    }
}
