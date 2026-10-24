//! The clap surface of `clrg`. It mirrors `clrg-cli.kdl` (the usage spec)
//! flag for flag; the parity test in `parity_tests.rs` keeps them in step.
//!
//! Help strings are attributes, not doc comments, so they stay byte-equal to
//! the spec's `help`. A flag with a spec `long_help` gets `help`, a blank line,
//! then the spec text, so `--help` still shows the one-line summary first.

use std::path::PathBuf;

use clap::{ArgAction, Args, Parser, Subcommand, ValueEnum, ValueHint};

const ROOT_LONG_HELP: &str =
    "A ~/.claude-shaped directory to search (repeatable; CLRG_ROOTS is ':'-separated)

Each root is scanned for projects/, file-history/, todos/, tasks/, plans/,
history.jsonl and sessions/. Results always carry the root they came from,
so the same session found in two backups is visible as such (see --dedupe).";

const DEDUPE_LONG_HELP: &str = "How to collapse the same session/message seen in several roots

uuid     merge transcripts by message uuid (union; best for partial backups)
session  keep the single longest copy of each session
none     report every copy, tagged by root

Not implemented (yet): every mode is accepted and behaves like none.";

const SCOPE_LONG_HELP: &str = "Whether selectors filter individual messages or whole sessions

message  only messages that match count (branch can change mid-session)
session  a session matches if any message matches; all its messages count";

const INFER_BRANCH_LONG_HELP: &str =
    "Also include sessions with no gitBranch when their cwd and time window fit a matched session

Older Claude Code builds didn't record gitBranch. With this flag, a
session with no branch is included when its cwd equals a matched session's
cwd and its time range falls within --infer-window of it. Such results are
tagged confidence=inferred in every output format.";

const STORE_LONG_HELP: &str = "Only search these stores (repeatable; default: every store)

transcripts   projects/**: transcripts (including subagents/), tool-results/,
              and every other file there that no store claims
history       history.jsonl
plans         plans/
todos         todos/
tasks         tasks/
file-history  file-history/
sessions      sessions/
workflows     projects/<dir>/<session>/workflows/ (workflow run records)
other         every other file under a root (settings.json, CLAUDE.md,
              commands/, loose files in file-history/, ...)";

const OP_LONG_HELP: &str = "Which tool operations to count (repeatable; default: write and edit)

write   Write / NotebookEdit, with rejected writes and returned text
edit    Edit / MultiEdit, with rejected edits
read    Read inputs
bash    Paths that appear in Bash commands (heuristic; not implemented yet)";

const SOURCE_LONG_HELP: &str = "Where file content comes from

file-history  backups in file-history/<sessionId>/<hash>@vN
transcript    Write tool inputs (full content), replaying Edit/MultiEdit on top
best          every event (backups, writes, edits, rejected, returned), replayed in time order";

const LAYOUT_LONG_HELP: &str = "How to arrange output paths

cwd      <out>/<cwd with / → _>/<path relative to cwd>
         (outside the cwd: <out>/_abs/<absolute path minus leading />)
absolute <out>/<absolute path minus leading />
session  <out>/<sessionId>/<path relative to cwd>
         (outside the cwd: <out>/<sessionId>/_abs/<absolute path ...>)";

const VERSION_LONG_HELP: &str = "Which version of each file to write

first  the earliest state with full content
last   the last state that was on disk (write, edit, backup) or returned;
       a newer rejected draft is listed, not written
all    every distinct state, as <name>.v<N> (rejected drafts included)";

const SESSIONS_AFTER: &str =
    "FIELDS: root, session, project, cwd, cwd_exists, branches, first_ts, last_ts,
        messages, tools, files_touched, models, cli_versions,
        has_file_history, subagents, confidence, last";

const GREP_AFTER: &str =
    "FIELDS: root, store, path, session, cwd, cwd_exists, branch, ts, type, part,
        line, excerpt, match_start, match_end, last, agreement, agreement_rule
type and part are the raw line type and content-part type (user/text,
assistant/tool_use, ...). last, agreement, and agreement_rule are clrg's:
see COGNETICS.md.";

const AGREE_LONG_HELP: &str =
    "Only user/text and history hits with this agreement (repeatable; other hits are kept)

both             the history line and the user/text line agree
transcript-only  a user/text line with no agreeing history line
history-only     a history line with no agreeing user/text line
unlinked         a history line with no sessionId
unknown          the other source is not in any searched root";

const FILES_AFTER: &str = "FIELDS: path, cwd, ops, first_ts, last_ts, sessions, branches, versions,
        outcome (written|rejected|returned|unknown),
        recoverable (full|diff-only|none), root, roots
ops are event kinds: write, edit, backup, rejected, returned, read.
A path has one timeline across roots (copies counted once); roots lists
every root it came from, and root is the first of them (for compatibility).
Selectors choose paths; every event on a chosen path is replayed.
versions, outcome, and recoverable are clrg's: see COGNETICS.md.";

const EXTRACT_AFTER: &str =
    "FIELDS (MANIFEST.jsonl and --format jsonl): path, out_path, session, agent_id,
        root, roots, version, ts,
        source_event (write|edit|backup|rejected|returned),
        outcome (written|rejected|returned|unknown), verified (agree|disagree),
        similarity, journal (agree|disagree|none), sha256, bytes
root is the first of roots (every root the path came from).
-o must not exist or be empty, and must not be inside a root (else exit 2,
nothing written). A path whose output would leave -o (a .. component) is
skipped and listed, and the rest are written (exit 4). Output paths that
collide case-insensitively get ~2, ~3, ... before the first write.
See COGNETICS.md.";

const ARTIFACTS_AFTER: &str =
    "Joins: file-history/<sessionId>/, todos/<sessionId>*.json, tasks/<sessionId>/,
plans/<slug>.md (slug taken from the transcript), projects/*/<sessionId>/subagents/,
history.jsonl entries matched by project path and timestamp.
FIELDS: root, session, kind, path, bytes, mtime, refers_to";

