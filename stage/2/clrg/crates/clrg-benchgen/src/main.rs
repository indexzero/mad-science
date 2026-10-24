//! `clrg-benchgen <base>`: build (or reuse) a deterministic, seeded synthetic
//! `~/.claude` tree of about 1.2 GB under `<base>/<VERSION>/claude`, for the
//! P1 speed gate in `check.sh`. Not part of the shipped `clrg` binary.
//!
//! The tree is regenerated only when `<base>/<VERSION>/complete` is missing,
//! so a change to the generator must bump [`VERSION`]. Older versions under
//! `<base>` are removed. On success it prints `root=<path>`, `needle=<text>`,
//! and `planted=<n>` (the lines that hold the needle) on stdout.
//!
//! Shape: long-tailed transcripts (a few KB to tens of MB) under
//! `projects/<encoded-cwd>/<session>.jsonl` with the real field set,
//! `subagents/`, `history.jsonl`, `todos/`, `tasks/`, `file-history/`, and
//! `plans/`. All text is synthetic (made-up words and code); all ids are fake.
//! The rare needle is planted in a few known places, never by chance.

#![forbid(unsafe_code)]
// Sizes and random draws move between u64, usize, and f64 on purpose.
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss
)]

use std::fmt::Write as _;
use std::fs::{self, File};
use std::io::{self, BufWriter, Write as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

/// Bump on any change to the output.
const VERSION: &str = "v1";
/// The rare literal: never produced by the word or code pools.
const NEEDLE: &str = "marmoset-quillfeather";
const SEED: u64 = 0x00c1_7a6e_5eed_0001;
/// Bytes of main transcripts to aim for (subagents and other stores add more).
const TRANSCRIPT_BUDGET: u64 = 900 * 1024 * 1024;
const MIN_SESSION: u64 = 3 * 1024;
const MAX_SESSION: u64 = 48 * 1024 * 1024;
const PROJECTS: usize = 40;
const PLANS: usize = 60;
/// 2026-01-05T00:00:00Z, in unix ms.
const EPOCH_MS: u64 = 1_767_571_200_000;

fn main() -> io::Result<()> {
    let base = std::env::args_os().nth(1).map_or_else(
        || {
            eprintln!("usage: clrg-benchgen <base-dir>");
            std::process::exit(2)
        },
        PathBuf::from,
    );
    let dir = base.join(VERSION);
    let root = dir.join("claude");
    let marker = dir.join("complete");
    let planted = if let Ok(s) = fs::read_to_string(&marker) {
        s.trim().parse().unwrap_or(0)
    } else {
        if let Ok(rd) = fs::read_dir(&base) {
            for e in rd.flatten() {
                fs::remove_dir_all(e.path())?;
            }
        }
        let n = generate(&root)?;
        fs::write(&marker, format!("{n}\n"))?;
        n
    };
    println!("root={}", root.display());
    println!("needle={NEEDLE}");
    println!("planted={planted}");
    Ok(())
}

// ---------------------------------------------------------------- random

/// `SplitMix64`: small, fast, and good enough for synthetic data.
#[derive(Clone)]
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Rng {
        let mut r = Rng(seed);
        r.next();
        r
    }
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
    /// Uniform in `lo..hi` (`hi > lo`).
    fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.next() % (hi - lo)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn chance(&mut self, p: f64) -> bool {
        self.unit() < p
    }
    fn normal(&mut self) -> f64 {
        let u1 = self.unit().max(1e-12);
        let u2 = self.unit();
        (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
    }
    fn pick<'a, T>(&mut self, xs: &'a [T]) -> &'a T {
        &xs[self.below(xs.len())]
    }
    /// A fake UUID-shaped id.
    fn id(&mut self) -> String {
        let a = self.next();
        let b = self.next();
        format!(
            "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
            a >> 32,
            (a >> 16) & 0xffff,
            a & 0xfff,
            0x8000 | (b >> 48) & 0x3fff,
            b & 0xffff_ffff_ffff
        )
    }
    fn hex(&mut self, n: usize) -> String {
        let mut s = String::with_capacity(n);
        while s.len() < n {
            let _ = write!(s, "{:016x}", self.next());
        }
        s.truncate(n);
        s
    }
}

