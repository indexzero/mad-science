//! Selectors: the `select` flagset compiled into a per-message filter.
//!
//! Message-level selectors (branch, branch glob, cwd, project, since/until,
//! model, cli-version, tool, touched) test one transcript message. With
//! `--scope message` (the default) a transcript hit passes when its own
//! message passes, because the branch can change mid-session (g5). With
//! `--scope session` a hit passes when any message of its session passes.
//!
//! Hits outside transcripts (todos, file-history, history, ...) are not
//! transcript messages, so message-level selectors reach them by joining on
//! the session id: such a hit passes when its session has a passing message.
//! A hit with no session fails every message-level selector.

use std::path::{Path, PathBuf};

use globset::{Glob, GlobSet, GlobSetBuilder};

use crate::{Error, MessageMeta, parse_ts};

/// Whether selectors filter messages or whole sessions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Scope {
    /// Only messages that match count.
    #[default]
    Message,
    /// A session matches if any message matches; all its messages count.
    Session,
}

/// The `select` flagset, with times already resolved to unix milliseconds
/// (see [`parse_when`]) and paths already absolute.
#[derive(Debug, Clone)]
pub struct Selectors {
    /// `-b`: exact `gitBranch` (OR'd).
    pub branch: Vec<String>,
    /// `--branch-glob`.
    pub branch_glob: Vec<String>,
    /// `-d`: `cwd` prefix, by whole path components.
    pub cwd: Vec<PathBuf>,
    /// `-p`: glob over the encoded `projects/<dir>` name.
    pub project: Vec<String>,
    /// `--session`: session id prefixes.
    pub session: Vec<String>,
    /// `--since`: at or after, unix ms.
    pub since: Option<i64>,
    /// `--until`: before, unix ms.
    pub until: Option<i64>,
    /// `--model`: glob over `message.model`.
    pub model: Vec<String>,
    /// `--cli-version`: a version range over `version`.
    pub cli_version: Option<String>,
    /// `--tool`: tool names the message calls (exact; OR'd).
    pub tool: Vec<String>,
    /// `--touched`: glob over paths in the message's tool inputs.
    pub touched: Vec<String>,
    /// `--subagents` (default) or `--no-subagents`.
    pub subagents: bool,
    /// `--scope`.
    pub scope: Scope,
}

impl Default for Selectors {
    fn default() -> Self {
        Selectors {
            branch: Vec::new(),
            branch_glob: Vec::new(),
            cwd: Vec::new(),
            project: Vec::new(),
            session: Vec::new(),
            since: None,
            until: None,
            model: Vec::new(),
            cli_version: None,
            tool: Vec::new(),
            touched: Vec::new(),
            subagents: true,
            scope: Scope::Message,
        }
    }
}

/// Compiled selectors.
#[derive(Debug, Clone)]
pub struct Filter {
    sel: Selectors,
    branch_glob: Option<GlobSet>,
    project: Option<GlobSet>,
    model: Option<GlobSet>,
    touched: Option<GlobSet>,
    version: Option<VersionRange>,
}

pub(crate) fn globs(flag: &'static str, pats: &[String]) -> Result<Option<GlobSet>, Error> {
    if pats.is_empty() {
        return Ok(None);
    }
    let mut b = GlobSetBuilder::new();
    for p in pats {
        b.add(Glob::new(p).map_err(|e| Error::Selector {
            flag,
            value: p.clone(),
            message: e.kind().to_string(),
        })?);
    }
    b.build().map(Some).map_err(|e| Error::Selector {
        flag,
        value: pats.join(","),
        message: e.to_string(),
    })
}

fn any_glob(set: Option<&GlobSet>, value: Option<&str>) -> bool {
    set.is_none_or(|s| value.is_some_and(|v| s.is_match(v)))
}

impl Filter {
    /// Compile `sel`.
    ///
    /// # Errors
    /// [`Error::Selector`] for a bad glob or version range.
    pub fn new(sel: &Selectors) -> Result<Filter, Error> {
        Ok(Filter {
            branch_glob: globs("--branch-glob", &sel.branch_glob)?,
            project: globs("--project", &sel.project)?,
            model: globs("--model", &sel.model)?,
            touched: globs("--touched", &sel.touched)?,
            version: sel
                .cli_version
                .as_deref()
                .map(VersionRange::parse)
                .transpose()?,
            sel: sel.clone(),
        })
    }

    /// The selectors this filter was built from.
    #[must_use]
    pub fn selectors(&self) -> &Selectors {
        &self.sel
    }