const FACETS_AFTER: &str =
    "Use this to find the right spelling before you search (e.g. 'onboarding.gonzo'
vs 'onboarding/gonzo'). FIELDS: value, sessions, messages, first_ts, last_ts";

const DOCTOR_AFTER: &str =
    "Checks: unparsable JSONL lines; truncated transcripts (same session shorter in
one root than another); duplicate sessions across roots; file-history snapshot
entries whose backup file is missing; sessions with no gitBranch (candidates
for --infer-branch); orphaned file-history/todos with no transcript.";

/// The whole `clrg` command line.
#[derive(Debug, Parser)]
#[command(
    name = "clrg",
    bin_name = "clrg",
    version,
    author = "Charlie Robbins",
    about = "Search Claude Code session history (~/.claude) by branch, project, time, tool, and file",
    long_about = "clrg indexes one or more ~/.claude-shaped roots and answers questions like
\"which files did Claude create on branch X?\" by selecting sessions/messages
from transcript metadata, then joining on sessionId to file-history, todos,
tasks, plans, and subagent transcripts.",
    override_usage = "clrg [GLOBAL OPTIONS] <COMMAND> [SELECTORS] [OPTIONS]"
)]
pub struct Cli {
    #[command(flatten)]
    pub global: GlobalArgs,

    #[arg(
        long = "usage-spec",
        hide = true,
        help = "Print the usage spec (KDL) that clap generates for this binary"
    )]
    pub usage_spec: bool,

    #[command(subcommand)]
    pub command: Option<Command>,
}

