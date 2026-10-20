//! The URL grammar, the key layout, the upload pass, the snapshot put, and the
//! host listing of section 8.5.
//!
//! This module never calls `delete`. It never reads `HOME`. It never mutates
//! the manifest. It never follows a link target. It reads a file body only in
//! `upload`, and the bytes it reads are the bytes it puts.

use std::path::Path as FsPath;
use std::path::PathBuf;
use std::sync::Arc;

use futures::TryStreamExt;
use object_store::path::{Path, PathPart};
use object_store::{ObjectStore, ObjectStoreExt, PutPayload};
use serde::Serialize;

use crate::manifest::{Action, Kind, Manifest, Plan};
use crate::scan::DenyList;

/// The parsed form of a `--store` URL. See Decision 4.6.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreUrl {
    /// `memory:`. State lives for one process.
    Memory,
    /// `file:<abs>` or `file://<abs>`. The directory must exist.
    File(PathBuf),
    /// `s3://<bucket>` or `s3://<bucket>/<prefix>`.
    S3 {
        bucket: String,
        prefix: Option<String>,
    },
}

impl StoreUrl {
    /// Parse the section 4.6 grammar. A `file:` path must be absolute. Any other
    /// scheme is `StoreError::Url`.
    pub fn parse(url: &str) -> Result<Self, StoreError> {
        if url == "memory:" {
            return Ok(Self::Memory);
        }
        if let Some(rest) = url.strip_prefix("file:") {
            let dir = rest.strip_prefix("//").unwrap_or(rest);
            if dir.is_empty() || !FsPath::new(dir).is_absolute() {
                return Err(StoreError::Url(format!(
                    "file: path must be absolute: {url}"
                )));
            }
            return Ok(Self::File(PathBuf::from(dir)));
        }
        if let Some(rest) = url.strip_prefix("s3://") {
            let (bucket, prefix) = match rest.split_once('/') {
                Some((b, p)) => (b, Some(p)),
                None => (rest, None),
            };
            if bucket.is_empty() {
                return Err(StoreError::Url(format!("s3: bucket is empty: {url}")));
            }
            let prefix = prefix
                .map(|p| p.trim_matches('/'))
                .filter(|p| !p.is_empty())
                .map(str::to_string);
            return Ok(Self::S3 {
                bucket: bucket.to_string(),
                prefix,
            });
        }
        Err(StoreError::Url(format!(
            "unsupported scheme, want memory:, file:, or s3://: {url}"
        )))
    }
}

/// An opened store and the key prefix from the URL ("" for none).
pub struct Opened {
    pub store: Arc<dyn ObjectStore>,
    pub prefix: Path,
}

/// Build the backend for `url`. `endpoint` applies to S3 only. An endpoint that
/// starts with `http://` also allows plain HTTP.
pub fn open(url: &StoreUrl, endpoint: Option<&str>) -> Result<Opened, StoreError> {
    match url {
        StoreUrl::Memory => Ok(Opened {
            store: Arc::new(object_store::memory::InMemory::new()),
            prefix: Path::default(),
        }),
        StoreUrl::File(dir) => Ok(Opened {
            store: Arc::new(object_store::local::LocalFileSystem::new_with_prefix(dir)?),
            prefix: Path::default(),
        }),
        StoreUrl::S3 { bucket, prefix } => {
            let mut builder =
                object_store::aws::AmazonS3Builder::from_env().with_bucket_name(bucket);
            if let Some(url) = endpoint {
                builder = builder.with_endpoint(url);
                if url.starts_with("http://") {
                    builder = builder.with_allow_http(true);
                }
            }
            Ok(Opened {
                store: Arc::new(builder.build()?),
                prefix: Path::from(prefix.as_deref().unwrap_or("")),
            })
        }
    }
}

/// The reserved segment under the host that holds links, tombstones, and manifests.
const META: &str = ".dotsync";

/// The key grammar of section 5. `prefix` is the store prefix from the URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    pub prefix: Path,
    pub host: String,
}

impl Layout {
    /// Bind a store prefix and a host name.
    pub fn new(prefix: Path, host: &str) -> Self {
        Self {
            prefix,
            host: host.to_string(),
        }
    }

    /// `[P/]H/R/p`, the content of a regular file.
    pub fn file_key(&self, root: &str, rel: &str) -> Path {
        self.key(&[&self.host, root], rel)
    }

