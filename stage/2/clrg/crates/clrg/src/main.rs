//! `clrg`: search Claude Code session history across one or more
//! `~/.claude`-shaped roots. This file parses, dispatches, and maps errors to
//! exit codes. The clap types live in `cli.rs`; `commands.rs` dispatches to
//! each command's module, or to a stub.

#![forbid(unsafe_code)]

mod cli;
mod commands;
mod common;
mod extract;
mod facets;
mod files;
mod grep;
#[cfg(test)]
mod parity_tests;
mod records;
mod render;
mod sessions;

use std::io::Write as _;
use std::process::ExitCode;

use clap::{CommandFactory as _, Parser as _};

use crate::cli::{Cli, Command, IndexCommand};
use crate::commands::{NotImplemented, UsageError};

/// Exit codes, as declared by `exit_code` in `clrg-cli.kdl`.
pub mod exit {
    pub const MATCHED: u8 = 0;
    pub const NO_MATCH: u8 = 1;
    pub const USAGE: u8 = 2;
    pub const UNREADABLE: u8 = 3;
    pub const UNRECOVERABLE: u8 = 4;
    pub const NOT_IMPLEMENTED: u8 = 5;
}

fn main() -> ExitCode {
    let cli = Cli::parse();

    if cli.usage_spec {
        // clap_usage::spec, not ::generate: generate panics on a closed pipe.
        let spec = clap_usage::spec(&mut Cli::command(), "clrg");
        let mut out = std::io::stdout().lock();
        return match writeln!(out, "{spec}").and_then(|()| out.flush()) {
            Ok(()) => ExitCode::from(exit::MATCHED),
            Err(e) if e.kind() == std::io::ErrorKind::BrokenPipe => ExitCode::from(exit::MATCHED),
            Err(e) => {
                eprintln!("clrg: {e}");
                ExitCode::from(exit::UNREADABLE)
            }
        };
    }

    let Some(command) = &cli.command else {
        // No subcommand: show help on stderr, like a usage error.
        let _ = Cli::command().write_help(&mut std::io::stderr());
        return ExitCode::from(exit::USAGE);
    };

    match run(&cli, command) {
        Ok(code) => ExitCode::from(code),
        Err(err) => {
            if let Some(ni) = err.downcast_ref::<NotImplemented>() {
                eprintln!("clrg {ni}");
                ExitCode::from(exit::NOT_IMPLEMENTED)
            } else if let Some(usage) = err.downcast_ref::<UsageError>() {
                eprintln!("clrg: {usage}");
                ExitCode::from(exit::USAGE)
            } else {
                eprintln!("clrg: {err:#}");
                ExitCode::from(exit::UNREADABLE)
            }
        }
    }
}

/// Dispatch one parsed command. Returns the exit code on success.
fn run(cli: &Cli, command: &Command) -> anyhow::Result<u8> {
    let global = &cli.global;
    match command {
        Command::Sessions(args) => commands::sessions(global, args),
        Command::Grep(args) => commands::grep(global, args),
        Command::Files(args) => commands::files(global, args),
        Command::Artifacts(args) => commands::artifacts(global, args),
        Command::Show(args) => commands::show(global, args),
        Command::Extract(args) => commands::extract(global, args),
        Command::Facets(args) => commands::facets(global, args),
        Command::Doctor(args) => commands::doctor(global, args),
        Command::Index { command } => match command {
            IndexCommand::Build { .. } => commands::not_implemented("index build"),
            IndexCommand::Status => commands::not_implemented("index status"),
            IndexCommand::Clear => commands::not_implemented("index clear"),
        },
        Command::Completion(args) => commands::completion(global, args),
    }
}
