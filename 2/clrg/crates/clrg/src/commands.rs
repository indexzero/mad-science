//! One function per command. `grep`, `sessions`, `facets`, `files`, and `extract` are built (in
//! their own modules); the rest are stubs that return [`NotImplemented`].

use std::fmt;

use crate::cli::{
    ArtifactsArgs, CompletionArgs, DoctorArgs, ExtractArgs, FacetsArgs, FilesArgs, GlobalArgs,
    GrepArgs, SessionsArgs, ShowArgs,
};

/// A command that is in the spec but not built yet. Exits 5.
#[derive(Debug)]
pub struct NotImplemented(pub &'static str);

impl fmt::Display for NotImplemented {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: not implemented (yet)", self.0)
    }
}

impl std::error::Error for NotImplemented {}

/// A bad value on the command line (a pattern, glob, or time). Exits 2.
#[derive(Debug)]
pub struct UsageError(pub String);

impl fmt::Display for UsageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for UsageError {}

/// Fail with [`NotImplemented`] for `command` (its canonical name).
pub fn not_implemented(command: &'static str) -> anyhow::Result<u8> {
    Err(NotImplemented(command).into())
}

pub fn sessions(global: &GlobalArgs, args: &SessionsArgs) -> anyhow::Result<u8> {
    crate::sessions::run(global, args)
}

pub fn grep(global: &GlobalArgs, args: &GrepArgs) -> anyhow::Result<u8> {
    crate::grep::run(global, args)
}

pub fn files(global: &GlobalArgs, args: &FilesArgs) -> anyhow::Result<u8> {
    crate::files::run(global, args)
}

pub fn artifacts(_global: &GlobalArgs, _args: &ArtifactsArgs) -> anyhow::Result<u8> {
    not_implemented("artifacts")
}

pub fn show(_global: &GlobalArgs, _args: &ShowArgs) -> anyhow::Result<u8> {
    not_implemented("show")
}

pub fn extract(global: &GlobalArgs, args: &ExtractArgs) -> anyhow::Result<u8> {
    crate::extract::run(global, args)
}

pub fn facets(global: &GlobalArgs, args: &FacetsArgs) -> anyhow::Result<u8> {
    crate::facets::run(global, args)
}

pub fn doctor(_global: &GlobalArgs, _args: &DoctorArgs) -> anyhow::Result<u8> {
    not_implemented("doctor")
}

pub fn completion(_global: &GlobalArgs, _args: &CompletionArgs) -> anyhow::Result<u8> {
    not_implemented("completion")
}