    /// `[P/]H/.dotsync/R/links/p`, a link record.
    pub fn link_key(&self, root: &str, rel: &str) -> Path {
        self.key(&[&self.host, META, root, "links"], rel)
    }

    /// `[P/]H/.dotsync/R/tombstones/p`, a tombstone.
    pub fn tombstone_key(&self, root: &str, rel: &str) -> Path {
        self.key(&[&self.host, META, root, "tombstones"], rel)
    }

    /// `[P/]H/.dotsync/R/manifest.json`, the manifest snapshot.
    pub fn manifest_key(&self, root: &str) -> Path {
        self.key(&[&self.host, META, root], "manifest.json")
    }

    /// `[P/]H/.dotsync`, the list prefix for `ls`.
    pub fn meta_prefix(&self) -> Path {
        self.key(&[&self.host], META)
    }

    /// Join the encoded prefix parts with raw segments. Every raw segment goes
    /// through `PathPart::from`, which percent-encodes it once.
    fn key(&self, segments: &[&str], rel: &str) -> Path {
        let raw = segments
            .iter()
            .copied()
            .chain(rel.split('/'))
            .filter(|s| !s.is_empty())
            .map(PathPart::from);
        Path::from_iter(self.prefix.parts().chain(raw))
    }
}

/// The outcome of one upload pass over a `Plan`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct UploadReport {
    /// Indices into `plan.actions` that succeeded, in order.
    pub done: Vec<usize>,
    /// Bytes put during the pass.
    pub bytes: u64,
    /// The first error, if the pass stopped early.
    pub failed: Option<(usize, String)>,
    /// Actions whose bytes differed from the plan at upload time: (index, new hash, new size).
    pub rehashed: Vec<(usize, String, u64)>,
}

/// The body of a link record, Decision 4.8.
#[derive(Serialize)]
struct LinkRecord<'a> {
    target: &'a str,
}

/// The body of a tombstone, section 5.
#[derive(Serialize)]
struct Tombstone<'a> {
    path: &'a str,
    kind: Kind,
    deleted_at_ns: u64,
    generation: u64,
}

/// Run every action of `plan` against the store, in order.
///
/// Every `rel` is checked against `deny` before the first put. A denied `rel`
/// returns `StoreError::Denied` and nothing is put. A store or read error stops
/// the pass. The report then has `failed` set and `done` lists the actions
/// that succeeded, so `manifest::apply` records exactly those.
///
/// A file is read whole into memory and hashed again. The bytes read are what is
/// put. When the hash or size differs from the plan, `rehashed` records the new
/// values. A tombstone body is section 5. A link body is Decision 4.8.
#[allow(clippy::too_many_arguments)]
pub async fn upload(
    store: &dyn ObjectStore,
    layout: &Layout,
    root_name: &str,
    root_dir: &FsPath,
    deny: &DenyList,
    plan: &Plan,
    generation: u64,
    now_ns: u64,
) -> Result<UploadReport, StoreError> {
    for action in &plan.actions {
        if deny.is_denied(action.rel()) {
            return Err(StoreError::Denied(action.rel().to_string()));
        }
    }
    let mut report = UploadReport::default();
    for (i, action) in plan.actions.iter().enumerate() {
        match put_action(
            store, layout, root_name, root_dir, action, generation, now_ns,
        )
        .await
        {
            Ok(Put::Content { bytes, rehashed }) => {
                report.bytes += bytes;
                if let Some((hash, size)) = rehashed {
                    report.rehashed.push((i, hash, size));
                }
                report.done.push(i);
            }
            Ok(Put::Nothing) => report.done.push(i),
            Err(e) => {
                report.failed = Some((i, e.to_string()));
                return Ok(report);
            }
        }
    }
    Ok(report)
}

/// What one action put.
enum Put {
    /// Bytes went to the store. `rehashed` is set when a file differed from the plan.
    Content {
        bytes: u64,
        rehashed: Option<(String, u64)>,
    },
    /// A `Touch`. Nothing is put.
    Nothing,
}