    /// True when any selector tests message metadata (anything but
    /// `--session`, `--subagents`, and `--scope`).
    #[must_use]
    pub fn has_message_selectors(&self) -> bool {
        let s = &self.sel;
        !(s.branch.is_empty()
            && s.branch_glob.is_empty()
            && s.cwd.is_empty()
            && s.project.is_empty()
            && s.since.is_none()
            && s.until.is_none()
            && s.model.is_empty()
            && s.cli_version.is_none()
            && s.tool.is_empty()
            && s.touched.is_empty())
    }

    /// `--session`: the session id starts with one of the prefixes.
    #[must_use]
    pub fn session_ok(&self, session: Option<&str>) -> bool {
        self.sel.session.is_empty()
            || session.is_some_and(|id| self.sel.session.iter().any(|p| id.starts_with(p.as_str())))
    }

    /// Every message-level selector passes for `m`.
    #[must_use]
    pub fn message_ok(&self, m: &MessageMeta) -> bool {
        let s = &self.sel;
        let branch = m.branch.as_deref();
        let branch_ok = if s.branch.is_empty() && self.branch_glob.is_none() {
            true
        } else {
            branch.is_some_and(|b| {
                s.branch.iter().any(|x| x == b)
                    || self.branch_glob.as_ref().is_some_and(|g| g.is_match(b))
            })
        };
        branch_ok
            && (s.cwd.is_empty()
                || m.cwd
                    .as_deref()
                    .is_some_and(|c| s.cwd.iter().any(|p| Path::new(c).starts_with(p))))
            && any_glob(self.project.as_ref(), m.project.as_deref())
            && s.since.is_none_or(|t| m.ts.is_some_and(|ts| ts >= t))
            && s.until.is_none_or(|t| m.ts.is_some_and(|ts| ts < t))
            && any_glob(self.model.as_ref(), m.model.as_deref())
            && self
                .version
                .as_ref()
                .is_none_or(|r| m.version.as_deref().is_some_and(|v| r.matches(v)))
            && (s.tool.is_empty() || m.tools.iter().any(|t| s.tool.contains(t)))
            && self
                .touched
                .as_ref()
                .is_none_or(|g| m.touched.iter().any(|p| g.is_match(p)))
    }
}

/// Parse a `--since`/`--until` value to unix milliseconds. Accepts RFC 3339,
/// `YYYY-MM-DD` and `YYYY-MM-DDTHH:MM[:SS]` (read as UTC), and relative
/// durations before `now_ms`: `90s`, `30m`, `6h`, `30d`, `2w`.
///
/// # Errors
/// [`Error::Selector`] when the value is none of these.
pub fn parse_when(flag: &'static str, value: &str, now_ms: i64) -> Result<i64, Error> {
    let err = || Error::Selector {
        flag,
        value: value.to_string(),
        message: "expected an ISO-8601 date/time (UTC) or a duration like 30d, 6h".into(),
    };
    let v = value.trim();
    if let Some(ms) = parse_ts(v) {
        return Ok(ms);
    }
    let with_time = if v.len() == 10 {
        format!("{v}T00:00:00Z")
    } else if v.len() == 16 {
        format!("{v}:00Z")
    } else {
        format!("{v}Z")
    };
    if let Some(ms) = parse_ts(&with_time) {
        return Ok(ms);
    }
    let unit_at = v.find(|c: char| !c.is_ascii_digit()).ok_or_else(err)?;
    let (num, unit) = v.split_at(unit_at);
    let n: i64 = num.parse().map_err(|_| err())?;
    let secs = match unit {
        "s" => 1,
        "m" => 60,
        "h" => 3600,
        "d" => 86_400,
        "w" => 604_800,
        _ => return Err(err()),
    };
    Ok(now_ms - n.saturating_mul(secs).saturating_mul(1000))
}

/// A version: up to three numeric components; a pre-release tag is ignored.
fn parse_version(s: &str) -> Option<Vec<u64>> {
    let core = s.trim().trim_start_matches('v');
    let core = core.split(['-', '+']).next()?;
    let parts: Option<Vec<u64>> = core.split('.').map(|p| p.parse().ok()).collect();
    parts.filter(|p| !p.is_empty() && p.len() <= 3)
}

