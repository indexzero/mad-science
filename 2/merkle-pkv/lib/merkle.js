'use strict'
// A binary Merkle tree over a SORTED list of fixed-size leaves, in the shape
// used by Certificate Transparency (RFC 6962 section 2.1):
//
//   MTH([])        = H()                       empty tree
//   MTH([d])       = H(0x00 || d)              leaf
//   MTH(D[0..n))   = H(0x01 || MTH(D[0..k)) || MTH(D[k..n)))   k = largest power of 2 < n
//
// The 0x00 / 0x01 prefixes are domain separation: a leaf can never be mistaken
// for an interior node (the classic second-preimage attack on naive trees).
// Leaves are kept sorted so (a) the root is the same no matter the insertion
// order, i.e. it commits to a SET, and (b) we can prove absence by showing the
// two neighbours a missing leaf would sit between.

const LEAF_PREFIX = Buffer.from([0x00])
const NODE_PREFIX = Buffer.from([0x01])

function largestPowerOfTwoBelow (n) {
  let k = 1
  while (k * 2 < n) k *= 2
  return k
}

function leafHash (H, leaf) { return H(LEAF_PREFIX, leaf) }
function nodeHash (H, left, right) { return H(NODE_PREFIX, left, right) }

function merkleRoot (H, leaves) {
  const n = leaves.length
  if (n === 0) return H()
  if (n === 1) return leafHash(H, leaves[0])
  const k = largestPowerOfTwoBelow(n)
  return nodeHash(H, merkleRoot(H, leaves.slice(0, k)), merkleRoot(H, leaves.slice(k)))
}

/**
 * Audit path for leaves[index]: the sibling hashes from the leaf up to the
 * root, each tagged with which side the sibling is on.
 */
function auditPath (H, leaves, index) {
  const n = leaves.length
  if (index < 0 || index >= n) throw new RangeError('index out of range')
  if (n === 1) return []
  const k = largestPowerOfTwoBelow(n)
  if (index < k) {
    return [...auditPath(H, leaves.slice(0, k), index), { hash: merkleRoot(H, leaves.slice(k)), side: 'right' }]
  }
  return [...auditPath(H, leaves.slice(k), index - k), { hash: merkleRoot(H, leaves.slice(0, k)), side: 'left' }]
}

/**
 * Verify that `leaf` sits at `proof.index` in a tree with head {root, size}.
 * Two checks: (1) the path hashes back up to `root`; (2) walking the same
 * split rule top-down with the path's left/right flags lands on `proof.index`.
 * Check (2) binds the index so a prover cannot lie about adjacency.
 */
function verifyInclusion (H, head, leaf, proof) {
  if (!head || !Buffer.isBuffer(head.root) || !Number.isInteger(head.size)) return false
  if (!proof || !Array.isArray(proof.path) || !Number.isInteger(proof.index)) return false

  let acc = leafHash(H, leaf)
  for (const step of proof.path) {
    if (!Buffer.isBuffer(step.hash) || step.hash.length !== H.bytes) return false
    acc = step.side === 'left' ? nodeHash(H, step.hash, acc) : nodeHash(H, acc, step.hash)
  }
  if (!acc.equals(head.root)) return false

  let lo = 0
  let n = head.size
  for (let i = proof.path.length - 1; i >= 0; i--) {
    if (n <= 1) return false
    const k = largestPowerOfTwoBelow(n)
    if (proof.path[i].side === 'right') n = k
    else { lo += k; n -= k }
  }
  return n === 1 && lo === proof.index
}

/** Index of the first leaf >= target (binary search over sorted leaves). */
function lowerBound (leaves, target) {
  let lo = 0
  let hi = leaves.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (Buffer.compare(leaves[mid], target) < 0) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Absence proof for a sorted tree: inclusion proofs for the neighbours the
 * target would sit between. Returns null if the target IS present.
 */
function proveAbsence (H, leaves, target) {
  const i = lowerBound(leaves, target)
  if (i < leaves.length && leaves[i].equals(target)) return null
  const neighbour = (idx) => idx < 0 || idx >= leaves.length
    ? null
    : { leaf: leaves[idx], index: idx, path: auditPath(H, leaves, idx) }
  return { left: neighbour(i - 1), right: neighbour(i) }
}

function verifyAbsence (H, head, target, proof) {
  if (!proof) return false
  const { left, right } = proof
  if (left) {
    if (!verifyInclusion(H, head, left.leaf, left) || Buffer.compare(left.leaf, target) >= 0) return false
  }
  if (right) {
    if (!verifyInclusion(H, head, right.leaf, right) || Buffer.compare(target, right.leaf) >= 0) return false
  }
  // adjacency: nothing can live between the two neighbours
  if (left && right) return right.index === left.index + 1
  if (!left && right) return right.index === 0
  if (left && !right) return left.index === head.size - 1
  return head.size === 0 && head.root.equals(H())
}

module.exports = { merkleRoot, auditPath, verifyInclusion, proveAbsence, verifyAbsence, lowerBound, leafHash, nodeHash }
