//! Human output for `clrg grep` (and the drawing helpers `sessions` and
//! `facets` share): one block per session (R2), the match in
//! the middle of a one-line excerpt (R1), sized to the terminal.
//!
//! ```text
//! 2026-08-02 14:31  ~/src/app  [onboarding.gonzo]  3f2a9c1e  (cwd missing)
//!   last: "wire the seed data into the onboarding flow and…"
//!         "Your response above was stopped by…" (not in history)
//!   14:02 user/text            …can you move the seed data into a fixture so the…
//!   14:09 assistant/tool_use   …Write fixtures/seed.json …
//!   14:10 user/text (not in history)  …Your response above was stopped by…
//! ```
//!
//! Each hit is labelled with its raw line type and part type (R9). The
//! `last:` line and the `(not in history)` / `(unverified)` markers come from
//! the session's agreement with `history.jsonl` (R10).

use std::io::{self, Write};
use std::path::{Path, PathBuf};

use anstyle::{AnsiColor, Style};
use clrg_core::agree::LastStatus;
use clrg_core::{Agreement, Group, StoreKind};
use time::{OffsetDateTime, UtcOffset};

use crate::grep::{Item, Row};

/// Width of the label column (`assistant/tool_use` and a space or two).
const PART: usize = 20;
/// Columns before a hit's excerpt: `  HH:MM <part> `.
const HIT_PREFIX: usize = 2 + 5 + 1 + PART + 1;
/// Columns before a context message's text.
const CONTEXT_PREFIX: usize = HIT_PREFIX + 2;
/// The narrowest excerpt, however narrow the terminal.
const MIN_EXCERPT: usize = 20;

/// How to draw.
pub struct Look<'a> {
    /// Use color (only when asked for and stdout is a terminal).
    pub color: bool,
    /// Terminal columns.
    pub width: usize,
    /// The home folder, for `~`.
    pub home: Option<&'a Path>,
    /// The local time offset.
    pub offset: UtcOffset,
    /// The roots; named in headers when there is more than one.
    pub roots: &'a [PathBuf],
}

const MATCH: Style = Style::new()
    .bold()
    .fg_color(Some(anstyle::Color::Ansi(AnsiColor::Red)));
pub const CWD: Style = Style::new().bold();
pub const MISSING: Style = Style::new().fg_color(Some(anstyle::Color::Ansi(AnsiColor::Yellow)));
pub const DIM: Style = Style::new().dimmed();

impl Look<'_> {
    fn time(&self, ms: i64) -> Option<OffsetDateTime> {
        let t = OffsetDateTime::from_unix_timestamp_nanos(i128::from(ms) * 1_000_000).ok()?;
        Some(t.to_offset(self.offset))
    }

    fn hhmm(&self, ms: Option<i64>) -> String {
        ms.and_then(|ms| self.time(ms)).map_or_else(
            || "     ".to_string(),
            |t| format!("{:02}:{:02}", t.hour(), t.minute()),
        )
    }

    /// `YYYY-MM-DD HH:MM` in local time.
    pub fn date_time(&self, ms: i64) -> Option<String> {
        let t = self.time(ms)?;
        Some(format!(
            "{:04}-{:02}-{:02} {:02}:{:02}",
            t.year(),
            u8::from(t.month()),
            t.day(),
            t.hour(),
            t.minute()
        ))
    }

    /// `YYYY-MM-DD` in local time.
    pub fn date(&self, ms: i64) -> Option<String> {
        let t = self.time(ms)?;
        Some(format!(
            "{:04}-{:02}-{:02}",
            t.year(),
            u8::from(t.month()),
            t.day()
        ))
    }

    /// Paint `s` in `style` when color is on.
    pub fn paint(&self, style: Style, s: &str) -> String {
        if self.color && !s.is_empty() {
            format!("{}{s}{}", style.render(), style.render_reset())
        } else {
            s.to_string()
        }
    }

    /// `path` with the home folder shown as `~`, made safe to print.
    pub fn tilde(&self, path: &str) -> String {
        let p = Path::new(path);
        let shown = match self.home.and_then(|h| p.strip_prefix(h).ok()) {
            Some(rest) if rest.as_os_str().is_empty() => "~".to_string(),
            Some(rest) => format!("~/{}", rest.display()),
            None => path.to_string(),
        };
        clean(&shown)
    }
}

/// Control characters become spaces and whitespace runs one space, so data
/// can never move the cursor or break the one-line layout.
pub fn clean(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut space = false;
    for c in s.chars() {
        if c.is_whitespace() || c.is_control() {
            if !space {
                out.push(' ');
            }
            space = true;
        } else {
            out.push(c);
            space = false;
        }
    }
    out
}

/// The short form of a session id: its first 8 chars, made safe to print.
/// (An id is untrusted data: it may be short or not ASCII.)
pub fn short_id(sid: &str) -> String {
    clean(take(sid, 8).0)
}