// ---------------------------------------------------------------- text pools

const SYLLABLES: &[&str] = &[
    "ba", "ko", "ri", "tun", "vel", "sa", "mi", "dor", "pe", "lax", "zu", "fen", "gri", "ho",
    "nal", "qui", "tre", "wo", "yel", "cam", "dru", "es", "fo", "jin", "ul", "pra", "sto", "vik",
    "ne", "lo",
];
const ACCENTED: &[&str] = &["café", "naïve", "über", "señor", "résumé", "→", "✓", "日本"];
const IDENTS: &[&str] = &[
    "parse", "render", "config", "index", "buffer", "session", "handler", "worker", "cache",
    "token", "value", "result", "error", "options", "client", "stream", "record", "schema",
];

/// Shared text pools; slices of them become message bodies.
struct Pools {
    prose: String,
    code: String,
}

fn word(r: &mut Rng) -> String {
    let n = 1 + r.below(3);
    (0..n).map(|_| *r.pick(SYLLABLES)).collect()
}

fn build_pools() -> Pools {
    let mut r = Rng::new(SEED ^ 0x9001);
    let vocab: Vec<String> = (0..2000).map(|_| word(&mut r)).collect();
    let mut prose = String::with_capacity(3 << 20);
    while prose.len() < (3 << 20) {
        let n = 4 + r.below(18);
        for i in 0..n {
            if i > 0 {
                prose.push(' ');
            }
            match r.below(40) {
                0 => {
                    let _ = write!(prose, "\"{}\"", r.pick(&vocab));
                }
                1 => prose.push_str(r.pick(ACCENTED)),
                2 => {
                    let _ = write!(prose, "C:\\{}\\{}", r.pick(&vocab), r.pick(&vocab));
                }
                3 => {
                    let _ = write!(prose, "src/{}.rs", r.pick(IDENTS));
                }
                _ => prose.push_str(r.pick(&vocab)),
            }
        }
        prose.push_str(if r.chance(0.15) { ".\n\n" } else { ". " });
    }
    let mut code = String::with_capacity(6 << 20);
    while code.len() < (6 << 20) {
        let indent = "    ".repeat(r.below(4));
        let (a, b) = (r.pick(IDENTS), r.pick(&vocab));
        let _ = match r.below(9) {
            0 => writeln!(
                code,
                "{indent}fn {a}_{b}(input: &str) -> Result<{a}, Error> {{"
            ),
            1 => writeln!(code, "{indent}let {a} = \"{b} {}\";", r.pick(&vocab)),
            2 => writeln!(code, "{indent}}}"),
            3 => writeln!(
                code,
                "{indent}// {} {} {}",
                b,
                r.pick(&vocab),
                r.pick(&vocab)
            ),
            4 => writeln!(code, "{indent}println!(\"{{}}\\t{b}\", {a});"),
            5 => writeln!(code, "{indent}if {a}.len() > {} {{", r.below(1000)),
            6 => writeln!(code, "{indent}path = \"C:\\\\{b}\\\\{a}.txt\";"),
            7 => writeln!(
                code,
                "-rw-r--r--  1 dev  staff  {:>6} Jan  {} {}.{}",
                r.below(99_999),
                1 + r.below(28),
                b,
                a
            ),
            _ => writeln!(
                code,
                "{indent}{a}.{b}({}, {});",
                r.pick(&vocab),
                r.below(64)
            ),
        };
    }
    for pool in [&prose, &code] {
        let low = pool.to_lowercase();
        assert!(!low.contains("marmoset") && !low.contains("quillfeather"));
    }
    Pools { prose, code }
}

