//! A small reader for the structure of one JSON value in raw bytes.
//!
//! A session header (R2) needs a few top-level string fields of every
//! transcript line, and the text of `user` lines only (R10). Most of a
//! transcript's bytes are tool output inside `message` and `toolUseResult`.
//! This reader finds members and elements by matching quotes and brackets
//! (`memchr` jumps from quote to quote), so the bytes it skips are never
//! decoded, built into values, or validated. Only the strings asked for are
//! decoded, by `serde_json` when they hold escapes.

use std::borrow::Cow;

use memchr::memchr;

fn ws(b: &[u8], mut i: usize) -> usize {
    while i < b.len() && matches!(b[i], b' ' | b'\t' | b'\n' | b'\r') {
        i += 1;
    }
    i
}

/// The index just past the string that opens at `i`: the next `"` that is
/// not escaped (preceded by an even number of backslashes).
fn string_end(b: &[u8], i: usize) -> Option<usize> {
    let mut j = i + 1;
    loop {
        let k = j + memchr(b'"', b.get(j..)?)?;
        let slashes = b[i + 1..k]
            .iter()
            .rev()
            .take_while(|&&c| c == b'\\')
            .count();
        if slashes % 2 == 0 {
            return Some(k + 1);
        }
        j = k + 1;
    }
}

/// The index just past the value that starts at `i`. Inside an object or an
/// array, `memchr` jumps from string to string, and only the few bytes
/// between strings are looked at for brackets.
fn value_end(b: &[u8], i: usize) -> Option<usize> {
    match *b.get(i)? {
        b'"' => string_end(b, i),
        b'{' | b'[' => {
            let mut depth = 0usize;
            let mut j = i;
            loop {
                let next = memchr(b'"', &b[j..]).map_or(b.len(), |n| j + n);
                for (n, c) in b[j..next].iter().enumerate() {
                    match c {
                        b'{' | b'[' => depth += 1,
                        b'}' | b']' => {
                            depth = depth.checked_sub(1)?;
                            if depth == 0 {
                                return Some(j + n + 1);
                            }
                        }
                        _ => {}
                    }
                }
                if next == b.len() {
                    return None;
                }
                j = string_end(b, next)?;
            }
        }
        _ => {
            let end = b[i..]
                .iter()
                .position(|c| matches!(c, b',' | b'}' | b']' | b' ' | b'\t' | b'\n' | b'\r'))
                .map_or(b.len(), |n| i + n);
            (end > i).then_some(end)
        }
    }
}

/// Call `f(key, value)` for each member of the object `b`, in order. `key`
/// is the raw bytes between the quotes; `value` is the raw value. `None`
/// when `b` is not an object or is cut short (members before the fault have
/// been passed to `f`).
pub fn members<'a>(b: &'a [u8], mut f: impl FnMut(&'a [u8], &'a [u8])) -> Option<()> {
    let mut i = ws(b, 0);
    if b.get(i) != Some(&b'{') {
        return None;
    }
    i = ws(b, i + 1);
    if b.get(i) == Some(&b'}') {
        return Some(());
    }
    loop {
        if b.get(i) != Some(&b'"') {
            return None;
        }
        let key_end = string_end(b, i)?;
        let key = &b[i + 1..key_end - 1];
        i = ws(b, key_end);
        if b.get(i) != Some(&b':') {
            return None;
        }
        i = ws(b, i + 1);
        let end = value_end(b, i)?;
        f(key, &b[i..end]);
        i = ws(b, end);
        match b.get(i)? {
            b',' => i = ws(b, i + 1),
            b'}' => return Some(()),
            _ => return None,
        }
    }
}

/// Call `f(element)` for each element of the array `b`, in order.
pub fn elements<'a>(b: &'a [u8], mut f: impl FnMut(&'a [u8])) -> Option<()> {
    let mut i = ws(b, 0);
    if b.get(i) != Some(&b'[') {
        return None;
    }
    i = ws(b, i + 1);
    if b.get(i) == Some(&b']') {
        return Some(());
    }
    loop {
        let end = value_end(b, i)?;
        f(&b[i..end]);
        i = ws(b, end);
        match b.get(i)? {
            b',' => i = ws(b, i + 1),
            b']' => return Some(()),
            _ => return None,
        }
    }
}

/// The decoded text of the raw JSON string `v`; `None` for any other value.
pub fn string(v: &[u8]) -> Option<Cow<'_, str>> {
    let inner = v.strip_prefix(b"\"")?.strip_suffix(b"\"")?;
    if memchr(b'\\', inner).is_none() {
        std::str::from_utf8(inner).ok().map(Cow::Borrowed)
    } else {
        serde_json::from_slice::<String>(v).ok().map(Cow::Owned)
    }
}

/// The text of a `user` line's raw `message`, read as
/// [`crate::decode::user_text`] reads it: a string `content`, or the `text`
/// of each part with `type == "text"` (and each bare string), joined with
/// newlines. Other parts (tool results, images) are skipped unread.
pub fn user_text(message: &[u8]) -> Option<String> {
    let mut content = None;
    members(message, |k, v| {
        if k == b"content" {
            content = Some(v);
        }
    })?;
    let content = content?;
    match content.first()? {
        b'"' => string(content).map(Cow::into_owned),
        b'[' => {
            let mut texts: Vec<Cow<'_, str>> = Vec::new();
            elements(content, |part| match part.first() {
                Some(b'"') => texts.extend(string(part)),
                Some(b'{') => {
                    let (mut kind, mut text) = (None, None);
                    let _ = members(part, |k, v| match k {
                        b"type" => kind = Some(v),
                        b"text" => text = Some(v),
                        _ => {}
                    });
                    if kind.and_then(string).as_deref() == Some("text") {
                        texts.extend(text.and_then(string));
                    }
                }
                _ => {}
            })?;
            (!texts.is_empty()).then(|| texts.join("\n"))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn members_skip_nested_values_and_escapes() {
        let line = br#"{"a":{"x":["}",{"y":"\"]"}]},"b" : "c\"d", "n":-1.5e3,"t":true,"z":[]}"#;
        let mut got = Vec::new();
        assert!(members(line, |k, v| got.push((k, v))).is_some());
        let keys: Vec<&[u8]> = got.iter().map(|g| g.0).collect();
        assert_eq!(keys, vec![&b"a"[..], b"b", b"n", b"t", b"z"]);
        assert_eq!(string(got[1].1).as_deref(), Some("c\"d"));
        assert_eq!(got[2].1, b"-1.5e3");
        assert!(members(br#"{"a":"unterminated}"#, |_, _| {}).is_none());
        assert!(members(b"[1]", |_, _| {}).is_none());
    }

    #[test]
    fn user_text_reads_like_decode() {
        let t = |m: &str| user_text(m.as_bytes());
        assert_eq!(t(r#"{"content":"plain"}"#).as_deref(), Some("plain"));
        assert_eq!(
            t(r#"{"content":[{"type":"text","text":"a"},{"type":"image"},"b"]}"#).as_deref(),
            Some("a\nb")
        );
        assert_eq!(
            t(r#"{"content":[{"type":"tool_result","content":[{"type":"text","text":"no"}]}]}"#),
            None
        );
        assert_eq!(t(r#""odd""#), None);
    }
}