/// The first `n` chars of `s`, and whether anything was cut.
fn take(s: &str, n: usize) -> (&str, bool) {
    match s.char_indices().nth(n) {
        Some((i, _)) => (&s[..i], true),
        None => (s, false),
    }
}

/// The last `n` chars of `s`, and whether anything was cut.
fn take_last(s: &str, n: usize) -> (&str, bool) {
    if n == 0 {
        return ("", !s.is_empty());
    }
    match s.char_indices().rev().nth(n - 1) {
        Some((i, _)) => (&s[i..], i > 0),
        None => (s, false),
    }
}

/// Fit `before`, `matched`, `after` into `width` chars with the match in the
/// middle (R1). Returns the left side (with any `…`), the match, and the
/// right side. `cut_left`/`cut_right` say the text goes on past the pieces.
pub fn fit(
    before: &str,
    matched: &str,
    after: &str,
    cut_left: bool,
    cut_right: bool,
    width: usize,
) -> (String, String, String) {
    // Two columns are kept for the ellipses.
    let avail = width.saturating_sub(2).max(1);
    let m_len = matched.chars().count();
    if m_len >= avail {
        let (m, _) = take(matched, avail);
        let left = if before.is_empty() && !cut_left {
            ""
        } else {
            "…"
        };
        return (left.into(), m.into(), "…".into());
    }
    let room = avail - m_len;
    let (b_len, a_len) = (before.chars().count(), after.chars().count());
    let mut left = (room / 2).min(b_len);
    let right = (room - left).min(a_len);
    left = (room - right).min(b_len);
    let (l, l_cut) = take_last(before, left);
    let (r, r_cut) = take(after, right);
    let lead = if l_cut || cut_left { "…" } else { "" };
    let tail = if r_cut || cut_right { "…" } else { "" };
    (format!("{lead}{l}"), matched.into(), format!("{r}{tail}"))
}

/// Shorten `s` to `width` chars, ending in `…` when cut.
pub fn shorten(s: &str, width: usize) -> String {
    let (head, cut) = take(s, width.saturating_sub(1).max(1));
    if cut || s.chars().count() > width {
        format!("{head}…")
    } else {
        s.to_string()
    }
}

/// A hit's label: its raw `type/part`, or whichever of the two it has, or
/// else its store. A `user/text` line that is `transcript-only` is marked
/// `(not in history)`.
pub fn label(
    kind: Option<&str>,
    part: Option<&str>,
    store: StoreKind,
    agreement: Option<Agreement>,
) -> String {
    let mut s = match (kind, part) {
        (Some(k), Some(p)) => format!("{k}/{p}"),
        (Some(one), None) | (None, Some(one)) => one.to_string(),
        (None, None) => store.as_str().to_string(),
    };
    if kind == Some("user") && part == Some("text") && agreement == Some(Agreement::TranscriptOnly)
    {
        s.push_str(" (not in history)");
    }
    clean(&s)
}

/// `label` padded to the column; a longer one gets two spaces after it.
fn pad(label: &str) -> String {
    let n = label.chars().count();
    if n >= PART {
        format!("{label}  ")
    } else {
        format!("{label:<PART$} ")
    }
}