/// Put one action. The deny check already happened in `upload`.
async fn put_action(
    store: &dyn ObjectStore,
    layout: &Layout,
    root_name: &str,
    root_dir: &FsPath,
    action: &Action,
    generation: u64,
    now_ns: u64,
) -> Result<Put, StoreError> {
    match action {
        Action::Upload { rel, entry } => {
            let abs = root_dir.join(rel);
            let bytes = tokio::fs::read(&abs)
                .await
                .map_err(|source| StoreError::Io { path: abs, source })?;
            let size = bytes.len() as u64;
            let hash = blake3::hash(&bytes).to_hex().to_string();
            let rehashed = (hash != entry.hash || size != entry.size).then_some((hash, size));
            store
                .put(&layout.file_key(root_name, rel), PutPayload::from(bytes))
                .await?;
            Ok(Put::Content {
                bytes: size,
                rehashed,
            })
        }
        Action::Link { rel, entry } => {
            let body = serde_json::to_vec(&LinkRecord {
                target: entry.target.as_deref().unwrap_or(""),
            })?;
            let size = body.len() as u64;
            store
                .put(&layout.link_key(root_name, rel), PutPayload::from(body))
                .await?;
            Ok(Put::Content {
                bytes: size,
                rehashed: None,
            })
        }
        Action::Tombstone { rel, kind } => {
            let body = serde_json::to_vec(&Tombstone {
                path: rel,
                kind: *kind,
                deleted_at_ns: now_ns,
                generation,
            })?;
            let size = body.len() as u64;
            store
                .put(
                    &layout.tombstone_key(root_name, rel),
                    PutPayload::from(body),
                )
                .await?;
            Ok(Put::Content {
                bytes: size,
                rehashed: None,
            })
        }
        Action::Touch { .. } => Ok(Put::Nothing),
    }
}

/// Put `manifest.to_json()` at `layout.manifest_key(&manifest.root)`.
pub async fn put_manifest(
    store: &dyn ObjectStore,
    layout: &Layout,
    manifest: &Manifest,
) -> Result<(), StoreError> {
    let body = manifest.to_json()?;
    store
        .put(&layout.manifest_key(&manifest.root), PutPayload::from(body))
        .await?;
    Ok(())
}

/// One live entry from a manifest snapshot, for `ls --host`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Listed {
    pub root: String,
    pub rel: String,
    pub kind: Kind,
    pub target: Option<String>,
    pub size: u64,
}

/// List the meta prefix of the host, read every `manifest.json` under it, and
/// return every entry with `deleted == false`, sorted by root then rel.
pub async fn list_host(
    store: &dyn ObjectStore,
    layout: &Layout,
) -> Result<Vec<Listed>, StoreError> {
    let prefix = layout.meta_prefix();
    let mut stream = store.list(Some(&prefix));
    let mut keys = Vec::new();
    while let Some(meta) = stream.try_next().await? {
        if meta.location.filename() == Some("manifest.json") {
            keys.push(meta.location);
        }
    }
    let mut out = Vec::new();
    for key in &keys {
        let bytes = store.get(key).await?.bytes().await?;
        let manifest = Manifest::from_json(&bytes)?;
        for (rel, entry) in &manifest.entries {
            if entry.deleted {
                continue;
            }
            out.push(Listed {
                root: manifest.root.clone(),
                rel: rel.clone(),
                kind: entry.kind,
                target: entry.target.clone(),
                size: entry.size,
            });
        }
    }
    out.sort_by(|a, b| (&a.root, &a.rel).cmp(&(&b.root, &b.rel)));
    Ok(out)
}