/// About `len` bytes of `pool`, starting and ending at whitespace.
fn slice<'a>(r: &mut Rng, pool: &'a str, len: usize) -> &'a str {
    let len = len.clamp(1, pool.len() / 2);
    let b = pool.as_bytes();
    let mut s = r.below(pool.len() - len);
    while s > 0 && !b[s - 1].is_ascii_whitespace() {
        s -= 1;
    }
    let mut e = (s + len).min(pool.len());
    while e < pool.len() && !b[e].is_ascii_whitespace() {
        e += 1;
    }
    &pool[s..e]
}

/// Long text: repeated slices, so large blobs stay cheap to build.
fn long_text(r: &mut Rng, pool: &str, len: usize) -> String {
    let mut s = String::with_capacity(len + 64);
    while s.len() < len {
        let chunk = (len - s.len()).min(256 * 1024);
        s.push_str(slice(r, pool, chunk));
    }
    s
}

/// Write `s` as a JSON string literal.
fn esc(out: &mut String, s: &str) {
    out.reserve(s.len() + 2);
    out.push('"');
    let mut start = 0;
    for (i, &c) in s.as_bytes().iter().enumerate() {
        let rep: &str = match c {
            b'"' => "\\\"",
            b'\\' => "\\\\",
            b'\n' => "\\n",
            b'\r' => "\\r",
            b'\t' => "\\t",
            0..=0x1f => "\\u0001",
            _ => continue,
        };
        out.push_str(&s[start..i]);
        out.push_str(rep);
        start = i + 1;
    }
    out.push_str(&s[start..]);
    out.push('"');
}

fn ts(ms: u64) -> String {
    let secs = ms / 1000;
    let days = i64::try_from(secs / 86_400).unwrap_or(0);
    let rem = secs % 86_400;
    // Civil date from days since 1970-01-01 (Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60,
        ms % 1000
    )
}

// ---------------------------------------------------------------- plan

#[derive(Clone, Copy, PartialEq, Eq)]
enum Plant {
    Prompt,
    ToolResultBlob,
    ToolUseInput,
    Thinking,
}

struct Project {
    cwd: String,
    dir: String,
}

struct SessionPlan {
    project: usize,
    size: u64,
    plant: Option<Plant>,
    /// Plant in a subagent transcript instead of the main one.
    plant_subagent: bool,
    subagents: usize,
}

fn projects() -> Vec<Project> {
    let mut r = Rng::new(SEED ^ 0x0b1e);
    (0..PROJECTS)
        .map(|i| {
            let name = format!("{}-{}", word(&mut r), word(&mut r));
            let cwd = match i % 3 {
                0 => format!("/srv/work/{name}"),
                1 => format!("/opt/src/{}/{name}", word(&mut r)),
                _ => format!("/srv/work/{name}/.worktrees/feature.{}", word(&mut r)),
            };
            let dir = cwd.replace(['/', '.'], "-");
            Project { cwd, dir }
        })
        .collect()
}

fn plan_sessions() -> Vec<SessionPlan> {
    let mut r = Rng::new(SEED ^ 0x5e55);
    let mut out = Vec::new();
    let mut total = 0;
    // Two fixed giants, so the tail is always there; the rest is log-normal
    // around a median of ~120 KB.
    let fixed = [46 * 1024 * 1024, 27 * 1024 * 1024];
    while total < TRANSCRIPT_BUDGET {
        let size = fixed.get(out.len()).copied().unwrap_or_else(|| {
            let x = (120_000f64.ln() + 1.9 * r.normal()).exp();
            (x as u64).clamp(MIN_SESSION, MAX_SESSION)
        });
        total += size;
        out.push(SessionPlan {
            project: r.below(PROJECTS),
            size,
            plant: None,
            plant_subagent: false,
            subagents: if r.chance(0.12) { 1 + r.below(3) } else { 0 },
        });
    }
    // Plants: inside the biggest transcript's tool-result blob, a prompt in a
    // small one, a tool_use input in a mid one, and a subagent's thinking.
    out[0].plant = Some(Plant::ToolResultBlob);
    let small = out.iter().position(|s| s.size < 40_000).unwrap_or(2);
    out[small].plant = Some(Plant::Prompt);
    let mid = out
        .iter()
        .position(|s| s.plant.is_none() && (1 << 20..8 << 20).contains(&s.size))
        .unwrap_or(3);
    out[mid].plant = Some(Plant::ToolUseInput);
    let sub = out
        .iter()
        .position(|s| s.plant.is_none() && s.subagents > 0)
        .unwrap_or(4);
    out[sub].plant = Some(Plant::Thinking);
    out[sub].plant_subagent = true;
    out[sub].subagents = out[sub].subagents.max(1);
    out
}

