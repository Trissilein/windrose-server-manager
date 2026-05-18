use chrono::{TimeZone, Utc, Local};
use regex::Regex;
use std::sync::LazyLock;

use crate::types::{LogCategory, LogEvent, LogLevel};

struct LogPattern {
    regex: Regex,
    category: LogCategory,
    summary_template: &'static str,
}

// Strips [000000]-style inline frame numbers that R5LogNet embeds in message bodies
static INLINE_FRAME_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[\d{4,6}\]\s*").unwrap()
});

fn strip_inline_frames(s: &str) -> String {
    INLINE_FRAME_RE.replace_all(s, "").trim().to_string()
}

static PATTERNS: LazyLock<Vec<LogPattern>> = LazyLock::new(|| {
    vec![
        // ── R5LogNet Warning: lines are gRPC / network startup noise ──────────
        LogPattern {
            regex: Regex::new(r"^R5LogNet: Warning:").unwrap(),
            category: LogCategory::BootNoise,
            summary_template: "",
        },
        // ── ReplicationGraph warnings fire every boot for unregistered actors ─
        LogPattern {
            regex: Regex::new(r"^(R5)?LogReplicationGraph: Warning:").unwrap(),
            category: LogCategory::BootNoise,
            summary_template: "",
        },
        // ── Other UE5 subsystem Warning: lines that are always noise ──────────
        LogPattern {
            regex: Regex::new(
                r"^(LogStringTable|LogUObjectGlobals|LogUObjectArray|LogNetVersion|LogOnlineSubsystem|LogTemp|LogScript): Warning:"
            ).unwrap(),
            category: LogCategory::BootNoise,
            summary_template: "",
        },
        // ── Known UE5 boot/init prefixes ──────────────────────────────────────
        LogPattern {
            regex: Regex::new(
                r"^Log(PluginManager|Config: Set CVar|Init:|PakFile|IoDispatcher|NetVersion|OnlineSubsystem|Streaming|DerivedDataCache|ShaderLibrary|Class|Linker|Package)"
            ).unwrap(),
            category: LogCategory::BootNoise,
            summary_template: "",
        },
        // ── Source file path lines from CheckMonitor / error backtraces ────────
        LogPattern {
            regex: Regex::new(r"^\[D:[/\\]Source[/\\]Build").unwrap(),
            category: LogCategory::BootNoise,
            summary_template: "",
        },
        // ── Server lifecycle ──────────────────────────────────────────────────
        LogPattern {
            regex: Regex::new(r"R5LogGameInstance.*Version\s+=\s+(.+)").unwrap(),
            category: LogCategory::ServerInfo,
            summary_template: "Server Version: {1}",
        },
        LogPattern {
            regex: Regex::new(r"^Unreal Engine version:\s+(.+)").unwrap(),
            category: LogCategory::ServerInfo,
            summary_template: "Engine: {1}",
        },
        LogPattern {
            regex: Regex::new(r"R5BLDalAsyncQueue::LoadDb.*Successfully loaded DB (.+)").unwrap(),
            category: LogCategory::WorldLoad,
            summary_template: "Spielwelt geladen: {1}",
        },
        // Primary Windrose ready signal
        LogPattern {
            regex: Regex::new(r"UR5EcCollector::OnResponse.*New settings received").unwrap(),
            category: LogCategory::ServerReady,
            summary_template: "Server ist bereit",
        },
        // Fallback for other UE5 servers
        LogPattern {
            regex: Regex::new(r"SetIsReadyForHostOwnerConnect.*Host server is ready").unwrap(),
            category: LogCategory::ServerReady,
            summary_template: "Server ist bereit",
        },
        // ── Network / connectivity ────────────────────────────────────────────
        LogPattern {
            regex: Regex::new(r"R5LogPinger.*Pinged server info.*Server: '([^']+)'.*AveragePingMs: ([\d.]+)").unwrap(),
            category: LogCategory::RegionPing,
            summary_template: "Ping {1}: {2} ms",
        },
        LogPattern {
            regex: Regex::new(r#""InviteCode":\s*"([^"]+)""#).unwrap(),
            category: LogCategory::ConnectionInfo,
            summary_template: "Invite Code: {1}",
        },
        // ── Map / world loading ───────────────────────────────────────────────
        // Extract only the filename from the UE path (e.g. /Game/R5/Levels/R5Island_P → R5Island_P)
        LogPattern {
            regex: Regex::new(r"LogLoad: Took ([\d.]+) seconds to LoadMap\((?:.*/)?([^/)]+)\)").unwrap(),
            category: LogCategory::MapLoad,
            summary_template: "Karte geladen: {2} ({1}s)",
        },
        // ── Auth / registration ───────────────────────────────────────────────
        LogPattern {
            regex: Regex::new(r"OnLoginFinished.*Login finished successfully").unwrap(),
            category: LogCategory::Auth,
            summary_template: "Authentifiziert",
        },
        LogPattern {
            regex: Regex::new(r"OnServerRegistered.*registration finished").unwrap(),
            category: LogCategory::Registration,
            summary_template: "Server registriert",
        },
        // ── Backup ────────────────────────────────────────────────────────────
        LogPattern {
            regex: Regex::new(r"SaveBackupsSync.*Start sync backups").unwrap(),
            category: LogCategory::BackupStart,
            summary_template: "Backup gestartet",
        },
        LogPattern {
            regex: Regex::new(r"OnSaveBackupFinished.*finished successfully").unwrap(),
            category: LogCategory::BackupDone,
            summary_template: "Backup abgeschlossen",
        },
        // ── CheckMonitor health summary (periodic report, not error events) ────
        LogPattern {
            regex: Regex::new(r"^R5(Error|Check|Ensure) Report Calls TotalNum").unwrap(),
            category: LogCategory::Warning,
            summary_template: "",
        },
        LogPattern {
            regex: Regex::new(r"^R5LogCheck: Warning:").unwrap(),
            category: LogCategory::Warning,
            summary_template: "",
        },
        // ── Shutdown ──────────────────────────────────────────────────────────
        LogPattern {
            regex: Regex::new(r"Engine exit requested|RequestExit").unwrap(),
            category: LogCategory::Shutdown,
            summary_template: "Server fährt herunter",
        },
        // ── Players ───────────────────────────────────────────────────────────
        // R5 DataKeeper account-status dump — fires on each state transition
        // Line format: "     1. Name 'PlayerName'. AccountId '...'. State 'ReadyToPlay'. ..."
        LogPattern {
            regex: Regex::new(r"Name '([^']+)'.*\bState 'ReadyToPlay'").unwrap(),
            category: LogCategory::PlayerConnect,
            summary_template: "Beitritt: {1}",
        },
        LogPattern {
            regex: Regex::new(r"Name '([^']+)'.*\bState 'SaidFarewell'").unwrap(),
            category: LogCategory::PlayerDisconnect,
            summary_template: "Verlassen: {1}",
        },
        // Standard UE5 join/logout (fallback for non-R5 servers)
        LogPattern {
            regex: Regex::new(r"LogNet.*Join request.*[?&]Name=([^&\s\]]+)").unwrap(),
            category: LogCategory::PlayerConnect,
            summary_template: "Beitritt: {1}",
        },
        LogPattern {
            regex: Regex::new(r"LogGameMode.*\bLogin:\s+(\S+)").unwrap(),
            category: LogCategory::PlayerConnect,
            summary_template: "Beitritt: {1}",
        },
        LogPattern {
            regex: Regex::new(r"LogGameMode.*\bLogout:\s+(\S+)").unwrap(),
            category: LogCategory::PlayerDisconnect,
            summary_template: "Verlassen: {1}",
        },
        LogPattern {
            regex: Regex::new(r"LogNet.*UNetConnection::Close.*RemoteAddr=([^,\s]+)").unwrap(),
            category: LogCategory::PlayerDisconnect,
            summary_template: "Verbindung getrennt: {1}",
        },
        // ── Version mismatch ─────────────────────────────────────────────────────
        LogPattern {
            regex: Regex::new(r"(?i)version.*mismatch|mismatch.*version").unwrap(),
            category: LogCategory::VersionMismatch,
            summary_template: "",
        },
        LogPattern {
            regex: Regex::new(r"LogNetVersion:.*[Cc]lient.*[Vv]ersion").unwrap(),
            category: LogCategory::VersionMismatch,
            summary_template: "",
        },
        LogPattern {
            regex: Regex::new(r"R5LogNet:.*[Vv]ersion.*[Mm]ismatch|R5LogNet:.*incompatible.*version").unwrap(),
            category: LogCategory::VersionMismatch,
            summary_template: "",
        },
        // ── Performance ───────────────────────────────────────────────────────────
        LogPattern {
            regex: Regex::new(r"^LogPerformance:").unwrap(),
            category: LogCategory::Performance,
            summary_template: "",
        },
        LogPattern {
            regex: Regex::new(r"^LogEngine: Warning: Hitch detected").unwrap(),
            category: LogCategory::Performance,
            summary_template: "",
        },
        LogPattern {
            regex: Regex::new(r"^LogMemory: Warning:").unwrap(),
            category: LogCategory::Performance,
            summary_template: "",
        },
        LogPattern {
            regex: Regex::new(r"^R5Log\w+:.*took \d+").unwrap(),
            category: LogCategory::Performance,
            summary_template: "",
        },
    ]
});

static TIMESTAMP_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\[(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d{3})\]\[(\s*\d+)\]").unwrap()
});

