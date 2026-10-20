//! The config file schema of section 10 and the merge of section 8.6.
//!
//! This module never reads `HOME` or any environment variable. Every default
//! arrives through `cli::Defaults`, which `main.rs` resolves. Every path in
//! `Settings` is absolute. A leading `~` is expanded by `expand_home` with the
//! `home` that `main.rs` resolved, before `resolve` runs.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::batch::Policy;
use crate::cli::{Common, Defaults, PolicyArgs};
use crate::scan::DEFAULT_DENY;

/// The default debounce of section 9, in milliseconds.
const DEFAULT_DEBOUNCE_MS: u64 = 500;

/// The file keys of section 10. Every key is optional. An unknown key is an error.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileConfig {
    pub host: Option<String>,
    pub store: Option<String>,
    pub endpoint: Option<String>,
    pub state_dir: Option<String>,
    pub roots: Option<Vec<RootConfig>>,
    pub deny: Option<Vec<String>>,
    pub deny_extra: Option<Vec<String>>,
    pub quiet_secs: Option<u64>,
    pub ceiling_secs: Option<u64>,
    pub rescan_secs: Option<u64>,
    pub debounce_ms: Option<u64>,
}

/// One `[[roots]]` entry. `name` defaults to `root_name(path)`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RootConfig {
    pub path: String,
    pub name: Option<String>,
}

impl FileConfig {
    /// `Ok(None)` when the file does not exist. Any other read failure is an error.
    pub fn load(path: &Path) -> Result<Option<Self>, ConfigError> {
        match std::fs::read_to_string(path) {
            Ok(text) => Ok(Some(Self::parse(&text)?)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(source) => Err(ConfigError::Io {
                path: path.to_path_buf(),
                source,
            }),
        }
    }

    /// Parse TOML text. An unknown key is an error.
    pub fn parse(text: &str) -> Result<Self, ConfigError> {
        Ok(toml::from_str(text)?)
    }

    /// Replace a leading `~` in `state_dir` and in every root `path` with `home`.
    /// The caller owns `home`. This function reads nothing from the environment.
    pub fn expand_home(&mut self, home: &Path) {
        if let Some(dir) = &self.state_dir {
            self.state_dir = Some(expand_tilde(dir, home));
        }
        if let Some(roots) = &mut self.roots {
            for root in roots.iter_mut() {
                root.path = expand_tilde(&root.path, home);
            }
        }
    }
}

/// `~` or `~/rest` becomes `home` or `home/rest`. Every other string is unchanged.
fn expand_tilde(value: &str, home: &Path) -> String {
    if value == "~" {
        return home.to_string_lossy().into_owned();
    }
    match value.strip_prefix("~/") {
        Some(rest) => home.join(rest).to_string_lossy().into_owned(),
        None => value.to_string(),
    }
}

/// The fully resolved settings. Every path is absolute. Nothing is optional.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    pub host: String,
    pub store: String,
    pub endpoint: Option<String>,
    pub state_dir: PathBuf,
    /// `(name, path)` per root.
    pub roots: Vec<(String, PathBuf)>,
    pub deny: Vec<String>,
    pub policy: Policy,
    pub debounce: Duration,
}