fn padded(v: &[u64]) -> [u64; 3] {
    [
        v.first().copied().unwrap_or(0),
        v.get(1).copied().unwrap_or(0),
        v.get(2).copied().unwrap_or(0),
    ]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Op {
    Ge,
    Gt,
    Le,
    Lt,
    Eq,
}

/// A conjunction of comparators, e.g. `>=1.0.40 <2`. Also `^1.2`, `~1.2.3`,
/// and a bare or `=` version, which matches every version it is a prefix
/// of (`1.0` matches `1.0.7`).
#[derive(Debug, Clone, PartialEq, Eq)]
struct VersionRange(Vec<(Op, [u64; 3], usize)>);

impl VersionRange {
    fn parse(range: &str) -> Result<VersionRange, Error> {
        let err = |msg: &str| Error::Selector {
            flag: "--cli-version",
            value: range.to_string(),
            message: msg.to_string(),
        };
        let mut out = Vec::new();
        for tok in range.split([',', ' ']).filter(|t| !t.is_empty()) {
            let (op, rest) = [">=", "<=", ">", "<", "=", "^", "~"]
                .iter()
                .find_map(|op| tok.strip_prefix(op).map(|r| (*op, r)))
                .unwrap_or(("", tok));
            let parsed =
                parse_version(rest).ok_or_else(|| err("expected a version like 1.0.40"))?;
            let p = padded(&parsed);
            let n = parsed.len();
            match op {
                ">=" => out.push((Op::Ge, p, 3)),
                ">" => out.push((Op::Gt, p, 3)),
                "<=" => out.push((Op::Le, p, 3)),
                "<" => out.push((Op::Lt, p, 3)),
                "^" => {
                    let upper = match p {
                        [0, 0, z] if n == 3 => [0, 0, z + 1],
                        [0, y, _] if n >= 2 => [0, y + 1, 0],
                        [x, _, _] => [x + 1, 0, 0],
                    };
                    out.push((Op::Ge, p, 3));
                    out.push((Op::Lt, upper, 3));
                }
                "~" => {
                    let upper = if n >= 2 {
                        [p[0], p[1] + 1, 0]
                    } else {
                        [p[0] + 1, 0, 0]
                    };
                    out.push((Op::Ge, p, 3));
                    out.push((Op::Lt, upper, 3));
                }
                _ => out.push((Op::Eq, p, n)),
            }
        }
        if out.is_empty() {
            return Err(err("empty range"));
        }
        Ok(VersionRange(out))
    }

    fn matches(&self, version: &str) -> bool {
        let Some(v) = parse_version(version) else {
            return false;
        };
        let v = padded(&v);
        self.0.iter().all(|(op, p, n)| match op {
            Op::Ge => v >= *p,
            Op::Gt => v > *p,
            Op::Le => v <= *p,
            Op::Lt => v < *p,
            Op::Eq => v[..*n] == p[..*n],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(branch: &str, cwd: &str) -> MessageMeta {
        MessageMeta {
            branch: Some(branch.into()),
            cwd: Some(cwd.into()),
            ..MessageMeta::default()
        }
    }

    #[test]
    fn branch_exact_and_glob() {
        let f = Filter::new(&Selectors {
            branch: vec!["main".into()],
            branch_glob: vec!["onboarding.*".into()],
            ..Selectors::default()
        })
        .unwrap();
        assert!(f.message_ok(&meta("main", "/w")));
        assert!(f.message_ok(&meta("onboarding.gonzo", "/w")));
        assert!(!f.message_ok(&meta("mainline", "/w")));
        assert!(!f.message_ok(&MessageMeta::default()));
    }

    #[test]
    fn cwd_is_a_component_prefix() {
        let f = Filter::new(&Selectors {
            cwd: vec!["/w/app".into()],
            ..Selectors::default()
        })
        .unwrap();
        assert!(f.message_ok(&meta("x", "/w/app")));
        assert!(f.message_ok(&meta("x", "/w/app/sub")));
        assert!(!f.message_ok(&meta("x", "/w/application")));
    }

    #[test]
    fn session_prefix() {
        let f = Filter::new(&Selectors {
            session: vec!["abc".into()],
            ..Selectors::default()
        })
        .unwrap();
        assert!(f.session_ok(Some("abcdef")));
        assert!(!f.session_ok(Some("xabc")));
        assert!(!f.session_ok(None));
    }

    #[test]
    fn when_values() {
        let day = parse_when("--since", "2026-08-02", 0).unwrap();
        assert_eq!(Some(day), parse_ts("2026-08-02T00:00:00Z"));
        assert_eq!(
            parse_when("--since", "2d", 200_000_000).unwrap(),
            200_000_000 - 172_800_000
        );
        assert!(parse_when("--since", "yesterday", 0).is_err());
    }

    #[test]
    fn version_ranges() {
        let r = VersionRange::parse(">=1.0.40, <2").unwrap();
        assert!(r.matches("1.0.40"));
        assert!(r.matches("1.9.0"));
        assert!(!r.matches("1.0.39"));
        assert!(!r.matches("2.0.0"));
        assert!(VersionRange::parse("1.0").unwrap().matches("1.0.7"));
        assert!(!VersionRange::parse("1.0").unwrap().matches("1.1.0"));
        assert!(VersionRange::parse("^1.2").unwrap().matches("1.9.9"));
        assert!(!VersionRange::parse("~1.2.3").unwrap().matches("1.3.0"));
        assert!(VersionRange::parse("abc").is_err());
    }
}