// ---------------------------------------------------------------- generate

/// Generate the tree. Returns the number of lines/files holding the needle.
fn generate(root: &Path) -> io::Result<usize> {
    let pools = build_pools();
    let projects = projects();
    let plans = plan_sessions();
    let mut ids = Rng::new(SEED ^ 0x1d5);
    let sids: Vec<String> = plans.iter().map(|_| ids.id()).collect();
    for p in &projects {
        fs::create_dir_all(root.join("projects").join(&p.dir))?;
    }
    for d in ["todos", "tasks", "file-history", "plans"] {
        fs::create_dir_all(root.join(d))?;
    }

    let next = AtomicUsize::new(0);
    let threads = std::thread::available_parallelism().map_or(4, std::num::NonZero::get);
    let mut results: Vec<(usize, Vec<String>)> = std::thread::scope(|s| {
        let handles: Vec<_> = (0..threads)
            .map(|_| {
                s.spawn(|| -> io::Result<Vec<(usize, Vec<String>)>> {
                    let mut done = Vec::new();
                    loop {
                        let i = next.fetch_add(1, Ordering::Relaxed);
                        if i >= plans.len() {
                            return Ok(done);
                        }
                        let ctx = SessionCtx {
                            root,
                            pools: &pools,
                            project: &projects[plans[i].project],
                            sid: &sids[i],
                            idx: i,
                        };
                        done.push((i, ctx.write_all(&plans[i])?));
                    }
                })
            })
            .collect();
        let mut all = Vec::new();
        for h in handles {
            all.extend(h.join().expect("generator thread panicked")?);
        }
        Ok::<_, io::Error>(all)
    })?;
    results.sort_by_key(|(i, _)| *i);

    // Transcripts: the prompt (and its history line), the blob, the tool_use
    // input, and the subagent thinking.
    let mut planted = 5;
    // history.jsonl: one line per prompt, sessions in order, plus one plant.
    let mut hist = BufWriter::with_capacity(1 << 20, File::create(root.join("history.jsonl"))?);
    let mut line = String::new();
    let mut hr = Rng::new(SEED ^ 0x4157);
    for (i, prompts) in &results {
        let p = &projects[plans[*i].project];
        let extra = (*i == 7).then(|| format!("where did we put the {NEEDLE} \"notes\"?"));
        for display in prompts.iter().chain(extra.as_ref()) {
            line.clear();
            line.push_str("{\"display\":");
            esc(&mut line, display);
            let _ = write!(
                line,
                ",\"pastedContents\":{{}},\"timestamp\":{},\"project\":",
                EPOCH_MS + (*i as u64) * 3_600_000 + hr.range(0, 3_000_000)
            );
            esc(&mut line, &p.cwd);
            let _ = writeln!(line, ",\"sessionId\":\"{}\"}}", sids[*i]);
            hist.write_all(line.as_bytes())?;
        }
    }
    hist.flush()?;
    planted += 1;

    // plans/: markdown, one with the needle.
    let mut pr = Rng::new(SEED ^ 0x91a5);
    for k in 0..PLANS {
        let slug = format!("{}-{}-{}", word(&mut pr), word(&mut pr), word(&mut pr));
        let mut md = format!("# Plan: {}\n\n## Context\n\n", word(&mut pr));
        md.push_str(&long_r(&mut pr, &pools.prose, 2_000, 18_000));
        if k == 11 {
            let _ = write!(
                md,
                "\n\n## Risks\n\n- The Marmoset-Quillfeather cache may go stale.\n"
            );
            planted += 1;
        }
        md.push_str("\n\n## Steps\n\n```rust\n");
        md.push_str(slice(&mut pr, &pools.code, 1_500));
        md.push_str("```\n");
        fs::write(root.join("plans").join(format!("{slug}.md")), md)?;
    }
    Ok(planted + PLANT_FH.load(Ordering::Relaxed))
}

