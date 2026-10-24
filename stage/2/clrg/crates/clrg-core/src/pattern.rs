//! The pattern: literal by default, regex opt-in, smart case (R6, R7).
//!
//! A [`CompiledPattern`] holds three matchers:
//!
//! - `decoded`: the real match. It runs on decoded JSON string values, or on
//!   the text of a non-JSON file line.
//! - `prefilter`: a raw-byte pre-filter for JSON files, run by
//!   `grep-searcher` over the undecoded bytes. Only lines (or files) it
//!   matches are parsed with `serde_json`. It must be *sound*: every line
//!   whose decoded text matches must also pass the pre-filter.
//! - `text`: the line matcher for non-JSON files (plans, file-history).
//!
//! # Pre-filter strategy
//!
//! JSON may write a character in the decoded text as an escape in the raw
//! bytes: `"` as `\"`, `\` as `\\`, control characters as `\n` or `\u0001`,
//! `/` as `\/` (allowed, rarely used), and any non-ASCII character as
//! `\uXXXX` (allowed; Claude Code writes raw UTF-8, but other writers may
//! not). Every other character is written as itself. So for a literal, any
//! run of the pattern free of those characters appears verbatim in the raw
//! bytes of every line whose decoded text contains the pattern. The
//! pre-filter is the longest such run, with the same case rule as the full
//! pattern.
//!
//! Tradeoffs, correctness over speed:
//! - A literal made only of escapable characters (e.g. `"\"`) has no run, so
//!   there is no pre-filter and every JSON line is parsed.
//! - A regex has no pre-filter: extracting required literals soundly from an
//!   arbitrary regex, after JSON escaping, is not worth the risk here. Every
//!   JSON line is parsed. (Literal search is the hot path, R8.)
//! - A short run (e.g. `a` from `a"b`) passes many lines; still correct.
//! - Case-insensitive matching uses Unicode simple case folding, so an ASCII
//!   run can match a non-ASCII character (e.g. `k` and the Kelvin sign). If a
//!   writer escaped that character as `\uXXXX`, the pre-filter misses it.
//!   Claude Code does not escape non-ASCII, so this is accepted.

use grep_matcher::Matcher as _;
use grep_regex::{RegexMatcher, RegexMatcherBuilder};

use crate::Error;

/// How letter case is matched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CaseMode {
    /// Case-insensitive unless the pattern has an uppercase letter (R7).
    #[default]
    Smart,
    /// `-i`: always case-insensitive.
    Insensitive,
    /// `-s`: always case-sensitive.
    Sensitive,
}

/// What the user asked to find.
#[derive(Debug, Clone, Default)]
pub struct Query {
    /// The pattern as typed.
    pub pattern: String,
    /// `-E`: treat the pattern as a regex. Otherwise it is literal.
    pub regex: bool,
    /// The case rule.
    pub case: CaseMode,
}

/// A query compiled into matchers. Cheap to share across threads.
#[derive(Debug, Clone)]
pub struct CompiledPattern {
    decoded: RegexMatcher,
    prefilter: Option<RegexMatcher>,
    text: Option<RegexMatcher>,
    prefilter_text: Option<String>,
    case_insensitive: bool,
}

/// True for a character JSON may write as an escape sequence.
#[must_use]
pub fn json_may_escape(c: char) -> bool {
    c == '"' || c == '\\' || c == '/' || c.is_control() || !c.is_ascii()
}

/// The longest run of `pattern` with no character JSON may escape. Empty
/// when there is none. On a tie, the first run wins.
#[must_use]
pub fn longest_unescaped_run(pattern: &str) -> &str {
    pattern.split(json_may_escape).fold(
        "",
        |best, run| if run.len() > best.len() { run } else { best },
    )
}

/// The smart-case rule for a literal: insensitive unless it has an uppercase
/// letter.
fn literal_is_insensitive(pattern: &str, case: CaseMode) -> bool {
    match case {
        CaseMode::Smart => !pattern.chars().any(char::is_uppercase),
        CaseMode::Insensitive => true,
        CaseMode::Sensitive => false,
    }
}

fn pattern_error(pattern: &str, err: &grep_regex::Error) -> Error {
    Error::Pattern {
        pattern: pattern.to_string(),
        message: err.to_string(),
    }
}

