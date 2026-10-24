//! clrg-core: root and store discovery, the record model, selectors, search,
//! and domain ordering for `clrg`.
//!
//! The library never reads `HOME`, the current folder, the clock, or the
//! environment. The binary resolves those and passes them in.

#![forbid(unsafe_code)]

pub mod agree;
pub mod catalog;
pub mod decode;
pub mod discover;
pub mod evidence;
pub mod extract;
pub mod order;
pub mod pattern;
mod rawjson;
pub mod search;
pub mod select;
pub mod session;

pub use agree::{Agreement, HistoryIndex, LastText, Rule, TextMark};
pub use catalog::{CatalogOptions, Facet, FacetField, SessionSummary};
pub use decode::MessageMeta;
pub use order::Group;
pub use pattern::{CaseMode, CompiledPattern, Query};
pub use search::{Hit, InSelector, Outcome, SearchOptions, search};
pub use select::{Scope, Selectors};
pub use session::{ContextMessage, SessionInfo, UserText};

/// Errors from the library. The binary maps them to exit codes.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The pattern did not compile.
    #[error("invalid pattern {pattern:?}: {message}")]
    Pattern { pattern: String, message: String },
    /// A selector value did not parse (a glob, a time, a version range).
    #[error("invalid {flag} value {value:?}: {message}")]
    Selector {
        flag: &'static str,
        value: String,
        message: String,
    },
}

/// A kind of store inside a `~/.claude`-shaped root.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum StoreKind {
    /// Everything under `projects/` that no other store claims: transcripts
    /// (`*.jsonl`, including `subagents/`), `tool-results/`, and other files.
    Transcripts,
    /// `history.jsonl`.
    History,
    /// `plans/`.
    Plans,
    /// `todos/`.
    Todos,
    /// `tasks/`.
    Tasks,
    /// `file-history/`.
    FileHistory,
    /// `sessions/`.
    Sessions,
    /// `projects/<dir>/<sid>/workflows/**`: workflow run records.
    Workflows,
    /// Every other file under a root that no store above claims
    /// (`settings.json`, `CLAUDE.md`, `commands/`, loose files in
    /// `file-history/`, ...): `type: null`, `part: null` (R3).
    Other,
}

impl StoreKind {
    /// Every store, in the order clrg searches them by default.
    pub const ALL: [StoreKind; 9] = [
        StoreKind::Transcripts,
        StoreKind::History,
        StoreKind::Plans,
        StoreKind::Todos,
        StoreKind::Tasks,
        StoreKind::FileHistory,
        StoreKind::Sessions,
        StoreKind::Workflows,
        StoreKind::Other,
    ];

    /// The name used on the command line and in output records.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            StoreKind::Transcripts => "transcripts",
            StoreKind::History => "history",
            StoreKind::Plans => "plans",
            StoreKind::Todos => "todos",
            StoreKind::Tasks => "tasks",
            StoreKind::FileHistory => "file-history",
            StoreKind::Sessions => "sessions",
            StoreKind::Workflows => "workflows",
            StoreKind::Other => "other",
        }
    }

    /// The entry directly under a root that holds this store. `other` has
    /// none: it can be anywhere in the root, so it is `""` and
    /// [`crate::discover::store_paths`] walks every entry of the root.
    #[must_use]
    pub fn entry(self) -> &'static str {
        match self {
            StoreKind::Transcripts | StoreKind::Workflows => "projects",
            StoreKind::History => "history.jsonl",
            StoreKind::Other => "",
            other => other.as_str(),
        }
    }
}

/// Format unix milliseconds as RFC 3339 in UTC, e.g. `2026-08-02T14:31:00.000Z`.
#[must_use]
pub fn format_ts(ms: i64) -> Option<String> {
    let nanos = i128::from(ms) * 1_000_000;
    let dt = time::OffsetDateTime::from_unix_timestamp_nanos(nanos).ok()?;
    let fmt = time::macros::format_description!(
        "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z"
    );
    dt.format(&fmt).ok()
}

/// Parse an RFC 3339 timestamp to unix milliseconds.
#[must_use]
pub fn parse_ts(s: &str) -> Option<i64> {
    let dt = time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()?;
    i64::try_from(dt.unix_timestamp_nanos() / 1_000_000).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_names_are_unique() {
        let mut names: Vec<_> = StoreKind::ALL.iter().map(|k| k.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), StoreKind::ALL.len());
    }

    #[test]
    fn timestamps_round_trip() {
        let ms = parse_ts("2026-08-02T14:31:00.250Z").unwrap();
        assert_eq!(format_ts(ms).unwrap(), "2026-08-02T14:31:00.250Z");
        assert_eq!(parse_ts("2026-08-02T16:31:00.250+02:00"), Some(ms));
        assert_eq!(parse_ts("not a time"), None);
    }
}