struct SessionCtx<'a> {
    root: &'a Path,
    pools: &'a Pools,
    project: &'a Project,
    sid: &'a str,
    idx: usize,
}

const TOOLS: &[&str] = &["Bash", "Read", "Edit", "Write", "Grep", "Glob", "Task"];
const BRANCHES: &[&str] = &[
    "main",
    "dev",
    "feature/sync",
    "fix/cache",
    "onboarding.gonzo",
];
const MODELS: &[&str] = &["claude-opus-4-1", "claude-sonnet-4-5", "claude-haiku-4-5"];

/// Writes the lines of one transcript.
struct Transcript<'a> {
    ctx: &'a SessionCtx<'a>,
    r: Rng,
    out: BufWriter<File>,
    written: u64,
    parent: Option<String>,
    ms: u64,
    branch: &'static str,
    version: String,
    sidechain: bool,
    agent: Option<String>,
    line: String,
    prompts: Vec<String>,
    /// The plant still to place, consumed by the turn that places it.
    pending: Option<Plant>,
}

impl SessionCtx<'_> {
    /// The main transcript, its subagents, and the session's side files.
    /// Returns the prompts, for `history.jsonl`.
    fn write_all(&self, plan: &SessionPlan) -> io::Result<Vec<String>> {
        let mut r = Rng::new(SEED ^ (self.idx as u64).wrapping_mul(0x2545_f491_4f6c_dd1d));
        let dir = self.root.join("projects").join(&self.project.dir);
        let main_plant = plan.plant.filter(|_| !plan.plant_subagent);
        let mut t = Transcript::new(
            self,
            r.next(),
            &dir.join(format!("{}.jsonl", self.sid)),
            None,
        )?;
        t.body(plan.size, main_plant)?;
        let prompts = std::mem::take(&mut t.prompts);
        t.out.flush()?;
        for k in 0..plan.subagents {
            let sub = dir.join(self.sid).join("subagents");
            fs::create_dir_all(&sub)?;
            let agent = r.hex(17);
            let path = sub.join(format!("agent-{agent}.jsonl"));
            let mut t = Transcript::new(self, r.next(), &path, Some(agent))?;
            let size = (plan.size / (5 + r.range(0, 15))).max(MIN_SESSION);
            t.body(size, plan.plant.filter(|_| plan.plant_subagent && k == 0))?;
            t.out.flush()?;
        }
        self.side_files(&mut r)?;
        Ok(prompts)
    }

    fn side_files(&self, r: &mut Rng) -> io::Result<()> {
        let pools = self.pools;
        if r.chance(0.3) {
            let mut s = String::from("[");
            for k in 0..=r.below(8) {
                if k > 0 {
                    s.push(',');
                }
                s.push_str("{\"content\":");
                esc(&mut s, slice(r, &pools.prose, 60));
                s.push_str(",\"status\":");
                esc(&mut s, r.pick(&["completed", "in_progress", "pending"]));
                s.push_str(",\"activeForm\":");
                esc(&mut s, slice(r, &pools.prose, 40));
                s.push('}');
            }
            s.push(']');
            let name = format!("{}-agent-{}.json", self.sid, self.sid);
            fs::write(self.root.join("todos").join(name), s)?;
        }
        if r.chance(0.1) {
            let dir = self.root.join("tasks").join(self.sid);
            fs::create_dir_all(&dir)?;
            for k in 1..=1 + r.below(5) {
                let mut s = format!("{{\"id\":\"{k}\",\"subject\":");
                esc(&mut s, slice(r, &pools.prose, 50));
                s.push_str(",\"description\":");
                esc(&mut s, slice(r, &pools.prose, 400));
                let _ = write!(
                    s,
                    ",\"status\":\"pending\",\"blocks\":[],\"blockedBy\":[]}}"
                );
                fs::write(dir.join(format!("{k}.json")), s)?;
            }
        }
        if r.chance(0.25) || self.idx == 5 {
            let dir = self.root.join("file-history").join(self.sid);
            fs::create_dir_all(&dir)?;
            for _ in 0..=r.below(4) {
                let hash = r.hex(16);
                for v in 1..=1 + r.below(3) {
                    let mut text = long_r(r, &pools.code, 1_000, 60_000);
                    if self.idx == 5 && v == 1 {
                        // Session 5's first backups each hold one plant.
                        let _ = writeln!(text, "// TODO: rename {NEEDLE} before release");
                        PLANT_FH.fetch_add(1, Ordering::Relaxed);
                    }
                    fs::write(dir.join(format!("{hash}@v{v}")), text)?;
                }
            }
        }
        Ok(())
    }
}

