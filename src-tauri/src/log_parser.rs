use regex::Regex;
use std::sync::LazyLock;

use crate::types::{LogCategory, LogEvent, LogLevel};

struct LogPattern {
    regex: Regex,
    category: LogCategory,
    summary_template: &'static str,
}

static PATTERNS: LazyLock<Vec<LogPattern>> = LazyLock::new(|| {
    vec![
        LogPattern {
            regex: Regex::new(r"^Log(PluginManager|Config: Set CVar|Init:|PakFile|IoDispatcher)").unwrap(),
            category: LogCategory::BootNoise,
            summary_template: "",
        },
        LogPattern {
            regex: Regex::new(r"R5LogGameInstance.*Version\s+=\s+(.+)").unwrap(),
            category: LogCategory::ServerInfo,
            summary_template: "Server Version: {1}",
        },
        LogPattern {
            regex: Regex::new(r"R5BLDalAsyncQueue::LoadDb.*Successfully loaded DB (.+)").unwrap(),
            category: LogCategory::WorldLoad,
            summary_template: "Welt geladen: {1}",
        },
        LogPattern {
            regex: Regex::new(r"SetIsReadyForHostOwnerConnect.*Host server is ready").unwrap(),
            category: LogCategory::ServerReady,
            summary_template: "SERVER BEREIT",
        },
        LogPattern {
            regex: Regex::new(r"R5LogPinger.*Pinged server info.*Server: '([^']+)'.*AveragePingMs: ([\d.]+)").unwrap(),
            category: LogCategory::RegionPing,
            summary_template: "Ping {1}: {2}ms",
        },
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
        LogPattern {
            regex: Regex::new(r#""InviteCode":\s*"([^"]+)""#).unwrap(),
            category: LogCategory::ConnectionInfo,
            summary_template: "Invite Code: {1}",
        },
        LogPattern {
            regex: Regex::new(r"LogLoad: Took ([\d.]+) seconds to LoadMap\((.+)\)").unwrap(),
            category: LogCategory::MapLoad,
            summary_template: "Map geladen: {2} ({1}s)",
        },
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
        LogPattern {
            regex: Regex::new(r"Engine exit requested|RequestExit").unwrap(),
            category: LogCategory::Shutdown,
            summary_template: "Server faehrt herunter",
        },
    ]
});

static TIMESTAMP_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\[(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d{3})\]\[(\s*\d+)\]").unwrap()
});

pub fn parse_line(raw: &str) -> LogEvent {
    let (timestamp, frame, content) = if let Some(caps) = TIMESTAMP_RE.captures(raw) {
        let ts = caps.get(1).map(|m| m.as_str().to_string());
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
            if summary.is_empty() {
                summary = content.chars().take(80).collect();
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

    let (level, category) = if content.contains("Error:") || content.contains("Error ") {
        (LogLevel::Error, LogCategory::Error)
    } else if content.contains("Warning:") {
        (LogLevel::Warning, LogCategory::Warning)
    } else {
        (LogLevel::Debug, LogCategory::Unknown)
    };

    LogEvent {
        timestamp,
        frame,
        category,
        level,
        summary: content.chars().take(120).collect(),
        raw_line: raw.to_string(),
    }
}
