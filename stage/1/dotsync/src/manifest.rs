//! The manifest schema of section 6. Load, diff, apply, and the atomic write follow.
//!

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// The manifest schema version this build reads and writes.
pub const SCHEMA_VERSION: u32 = 1;

/// Serialized as `file` or `link`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    File,
    Link,
}

/// One manifest entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub kind: Kind,
    /// Byte length for a file. Length of the target string for a link.
    pub size: u64,
    /// Nanoseconds since the Unix epoch, from `Metadata::modified()`.
    /// A time before the epoch is stored as 0.
    pub mtime_ns: u64,
    /// `MetadataExt::ino()` on Unix. 0 on other targets.
    pub inode: u64,
    /// blake3 of the file bytes, or of the link target string. 64 lowercase hex chars.
    pub hash: String,
    /// The link target string. `None` for a file.
    pub target: Option<String>,
    /// The generation of the pass that last put this entry's content.
    pub uploaded_version: u64,
    /// True after a tombstone was written for this path.
    pub deleted: bool,
}

/// The manifest of one root on one host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    pub schema: u32,
    pub host: String,
    pub root: String,
    pub generation: u64,
    /// Key: the root-relative path with `/` separators.
    pub entries: BTreeMap<String, Entry>,
}
