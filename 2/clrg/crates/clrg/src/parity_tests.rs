//! Spec/clap parity (INTENT.md "Parity rule"): every command, alias, flag
//! (long and short), and argument in `clrg-cli.kdl` exists in clap, and every
//! one in clap exists in the spec. Choices, defaults, env bindings, help text,
//! and the var/count/hide/global/required bits are compared too.
//!
//! The spec is read through `usage generate json`, so the `usage` binary must
//! be on PATH. Without it the test prints why and skips; check.sh requires it.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::process::Command as Process;

use clap::{Arg, ArgAction, Command, CommandFactory as _};
use serde_json::Value;

use crate::cli::Cli;

fn spec_json() -> Option<Value> {
    let spec = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../clrg-cli.kdl");
    let out = match Process::new("usage")
        .args(["generate", "json", "-f"])
        .arg(&spec)
        .output()
    {
        Ok(out) => out,
        Err(err) => {
            eprintln!("SKIP spec/clap parity: `usage` is not on PATH ({err})");
            return None;
        }
    };
    assert!(
        out.status.success(),
        "usage generate json failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    Some(serde_json::from_slice(&out.stdout).expect("usage generate json printed JSON"))
}

fn strs(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn opt_str(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn flag_bool(v: &Value, key: &str) -> bool {
    v.get(key).and_then(Value::as_bool).unwrap_or(false)
}

/// The expected clap `long_help`: the short help, a blank line, the spec text.
fn expected_long(help: Option<&String>, long: Option<String>) -> Option<String> {
    long.map(|l| match help {
        Some(h) => format!("{h}\n\n{l}"),
        None => l,
    })
}

fn clap_key(arg: &Arg) -> String {
    arg.get_long()
        .map(str::to_owned)
        .or_else(|| arg.get_short().map(String::from))
        .unwrap_or_else(|| arg.get_id().to_string())
}

fn choices(arg: &Arg) -> Vec<String> {
    arg.get_possible_values()
        .iter()
        .map(|p| p.get_name().to_owned())
        .collect()
}

fn defaults(arg: &Arg) -> Vec<String> {
    arg.get_default_values()
        .iter()
        .map(|d| d.to_string_lossy().into_owned())
        .collect()
}

#[allow(clippy::needless_pass_by_value)] // call sites build both sides inline
fn check_eq<T: PartialEq + std::fmt::Debug>(
    errs: &mut Vec<String>,
    at: &str,
    what: &str,
    spec: T,
    clap: T,
) {
    if spec != clap {
        errs.push(format!("{at}: {what} differs: spec={spec:?} clap={clap:?}"));
    }
}

fn check_flag(errs: &mut Vec<String>, at: &str, f: &Value, arg: &Arg) {
    let takes_value = f.get("arg").is_some();
    check_eq(
        errs,
        at,
        "short",
        strs(&f["short"]),
        arg.get_short().map(String::from).into_iter().collect(),
    );
    check_eq(
        errs,
        at,
        "long",
        strs(&f["long"]),
        arg.get_long().map(str::to_owned).into_iter().collect(),
    );
    check_eq(
        errs,
        at,
        "takes a value",
        takes_value,
        arg.get_action().takes_values(),
    );
    check_eq(
        errs,
        at,
        "var",
        flag_bool(f, "var"),
        matches!(arg.get_action(), ArgAction::Append),
    );
    check_eq(
        errs,
        at,
        "count",
        flag_bool(f, "count"),
        matches!(arg.get_action(), ArgAction::Count),
    );
    check_eq(errs, at, "hide", flag_bool(f, "hide"), arg.is_hide_set());
    check_eq(
        errs,
        at,
        "global",
        flag_bool(f, "global"),
        arg.is_global_set(),
    );
    check_eq(
        errs,
        at,
        "required",
        flag_bool(f, "required"),
        arg.is_required_set(),
    );
    check_eq(
        errs,
        at,
        "env",
        opt_str(f, "env"),
        arg.get_env().map(|e| e.to_string_lossy().into_owned()),
    );
    let help = opt_str(f, "help");
    check_eq(
        errs,
        at,
        "help",
        help.clone(),
        arg.get_help().map(ToString::to_string),
    );
    check_eq(
        errs,
        at,
        "long_help",
        expected_long(help.as_ref(), opt_str(f, "help_long")),
        arg.get_long_help().map(ToString::to_string),
    );
    let spec_default = strs(&f["default"]);
    if takes_value || !spec_default.is_empty() {
        check_eq(errs, at, "default", spec_default, defaults(arg));
    }
    if takes_value {
        let a = &f["arg"];
        check_eq(
            errs,
            at,
            "value name",
            opt_str(a, "name"),
            arg.get_value_names()
                .and_then(|v| v.first())
                .map(ToString::to_string),
        );
        check_eq(
            errs,
            at,
            "choices",
            strs(&a["choices"]["choices"]),
            choices(arg),
        );
    }
}

fn check_positional(errs: &mut Vec<String>, at: &str, a: &Value, arg: &Arg) {
    check_eq(
        errs,
        at,
        "required",
        flag_bool(a, "required"),
        arg.is_required_set(),
    );
    check_eq(
        errs,
        at,
        "help",
        opt_str(a, "help"),
        arg.get_help().map(ToString::to_string),
    );
    check_eq(
        errs,
        at,
        "choices",
        strs(&a["choices"]["choices"]),
        choices(arg),
    );
    check_eq(errs, at, "default", strs(&a["default"]), defaults(arg));
}

fn check_flags(errs: &mut Vec<String>, path: &str, spec: &Value, cmd: &Command) {
    // Flags, keyed by their first long (or short) name. A spec `negate`
    // becomes its own clap flag.
    let mut spec_flags: BTreeMap<String, &Value> = BTreeMap::new();
    let mut negates: BTreeSet<String> = BTreeSet::new();
    for f in spec["flags"].as_array().into_iter().flatten() {
        let key = strs(&f["long"])
            .into_iter()
            .next()
            .or_else(|| strs(&f["short"]).into_iter().next());
        spec_flags.insert(key.expect("flag has a name"), f);
        if let Some(n) = opt_str(f, "negate") {
            negates.insert(n.trim_start_matches("--").to_owned());
        }
    }
    let mut clap_flags: BTreeMap<String, &Arg> = BTreeMap::new();
    for a in cmd.get_arguments().filter(|a| !a.is_positional()) {
        clap_flags.insert(clap_key(a), a);
    }
    for (key, f) in &spec_flags {
        match clap_flags.get(key) {
            Some(arg) => check_flag(errs, &format!("{path} --{key}"), f, arg),
            None => errs.push(format!("{path}: flag {key} is in the spec but not in clap")),
        }
    }
    for n in &negates {
        if !clap_flags.contains_key(n) {
            errs.push(format!(
                "{path}: negate --{n} is in the spec but not in clap"
            ));
        }
    }
    for key in clap_flags.keys() {
        if !spec_flags.contains_key(key) && !negates.contains(key) {
            errs.push(format!("{path}: flag {key} is in clap but not in the spec"));
        }
    }
}

fn check_command(errs: &mut Vec<String>, path: &str, spec: &Value, cmd: &Command) {
    // Commands and aliases.
    let mut aliases = strs(&spec["aliases"]);
    aliases.extend(strs(&spec["hidden_aliases"]));
    aliases.sort();
    let mut clap_aliases: Vec<String> = cmd.get_all_aliases().map(str::to_owned).collect();
    clap_aliases.sort();
    check_eq(errs, path, "aliases", aliases, clap_aliases);
    check_eq(
        errs,
        path,
        "hide",
        flag_bool(spec, "hide"),
        cmd.is_hide_set(),
    );
    check_eq(
        errs,
        path,
        "subcommand_required",
        flag_bool(spec, "subcommand_required"),
        cmd.is_subcommand_required_set(),
    );
    check_eq(
        errs,
        path,
        "after_long_help",
        opt_str(spec, "after_help_long"),
        cmd.get_after_long_help().map(ToString::to_string),
    );
    if path != "clrg" {
        check_eq(
            errs,
            path,
            "help",
            opt_str(spec, "help"),
            cmd.get_about().map(ToString::to_string),
        );
    }

    check_flags(errs, path, spec, cmd);

    // Positional arguments, in order.
    let spec_args: Vec<&Value> = spec["args"].as_array().into_iter().flatten().collect();
    let clap_args: Vec<&Arg> = cmd.get_positionals().collect();
    let names = |v: &[&Value]| {
        v.iter()
            .filter_map(|a| opt_str(a, "name"))
            .collect::<Vec<_>>()
    };
    let clap_names: Vec<String> = clap_args
        .iter()
        .map(|a| {
            a.get_value_names()
                .and_then(|v| v.first())
                .map_or_else(|| a.get_id().to_string(), ToString::to_string)
        })
        .collect();
    check_eq(errs, path, "args", names(&spec_args), clap_names);
    for (s, c) in spec_args.iter().zip(&clap_args) {
        check_positional(errs, &format!("{path} <{}>", c.get_id()), s, c);
    }

    // Subcommands, recursively.
    let spec_subs: BTreeMap<String, &Value> = spec["subcommands"]
        .as_object()
        .map(|m| m.iter().map(|(k, v)| (k.clone(), v)).collect())
        .unwrap_or_default();
    let clap_subs: BTreeMap<String, &Command> = cmd
        .get_subcommands()
        .map(|c| (c.get_name().to_owned(), c))
        .collect();
    check_eq(
        errs,
        path,
        "subcommands",
        spec_subs.keys().collect::<Vec<_>>(),
        clap_subs.keys().collect::<Vec<_>>(),
    );
    for (name, s) in &spec_subs {
        if let Some(c) = clap_subs.get(name) {
            check_command(errs, &format!("{path} {name}"), s, c);
        }
    }
}

#[test]
fn spec_and_clap_have_the_same_surface() {
    let Some(spec) = spec_json() else { return };
    let cmd = Cli::command();
    let mut errs = Vec::new();
    check_eq(
        &mut errs,
        "clrg",
        "bin",
        opt_str(&spec, "bin"),
        Some(cmd.get_name().to_owned()),
    );
    check_eq(
        &mut errs,
        "clrg",
        "version",
        opt_str(&spec, "version"),
        cmd.get_version().map(str::to_owned),
    );
    check_eq(
        &mut errs,
        "clrg",
        "about",
        opt_str(&spec, "about"),
        cmd.get_about().map(ToString::to_string),
    );
    check_eq(
        &mut errs,
        "clrg",
        "long_about",
        opt_str(&spec, "about_long"),
        cmd.get_long_about().map(ToString::to_string),
    );
    check_command(&mut errs, "clrg", &spec["cmd"], &cmd);
    assert!(
        errs.is_empty(),
        "spec/clap parity failed:\n  {}",
        errs.join("\n  ")
    );
}

#[test]
fn clap_command_is_well_formed() {
    Cli::command().debug_assert();
}