/// Precedence: flag, then env, then file, then default. `flags` and `policy` already
/// carry env values through clap. `defaults` comes from `main.rs`. `plan`, `sync`,
/// and `ls` pass `PolicyArgs::default()`, so for them the file keys and then the
/// defaults apply. The policy defaults are quiet 2 s, ceiling 300 s, rescan 1800 s,
/// debounce 500 ms (`batch::Policy::default()` and section 9).
pub fn resolve(
    flags: &Common,
    policy: &PolicyArgs,
    file: Option<&FileConfig>,
    defaults: &Defaults,
) -> Result<Settings, ConfigError> {
    let empty = FileConfig::default();
    let file = file.unwrap_or(&empty);

    let host = flags
        .host
        .clone()
        .or_else(|| file.host.clone())
        .unwrap_or_else(|| defaults.host.clone());
    if host.is_empty() {
        return Err(ConfigError::EmptyHost);
    }

    let store = flags
        .store
        .clone()
        .or_else(|| file.store.clone())
        .ok_or(ConfigError::MissingStore)?;

    let endpoint = flags.endpoint.clone().or_else(|| file.endpoint.clone());

    let state_dir = flags
        .state_dir
        .clone()
        .or_else(|| file.state_dir.as_deref().map(PathBuf::from))
        .unwrap_or_else(|| defaults.state_dir.clone());
    let state_dir = absolute(state_dir)?;

    let roots = resolve_roots(flags, file, defaults)?;

    let deny = match &file.deny {
        Some(list) => list.clone(),
        None => DEFAULT_DENY
            .iter()
            .map(|p| (*p).to_string())
            .chain(file.deny_extra.iter().flatten().cloned())
            .collect(),
    };

    let base = Policy::default();
    let secs = |flag: Option<u64>, key: Option<u64>, default: Duration| {
        flag.or(key).map(Duration::from_secs).unwrap_or(default)
    };
    let resolved = Policy {
        quiet: secs(policy.quiet_secs, file.quiet_secs, base.quiet),
        ceiling: secs(policy.ceiling_secs, file.ceiling_secs, base.ceiling),
        rescan: secs(policy.rescan_secs, file.rescan_secs, base.rescan),
    };
    let debounce = Duration::from_millis(
        policy
            .debounce_ms
            .or(file.debounce_ms)
            .unwrap_or(DEFAULT_DEBOUNCE_MS),
    );

    Ok(Settings {
        host,
        store,
        endpoint,
        state_dir,
        roots,
        deny,
        policy: resolved,
        debounce,
    })
}

/// The roots: `--root` (repeatable), else the file `[[roots]]`, else `<home>/.claude`.
/// Every path must be absolute. Two roots with one name is an error.
fn resolve_roots(
    flags: &Common,
    file: &FileConfig,
    defaults: &Defaults,
) -> Result<Vec<(String, PathBuf)>, ConfigError> {
    let mut roots: Vec<(String, PathBuf)> = Vec::new();
    if !flags.root.is_empty() {
        for path in &flags.root {
            let path = absolute(path.clone())?;
            roots.push((root_name(&path)?, path));
        }
    } else if let Some(list) = &file.roots {
        for root in list {
            let path = absolute(PathBuf::from(&root.path))?;
            let name = match &root.name {
                Some(name) if !name.is_empty() => name.clone(),
                _ => root_name(&path)?,
            };
            roots.push((name, path));
        }
    } else {
        let path = defaults.home.join(".claude");
        roots.push((root_name(&path)?, path));
    }
    let mut seen = BTreeSet::new();
    for (name, _) in &roots {
        if !seen.insert(name.clone()) {
            return Err(ConfigError::DuplicateRoot(name.clone()));
        }
    }
    Ok(roots)
}

/// `path` unchanged when absolute, else `ConfigError::NotAbsolute`.
fn absolute(path: PathBuf) -> Result<PathBuf, ConfigError> {
    if path.is_absolute() {
        Ok(path)
    } else {
        Err(ConfigError::NotAbsolute(path))
    }
}

/// The root name: the final component with leading dots removed. An error when empty.
pub fn root_name(path: &Path) -> Result<String, ConfigError> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let name = name.trim_start_matches('.');
    if name.is_empty() {
        return Err(ConfigError::EmptyRootName(path.to_path_buf()));
    }
    Ok(name.to_string())
}