/// The one error type of this module.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("store url: {0}")]
    Url(String),
    #[error("object store: {0}")]
    Object(#[from] object_store::Error),
    #[error("io at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("denied path reached the uploader: {0}")]
    Denied(String),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Manifest(#[from] crate::manifest::ManifestError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::Entry;
    use crate::scan::{self, Scope};
    use object_store::memory::InMemory;
    use std::fs;

    const HOST: &str = "alpha";
    const ROOT: &str = "root";
    const T0: u64 = 1_760_976_000_000_000_000;

    struct Fx {
        dir: tempfile::TempDir,
        deny: DenyList,
        store: InMemory,
        layout: Layout,
    }

    impl Fx {
        fn new() -> Self {
            Self {
                dir: tempfile::TempDir::new().unwrap(),
                deny: DenyList::default_list().unwrap(),
                store: InMemory::new(),
                layout: Layout::new(Path::default(), HOST),
            }
        }

        fn root(&self) -> &FsPath {
            self.dir.path()
        }

        fn write(&self, rel: &str, body: &[u8]) {
            fs::write(self.root().join(rel), body).unwrap();
        }

        fn plan(&self, m: &Manifest) -> Plan {
            let snap = scan::scan(self.root(), &self.deny, Scope::Full, T0).unwrap();
            m.diff(self.root(), &snap).unwrap()
        }

        async fn upload(&self, plan: &Plan) -> Result<UploadReport, StoreError> {
            upload(
                &self.store,
                &self.layout,
                ROOT,
                self.root(),
                &self.deny,
                plan,
                1,
                T0,
            )
            .await
        }

        async fn keys(&self) -> Vec<String> {
            let mut out: Vec<String> = self
                .store
                .list(None)
                .try_collect::<Vec<_>>()
                .await
                .unwrap()
                .into_iter()
                .map(|m| m.location.to_string())
                .collect();
            out.sort();
            out
        }

        async fn body(&self, key: &str) -> Option<Vec<u8>> {
            match self.store.get(&Path::from(key)).await {
                Ok(r) => Some(r.bytes().await.unwrap().to_vec()),
                Err(object_store::Error::NotFound { .. }) => None,
                Err(e) => panic!("{e}"),
            }
        }
    }

    fn file_entry(size: u64, hash: &str) -> Entry {
        Entry {
            kind: Kind::File,
            size,
            mtime_ns: T0,
            inode: 1,
            hash: hash.to_string(),
            target: None,
            uploaded_version: 0,
            deleted: false,
        }
    }

    #[tokio::test]
    async fn dl_1_credentials_json_never_reaches_store() {
        let fx = Fx::new();
        fx.write(".credentials.json", b"{\"k\":\"v\"}");
        fx.write("ok.txt", b"ok");
        let m = Manifest::new(HOST, ROOT);
        let plan = fx.plan(&m);
        assert_eq!(plan.actions.len(), 1);
        let report = fx.upload(&plan).await.unwrap();
        assert_eq!(report.done, vec![0]);
        let keys = fx.keys().await;
        assert_eq!(keys, vec!["alpha/root/ok.txt".to_string()]);
        assert!(keys.iter().all(|k| !k.contains(".credentials.json")));

        let forged = Plan {
            actions: vec![Action::Upload {
                rel: ".credentials.json".to_string(),
                entry: file_entry(9, "0"),
            }],
        };
        let err = fx.upload(&forged).await.unwrap_err();
        assert!(matches!(err, StoreError::Denied(ref r) if r == ".credentials.json"));
        let keys = fx.keys().await;
        assert_eq!(keys, vec!["alpha/root/ok.txt".to_string()]);
    }

    #[tokio::test]
    async fn store_symlink_uploads_link_record_under_meta_prefix() {
        let fx = Fx::new();
        std::os::unix::fs::symlink("../t", fx.root().join("l")).unwrap();
        let m = Manifest::new(HOST, ROOT);
        let plan = fx.plan(&m);
        assert!(matches!(&plan.actions[..], [Action::Link { rel, .. }] if rel == "l"));
        let report = fx.upload(&plan).await.unwrap();
        assert_eq!(report.done, vec![0]);
        assert_eq!(
            fx.body("alpha/.dotsync/root/links/l").await.as_deref(),
            Some(&b"{\"target\":\"../t\"}"[..])
        );
        assert_eq!(fx.body("alpha/root/l").await, None);
    }

    #[tokio::test]
    async fn store_tombstone_is_written_never_deleted() {
        let fx = Fx::new();
        fx.write("f", b"body");
        let mut m = Manifest::new(HOST, ROOT);
        let plan = fx.plan(&m);
        let report = fx.upload(&plan).await.unwrap();
        m.apply(&plan, &report);
        let before = fx.keys().await.len();
        assert_eq!(before, 1);

        fs::remove_file(fx.root().join("f")).unwrap();
        let plan = fx.plan(&m);
        assert!(matches!(
            &plan.actions[..],
            [Action::Tombstone { rel, kind: Kind::File }] if rel == "f"
        ));
        let report = fx.upload(&plan).await.unwrap();
        assert_eq!(report.done, vec![0]);

        assert_eq!(fx.body("alpha/root/f").await.as_deref(), Some(&b"body"[..]));
        let tomb = fx.body("alpha/.dotsync/root/tombstones/f").await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&tomb).unwrap();
        assert_eq!(v["kind"], "file");
        assert_eq!(v["path"], "f");
        assert_eq!(v["generation"], 1);
        assert_eq!(v["deleted_at_ns"], T0);
        assert_eq!(fx.keys().await.len(), before + 1);
    }

    #[tokio::test]
    async fn store_keys_follow_layout() {
        let l = Layout::new(Path::default(), "host-a");
        let rel = "projects/x/y.jsonl";
        assert_eq!(
            l.file_key("claude", rel).as_ref(),
            "host-a/claude/projects/x/y.jsonl"
        );
        assert_eq!(
            l.link_key("claude", rel).as_ref(),
            "host-a/.dotsync/claude/links/projects/x/y.jsonl"
        );
        assert_eq!(
            l.tombstone_key("claude", rel).as_ref(),
            "host-a/.dotsync/claude/tombstones/projects/x/y.jsonl"
        );
        assert_eq!(
            l.manifest_key("claude").as_ref(),
            "host-a/.dotsync/claude/manifest.json"
        );
        assert_eq!(l.meta_prefix().as_ref(), "host-a/.dotsync");

        let p = Layout::new(Path::from("backup"), "host-a");
        for key in [
            p.file_key("claude", rel),
            p.link_key("claude", rel),
            p.tombstone_key("claude", rel),
            p.manifest_key("claude"),
            p.meta_prefix(),
        ] {
            assert!(key.as_ref().starts_with("backup/"), "{key}");
        }
        assert_eq!(
            p.file_key("claude", rel).as_ref(),
            "backup/host-a/claude/projects/x/y.jsonl"
        );
        assert_eq!(
            p.file_key("claude", "a~b").as_ref(),
            "backup/host-a/claude/a%7Eb"
        );
    }

    #[test]
    fn store_url_grammar() {
        assert_eq!(StoreUrl::parse("memory:").unwrap(), StoreUrl::Memory);
        assert_eq!(
            StoreUrl::parse("file:/abs").unwrap(),
            StoreUrl::File(PathBuf::from("/abs"))
        );
        assert_eq!(
            StoreUrl::parse("file:///abs").unwrap(),
            StoreUrl::File(PathBuf::from("/abs"))
        );
        assert_eq!(
            StoreUrl::parse("s3://b").unwrap(),
            StoreUrl::S3 {
                bucket: "b".to_string(),
                prefix: None
            }
        );
        assert_eq!(
            StoreUrl::parse("s3://b/p").unwrap(),
            StoreUrl::S3 {
                bucket: "b".to_string(),
                prefix: Some("p".to_string())
            }
        );
        assert!(matches!(
            StoreUrl::parse("file:rel"),
            Err(StoreError::Url(_))
        ));
        assert!(matches!(
            StoreUrl::parse("ftp://x"),
            Err(StoreError::Url(_))
        ));
    }

    #[tokio::test]
    async fn store_list_host_reads_snapshots() {
        let fx = Fx::new();
        let mut a = Manifest::new(HOST, "claude");
        a.entries.insert("z.txt".to_string(), file_entry(1, "h1"));
        a.entries.insert("a.txt".to_string(), file_entry(2, "h2"));
        let mut gone = file_entry(3, "h3");
        gone.deleted = true;
        a.entries.insert("gone.txt".to_string(), gone);
        let mut b = Manifest::new(HOST, "bin");
        b.entries.insert("tool".to_string(), file_entry(4, "h4"));
        put_manifest(&fx.store, &fx.layout, &a).await.unwrap();
        put_manifest(&fx.store, &fx.layout, &b).await.unwrap();
        let other = Layout::new(Path::default(), "beta");
        let mut c = Manifest::new("beta", "claude");
        c.entries.insert("x".to_string(), file_entry(5, "h5"));
        put_manifest(&fx.store, &other, &c).await.unwrap();

        let listed = list_host(&fx.store, &fx.layout).await.unwrap();
        let summary: Vec<(&str, &str, u64)> = listed
            .iter()
            .map(|l| (l.root.as_str(), l.rel.as_str(), l.size))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("bin", "tool", 4),
                ("claude", "a.txt", 2),
                ("claude", "z.txt", 1)
            ]
        );
        assert_eq!(list_host(&fx.store, &other).await.unwrap().len(), 1);
    }
}