/// Global flags: where to look and how to read it.
#[derive(Debug, Args)]
#[allow(clippy::struct_excessive_bools)]
pub struct GlobalArgs {
    #[arg(
        short = 'r',
        long = "root",
        value_name = "dir",
        global = true,
        env = "CLRG_ROOTS",
        default_value = "~/.claude",
        value_delimiter = ':',
        action = ArgAction::Append,
        value_hint = ValueHint::DirPath,
        help = "A ~/.claude-shaped directory to search (repeatable; CLRG_ROOTS is ':'-separated)",
        long_help = ROOT_LONG_HELP
    )]
    pub root: Vec<PathBuf>,

    #[arg(
        long = "dedupe",
        value_name = "mode",
        global = true,
        value_enum,
        default_value = "uuid",
        help = "How to collapse the same session/message seen in several roots",
        long_help = DEDUPE_LONG_HELP
    )]
    pub dedupe: Dedupe,

    #[arg(
        long = "index",
        value_name = "path",
        global = true,
        env = "CLRG_INDEX",
        default_value = "~/.cache/clrg/index.sqlite",
        help = "Metadata cache; rebuilt incrementally from file mtimes (not implemented yet: accepted, no effect)"
    )]
    pub index: PathBuf,

    #[arg(
        long = "no-index",
        global = true,
        help = "Stream transcripts directly; slower, but never uses a stale cache (the only mode yet: accepted, no effect)"
    )]
    pub no_index: bool,

    #[arg(
        long = "strict",
        global = true,
        help = "Exit 3 on any unparsable line or unreadable root instead of warning"
    )]
    pub strict: bool,

    #[arg(
        short = 'v',
        long = "verbose",
        global = true,
        action = ArgAction::Count,
        help = "Log scan progress and skipped lines to stderr (-vv for per-file)"
    )]
    pub verbose: u8,

    #[arg(
        short = 'q',
        long = "quiet",
        global = true,
        help = "Suppress warnings on stderr"
    )]
    pub quiet: bool,

    #[arg(
        long = "color",
        global = true,
        env = "CLRG_COLOR",
        default_value_t = true,
        value_parser = clap::builder::BoolishValueParser::new(),
        help = "Colorize human output"
    )]
    pub color: bool,

    #[arg(long = "no-color", global = true, help = "Negate --color")]
    pub no_color: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Dedupe {
    Uuid,
    Session,
    #[value(name = "none")]
    Off,
}

/// The `select` flagset: what to match.
#[derive(Debug, Args)]
#[allow(clippy::struct_excessive_bools)]
pub struct SelectArgs {
    #[arg(short = 'b', long = "branch", value_name = "name", action = ArgAction::Append,
          help = "Match gitBranch exactly (repeatable; OR'd)")]
    pub branch: Vec<String>,

    #[arg(long = "branch-glob", value_name = "glob", action = ArgAction::Append,
          help = "Match gitBranch by glob, e.g. 'onboarding.*'")]
    pub branch_glob: Vec<String>,

    #[arg(short = 'd', long = "cwd", value_name = "path", action = ArgAction::Append,
          help = "Match message cwd (prefix match; repeatable)")]
    pub cwd: Vec<PathBuf>,

    #[arg(short = 'p', long = "project", value_name = "name", action = ArgAction::Append,
          help = "Match the encoded projects/<dir> name (glob)")]
    pub project: Vec<String>,

    #[arg(long = "session", value_name = "id", action = ArgAction::Append,
          help = "Restrict to session ids (prefixes accepted)")]
    pub session: Vec<String>,

    #[arg(
        long = "since",
        value_name = "when",
        help = "Messages at or after this time (ISO-8601 date/time or relative: 30d, 6h)"
    )]
    pub since: Option<String>,

    #[arg(
        long = "until",
        value_name = "when",
        help = "Messages before this time (ISO-8601 date/time or relative)"
    )]
    pub until: Option<String>,

    #[arg(long = "model", value_name = "model", action = ArgAction::Append,
          help = "Match assistant message model id (glob)")]
    pub model: Vec<String>,

    #[arg(
        long = "cli-version",
        value_name = "semver-range",
        help = "Match the Claude Code version that wrote the message, e.g. '>=1.0.40'"
    )]
    pub cli_version: Option<String>,

    #[arg(long = "tool", value_name = "name", action = ArgAction::Append,
          help = "Only messages that use these tools (Write, Edit, MultiEdit, Bash, Task, ...)")]
    pub tool: Vec<String>,

    #[arg(long = "touched", value_name = "glob", action = ArgAction::Append,
          help = "Only messages whose tool input touched a path matching this glob")]
    pub touched: Vec<String>,

    #[arg(
        long = "subagents",
        default_value_t = true,
        overrides_with = "no_subagents",
        help = "Include subagent (sidechain) transcripts"
    )]
    pub subagents: bool,

    #[arg(
        long = "no-subagents",
        overrides_with = "subagents",
        help = "Negate --subagents"
    )]
    pub no_subagents: bool,

    #[arg(long = "scope", value_name = "scope", value_enum, default_value = "message",
          help = "Whether selectors filter individual messages or whole sessions",
          long_help = SCOPE_LONG_HELP)]
    pub scope: Scope,

    #[arg(long = "infer-branch",
          help = "Also include sessions with no gitBranch when their cwd and time window fit a matched session",
          long_help = INFER_BRANCH_LONG_HELP)]
    pub infer_branch: bool,

    #[arg(
        long = "infer-window",
        value_name = "duration",
        default_value = "24h",
        help = "Time tolerance for --infer-branch"
    )]
    pub infer_window: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Scope {
    Message,
    Session,
}