impl CompiledPattern {
    /// Compile `query`.
    ///
    /// # Errors
    /// [`Error::Pattern`] when a regex does not compile.
    pub fn new(query: &Query) -> Result<CompiledPattern, Error> {
        let pattern = query.pattern.as_str();
        let mut builder = RegexMatcherBuilder::new();
        let case_insensitive = if query.regex {
            match query.case {
                CaseMode::Smart => {
                    builder.case_smart(true);
                    // grep-regex decides; mirror its answer for reporting.
                    !pattern.chars().any(char::is_uppercase)
                }
                CaseMode::Insensitive => {
                    builder.case_insensitive(true);
                    true
                }
                CaseMode::Sensitive => false,
            }
        } else {
            let ci = literal_is_insensitive(pattern, query.case);
            builder.fixed_strings(true).case_insensitive(ci);
            ci
        };
        let decoded = builder
            .build(pattern)
            .map_err(|e| pattern_error(pattern, &e))?;

        // The text matcher bans the line terminator, as grep-searcher needs.
        // A pattern that must match a newline cannot match within one line;
        // without a text matcher, text files are scanned line by line.
        // Multi-line CRLF mode lets `^` and `$` match at each line's ends,
        // before a `\r\n` too (a file saved on Windows); the searcher takes
        // its line terminator from this matcher.
        let text = builder
            .clone()
            .multi_line(true)
            .crlf(true)
            .build(pattern)
            .ok();

        let (prefilter, prefilter_text) = if query.regex {
            (None, None)
        } else {
            let run = longest_unescaped_run(pattern);
            if run.is_empty() {
                (None, None)
            } else {
                let m = RegexMatcherBuilder::new()
                    .fixed_strings(true)
                    .case_insensitive(case_insensitive)
                    .line_terminator(Some(b'\n'))
                    .build(run)
                    .map_err(|e| pattern_error(pattern, &e))?;
                (Some(m), Some(run.to_string()))
            }
        };

        Ok(CompiledPattern {
            decoded,
            prefilter,
            text,
            prefilter_text,
            case_insensitive,
        })
    }

    /// The first match in decoded text, as a byte range.
    #[must_use]
    pub fn find(&self, text: &str) -> Option<(usize, usize)> {
        match self.decoded.find(text.as_bytes()) {
            Ok(Some(m)) => Some((m.start(), m.end())),
            _ => None,
        }
    }

    /// The raw-byte pre-filter for JSON files, if there is a sound one.
    #[must_use]
    pub fn prefilter(&self) -> Option<&RegexMatcher> {
        self.prefilter.as_ref()
    }

    /// The literal run the pre-filter looks for, if any.
    #[must_use]
    pub fn prefilter_text(&self) -> Option<&str> {
        self.prefilter_text.as_deref()
    }

    /// The line matcher for non-JSON files, if the pattern can match in a line.
    #[must_use]
    pub fn text_matcher(&self) -> Option<&RegexMatcher> {
        self.text.as_ref()
    }

    /// Whether the effective match is case-insensitive.
    #[must_use]
    pub fn case_insensitive(&self) -> bool {
        self.case_insensitive
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lit(p: &str) -> CompiledPattern {
        CompiledPattern::new(&Query {
            pattern: p.into(),
            ..Query::default()
        })
        .unwrap()
    }

    #[test]
    fn longest_run_skips_escapable_characters() {
        assert_eq!(longest_unescaped_run(r#"say "hi" there"#), " there");
        assert_eq!(longest_unescaped_run(r"C:\temp"), "temp");
        assert_eq!(longest_unescaped_run("café au lait"), " au lait");
        assert_eq!(longest_unescaped_run("a/b"), "a");
        assert_eq!(longest_unescaped_run(r#""\""#), "");
        assert_eq!(longest_unescaped_run("needle"), "needle");
    }

    #[test]
    fn literal_is_literal() {
        let p = lit("a.b");
        assert!(p.find("x a.b y").is_some());
        assert!(p.find("axb").is_none());
    }

    #[test]
    fn smart_case() {
        assert!(lit("needle").find("NEEDLE").is_some());
        assert!(lit("Needle").find("needle").is_none());
        assert!(lit("Needle").find("Needle").is_some());
    }

    #[test]
    fn prefilter_is_sound_for_escaped_text() {
        let p = lit(r#"say "hi""#);
        assert_eq!(p.prefilter_text(), Some("say "));
        let raw = br#"{"text":"I say \"hi\" now"}"#;
        assert!(p.prefilter().unwrap().find(raw).unwrap().is_some());
        assert!(p.find(r#"I say "hi" now"#).is_some());
    }

    #[test]
    fn regex_has_no_prefilter() {
        let p = CompiledPattern::new(&Query {
            pattern: "ne+dle".into(),
            regex: true,
            case: CaseMode::Smart,
        })
        .unwrap();
        assert!(p.prefilter().is_none());
        assert!(p.find("neeedle").is_some());
    }

    #[test]
    fn text_matcher_anchors_work_on_crlf_lines() {
        use grep_searcher::{SearcherBuilder, sinks};
        let p = CompiledPattern::new(&Query {
            pattern: "^a.*needle$".into(),
            regex: true,
            case: CaseMode::Smart,
        })
        .unwrap();
        let m = p.text_matcher().unwrap();
        for text in [
            &b"a line with needle\r\nother\r\n"[..],
            b"a line with needle\nother\n",
        ] {
            let mut lines = 0;
            let mut b = SearcherBuilder::new();
            if let Some(lt) = m.line_terminator() {
                b.line_terminator(lt);
            }
            b.build()
                .search_slice(
                    m,
                    text,
                    sinks::Bytes(|_, _| {
                        lines += 1;
                        Ok(true)
                    }),
                )
                .unwrap();
            assert_eq!(lines, 1, "{text:?}");
        }
        assert!(p.find("a line with needle").is_some());
    }

    #[test]
    fn bad_regex_is_an_error() {
        let err = CompiledPattern::new(&Query {
            pattern: "(".into(),
            regex: true,
            case: CaseMode::Smart,
        });
        assert!(matches!(err, Err(Error::Pattern { .. })));
    }
}