/// File-history plants, counted as they are written.
static PLANT_FH: AtomicUsize = AtomicUsize::new(0);

impl<'a> Transcript<'a> {
    fn new(
        ctx: &'a SessionCtx<'a>,
        seed: u64,
        path: &Path,
        agent: Option<String>,
    ) -> io::Result<Transcript<'a>> {
        let mut r = Rng::new(seed);
        let ms = EPOCH_MS + (ctx.idx as u64) * 3_600_000 + r.range(0, 3_000_000);
        let branch = *r.pick(BRANCHES);
        let version = format!("2.{}.{}", r.below(2), r.below(80));
        Ok(Transcript {
            ctx,
            r,
            out: BufWriter::with_capacity(1 << 20, File::create(path)?),
            written: 0,
            parent: None,
            ms,
            branch,
            version,
            sidechain: agent.is_some(),
            agent,
            line: String::with_capacity(1 << 16),
            prompts: Vec::new(),
            pending: None,
        })
    }

    /// Turns until about `size` bytes; one turn near the middle gets `plant`.
    fn body(&mut self, size: u64, plant: Option<Plant>) -> io::Result<()> {
        self.summary()?;
        let mut plant = plant;
        while self.written < size {
            if self.written >= size / 2 {
                self.pending = plant.take();
            }
            self.turn()?;
            if self.r.chance(0.02) {
                self.branch = self.r.pick(BRANCHES);
            }
        }
        if plant.is_some() {
            self.pending = plant;
            self.turn()?;
        }
        Ok(())
    }

    fn summary(&mut self) -> io::Result<()> {
        let r = &mut self.r;
        self.line.clear();
        self.line.push_str("{\"type\":\"summary\",\"summary\":");
        esc(&mut self.line, slice(r, &self.ctx.pools.prose, 50));
        let _ = write!(self.line, ",\"leafUuid\":\"{}\"}}", r.id());
        self.emit()
    }

    /// Start a line with the common fields, up to (not including) `message`.
    fn head(&mut self, kind: &str) -> String {
        let uuid = self.r.id();
        self.ms += self.r.range(500, 90_000);
        self.line.clear();
        let parent = self
            .parent
            .as_ref()
            .map_or_else(|| "null".to_string(), |p| format!("\"{p}\""));
        let _ = write!(
            self.line,
            "{{\"parentUuid\":{parent},\"isSidechain\":{},\"userType\":\"external\",\"cwd\":",
            self.sidechain
        );
        esc(&mut self.line, &self.ctx.project.cwd);
        let _ = write!(
            self.line,
            ",\"sessionId\":\"{}\",\"version\":\"{}\",\"gitBranch\":\"{}\",",
            self.ctx.sid, self.version, self.branch
        );
        if let Some(a) = &self.agent {
            let _ = write!(self.line, "\"agentId\":\"{a}\",");
        }
        let _ = write!(self.line, "\"type\":\"{kind}\",");
        self.parent = Some(uuid.clone());
        uuid
    }

    fn tail(&mut self, uuid: &str) -> io::Result<()> {
        let _ = write!(
            self.line,
            ",\"uuid\":\"{uuid}\",\"timestamp\":\"{}\"}}",
            ts(self.ms)
        );
        self.emit()
    }

    fn emit(&mut self) -> io::Result<()> {
        self.line.push('\n');
        self.out.write_all(self.line.as_bytes())?;
        self.written += self.line.len() as u64;
        Ok(())
    }

    fn turn(&mut self) -> io::Result<()> {
        let pools = self.ctx.pools;
        // The prompt.
        let mut text = slice_r(&mut self.r, &pools.prose, 20, 800).to_string();
        if self.pending == Some(Plant::Prompt) {
            self.pending = None;
            text = format!("can you check why the \"{NEEDLE}\" job\nfails? {text}");
        }
        if !self.sidechain {
            self.prompts.push(text.chars().take(200).collect());
        }
        let uuid = self.head("user");
        self.line
            .push_str("\"message\":{\"role\":\"user\",\"content\":");
        if self.r.chance(0.3) {
            self.line.push_str("[{\"type\":\"text\",\"text\":");
            esc(&mut self.line, &text);
            self.line.push_str("}]");
        } else {
            esc(&mut self.line, &text);
        }
        self.line.push('}');
        self.tail(&uuid)?;

        for _ in 0..=self.r.below(4) {
            let plant = self.pending.take();
            self.assistant(plant)?;
        }
        Ok(())
    }

    /// An assistant message (thinking, text, or `tool_use`), and for a `tool_use`,
    /// the user line with its result.
    fn assistant(&mut self, plant: Option<Plant>) -> io::Result<()> {
        let pools = self.ctx.pools;
        let r = &mut self.r;
        let model = *r.pick(MODELS);
        let msg_id = format!("msg_{}", r.hex(24));
        let req = format!("req_{}", r.hex(24));
        let kind = match plant {
            Some(Plant::Thinking) => 0,
            Some(_) => 9,
            None => r.below(10),
        };
        let uuid = self.head("assistant");
        let r = &mut self.r;
        let _ = write!(
            self.line,
            "\"message\":{{\"id\":\"{msg_id}\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"{model}\",\"content\":["
        );
        let mut tool = None;
        if kind < 3 {
            let mut t = slice_r(r, &pools.prose, 200, 3000).to_string();
            if plant == Some(Plant::Thinking) {
                let _ = write!(t, " The {NEEDLE} module owns this; check it first.");
            }
            self.line.push_str("{\"type\":\"thinking\",\"thinking\":");
            esc(&mut self.line, &t);
            let _ = write!(self.line, ",\"signature\":\"{}\"}}", r.hex(64));
        } else if kind < 6 {
            self.line.push_str("{\"type\":\"text\",\"text\":");
            esc(&mut self.line, slice_r(r, &pools.prose, 100, 2000));
            self.line.push('}');
        } else {
            let name = if plant.is_some() {
                "Bash"
            } else {
                *r.pick(TOOLS)
            };
            let id = format!("toolu_{}", r.hex(24));
            let _ = write!(
                self.line,
                "{{\"type\":\"tool_use\",\"id\":\"{id}\",\"name\":\"{name}\",\"input\":{{"
            );
            let file = format!("{}/src/{}.rs", self.ctx.project.cwd, r.pick(IDENTS));
            match name {
                "Bash" => {
                    let mut cmd = format!("cargo test -p {} -- --nocapture", r.pick(IDENTS));
                    if plant == Some(Plant::ToolUseInput) {
                        cmd = format!("rg -n '{NEEDLE}' src/ | head -20");
                    }
                    self.line.push_str("\"command\":");
                    esc(&mut self.line, &cmd);
                    self.line.push_str(",\"description\":");
                    esc(&mut self.line, slice(r, &pools.prose, 40));
                }
                "Edit" | "Write" => {
                    self.line.push_str("\"file_path\":");
                    esc(&mut self.line, &file);
                    self.line.push_str(",\"old_string\":");
                    esc(&mut self.line, slice_r(r, &pools.code, 100, 1500));
                    self.line.push_str(",\"new_string\":");
                    esc(&mut self.line, slice_r(r, &pools.code, 100, 1500));
                }
                "Task" => {
                    self.line.push_str("\"description\":");
                    esc(&mut self.line, slice(r, &pools.prose, 40));
                    self.line.push_str(",\"prompt\":");
                    esc(&mut self.line, slice_r(r, &pools.prose, 300, 1500));
                }
                _ => {
                    self.line.push_str("\"file_path\":");
                    esc(&mut self.line, &file);
                }
            }
            self.line.push_str("}}");
            tool = Some((id, name));
        }
        let _ = write!(
            self.line,
            "],\"stop_reason\":null,\"usage\":{{\"input_tokens\":{},\"output_tokens\":{}}}}},\"requestId\":\"{req}\"",
            r.below(20_000),
            r.below(4_000)
        );
        self.tail(&uuid)?;

        if let Some((id, name)) = tool {
            self.tool_result(&id, name, plant)?;
        }
        Ok(())
    }

    fn tool_result(&mut self, id: &str, name: &str, plant: Option<Plant>) -> io::Result<()> {
        let pools = self.ctx.pools;
        let r = &mut self.r;
        // Long-tailed result sizes: most are small, a few are big blobs.
        let len = match r.below(100) {
            0..=69 => 100 + r.below(4_000),
            70..=94 => 4_000 + r.below(40_000),
            _ => 50_000 + r.below(900_000),
        };
        let mut text = long_text(r, &pools.code, len);
        if plant == Some(Plant::ToolResultBlob) {
            let at = text[..text.len() / 2].rfind('\n').unwrap_or(0);
            text.insert_str(
                at,
                &format!("\n    let tag = \"{NEEDLE}\"; // see \"notes\"\\n"),
            );
        }
        let uuid = self.head("user");
        let _ = write!(
            self.line,
            "\"message\":{{\"role\":\"user\",\"content\":[{{\"tool_use_id\":\"{id}\",\"type\":\"tool_result\",\"content\":"
        );
        esc(&mut self.line, &text);
        self.line.push_str(",\"is_error\":false}]}");
        if name == "Bash" && plant != Some(Plant::ToolResultBlob) {
            // Claude Code repeats Bash output in toolUseResult.
            self.line.push_str(",\"toolUseResult\":{\"stdout\":");
            esc(&mut self.line, &text);
            self.line
                .push_str(",\"stderr\":\"\",\"interrupted\":false}");
        }
        self.tail(&uuid)
    }
}

/// [`slice`] of `lo..lo + spread` bytes.
fn slice_r<'a>(r: &mut Rng, pool: &'a str, lo: usize, spread: usize) -> &'a str {
    let len = lo + r.below(spread);
    slice(r, pool, len)
}

/// [`long_text`] of `lo..lo + spread` bytes.
fn long_r(r: &mut Rng, pool: &str, lo: usize, spread: usize) -> String {
    let len = lo + r.below(spread);
    long_text(r, pool, len)
}