/// The `output` flagset, minus `--format` (each command declares its own,
/// because `doctor` and `extract` narrow the choices).
#[derive(Debug, Args)]
pub struct OutputArgs {
    #[arg(
        long = "fields",
        value_name = "list",
        help = "Comma-separated columns for tsv/human (see each command's FIELDS)"
    )]
    pub fields: Option<String>,

    #[arg(
        long = "sort",
        value_name = "field",
        allow_hyphen_values = true,
        help = "Sort key; prefix with '-' for descending"
    )]
    pub sort: Option<String>,

    #[arg(
        short = 'n',
        long = "limit",
        value_name = "n",
        help = "Stop after n results"
    )]
    pub limit: Option<usize>,

    #[arg(
        short = '0',
        long = "null",
        help = "NUL-terminate records (for 'values' and 'tsv'; pairs with xargs -0)"
    )]
    pub null: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Format {
    Human,
    Json,
    Jsonl,
    Tsv,
    Values,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum DoctorFormat {
    Human,
    Json,
    Jsonl,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum ExtractFormat {
    Human,
    Jsonl,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    #[command(visible_alias = "ls", about = "List sessions that match the selectors",
              after_long_help = SESSIONS_AFTER)]
    Sessions(SessionsArgs),

    #[command(visible_aliases = ["messages", "m"],
              about = "Search the decoded text of every store; show each hit in its session's context",
              after_long_help = GREP_AFTER)]
    Grep(GrepArgs),

    #[command(visible_alias = "f",
              about = "List files Claude read, created, or modified in the selected messages",
              after_long_help = FILES_AFTER)]
    Files(FilesArgs),

    #[command(visible_alias = "a", about = "List ~/.claude artifacts joined to the selected sessions",
              after_long_help = ARTIFACTS_AFTER)]
    Artifacts(ArtifactsArgs),

    #[command(about = "Render one session's transcript")]
    Show(ShowArgs),

    #[command(
        visible_alias = "x",
        about = "Recover file contents from the selected messages into a new directory",
        after_long_help = EXTRACT_AFTER
    )]
    Extract(ExtractArgs),

    #[command(about = "Count distinct values of a metadata field across the selection",
              after_long_help = FACETS_AFTER)]
    Facets(FacetsArgs),

    #[command(about = "Check roots for problems that would hide matches",
              after_long_help = DOCTOR_AFTER)]
    Doctor(DoctorArgs),

    #[command(about = "Manage the metadata cache", subcommand_required = true)]
    Index {
        #[command(subcommand)]
        command: IndexCommand,
    },

    #[command(about = "Print shell completion script")]
    Completion(CompletionArgs),
}

#[derive(Debug, Args)]
pub struct SessionsArgs {
    #[command(flatten)]
    pub select: SelectArgs,
    #[command(flatten)]
    pub output: OutputArgs,
    #[arg(
        short = 'f',
        long = "format",
        value_name = "format",
        value_enum,
        default_value = "human",
        help = "Output format"
    )]
    pub format: Format,
}

