//! dotsync mirrors a dot directory into an object store under a per-machine prefix.
//!
//! This is the only module that reads the process environment. It resolves
//! `HOME`, the hostname, the default config path, and the default state
//! directory, then hands them to `cli::run` as `Defaults`. Every other module
//! takes those values as arguments. The three `allow(dead_code)` lines cover the
//! modules that only the daemon loop uses, until the next commit wires it.
#![forbid(unsafe_code)]

#[allow(dead_code)]
mod batch;
mod cli;
mod config;
mod manifest;
#[allow(dead_code)]
mod scan;
mod store;
#[allow(dead_code)]
mod watch;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::Parser;

use cli::{Cli, CliError, Defaults};

/// `HOME` from the environment. An error when unset or empty.
fn resolve_home() -> Result<PathBuf, CliError> {
    match std::env::var_os("HOME") {
        Some(home) if !home.is_empty() => Ok(PathBuf::from(home)),
        _ => Err(CliError::Env("HOME is unset or empty".to_string())),
    }
}

/// Decision 4.1. `gethostname::gethostname()`, cut at the first '.', lowercased,
/// non [a-z0-9-] to '-'. An empty result is an error.
fn resolve_host() -> Result<String, CliError> {
    let raw = gethostname::gethostname().to_string_lossy().into_owned();
    let host: String = raw
        .split('.')
        .next()
        .unwrap_or("")
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    if host.is_empty() {
        return Err(config::ConfigError::EmptyHost.into());
    }
    Ok(host)
}

/// `$XDG_CONFIG_HOME/dotsync/config.toml` when that variable is set and not empty,
/// else `<home>/.config/dotsync/config.toml`.
fn default_config_path(home: &Path) -> PathBuf {
    match std::env::var_os("XDG_CONFIG_HOME") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir).join("dotsync").join("config.toml"),
        _ => home.join(".config").join("dotsync").join("config.toml"),
    }
}

/// `$XDG_STATE_HOME/dotsync` when that variable is set and not empty,
/// else `<home>/.local/state/dotsync`.
fn default_state_dir(home: &Path) -> PathBuf {
    match std::env::var_os("XDG_STATE_HOME") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir).join("dotsync"),
        _ => home.join(".local").join("state").join("dotsync"),
    }
}

/// Resolve the environment, then run the subcommand.
async fn run(cli: Cli, out: &mut dyn Write) -> Result<(), CliError> {
    let home = resolve_home()?;
    let defaults = Defaults {
        host: resolve_host()?,
        config_path: default_config_path(&home),
        state_dir: default_state_dir(&home),
        home,
    };
    cli::run(cli, defaults, out).await?;
    out.flush()?;
    Ok(())
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    let mut out = std::io::stdout().lock();
    match run(cli, &mut out).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::from(1)
        }
    }
}
