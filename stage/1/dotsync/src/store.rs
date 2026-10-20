//! The URL grammar, the key layout, and the upload pass of section 8.5. M3 fills this module.
//! M1 carries `UploadReport` because `manifest::apply` reads it.

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