#[derive(Debug, Args)]
#[allow(clippy::struct_excessive_bools)]
pub struct GrepArgs {
    #[command(flatten)]
    pub select: SelectArgs,
    #[command(flatten)]
    pub output: OutputArgs,
    #[arg(
        short = 'f',
        long = "format",
        value_name = "format",
        value_enum,
        default_value = "human",
        help = "Output format"
    )]
    pub format: Format,

    #[arg(
        value_name = "pattern",
        help = "Literal text to find in decoded text (use -E for a regex)"
    )]
    pub pattern: Option<String>,

    #[arg(short = 'E', long = "regex", help = "Treat [pattern] as a regex")]
    pub regex: bool,

    #[arg(
        short = 'i',
        long = "ignore-case",
        overrides_with = "case_sensitive",
        help = "Case-insensitive [pattern]"
    )]
    pub ignore_case: bool,

    #[arg(
        short = 's',
        long = "case-sensitive",
        overrides_with = "ignore_case",
        help = "Case-sensitive [pattern] (default: smart case; an uppercase letter makes it case-sensitive)"
    )]
    pub case_sensitive: bool,

    #[arg(
        short = 'l',
        long = "files-with-matches",
        help = "Print only the paths of files that match, like rg -l"
    )]
    pub files_with_matches: bool,

    #[arg(long = "store", value_name = "kind", value_enum, action = ArgAction::Append,
          help = "Only search these stores (repeatable; default: every store)",
          long_help = STORE_LONG_HELP)]
    pub store: Vec<Store>,

    #[arg(long = "in", value_name = "sel", action = ArgAction::Append, default_value = "all",
          help = "Only hits with these raw labels: a line type (user), a part type (tool_result), or type/part (user/text); repeatable")]
    pub ins: Vec<String>,

    #[arg(long = "agree", value_name = "value", value_enum, action = ArgAction::Append,
          help = "Only user/text and history hits with this agreement (repeatable; other hits are kept)",
          long_help = AGREE_LONG_HELP)]
    pub agree: Vec<Agree>,

    #[arg(
        short = 'C',
        long = "context",
        value_name = "n",
        default_value = "0",
        help = "Also show n messages before/after each match within the session"
    )]
    pub context: usize,

    #[arg(short = 'u', action = ArgAction::Count, hide = true,
          help = "Accepted and ignored, for rg muscle memory (hidden and ignored files are always searched)")]
    pub unrestricted: u8,

    #[arg(
        long = "raw",
        help = "Emit the original JSONL lines unchanged (implies --format=jsonl)"
    )]
    pub raw: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Store {
    Transcripts,
    History,
    Plans,
    Todos,
    Tasks,
    FileHistory,
    Sessions,
    Workflows,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Agree {
    Both,
    TranscriptOnly,
    HistoryOnly,
    Unlinked,
    Unknown,
}

#[derive(Debug, Args)]
pub struct FilesArgs {
    #[command(flatten)]
    pub select: SelectArgs,
    #[command(flatten)]
    pub output: OutputArgs,
    #[arg(
        short = 'f',
        long = "format",
        value_name = "format",
        value_enum,
        default_value = "human",
        help = "Output format"
    )]
    pub format: Format,

    #[arg(long = "op", value_name = "op", value_enum, action = ArgAction::Append,
          help = "Which tool operations to count (repeatable; default: write and edit)",
          long_help = OP_LONG_HELP)]
    pub op: Vec<Op>,

    #[arg(long = "path", value_name = "glob", action = ArgAction::Append,
          help = "Only report paths matching this glob (the resolved absolute path)")]
    pub path: Vec<String>,

    #[arg(long = "relative", help = "Print paths relative to the session cwd")]
    pub relative: bool,

    #[arg(
        long = "created-only",
        help = "Only paths whose first event is a write (or rejected write), with no earlier backup holding content"
    )]
    pub created_only: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Op {
    Write,
    Edit,
    Read,
    Bash,
}

#[derive(Debug, Args)]
pub struct ArtifactsArgs {
    #[command(flatten)]
    pub select: SelectArgs,
    #[command(flatten)]
    pub output: OutputArgs,
    #[arg(
        short = 'f',
        long = "format",
        value_name = "format",
        value_enum,
        default_value = "human",
        help = "Output format"
    )]
    pub format: Format,

    #[arg(short = 'k', long = "kind", value_name = "kind", value_enum, action = ArgAction::Append,
          default_value = "all", help = "Artifact stores to include")]
    pub kind: Vec<ArtifactKind>,

    #[arg(
        long = "missing",
        help = "Report expected artifacts that are absent (e.g. snapshot entries with no backup file)"
    )]
    pub missing: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum ArtifactKind {
    FileHistory,
    Todos,
    Tasks,
    Plans,
    Subagents,
    Sessions,
    History,
    All,
}

#[derive(Debug, Args)]
#[allow(clippy::struct_excessive_bools)]
pub struct ShowArgs {
    #[arg(value_name = "session", help = "Session id or unique prefix")]
    pub session: String,

    #[arg(long = "from-root", value_name = "dir", value_hint = ValueHint::DirPath,
          help = "Which root's copy to show when --dedupe=none finds several")]
    pub from_root: Option<PathBuf>,

    #[arg(
        long = "tools",
        default_value_t = true,
        overrides_with = "no_tools",
        help = "Include tool calls and results"
    )]
    pub tools: bool,

    #[arg(long = "no-tools", overrides_with = "tools", help = "Negate --tools")]
    pub no_tools: bool,

    #[arg(long = "thinking", help = "Include thinking blocks")]
    pub thinking: bool,

    #[arg(long = "raw", help = "Print the original JSONL")]
    pub raw: bool,

    #[arg(
        long = "pager",
        env = "CLRG_PAGER",
        default_value_t = true,
        overrides_with = "no_pager",
        help = "Page human output"
    )]
    pub pager: bool,

    #[arg(long = "no-pager", overrides_with = "pager", help = "Negate --pager")]
    pub no_pager: bool,
}

