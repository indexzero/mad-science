//! Commands that are in the spec but not built yet print
//! `clrg <command>: not implemented (yet)` and exit 5.

use assert_cmd::Command;
use predicates::prelude::*;

/// Each entry: the canonical name printed, then the argv that reaches it.
/// When a command is implemented, delete its rows here.
const UNIMPLEMENTED: &[(&str, &[&str])] = &[
    ("artifacts", &["artifacts"]),
    ("artifacts", &["a"]),
    ("show", &["show", "0000"]),
    ("doctor", &["doctor"]),
    ("index build", &["index", "build"]),
    ("index status", &["index", "status"]),
    ("index clear", &["index", "clear"]),
    ("completion", &["completion", "zsh"]),
];

fn clrg() -> Command {
    let mut cmd = Command::cargo_bin("clrg").expect("the clrg binary is built");
    for var in ["CLRG_ROOTS", "CLRG_INDEX", "CLRG_COLOR", "CLRG_PAGER"] {
        cmd.env_remove(var);
    }
    // No test reads a real root. This one does not exist.
    cmd.args(["--root", "no-such-root"]);
    cmd
}

#[test]
fn n1_unimplemented_commands_say_not_implemented_yet() {
    for (name, argv) in UNIMPLEMENTED {
        clrg()
            .args(*argv)
            .assert()
            .code(5)
            .stdout(predicate::str::is_empty())
            .stderr(predicate::eq(format!(
                "clrg {name}: not implemented (yet)\n"
            )));
    }
}

#[test]
fn version_prints_the_crate_version() {
    clrg()
        .arg("--version")
        .assert()
        .success()
        .stdout(predicate::eq(format!(
            "clrg {}\n",
            env!("CARGO_PKG_VERSION")
        )));
}

#[test]
fn usage_spec_is_printed() {
    clrg()
        .arg("--usage-spec")
        .assert()
        .success()
        .stdout(predicate::str::contains("bin clrg"));
}

#[test]
fn no_command_is_a_usage_error() {
    clrg().assert().code(2);
}