/// The one error type of this module.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("io at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("toml: {0}")]
    Toml(#[from] toml::de::Error),
    #[error("--store is required (flag, DOTSYNC_STORE, or config store)")]
    MissingStore,
    #[error("root name is empty for {0}")]
    EmptyRootName(PathBuf),
    #[error("two roots share the name {0}")]
    DuplicateRoot(String),
    #[error("host name is empty")]
    EmptyHost,
    #[error("path is not absolute: {0}")]
    NotAbsolute(PathBuf),
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Defaults for a fake home under a `TempDir`. No test reads `HOME`.
    fn defaults(home: &Path) -> Defaults {
        Defaults {
            home: home.to_path_buf(),
            host: "alpha".to_string(),
            config_path: home.join(".config/dotsync/config.toml"),
            state_dir: home.join(".local/state/dotsync"),
        }
    }

    #[test]
    fn config_precedence_flag_over_env_over_file_over_default() {
        let dir = tempfile::TempDir::new().unwrap();
        let home = dir.path();
        let d = defaults(home);
        let file = FileConfig::parse(
            r#"
host = "from-file"
store = "memory:"
state_dir = "/tmp-file-state"
quiet_secs = 7
"#,
        )
        .unwrap();

        let flags = Common {
            host: Some("from-flag".to_string()),
            state_dir: Some(home.join("flag-state")),
            ..Common::default()
        };
        let policy = PolicyArgs {
            quiet_secs: Some(9),
            ..PolicyArgs::default()
        };
        let s = resolve(&flags, &policy, Some(&file), &d).unwrap();
        assert_eq!(s.host, "from-flag");
        assert_eq!(s.state_dir, home.join("flag-state"));
        assert_eq!(s.policy.quiet, Duration::from_secs(9));

        let s = resolve(&Common::default(), &PolicyArgs::default(), Some(&file), &d).unwrap();
        assert_eq!(s.host, "from-file");
        assert_eq!(s.store, "memory:");
        assert_eq!(s.state_dir, PathBuf::from("/tmp-file-state"));
        assert_eq!(s.policy.quiet, Duration::from_secs(7));
        assert_eq!(s.policy.ceiling, Duration::from_secs(300));
        assert_eq!(s.policy.rescan, Duration::from_secs(1800));
        assert_eq!(s.debounce, Duration::from_millis(500));

        let only_store = FileConfig {
            store: Some("memory:".to_string()),
            ..FileConfig::default()
        };
        let s = resolve(
            &Common::default(),
            &PolicyArgs::default(),
            Some(&only_store),
            &d,
        )
        .unwrap();
        assert_eq!(s.host, "alpha");
        assert_eq!(s.state_dir, d.state_dir);
        assert_eq!(s.roots, vec![("claude".to_string(), home.join(".claude"))]);
        assert_eq!(s.policy, Policy::default());
        assert_eq!(s.deny.len(), DEFAULT_DENY.len());

        let err = resolve(&Common::default(), &PolicyArgs::default(), None, &d).unwrap_err();
        assert!(matches!(err, ConfigError::MissingStore));
    }

    #[test]
    fn config_root_name_strips_leading_dots() {
        assert_eq!(root_name(Path::new("/h/.claude")).unwrap(), "claude");
        assert_eq!(root_name(Path::new("/h/..x")).unwrap(), "x");
        assert!(matches!(
            root_name(Path::new("/h/...")),
            Err(ConfigError::EmptyRootName(_))
        ));
    }

    #[test]
    fn config_deny_extra_appends_and_deny_replaces() {
        let dir = tempfile::TempDir::new().unwrap();
        let d = defaults(dir.path());
        let extra = FileConfig::parse("store = \"memory:\"\ndeny_extra = [\"**/*.key\"]").unwrap();
        let s = resolve(&Common::default(), &PolicyArgs::default(), Some(&extra), &d).unwrap();
        assert_eq!(s.deny.len(), DEFAULT_DENY.len() + 1);
        assert_eq!(s.deny.last().map(String::as_str), Some("**/*.key"));

        let replace = FileConfig::parse("store = \"memory:\"\ndeny = [\"a\", \"b\"]").unwrap();
        let s = resolve(
            &Common::default(),
            &PolicyArgs::default(),
            Some(&replace),
            &d,
        )
        .unwrap();
        assert_eq!(s.deny, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn config_unknown_key_and_duplicate_root_are_errors() {
        assert!(matches!(
            FileConfig::parse("bogus = 1"),
            Err(ConfigError::Toml(_))
        ));
        let dir = tempfile::TempDir::new().unwrap();
        let d = defaults(dir.path());
        let flags = Common {
            store: Some("memory:".to_string()),
            root: vec![dir.path().join("a/.x"), dir.path().join("b/x")],
            ..Common::default()
        };
        let err = resolve(&flags, &PolicyArgs::default(), None, &d).unwrap_err();
        assert!(matches!(err, ConfigError::DuplicateRoot(ref n) if n == "x"));
    }

    #[test]
    fn config_expand_home_replaces_leading_tilde() {
        let mut file = FileConfig::parse(
            "state_dir = \"~/.local/state/dotsync\"\n[[roots]]\npath = \"~/.claude\"\n",
        )
        .unwrap();
        file.expand_home(Path::new("/h"));
        assert_eq!(file.state_dir.as_deref(), Some("/h/.local/state/dotsync"));
        assert_eq!(file.roots.unwrap()[0].path, "/h/.claude");
    }
}