/// Print `rows` grouped into blocks, in the order each block first appears.
pub fn human(
    out: &mut impl Write,
    groups: &[Group],
    rows: &[Row<'_>],
    look: &Look<'_>,
) -> io::Result<()> {
    let mut order: Vec<usize> = Vec::new();
    let mut buckets: Vec<Vec<&Row<'_>>> = vec![Vec::new(); groups.len()];
    for r in rows {
        if buckets[r.group].is_empty() {
            order.push(r.group);
        }
        buckets[r.group].push(r);
    }
    for (n, &gi) in order.iter().enumerate() {
        if n > 0 {
            writeln!(out)?;
        }
        header(out, &groups[gi], look)?;
        for r in &buckets[gi] {
            match &r.item {
                Item::Hit(h) => {
                    let label = pad(&label(
                        h.kind.as_deref(),
                        h.part.as_deref(),
                        h.store,
                        h.agreement,
                    ));
                    let before = clean(&h.excerpt[..h.match_start]);
                    let matched = clean(&h.excerpt[h.match_start..h.match_end]);
                    let after = clean(&h.excerpt[h.match_end..]);
                    let used = HIT_PREFIX - PART - 1 + label.chars().count();
                    let width = look.width.saturating_sub(used).max(MIN_EXCERPT);
                    let (l, m, r) = fit(&before, &matched, &after, h.cut_left, h.cut_right, width);
                    writeln!(
                        out,
                        "  {} {label}{l}{}{r}",
                        look.hhmm(h.meta.ts),
                        look.paint(MATCH, &m)
                    )?;
                }
                Item::Context { path, msg } => {
                    let mark = crate::records::context_mark(&groups[gi], path, msg);
                    let label = pad(&label(
                        msg.kind.as_deref(),
                        msg.part.as_deref(),
                        StoreKind::Transcripts,
                        mark.map(|m| m.0),
                    ));
                    let used = CONTEXT_PREFIX - PART - 1 + label.chars().count();
                    let width = look.width.saturating_sub(used).max(MIN_EXCERPT);
                    let line = format!(
                        "    {} {label}{}",
                        look.hhmm(msg.meta.ts),
                        shorten(&clean(&msg.text), width)
                    );
                    writeln!(out, "{}", look.paint(DIM, &line))?;
                }
            }
        }
    }
    Ok(())
}

fn header(out: &mut impl Write, g: &Group, look: &Look<'_>) -> io::Result<()> {
    let mut parts: Vec<String> = Vec::new();
    if let Some(ts) = g.last_ts.and_then(|ms| look.date_time(ms)) {
        parts.push(ts);
    }
    if let Some(sid) = &g.session {
        parts.push(match &g.cwd {
            Some(c) => look.paint(CWD, &look.tilde(c)),
            None => "(no cwd)".into(),
        });
        if !g.branches.is_empty() {
            parts.push(format!("[{}]", clean(&g.branches.join(", "))));
        }
        parts.push(short_id(sid));
        if g.cwd_exists == Some(false) {
            parts.push(look.paint(MISSING, "(cwd missing)"));
        }
    } else {
        parts.push(g.store.as_str().into());
        let path = g
            .path
            .as_deref()
            .map_or_else(String::new, |p| p.to_string_lossy().into_owned());
        parts.push(look.tilde(&path));
    }
    if look.roots.len() > 1 {
        parts.push(format!(
            "(root {})",
            look.tilde(&look.roots[g.root].to_string_lossy())
        ));
    }
    writeln!(out, "{}", parts.join("  "))?;
    if g.info.is_some()
        && let Some(last) = g.agreement.as_ref().and_then(|a| a.last.as_ref())
    {
        let marker = match last.status {
            LastStatus::Agreed => "",
            LastStatus::Unverified => " (unverified)",
            LastStatus::NotInHistory => NOT_IN_HISTORY,
        };
        writeln!(out, "  last: {}", quoted(&last.text, marker, look))?;
        if let Some(later) = &last.later {
            writeln!(out, "        {}", quoted(later, NOT_IN_HISTORY, look))?;
        }
    }
    Ok(())
}

const NOT_IN_HISTORY: &str = " (not in history)";

/// `"text"` shortened to fit after the 8-column `  last: ` indent, then
/// `marker` (dimmed).
fn quoted(text: &str, marker: &str, look: &Look<'_>) -> String {
    let width = look
        .width
        .saturating_sub(10 + marker.len())
        .max(MIN_EXCERPT);
    format!(
        "\"{}\"{}",
        shorten(clean(text).trim(), width),
        look.paint(MISSING, marker)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn joined(t: &(String, String, String)) -> String {
        format!("{}{}{}", t.0, t.1, t.2)
    }

    #[test]
    fn the_match_sits_in_the_middle() {
        let before = "a".repeat(200);
        let after = "b".repeat(200);
        let t = fit(&before, "NEEDLE", &after, false, false, 40);
        assert_eq!(joined(&t).chars().count(), 40);
        let left = t.0.chars().count();
        let right = t.2.chars().count();
        assert!(left.abs_diff(right) <= 1, "{t:?}");
        assert!(t.0.starts_with('…') && t.2.ends_with('…'));
    }

    #[test]
    fn short_sides_give_room_to_the_other() {
        let t = fit("ab ", "NEEDLE", &"z".repeat(100), false, false, 30);
        assert_eq!(t.0, "ab ", "nothing cut on the left, no ellipsis");
        assert_eq!(t.2.chars().count(), 30 - 2 - 3 - 6 + 1);
        assert!(t.2.ends_with('…'));
        // The text went on past the excerpt: say so.
        let t = fit("ab ", "NEEDLE", " cd", true, true, 30);
        assert_eq!(joined(&t), "…ab NEEDLE cd…");
        let t = fit("", "NEEDLE", "", false, false, 30);
        assert_eq!(joined(&t), "NEEDLE");
    }

    #[test]
    fn a_long_match_is_cut_at_the_width() {
        let t = fit("x", &"m".repeat(50), "y", false, false, 12);
        assert_eq!(joined(&t), format!("…{}…", "m".repeat(10)));
    }

    #[test]
    fn multibyte_text_is_cut_on_char_boundaries() {
        let t = fit(&"é".repeat(50), "ü", &"ø".repeat(50), false, false, 21);
        assert_eq!(joined(&t).chars().count(), 21);
    }

    #[test]
    fn short_id_cuts_on_chars() {
        assert_eq!(short_id("aéééé"), "aéééé");
        assert_eq!(short_id("éééééééééé"), "éééééééé");
        assert_eq!(short_id("s1"), "s1");
        assert_eq!(short_id(""), "");
    }

    #[test]
    fn clean_flattens_controls() {
        assert_eq!(clean("a\x1b[31m\n\t b"), "a [31m b");
    }
}