#[derive(Debug, Args)]
#[allow(clippy::struct_excessive_bools)]
pub struct ExtractArgs {
    #[command(flatten)]
    pub select: SelectArgs,

    #[arg(short = 'o', long = "out", value_name = "dir", required = true,
          value_hint = ValueHint::DirPath, help = "Destination; must not exist or must be empty")]
    pub out: PathBuf,

    #[arg(long = "path", value_name = "glob", action = ArgAction::Append,
          help = "Only extract paths matching this glob")]
    pub path: Vec<String>,

    #[arg(
        long = "created-only",
        help = "Only paths whose first operation in scope is a Write to a path not seen earlier"
    )]
    pub created_only: bool,

    #[arg(long = "source", value_name = "source", value_enum, default_value = "best",
          help = "Where file content comes from", long_help = SOURCE_LONG_HELP)]
    pub source: Source,

    #[arg(
        long = "version",
        value_name = "which",
        value_enum,
        default_value = "last",
        help = "Which version of each file to write",
        long_help = VERSION_LONG_HELP
    )]
    pub version: Which,

    #[arg(long = "layout", value_name = "layout", value_enum, default_value = "cwd",
          help = "How to arrange output paths", long_help = LAYOUT_LONG_HELP)]
    pub layout: Layout,

    #[arg(long = "dry-run", help = "Print the plan without writing")]
    pub dry_run: bool,

    #[arg(
        long = "manifest",
        default_value_t = true,
        overrides_with = "no_manifest",
        help = "Write <out>/MANIFEST.jsonl with provenance per file (session, ts, source_event, outcome, sha256, ...)"
    )]
    pub manifest: bool,

    #[arg(
        long = "no-manifest",
        overrides_with = "manifest",
        help = "Negate --manifest"
    )]
    pub no_manifest: bool,

    #[arg(
        short = 'f',
        long = "format",
        value_name = "format",
        value_enum,
        default_value = "human",
        help = "Output format"
    )]
    pub format: ExtractFormat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Source {
    FileHistory,
    Transcript,
    Best,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Which {
    First,
    Last,
    All,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Layout {
    Cwd,
    Absolute,
    Session,
}

#[derive(Debug, Args)]
pub struct FacetsArgs {
    #[command(flatten)]
    pub select: SelectArgs,
    #[command(flatten)]
    pub output: OutputArgs,
    #[arg(
        short = 'f',
        long = "format",
        value_name = "format",
        value_enum,
        default_value = "human",
        help = "Output format"
    )]
    pub format: Format,

    #[arg(value_name = "field", value_enum, help = "Field to count")]
    pub field: Field,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Field {
    Branch,
    Cwd,
    Project,
    Model,
    CliVersion,
    Tool,
    Root,
    Day,
}

#[derive(Debug, Args)]
pub struct DoctorArgs {
    #[command(flatten)]
    pub output: OutputArgs,
    #[arg(
        short = 'f',
        long = "format",
        value_name = "format",
        value_enum,
        default_value = "human",
        help = "Output format"
    )]
    pub format: DoctorFormat,

    #[arg(
        long = "fix-index",
        help = "Rebuild index entries for any root that fails a check"
    )]
    pub fix_index: bool,
}

#[derive(Debug, Subcommand)]
pub enum IndexCommand {
    #[command(about = "Scan roots and update the cache incrementally")]
    Build {
        #[arg(long = "full", help = "Discard and rebuild from scratch")]
        full: bool,
    },
    #[command(about = "Show cache location, size, roots, and staleness")]
    Status,
    #[command(about = "Delete the cache file")]
    Clear,
}

#[derive(Debug, Args)]
pub struct CompletionArgs {
    #[arg(
        value_name = "shell",
        value_enum,
        help = "Shell to generate completions for"
    )]
    pub shell: Shell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Shell {
    Bash,
    Zsh,
    Fish,
}
