'use strict'
// PKV-KEY / PKV-VALUE / PKV-KV exactly as described in mikeal/pkv README.
// H is a hasher from ./hash.js: H(...parts) = hash(part0 || part1 || ...).

/**
 * PKV-KEY of a sequence of parts.
 *   step 1: k0 = H(H(parts[0]))          double-hash the first part (domain separation)
 *   step 2: ki = H(k(i-1) || H(parts[i])) for every later part
 * The final ki is the PKV-KEY. Every intermediate ki is itself the PKV-KEY of
 * the prefix parts[0..i], which is what PKV calls a "namespace".
 */
function pkvKey (H, parts) {
  if (!Array.isArray(parts) || parts.length === 0) throw new RangeError('PKV-KEY needs at least one part')
  let acc = H(H(parts[0]))
  for (let i = 1; i < parts.length; i++) acc = pkvExtend(H, acc, parts[i])
  return acc
}

/** One step of the chain: given the PKV-KEY of a prefix, derive the PKV-KEY of prefix + [part]. */
function pkvExtend (H, prefixKey, part) {
  return H(prefixKey, H(part))
}

/** Every prefix key, in order. pkvPrefixes(H, ['a','b','c']) -> [KEY(['a']), KEY(['a','b']), KEY(['a','b','c'])] */
function pkvPrefixes (H, parts) {
  const out = []
  let acc = null
  for (const part of parts) {
    acc = acc === null ? H(H(part)) : pkvExtend(H, acc, part)
    out.push(acc)
  }
  return out
}

/** PKV-VALUE = H(H(value) || PKV-KEY). Not needed for membership; here for completeness. */
function pkvValue (H, key, value) {
  return H(H(value), key)
}

/** PKV-KV = H(PKV-KEY || PKV-VALUE). The README omits the final "hash" verb; we assume it. */
function pkvKV (H, key, value) {
  return H(key, pkvValue(H, key, value))
}

module.exports = { pkvKey, pkvExtend, pkvPrefixes, pkvValue, pkvKV }
