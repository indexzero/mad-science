//! dotsync mirrors a dot directory into an object store under a per-machine prefix.
//!
//! M1 ships a stub `main`. M4 replaces it with the clap entry point of section 8.8.
//! The `allow(dead_code)` on each module is M1 scaffolding. M4 removes it when
//! `main` calls into the modules.
#![forbid(unsafe_code)]

#[allow(dead_code)]
mod batch;
#[allow(dead_code)]
mod cli;
#[allow(dead_code)]
mod config;
#[allow(dead_code)]
mod manifest;
#[allow(dead_code)]
mod scan;
#[allow(dead_code)]
mod store;
#[allow(dead_code)]
mod watch;

use std::process::ExitCode;

fn main() -> ExitCode {
    ExitCode::SUCCESS
}
