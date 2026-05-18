use std::collections::{HashMap, HashSet};
use crate::types::LearnedNoiseEntry;

const THRESHOLD: u32 = 5;

pub struct NoiseLearner {
    session_counts: HashMap<String, u32>,
    learned_prefixes: HashSet<String>,
}

impl NoiseLearner {
    pub fn new(learned: &[LearnedNoiseEntry]) -> Self {
        let learned_prefixes = learned.iter().map(|e| e.prefix.clone()).collect();
        Self {
            session_counts: HashMap::new(),
            learned_prefixes,
        }
    }

    /// Extracts the normalized log prefix from a content string (after timestamp/frame stripped).
    /// If the first token before `:` is a clean alphanumeric category, returns it with the colon.
    /// Otherwise normalizes runs of digits to `#` and takes up to 50 chars.
    pub fn extract_prefix(content: &str) -> String {
        if let Some(colon) = content.find(':') {
            let candidate = &content[..colon];
            if candidate.chars().all(|c| c.is_alphanumeric() || c == '_') && !candidate.is_empty() {
                return format!("{}:", candidate);
            }
        }
        // Normalize digit runs to '#', take first 50 chars
        let normalized: String = content
            .chars()
            .take(50)
            .collect::<String>()
            .split(|c: char| c.is_ascii_digit())
            .collect::<Vec<_>>()
            .join("#");
        normalized.trim().to_string()
    }

    /// Observes a content string. Returns true if it should be reclassified to BootNoise.
    pub fn observe(&mut self, content: &str) -> bool {
        let prefix = Self::extract_prefix(content);
        if self.learned_prefixes.contains(&prefix) {
            return true;
        }
        let count = self.session_counts.entry(prefix.clone()).or_insert(0);
        *count += 1;
        if *count >= THRESHOLD {
            self.learned_prefixes.insert(prefix);
            return true;
        }
        false
    }

    /// Returns entries that crossed the threshold this session, ready to merge into AppConfig.
    pub fn finalize(&self, today: &str) -> Vec<LearnedNoiseEntry> {
        self.session_counts
            .iter()
            .filter(|(_, &count)| count >= THRESHOLD)
            .map(|(prefix, &count)| LearnedNoiseEntry {
                prefix: prefix.clone(),
                session_count: 1,
                max_occurrences: count,
                last_seen: today.to_string(),
            })
            .collect()
    }
}

/// Merges new entries from the current session into the persisted learned_noise list.
pub fn merge_learned(existing: &mut Vec<LearnedNoiseEntry>, new: Vec<LearnedNoiseEntry>) {
    for entry in new {
        if let Some(existing_entry) = existing.iter_mut().find(|e| e.prefix == entry.prefix) {
            existing_entry.session_count += 1;
            if entry.max_occurrences > existing_entry.max_occurrences {
                existing_entry.max_occurrences = entry.max_occurrences;
            }
            existing_entry.last_seen = entry.last_seen;
        } else {
            existing.push(entry);
        }
    }
}