// Parse UE5 timestamp (UTC) and convert to local time for display
fn convert_timestamp(raw_ts: &str) -> String {
    // UE5 format: 2026.05.17-16.11.17:016 — treat as UTC, convert to local timezone
    if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(raw_ts, "%Y.%m.%d-%H.%M.%S:%3f") {
        let utc = Utc.from_utc_datetime(&ndt);
        return utc.with_timezone(&Local).format("%H:%M:%S").to_string();
    }
    raw_ts.to_string()
}

/// Returns the content portion of a raw log line (everything after the [ts][frame] prefix).
pub fn content_of(raw: &str) -> &str {
    if let Some(caps) = TIMESTAMP_RE.captures(raw) {
        &raw[caps.get(0).unwrap().end()..]
    } else {
        raw
    }
}

pub fn parse_line(raw: &str) -> LogEvent {
    let (timestamp, frame, content) = if let Some(caps) = TIMESTAMP_RE.captures(raw) {
        let ts = caps.get(1).map(|m| convert_timestamp(m.as_str()));
        let fr = caps.get(2).and_then(|m| m.as_str().trim().parse::<u32>().ok());
        let rest = &raw[caps.get(0).unwrap().end()..];
        (ts, fr, rest)
    } else {
        (None, None, raw)
    };

    for pattern in PATTERNS.iter() {
        if let Some(caps) = pattern.regex.captures(content) {
            let mut summary = pattern.summary_template.to_string();
            for i in 1..caps.len() {
                if let Some(m) = caps.get(i) {
                    summary = summary.replace(&format!("{{{}}}", i), m.as_str());
                }
            }
            // Empty template = BootNoise: store truncated content (stripped of inline frame numbers)
            if summary.is_empty() {
                summary = strip_inline_frames(content).chars().take(120).collect();
            }
            return LogEvent {
                timestamp,
                frame,
                category: pattern.category.clone(),
                level: LogLevel::Info,
                summary,
                raw_line: raw.to_string(),
            };
        }
    }

    // Fallback classification
    let (level, category) = if content.contains("Error:") || content.contains("Error ") {
        (LogLevel::Error, LogCategory::Error)
    } else if content.contains("Warning:") {
        (LogLevel::Warning, LogCategory::Warning)
    } else {
        (LogLevel::Debug, LogCategory::Unknown)
    };

    let summary = match category {
        // Error/Warning/Performance: full content, inline frames stripped
        LogCategory::Error | LogCategory::Warning | LogCategory::Performance => strip_inline_frames(content),
        // Unknown: strip frames + cap at 200 chars to avoid noise walls
        _ => strip_inline_frames(content).chars().take(200).collect(),
    };

    LogEvent {
        timestamp,
        frame,
        category,
        level,
        summary,
        raw_line: raw.to_string(),
    }
}
