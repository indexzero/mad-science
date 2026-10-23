---
title: "brave-sync: a literate read-only client"
status: "Complete. Every chunk tangles, the 27 tests pass, and a pull of the throwaway chain from a local go-sync decrypted every entity."
written: 2026-10-22
sources:
  - "brave/go-sync ca8d4e1e60faec3cbfac295b0c4d81eb463bccdf, vendored at vendor/go-sync (citations use the upstream files, git show HEAD:<path>, not the patched tree)"
  - "brave/brave-core b503dc1ba8d27caf6297d528f41a9f4a72b58a54 (master on 2026-10-22)"
  - "chromium/src 156.0.8078.48, the tag brave-core's package.json targets"
tangle: "node client/tangle.mjs LITERATE.md client"
chain_crypto: "client/src/chain-crypto.js, contract and implementation in §2"
on_conflict: "The Architecture section of PROMPT.md wins over this document."
---

# brave-sync: a literate read-only client

This document is the whole brave-sync client. It explains every line in the
order a reader needs it, and cites the server code, the protos and the
Brave and Chromium sources each line depends on. One module, `ChainCrypto`,
touches the sync code. It turns the code into a client ID, access tokens, and
decrypted entities. §2 states its contract first, then implements it. Every
other module calls it only through that contract.

## 0. How to read this

**Tangling.** Every code block whose info string reads `file=PATH` belongs to
`client/PATH`. Blocks for one file appear in the same order as in the file,
and the tangler joins them with one blank line. [Appendix A](#appendix-a-the-tangler)
holds the tangler. Copy it to `client/tangle.mjs` once, and from then on run:

```sh
cd stage/1/brave-sync
node client/tangle.mjs LITERATE.md client
cd client && npm install && npm run proto && npm test
```

`npm install` writes `package-lock.json` and `npm run proto` writes
`src/proto/sync_pb.json`. Commit both: the prompt requires a lockfile, and the
JSON bindings mean an edge build never needs the generator.

**Citations.** A citation names a repository, a path and a line range, at the
commits in the frontmatter. `go-sync` paths are relative to `vendor/go-sync/`.
`brave-core` and `chromium` paths are relative to their repository roots. Each
claim carries one of three marks:

- **[code]**: verified in code. I read the cited lines.
- **[test]**: verified by test. I ran something and saw the result (§13 lists the runs).
- **[inferred]**: reasoned from names, comments or behavior. It is not verified.

**Ground rules this code enforces.** The client is read-only, and it requests
only NIGORI, SESSIONS and HISTORY (Q-001). The sync code comes only from the
file named by `BRAVE_SYNC_CODE_FILE`. The code, the seed, the derived keys and
the tokens are never written to disk or to a log. Tests use synthetic, public
vectors only.

## 1. The shape of the client

brave-sync is one more member of the owner's sync chain (A3). It sends
GetUpdates requests and never sends a Commit. It decrypts what the other
devices sync, and it appends every version it sees to JSON lines files that
nothing truncates (A4).

```
BRAVE_SYNC_CODE_FILE ──► ChainCrypto ──────────────┐ token per request
                          ▲        ▲               ▼
state.json ─► markers ─► GetUpdates loop ─► transport ─► POST {server}/command/
                          │        │               │
                          │        └── entries ◄───┘
          NIGORI ─────────┘ setNigori
          SESSIONS, HISTORY ─► decrypt ─► EntitySpecifics ─► records
                                                              │
               archive/*.jsonl  ◄── append + fsync ◄──────────┘
               archive/state.json ◄── rename, after the append
```

| File | Job | Runtime |
|---|---|---|
| `src/chain-crypto.js` | The sync code: words, signing keys, token, keybag, decryption (§2) | Web Crypto, `@noble`, `@scure` |
| `src/proto.js` | Protobuf bindings and token decoding (§3) | portable |
| `src/transport.js` | One HTTP POST per message, and the read-only guard (§4) | `fetch` |
| `src/get-updates.js` | The GetUpdates loop with progress markers (§5) | portable |
| `src/decode.js` | Entities to records, decrypting as needed (§6) | portable |
| `src/sessions.js` | SESSIONS to tab snapshots (§7) | portable |
| `src/history.js`, `src/time.js` | HISTORY to visits, and time conversion (§8) | portable |
| `src/archive.js` | The append-only archive and the state file (§9) | Node only |
| `src/pull.js` | One pull, from markers to archived records (§10) | portable |
| `src/cli.js` | `pull`, `watch`, `status` (§11) | Node only |

The core uses only `fetch`, Web Crypto, protobufjs and three small pure-JS
crypto packages. The two Node-only files are the adapter that A8 calls for.

## 2. ChainCrypto

The rest of the client needs four functions from the sync code. §2.1 to §2.6
define what each one must do, and §2.7 implements them. The sources are
brave-core `components/brave_sync/` (the words, the seed, the signing keys),
brave-core `components/sync/service/brave_sync_auth_manager.cc` (the token),
and Chromium `components/sync/model/crypto/` and `components/sync/nigori/`
(the keybag and entity encryption). For the server's side of the token, see
go-sync `auth/auth.go:39-115`.

### 2.1 `openChain(syncCode) → Promise<Chain>`

`syncCode` is the content of the file named by `BRAVE_SYNC_CODE_FILE`, with
leading and trailing whitespace trimmed (§11). Every other decision about the
words belongs to ChainCrypto: splitting them, the 24-word versus 25-word forms,
and the time-limited word (brave-core `components/brave_sync/time_limited_words.cc`).
The resolved chain holds its keys in memory only.

### 2.2 `chain.clientId: string`

This is the hex Ed25519 public key, in exactly the form go-sync keys the chain
by. go-sync takes the chain ID from the token's third field as is
(go-sync `auth/auth.go:53`, `:88`) **[code]** and uses it as a string key
throughout the datastore. Case therefore matters. Brave writes the key with
`base::HexEncode`, which is uppercase (brave-core
`components/sync/service/brave_sync_auth_manager.cc:81`, `:102`) **[code]**.
The throwaway chain in `vendor/go-sync-dev.db` is keyed `556E89CCD8F…`, also
uppercase **[test]**. A lowercase client ID would address a different, empty
chain. The golden test in Phase 2 of the prompt compares `clientId` with the
CHAIN column of `hack/dev.sh sqlite`, which prints only a prefix. It passes:
the throwaway code gives `556E89CCD8F…` **[test]**.

The loop uses `clientId` only to build the `share` field (§5.1).

### 2.3 `chain.accessToken(nowMs) → Promise<string>`

This resolves to the string that follows `Bearer ` in the `Authorization`
header. It must be a token that go-sync's `authenticate` accepts: it must
parse, the signature must verify, and the time must fall within one day of the
server clock (go-sync `auth/auth.go:20`, `:42-89`) **[code]**. The transport
calls it once per request with `Date.now()`, so no token is ever cached or
stored (§4.3).

Two facts shaped the implementation:

- go-sync decodes the token with `base64.URLEncoding` (`auth/auth.go:43`) and
  Brave encodes it with `base::Base64Encode`, the standard alphabet
  (`brave_sync_auth_manager.cc:117`). For this payload the two agree. The
  payload is only hex digits and `|`, and no 6-bit group of those bytes is 62
  or 63, so neither `+`, `/`, `-` nor `_` can appear **[inferred]**, checked by
  hand over the byte ranges `0x30-0x39`, `0x41-0x46`, `0x61-0x66` and `0x7C`.
- Brave reads the time from a network time service
  (`brave_sync_auth_manager.cc:71-76`, `:126-136`). go-sync at this commit has
  no time route: `/v2` serves only `POST /command/` (go-sync
  `controller/controller.go:27-33`, `server/server.go:83-86`) **[code]**. So
  the client uses its own clock. A rejected token surfaces as an `HttpError`
  carrying the server's `Date` header, which makes clock skew visible (§4.2).

### 2.4 `chain.setNigori(nigori) → Promise<void>`

`nigori` is the decoded `NigoriSpecifics` of the NIGORI entity, in the plain
form `decode` produces (§3.3): bytes as base64 strings, int64 values as decimal
strings, enums as names. The fields ChainCrypto reads are its own business. The
keybag is `encryption_keybag`, an `EncryptedData` (go-sync
`schema/protobuf/sync_pb/nigori_specifics.proto:63-65`) **[code]**. The
decoder calls `setNigori` for every NIGORI entity it sees, before any other
entity in the same response (§6.3). Each call replaces the keybag. If the
keybag cannot be decrypted, the promise rejects and the pull fails without
writing anything.

### 2.5 `chain.decrypt(encrypted) → Promise<Uint8Array>`

`encrypted` is `{ keyName, blob }`, the plain form of `EncryptedData`, where
`blob` is base64 text (go-sync `schema/protobuf/sync_pb/encryption.proto:33-35`)
**[code]**. The promise resolves to the bytes of a serialized
`EntitySpecifics`, whose one variant must be the same type as the entity that
carried it. §6.2 checks this, and every entity on the throwaway chain passed
**[test]**.

If `keyName` is not in the keybag, the promise rejects with an error whose
`code` is `'UNKNOWN_KEY'`. Any other rejection means the data failed its
integrity check. Either way the batch fails and nothing is written (§6.4).

### 2.6 Invariants

- ChainCrypto writes nothing to disk and logs nothing.
- No error message contains the code, the seed, a key or a token. The CLI
  prints `error.message`.
- Every method is async, because Web Crypto is (A8).

### 2.7 The implementation

#### 2.7.1 Libraries and helpers

```js file=src/chain-crypto.js
import { mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import * as ed from '@noble/ed25519';
import { scrypt } from '@noble/hashes/scrypt.js';
import { EncryptionKeys, decode } from './proto.js';

const { subtle } = globalThis.crypto;
const utf8 = new TextEncoder();

const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
```

Web Crypto does most of the work: HKDF, PBKDF2, AES-CBC and HMAC, which are
available in Node and at the edge (A8). It lacks three things, and each comes
from a small, audited, pure-JS package the prompt names:

- `@scure/bip39` turns the words into bytes. brave-core calls wally's
  `bip39_mnemonic_to_bytes` with a null word list (brave-core
  `components/brave_sync/crypto/crypto.cc:146-157`), which means wally's
  default, English **[inferred]**. The public test vectors below confirm it.
- `@noble/ed25519` signs. It is RFC 8032 Ed25519, the same scheme as
  BoringSSL's `ED25519_keypair_from_seed` and `ED25519_sign`, which brave-core
  uses (`crypto.cc:44-68`).
- `@noble/hashes` supplies scrypt, which Web Crypto does not have.

`toHex` writes uppercase, because Brave's `base::HexEncode` does (§2.2).

Every constant below that comes from Brave or Chromium has a comment with an
`https://` link to the exact lines, at the commits in the frontmatter. The
salts are not secrets. Every copy of Brave and Chromium ships them, and the
client has to use the same bytes to derive the same keys.

#### 2.7.2 The words

```js file=src/chain-crypto.js
export function pureWords(syncCode) {
  const words = syncCode.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length !== 24 && words.length !== 25) {
    throw new Error(`a sync code has 24 or 25 words, this one has ${words.length}`);
  }
  const pure = words.slice(0, 24).join(' ');
  if (!validateMnemonic(pure, wordlist)) throw new Error('the sync code is not a valid BIP39 mnemonic');
  return pure;
}
```

This follows Brave's `TimeLimitedWords` parser (brave-core
`components/brave_sync/time_limited_words.cc`). It splits on any whitespace
(`:36-40`), takes 24 or 25 words (`:147-194`), keeps the first 24, and checks
them as a BIP39 mnemonic, checksum included, just as `IsPassphraseValid` does
(`crypto.cc:146-162`). Words are lowercased, as Brave does when it looks up the
25th word (`:65-66`).

The 25th word encodes the day the code was shown: its index in the word list
is the number of days since 2022-05-10 (`:117-140`). Brave refuses a 25th word
more than a day off, and it refuses bare 24-word codes after 2022-08-01
(`:155-188`). brave-sync accepts both regardless of date, as Brave's own
`ParseIgnoreDate` does (`:203-206`). The time limit protects a code shown on a
screen or in a QR code. An archiver keeps running long after the code was
shown, and it reads the code from a file only you can read (mode `0600` on the
throwaway file).

Errors give the word count but never a word. A test checks this.

#### 2.7.3 The signing keys

```js file=src/chain-crypto.js
// Brave's fixed HKDF salt and info for the sync signing key, copied byte for
// byte from brave-core BraveSyncAuthManager::DeriveSigningKeys:
// https://github.com/brave/brave-core/blob/b503dc1ba8d27caf6297d528f41a9f4a72b58a54/components/sync/service/brave_sync_auth_manager.cc#L43-L53
// The same 64 bytes appear in brave-core's Ed25519KeyDerivation test:
// https://github.com/brave/brave-core/blob/b503dc1ba8d27caf6297d528f41a9f4a72b58a54/components/brave_sync/crypto/crypto_unittest.cc#L123-L128
const SIGNING_SALT = Uint8Array.from([
  72, 203, 156, 43, 64, 229, 225, 127, 214, 158, 50, 29, 130, 186, 182, 207, 6, 108, 47, 254, 245, 71,
  198, 109, 44, 108, 32, 193, 221, 126, 119, 143, 112, 113, 87, 184, 239, 231, 230, 234, 28, 135, 54,
  42, 9, 243, 39, 30, 179, 147, 194, 211, 212, 239, 225, 52, 192, 219, 145, 40, 95, 19, 142, 98,
]);
const SIGNING_INFO = utf8.encode('sync-auth-key');

// HKDF-SHA512 to a 32-byte Ed25519 seed, as brave-core's HKDFSha512 and
// DeriveSigningKeysFromSeed do:
// https://github.com/brave/brave-core/blob/b503dc1ba8d27caf6297d528f41a9f4a72b58a54/components/brave_sync/crypto/crypto.cc#L31-L58
export async function hkdfSha512(ikm, salt, info, length) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-512', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

export async function signingKeys(seed, info = SIGNING_INFO) {
  const secretKey = await hkdfSha512(seed, SIGNING_SALT, info, 32);
  return { secretKey, publicKey: await ed.getPublicKeyAsync(secretKey) };
}
```

The seed is the 32 bytes of BIP39 *entropy* the words encode. It is not
BIP39's PBKDF2 "seed" (`crypto.cc:146-157`). HKDF-SHA512 turns it into 32
bytes with Brave's fixed 64-byte salt and the info string `sync-auth-key`
(brave-core `brave_sync_auth_manager.cc:38-56`, `crypto.cc:31-58`), and those
32 bytes are the Ed25519 private seed **[code]**. The public key is the client
ID.

`signingKeys` takes `info` as a parameter only so the test can reproduce
brave-core's `Ed25519KeyDerivation` vector, which uses the info `{0}`
(`components/brave_sync/crypto/crypto_unittest.cc:122-142`). The HKDF test uses
the vectors brave-core tests against (`:26-120`) **[test]**.

#### 2.7.4 The passphrase keys

```js file=src/chain-crypto.js
// Chromium's constant salt for the legacy PBKDF2 Nigori method, from
// Nigori::Keys::InitByDerivationUsingPbkdf2:
// https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.48/components/sync/model/crypto/nigori.cc#111
// Old Chromium (<= M70) computed it as PBKDF2-HMAC-SHA1(Ns("dummy") +
// Ns("localhost"), "saltsalt", 1001, 16 bytes), where Ns(s) is s preceded by
// its 4-byte big-endian length (nigori.cc#106). Recomputing it gives these bytes.
const PBKDF2_SALT = Uint8Array.from([
  0xc7, 0xca, 0xfb, 0x23, 0xec, 0x2a, 0x9d, 0x4c, 0x03, 0x5a, 0x90, 0xae, 0xed, 0x8b, 0xa4, 0x98,
]);

async function pbkdf2Sha1(password, iterations) {
  const key = await subtle.importKey('raw', utf8.encode(password), 'PBKDF2', false, ['deriveBits']);
  const params = { name: 'PBKDF2', hash: 'SHA-1', salt: PBKDF2_SALT, iterations };
  return new Uint8Array(await subtle.deriveBits(params, key, 128));
}

// The two Nigori key derivations, from nigori.cc:
//   PBKDF2: 1003 iterations for the encryption key, 1004 for the MAC key
//     https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.48/components/sync/model/crypto/nigori.cc#136
//   scrypt: N = 8192, r = 8, p = 11, 32 bytes split in two
//     https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.48/components/sync/model/crypto/nigori.cc#157
// The method numbers (0 and 1 are PBKDF2, 2 is scrypt) come from
// https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.48/components/sync/base/passphrase_enums.cc#75
// The scrypt salt is not a constant: each chain stores its own, base64, in
// NigoriSpecifics.custom_passphrase_key_derivation_salt
// https://github.com/brave/go-sync/blob/ca8d4e1e60faec3cbfac295b0c4d81eb463bccdf/schema/protobuf/sync_pb/nigori_specifics.proto#L227-L232
// and Chromium base64-decodes it the same way:
// https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.48/components/sync/nigori/nigori_sync_bridge_impl.cc#70
export async function deriveNigoriKeys(password, method, scryptSalt) {
  if (method === 0 || method === 1) {
    return { encryptionKey: await pbkdf2Sha1(password, 1003), macKey: await pbkdf2Sha1(password, 1004) };
  }
  if (method === 2) {
    const keys = scrypt(utf8.encode(password), scryptSalt, { N: 8192, r: 8, p: 11, dkLen: 32 });
    return { encryptionKey: keys.slice(0, 16), macKey: keys.slice(16) };
  }
  throw new Error(`unsupported custom passphrase key derivation method ${method}`);
}
```

The custom passphrase becomes two 16-byte keys, one for AES-128 and one for
HMAC-SHA256, by one of two methods (chromium
`components/sync/model/crypto/nigori.cc:105-170`) **[code]**:

- **PBKDF2-HMAC-SHA1** with a constant 16-byte salt: 1003 iterations for the
  encryption key and 1004 for the MAC key. A third key at 1002 iterations is
  derived and never used, so it is skipped here.
- **scrypt** with N = 8192, r = 8, p = 11 and the salt from the NIGORI
  entity, giving 32 bytes that split into the two keys.

`custom_passphrase_key_derivation_method` picks the method: 0 (unset, from
old clients) and 1 mean PBKDF2, and 2 means scrypt (chromium
`components/sync/base/passphrase_enums.cc:75-88`). The scrypt salt is base64
in the specifics (go-sync `nigori_specifics.proto:227-232`, chromium
`components/sync/nigori/nigori_sync_bridge_impl.cc:70-79`). The throwaway
chain uses scrypt with a salt **[test]**. Both methods reproduce Chromium's
reference keys for `hunter2` (chromium
`components/sync/model/crypto/nigori_unittest.cc:326-369`) **[test]**.

#### 2.7.5 One Nigori key

```js file=src/chain-crypto.js
const IV_SIZE = 16;
const MAC_SIZE = 32;
// A key's name is its encryption of this Nigori stream: the type Password (1)
// and the string "nigori-key", each preceded by a 4-byte big-endian length.
// https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.48/components/sync/model/crypto/nigori.cc#223
// https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.48/components/sync/model/crypto/nigori.cc#44
// https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.48/components/sync/model/crypto/nigori.h#52
const KEY_NAME_PLAINTEXT = concat(
  Uint8Array.of(0, 0, 0, 4, 0, 0, 0, 1),
  Uint8Array.of(0, 0, 0, 10),
  utf8.encode('nigori-key'),
);

export async function nigori({ encryptionKey, macKey }) {
  const aes = await subtle.importKey('raw', encryptionKey, 'AES-CBC', false, ['encrypt', 'decrypt']);
  const hmac = await subtle.importKey('raw', macKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const encrypt = async (iv, bytes) => new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, aes, bytes));
  const sign = async (bytes) => new Uint8Array(await subtle.sign('HMAC', hmac, bytes));

  const ciphertext = await encrypt(new Uint8Array(IV_SIZE), KEY_NAME_PLAINTEXT);
  const name = toBase64(concat(ciphertext, await sign(ciphertext)));

  async function decrypt(blob) {
    const input = fromBase64(blob);
    if (input.length < IV_SIZE * 2 + MAC_SIZE) throw new Error('encrypted blob is too short');
    const iv = input.subarray(0, IV_SIZE);
    const body = input.subarray(IV_SIZE, input.length - MAC_SIZE);
    const mac = input.subarray(input.length - MAC_SIZE);
    const authentic =
      (await subtle.verify('HMAC', hmac, mac, input.subarray(0, input.length - MAC_SIZE))) ||
      (await subtle.verify('HMAC', hmac, mac, body));
    if (!authentic) throw new Error('encrypted blob failed its integrity check');
    return new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv }, aes, body));
  }

  return { name, decrypt };
}
```

A Nigori is an encryption key and a MAC key, plus two operations (chromium
`nigori.cc`) **[code]**.

**Its name** (`:223-237`) is how `EncryptedData.key_name` refers to it. The
plaintext is a "Nigori stream" of two fields, each a 4-byte big-endian length
followed by the value (`:44-61`). The first field is the type `Password = 1`
as 4 bytes (chromium `nigori.h:51-52`), and the second is the string
`nigori-key`. The name is the base64 of that plaintext's AES-128-CBC
encryption under a zero IV, followed by an HMAC-SHA256 of the ciphertext.
Chromium's golden name for the password `password` matches
(`nigori_unittest.cc:58-68`) **[test]**.

**A blob** is base64 of a 16-byte IV, the AES-128-CBC ciphertext, and a
32-byte HMAC-SHA256 (`:280-304`). Older clients MAC the ciphertext alone.
Newer ones, behind `kSyncNigoriAuthenticateIV`, MAC the IV plus the
ciphertext (`:258-261`), and Chromium accepts either when reading
(`:297-301`). So does this code. Chromium's goldens for both layouts decrypt
to `test, test, 1, 2, 3`, and a changed byte fails the integrity check
(`nigori_unittest.cc:26-32`, `:99-136`) **[test]**. Web Crypto's AES-CBC
removes PKCS#7 padding, the padding Chromium's `crypto::aes_cbc` uses
**[inferred]**, and the goldens agree.

#### 2.7.6 The chain

```js file=src/chain-crypto.js
const CUSTOM_PASSPHRASE = 4;

export async function openChain(syncCode) {
  const passphrase = pureWords(syncCode);
  const { secretKey, publicKey } = await signingKeys(mnemonicToEntropy(passphrase, wordlist));
  const clientId = toHex(publicKey);
  const passphraseKeys = new Map();
  let keybag = new Map();

  async function passphraseNigori(method, salt) {
    const id = `${method}:${salt}`;
    if (!passphraseKeys.has(id)) {
      const scryptSalt = method === 2 ? fromBase64(salt) : null;
      passphraseKeys.set(id, await nigori(await deriveNigoriKeys(passphrase, method, scryptSalt)));
    }
    return passphraseKeys.get(id);
  }
```

The custom passphrase is the 24 pure words. Brave keeps the words as its
"seed" and passes that same string to `SetDecryptionPassphrase` (brave-core
`components/sync/service/brave_sync_service_impl.cc:229-247`, `:362-373`)
**[code]**. The passphrase key depends on the NIGORI's method and salt, so it
is derived when the first NIGORI arrives and then cached for each method and
salt. scrypt is slow by design, and `watch` should not pay for it on every
pull.

```js file=src/chain-crypto.js
  return {
    clientId,

    async accessToken(nowMs) {
      const timestamp = utf8.encode(String(Math.trunc(nowMs)));
      const signature = await ed.signAsync(timestamp, secretKey);
      return btoa(`${toHex(timestamp)}|${toHex(signature)}|${clientId}`);
    },
```

The token is exactly what `GenerateAccessToken` builds (brave-core
`brave_sync_auth_manager.cc:97-124`): the timestamp in milliseconds as decimal
text, hex-encoded; the Ed25519 signature of that text, hex-encoded; and the
client ID, joined by `|` and base64-encoded. The `BraveServiceKey` suffix is
left out (§4.3). For Brave's public test code and the timestamp `1234567`,
this reproduces brave-core's expected token byte for byte
(`components/sync/service/brave_sync_auth_manager_unittest.cc:26-42`)
**[test]**. The local go-sync accepted the tokens for the throwaway chain
**[test]**.

```js file=src/chain-crypto.js
    async setNigori(specifics) {
      const type = specifics.passphraseType ?? 1;
      if (type !== CUSTOM_PASSPHRASE) throw new Error(`NIGORI passphrase type is ${type}, not a custom passphrase`);
      const method = specifics.customPassphraseKeyDerivationMethod ?? 0;
      const opener = await passphraseNigori(method, specifics.customPassphraseKeyDerivationSalt ?? '');
      const { keyName, blob } = specifics.encryptionKeybag ?? {};
      if (keyName !== opener.name) throw new Error('the sync code does not open this chain\'s keybag');

      const keys = decode(EncryptionKeys, await opener.decrypt(blob)).key ?? [];
      const next = new Map();
      for (const key of keys) {
        const imported = await nigori({ encryptionKey: fromBase64(key.encryptionKey), macKey: fromBase64(key.macKey) });
        next.set(imported.name, imported);
      }
      if (!next.has(keyName)) throw new Error('the keybag does not hold its own default key');
      keybag = next;
    },
```

`setNigori` reproduces what Chromium does when a NIGORI with a custom
passphrase arrives **[code]**:

1. The chain must use a custom passphrase: `passphrase_type` 4 (go-sync
   `nigori_specifics.proto:137-158`). Brave's does **[test]**. A keystore or
   trusted-vault chain needs keys only Google's servers hold, so it is
   refused.
2. The keybag must be encrypted under the passphrase key. Chromium looks up
   the decryption key by the keybag's `key_name` (chromium
   `components/sync/nigori/nigori_key_bag.cc:154-168`), so a different name
   means the sync code belongs to another chain.
3. The decrypted keybag is an `EncryptionKeys` message
   (`nigori_sync_bridge_impl.cc:799-807`). Each key is imported and filed
   under its own computed name (`nigori_key_bag.cc:99-115`), and the keybag's
   default key must be among them (`nigori_sync_bridge_impl.cc:809-821`).
4. The new keybag replaces the old one. The keybag carries every key the
   chain has used, so older data stays readable after a rotation
   **[inferred]**.

```js file=src/chain-crypto.js
    async decrypt({ keyName, blob }) {
      const key = keybag.get(keyName);
      if (!key) {
        throw Object.assign(new Error(`no key named ${keyName.slice(0, 8)}… in the keybag`), { code: 'UNKNOWN_KEY' });
      }
      return key.decrypt(blob);
    },
  };
}
```

`decrypt` finds the key by name and opens the blob. A missing key rejects with
`UNKNOWN_KEY` (§6.4). The message shows only the first 8 characters of the key
name, which is an encryption of a constant, not key material.

## 3. The package and the protobuf bindings

### 3.1 package.json

```json file=package.json
{
  "name": "brave-sync",
  "version": "0.0.0",
  "description": "Read-only Brave Sync v2 chain member that archives open tabs and history",
  "scripts": {
    "proto": "mkdir -p src/proto && pbjs -t json -p ../vendor/go-sync/schema/protobuf/sync_pb -o src/proto/sync_pb.json sync.proto",
    "test": "node --test"
  },
  "type": "module",
  "dependencies": {
    "@noble/ed25519": "3.2.0",
    "@noble/hashes": "2.4.0",
    "@scure/bip39": "2.4.0",
    "long": "5.3.2",
    "protobufjs": "8.8.1"
  },
  "devDependencies": {
    "protobufjs-cli": "2.7.1"
  },
  "private": true,
  "bin": {
    "brave-sync": "src/cli.js"
  },
  "engines": {
    "node": ">=24"
  }
}
```

Every dependency is pinned to an exact version, and all of them are the
ones the prompt names. `protobufjs` reads and writes the wire format. `long`
carries int64 values exactly (§3.2). `@scure/bip39`, `@noble/ed25519` and
`@noble/hashes` (for scrypt only) are small, audited, pure-JS libraries that
fill the gaps in Web Crypto (§2.7.1). `protobufjs-cli` generates the bindings
at development time only. Everything else comes from Node 24, the current
LTS: `fetch`, Web Crypto, `node:test` and `parseArgs`.

`npm run proto` generates the bindings from go-sync's vendored protos, as the
prompt requires. pbjs follows the imports from `sync.proto`, through
`sync_entity.proto` and `entity_specifics.proto`, to every specifics type: 169
messages and enums in the `sync_pb` package **[test]**. The output is a JSON
descriptor rather than generated code, so the runtime needs only the light
build of protobufjs, with no `fs`, no parser and no `eval`. That suits A8.

### 3.2 Loading the bindings

```js file=src/proto.js
import protobuf from 'protobufjs/light.js';
import Long from 'long';
import descriptor from './proto/sync_pb.json' with { type: 'json' };

protobuf.util.Long = Long;
protobuf.configure();

const root = protobuf.Root.fromJSON(descriptor);

export const ClientToServerMessage = root.lookupType('sync_pb.ClientToServerMessage');
export const ClientToServerResponse = root.lookupType('sync_pb.ClientToServerResponse');
export const EntitySpecifics = root.lookupType('sync_pb.EntitySpecifics');
export const EncryptionKeys = root.lookupType('sync_pb.EncryptionKeys');
```

A HISTORY visit time is microseconds since 1601 (§8.2), about 1.34 × 10¹⁶
today. That is past 2⁵³ ≈ 9.0 × 10¹⁵, the largest integer a JavaScript
number holds exactly. Without `long`, protobufjs would decode such a value as a
rounded number. With `long` installed and `configure()` called, every int64
decodes as a `Long`, and §3.3 turns it into an exact decimal string. Code that
needs arithmetic uses `BigInt`.

Four top-level types are needed: the request, the response,
`EntitySpecifics` for decrypted payloads, and `EncryptionKeys` for the
decrypted keybag (§2.7.6). Everything else is reached through their fields.

### 3.3 Encoding and decoding

```js file=src/proto.js
export function encode(type, object) {
  const message = type.fromObject(object);
  const problem = type.verify(message);
  if (problem) throw new TypeError(`${type.name}: ${problem}`);
  return type.encode(message).finish();
}
```

`fromObject` accepts the plain form the rest of the client writes: enum names
such as `'GET_UPDATES'`, decimal strings for int64, base64 strings for bytes.
`verify` then checks the message instance before it is encoded. (`verify`
checks message instances, not plain objects, so it must run after
`fromObject`.)

```js file=src/proto.js
export function decode(type, bytes) {
  return type.toObject(type.decode(bytes), {
    longs: String,
    enums: String,
    bytes: String,
    oneofs: true,
  });
}
```

Decoding goes the other way, and every caller gets the same shape:

- `longs: String`: int64 values become exact decimal strings.
- `enums: String`: enum values become names, so the archive reads
  `"DEVICE_FORM_FACTOR_PHONE"` and not `2`.
- `bytes: String`: bytes become base64. Progress marker tokens can then go
  straight into `state.json` and back into the next request.
- `oneofs: true`: adds a `specificsVariant` field naming the set member of the
  `EntitySpecifics` oneof (`'nigori'`, `'session'`, `'history'`). §6 uses it to
  dispatch.

Fields the sender did not set stay absent, because `defaults` is off. That
lets the decoders tell "not sent" apart from "sent as the default".

### 3.4 What a progress marker token holds

```js file=src/proto.js
export function tokenMtime(token) {
  if (!token) return null;
  const bytes = protobuf.util.newBuffer(protobuf.util.base64.length(token));
  protobuf.util.base64.decode(token, bytes, 0);
  return protobuf.Reader.create(bytes).sint64().toString();
}
```

To the client a token is opaque bytes. It stores each token and sends it back
unchanged. `status` decodes one only so a person can read it. go-sync builds
each token with `binary.PutVarint` into a 10-byte buffer. The value is 0 for a
fresh type (go-sync `command/command.go:113-122`), and otherwise the mtime of
the last entity returned (`:158-162`) **[code]**. Go's `PutVarint` is the
zigzag varint that protobuf calls `sint64`, so a protobufjs `Reader` decodes
it, and the trailing zero padding is never read. The vectors in
`test/proto.test.js` came from Go's `binary.PutVarint` **[test]**.

## 4. The transport

### 4.1 The three types and the read-only guard

```js file=src/transport.js
import { ClientToServerMessage, ClientToServerResponse, encode, decode } from './proto.js';

export const TYPES = Object.freeze({ NIGORI: 47745, SESSIONS: 50119, HISTORY: 963985 });
const ALLOWED = new Set(Object.values(TYPES));
```

The field numbers of the `EntitySpecifics` oneof are also the data type IDs:
`nigori = 47745`, `session = 50119`, `history = 963985` (go-sync
`schema/protobuf/sync_pb/entity_specifics.proto:115`, `:118`, `:147`). go-sync
uses the same numbers (`command/command.go:28`,
`datastore/sync_entity.go:33`) **[code]**. Q-001 approves exactly these three.

```js file=src/transport.js
export function assertReadOnly(message) {
  if (message.messageContents !== 'GET_UPDATES') {
    throw new Error(`read-only: refusing ${message.messageContents}`);
  }
  if (message.commit || message.clearServerData) {
    throw new Error('read-only: refusing a message that carries a commit or clear');
  }
  const gu = message.getUpdates;
  if (gu.getUpdatesOrigin === 'NEW_CLIENT') {
    throw new Error('read-only: refusing NEW_CLIENT, it makes the server write');
  }
  for (const { dataTypeId } of gu.fromProgressMarker) {
    if (!ALLOWED.has(dataTypeId)) throw new Error(`read-only: refusing data type ${dataTypeId}`);
  }
}
```

Every message passes through `assertReadOnly` before it is encoded, so this is
the one place where "read-only" is enforced. It refuses three things:

1. **Any message but GET_UPDATES.** go-sync dispatches `COMMIT` and
   `CLEAR_SERVER_DATA` to handlers that write. `CLEAR_SERVER_DATA` disables
   the chain and deletes its data (go-sync `command/command.go:668-714`,
   `:751-775`) **[code]**.
2. **The NEW_CLIENT origin.** A GetUpdates with this origin makes go-sync run
   `setupNewClient`, which counts devices and then *inserts* the
   server-defined entities (go-sync `command/command.go:34-84`, `:86-104`,
   `:291-293`) **[code]**. On a scratch server, one such request inserted 5
   entities: the Nigori root and 4 bookmark folders **[test]**. A GetUpdates
   from this client therefore never says NEW_CLIENT.
3. **Any data type outside the three.** This is Q-001 in code.

`test/get-updates.test.js` checks all three refusals.

### 4.2 Errors from HTTP

```js file=src/transport.js
export class HttpError extends Error {
  constructor(status, serverDate, text) {
    super(`HTTP ${status} from sync server (server date ${serverDate}): ${text}`);
    this.status = status;
    this.serverDate = serverDate;
    this.retryable = status >= 500;
  }
}
```

go-sync answers in three ways **[code]**:

- **401** when the token is missing or fails to verify (go-sync
  `middleware/auth.go:14-28`). A local run with a bad token returned 401 and
  the body `Unauthorized` **[test]**.
- **500** with a short text when the body cannot be read or parsed, or a
  handler fails outside the protocol (go-sync `controller/controller.go:58-80`).
- **200** with a `ClientToServerResponse` in every other case, protocol
  errors included. A disabled chain is a 200 whose `error_code` is
  `DISABLED_BY_ADMIN` (go-sync `middleware/disabled_chain.go:31-56`).

`HttpError` keeps the status and the server's `Date` header, so the cause of a
401 from clock skew is visible. A 5xx is retryable and a 4xx is not. The error
never includes the request headers, so the token cannot leak through it.

### 4.3 One POST

```js file=src/transport.js
export function createTransport({
  server,
  chain,
  cacheGuid,
  fetch = globalThis.fetch,
  now = Date.now,
  userAgent = 'brave-sync/0.0.0 (read-only archiver)',
}) {
  const url = new URL(`${server.replace(/\/+$/, '')}/command/`);
  url.searchParams.set('client', 'brave-sync');
  url.searchParams.set('client_id', cacheGuid);

  return async function post(message) {
    assertReadOnly(message);
    const body = encode(ClientToServerMessage, message);
    const authorization = `Bearer ${await chain.accessToken(now())}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/octet-stream', 'user-agent': userAgent },
      body,
    }).catch((error) => {
      throw Object.assign(new Error(`network: ${error.message}`), { retryable: true });
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (response.status !== 200) {
      const text = new TextDecoder().decode(bytes.subarray(0, 200)).trim();
      throw new HttpError(response.status, response.headers.get('date'), text);
    }
    return decode(ClientToServerResponse, bytes);
  };
}
```

**The URL.** Brave's production base is `https://sync-v2.brave.com/v2`
(brave-core `components/brave_sync/BUILD.gn:13`), and go-sync mounts
`POST /command/` under `/v2` (go-sync `server/server.go:83-85`,
`controller/controller.go:31`) **[code]**. Chromium adds a `client_id` query
parameter (chromium `components/sync/engine/net/url_translator.cc:15`, `:24-26`)
**[code]**. go-sync never reads the query string **[code]**. The client sends
`client=brave-sync` and its own cache GUID (§9.3), which keeps the request
honest about what sent it.

**The headers.**

| Header | Brave sends it | brave-sync sends it | go-sync checks it |
|---|---|---|---|
| `Authorization: Bearer <token>` | yes (chromium `components/sync/engine/net/sync_server_connection_manager.cc:79`) | yes | yes (go-sync `auth/auth.go:94-115`) |
| `Content-Type: application/octet-stream` | yes (same file, `:84`) | yes | no |
| `Content-Encoding: gzip` | not checked | no | it decompresses if present (go-sync `controller/controller.go:47-56`) |
| `User-Agent` | Chromium's | `brave-sync/0.0.0 (read-only archiver)` | logged only (go-sync `server/server.go:61`) |
| `BraveServiceKey` | yes (see below) | **no** | no |

**A finding to report, as the ground rules require.** Brave sends one more
header with every sync request. `GenerateAccessToken` appends
`"\r\nBraveServiceKey: " + BUILDFLAG(BRAVE_SERVICES_KEY)` to the token
(brave-core `components/sync/service/brave_sync_auth_manager.cc:22-25`,
`:121-122`). A Chromium override splits it into a second header
(brave-core `chromium_src/components/sync/engine/net/sync_server_connection_manager.cc:8-22`)
**[code]**. The key is a build-time secret in Brave's binaries. go-sync never
reads it: `rg -i 'servicekey|services_key|BraveService'` over `vendor/go-sync`
finds nothing outside generated code **[test]**. Whether a gateway in front of
production requires it cannot be learned from source **[inferred]**. This
client does not send it and does not extract it. If production rejects this
client with a 4xx that clock skew does not explain, stop and report. Do not
work around it.

**The token** comes from ChainCrypto on every request and lives only in the
`authorization` local.

**Network failures** (DNS, refused connections, resets) become retryable
errors, so `watch` (§11) survives a laptop going to sleep.

## 5. The GetUpdates loop

### 5.1 The request

```js file=src/get-updates.js
import { TYPES } from './transport.js';

const ORDER = [TYPES.NIGORI, TYPES.SESSIONS, TYPES.HISTORY];

export function shareFor(clientId) {
  const middle = clientId.length / 2;
  return `${clientId.slice(0, middle)} ${clientId.slice(middle)} @brave.com`;
}
```

The request goes in this order: NIGORI, then SESSIONS, then HISTORY. The order
matters (§5.3).

`share` is a `required` string in proto2 (go-sync
`schema/protobuf/sync_pb/sync.proto:268`). Chromium fills it with the account
email (chromium `components/sync/engine/get_updates_processor.cc:162`), and
Brave's account email is the client ID split in the middle by a space,
followed by `" @brave.com"` (brave-core `brave_sync_auth_manager.cc:85-89`)
**[code]**. go-sync never reads `share` **[code]**. The client matches Brave
anyway, so its requests look like the other members' in server logs.

```js file=src/get-updates.js
export function buildGetUpdates({ share, storeBirthday, markers }) {
  return {
    share,
    protocolVersion: 99,
    messageContents: 'GET_UPDATES',
    ...(storeBirthday ? { storeBirthday } : {}),
    getUpdates: {
      fetchFolders: true,
      needEncryptionKey: false,
      getUpdatesOrigin: 'PERIODIC',
      fromProgressMarker: ORDER.map((dataTypeId) => ({
        dataTypeId,
        ...(markers[dataTypeId] ? { token: markers[dataTypeId] } : {}),
      })),
    },
  };
}
```

Each field, and why it has this value:

| Field | Value | Why |
|---|---|---|
| `protocol_version` | 99 | The proto default (`sync.proto:270`). Chromium always sets it (chromium `components/sync/engine/syncer_proto_util.cc:395-396`). go-sync ignores it. **[code]** |
| `message_contents` | `GET_UPDATES` | The only kind §4.1 lets through. |
| `store_birthday` | absent at first, then echoed | Chromium sends it once it has one (`syncer_proto_util.cc:494`). go-sync always answers `"1"` and never checks it (go-sync `command/command.go:25`, `:742`). **[code]** |
| `fetch_folders` | true | Chromium sets it (`get_updates_processor.cc:170`). When false, go-sync drops folder entities (go-sync `command/command.go:106-111`, `datastore/sync_entity.go:704-707`), and the NIGORI root is a folder (`DIR y` in `hack/dev.sh sqlite`). **[code] [test]** |
| `need_encryption_key` | false | go-sync fills `encryption_keys` only for NEW_CLIENT, and then with the placeholder `"1234"` (go-sync `command/command.go:124-133`). Brave's keys come from the sync code. **[code]** |
| `get_updates_origin` | `PERIODIC` | Not NEW_CLIENT (§4.1). PERIODIC also lets go-sync skip the database when its cache says a type is up to date (go-sync `command/command.go:228-232`). A cache miss always falls through to the query (go-sync `cache/cache.go:82-114`), so the shortcut never hides an update. **[code]** |
| `from_progress_marker` | one per type, with the saved token if there is one | An absent token means "from the start", which go-sync reads as 0 (`command/command.go:113-122`). **[code]** |

Chromium also sends `bag_of_chips`, `api_key` (Google's) and `client_status`
(`syncer_proto_util.cc:497-500`). go-sync reads none of them, so the client
sends none **[code]**.

### 5.2 Protocol errors

```js file=src/get-updates.js
export class SyncError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(`${code}: ${message}`);
    this.code = code;
    this.retryable = retryable;
  }
}

const RETRYABLE = new Set(['THROTTLED', 'TRANSIENT_ERROR']);

function checkErrorCode(response) {
  const code = response.errorCode ?? 'SUCCESS';
  if (code === 'SUCCESS') return;
  const message = response.errorMessage ?? 'no error message';
  if (code === 'DISABLED_BY_ADMIN') {
    throw new SyncError(code, 'the chain was deleted or disabled; stop polling it');
  }
  throw new SyncError(code, message, { retryable: RETRYABLE.has(code) });
}
```

The codes come from `SyncEnums.ErrorType` (go-sync
`schema/protobuf/sync_pb/sync_enums.proto:91-130`). For a GetUpdates without
NEW_CLIENT, go-sync produces only `SUCCESS`, `TRANSIENT_ERROR` (datastore
failures: `command/command.go:243-248`) and `DISABLED_BY_ADMIN`, from the
middleware **[code]**. `THROTTLED` comes from the device limit, which only
NEW_CLIENT checks (`command/command.go:62-66`), but it is handled anyway.
`error_message`, when set, carries the server's error text
(`command/command.go:716-728`).

`DISABLED_BY_ADMIN` means the chain was cleared: some member sent
`CLEAR_SERVER_DATA`, which disables the chain first
(`command/command.go:680`). Polling a deleted chain helps no one, so the error
is fatal. Every other unknown code is fatal too, because a read-only client
has no business guessing.

### 5.3 Paging, one batch at a time

```js file=src/get-updates.js
export async function* getUpdates({ post, share, storeBirthday = null, markers = {}, maxRounds = 1000 }) {
  for (let round = 0; round < maxRounds; round++) {
    const response = await post(buildGetUpdates({ share, storeBirthday, markers }));
    checkErrorCode(response);
```

`getUpdates` is an async generator, so the caller controls when it moves on.
It yields each batch, then waits. It advances its markers only after the
caller's loop body returns, which happens after the caller has archived the
batch (§10). A crash between the two leaves the old markers in place, so the
next pull asks again.

```js file=src/get-updates.js
    const birthday = response.storeBirthday ?? storeBirthday;
    if (storeBirthday && birthday !== storeBirthday) {
      throw new SyncError('BIRTHDAY_CHANGED', `store birthday ${storeBirthday} became ${birthday}; run pull --reset`);
    }
```

go-sync always sends the same birthday (§5.1). A different birthday from
another server would mean the saved markers point into a store that no longer
exists. The client stops and lets a person choose `pull --reset`, which
re-reads everything. That is safe because the archive only appends (§9).

```js file=src/get-updates.js
    const updates = response.getUpdates ?? {};
    const entries = updates.entries ?? [];
    const next = { ...markers };
    for (const marker of updates.newProgressMarker ?? []) {
      if (marker.token) next[marker.dataTypeId] = marker.token;
    }
    const moved = entries.length > 0 || ORDER.some((id) => next[id] !== markers[id]);
```

What go-sync puts in a response **[code]**:

- At most 500 entries across all types, filled in request order
  (`command/command.go:19`, `:303-307`, `:219-221`). Since NIGORI goes first,
  the NIGORI entity is never crowded out by history.
- For every requested type, a new marker holding the token of the last entry
  returned for that type, or the old token if none was (`:207-210`,
  `:158-162`). Markers the server leaves out mean "unchanged" (`sync.proto:400-409`),
  so the loop starts from a copy of the old markers.
- `changes_remaining` set to 1, "instead of actual count", when any type had
  more (`:255-257`).

The token is an exclusive lower bound: the next query starts at mtime
`token + 1` (`datastore/sync_entity.go:694`) **[code]**. Suppose two entities
of one type shared an mtime and a page ended between them. The second would
then be skipped for good. go-sync relies on mtimes that strictly increase. The
SQLite dev backend enforces that by making each write wait for the next
millisecond (commit 7431acd), and Dynamo gets it from write latency
**[inferred]**.

`moved` records whether this round made progress, for the stall check below.

```js file=src/get-updates.js
    yield {
      entries,
      markers: next,
      storeBirthday: birthday,
      pollIntervalSeconds: response.clientCommand?.setSyncPollInterval ?? null,
    };
```

The batch carries the new markers, the birthday, and the poll interval the
server asks for: `set_sync_poll_interval`, in seconds
(`schema/protobuf/sync_pb/client_commands.proto:28`). go-sync always asks for 30
(`command/command.go:27`, `:743-745`) **[code]**.

```js file=src/get-updates.js
    markers = next;
    storeBirthday = birthday;
    if (Number(updates.changesRemaining ?? 0) === 0) return;
    if (!moved) throw new SyncError('STALLED', 'changes remain but the server returned nothing new');
  }
  throw new SyncError('TOO_MANY_ROUNDS', `still paging after ${maxRounds} rounds`);
}
```

The loop ends when `changes_remaining` is 0.

**The stall guard.** go-sync decides "has more" from the query's
`LastEvaluatedKey`, *before* it filters out expired history
(`datastore/sync_entity.go:730` versus `:767-777`) **[code]**. Suppose a page
of 500 is all expired history. Then no entries come back, the token does not
move, and `changes_remaining` is still 1. A naive client would ask the same
question forever. Dynamo's TTL deletes expired items in the background, so
this should be rare in production **[inferred]**. The guard costs one line:
if changes remain and nothing moved, stop with `STALLED`.

`maxRounds` caps one pull at 1000 rounds, which is 500,000 entities. The
per-chain quota is 50,000 objects (`command/command.go:20`), so a real chain
never comes close.

## 6. From entities to records

### 6.1 What an entity carries

```js file=src/decode.js
import { EntitySpecifics, decode } from './proto.js';
import { sessionRecord } from './sessions.js';
import { visitRecord } from './history.js';

function entityMeta(entry) {
  return {
    id: entry.idString,
    version: entry.version ?? null,
    mtime: entry.mtime ?? null,
    ctime: entry.ctime ?? null,
    clientTagHash: entry.clientTagHash ?? null,
    originatorCacheGuid: entry.originatorCacheGuid ?? null,
    deleted: entry.deleted ?? false,
  };
}
```

These are the fields go-sync fills when it turns a stored item into a
`SyncEntity` (go-sync `datastore/sync_entity.go:905-941`) **[code]**. Each
record keeps them under `entity`, and `(entity.id, entity.version)` names one
version of one entity (§9.1). `originatorCacheGuid` is the cache GUID of the
device that committed the entity. go-sync records it from the commit
(`datastore/sync_entity.go:835-842`), and §7 and §8 use it to join visits to
device names.

### 6.2 Encrypted specifics

```js file=src/decode.js
async function plaintext(specifics, chain) {
  if (!specifics.encrypted) return specifics;
  const inner = decode(EntitySpecifics, await chain.decrypt(specifics.encrypted));
  if (inner.specificsVariant !== specifics.specificsVariant) {
    throw new Error(`decrypted ${inner.specificsVariant} inside a ${specifics.specificsVariant} entity`);
  }
  return inner;
}
```

Brave encrypts SESSIONS and HISTORY. It adds HISTORY to Chromium's encryptable
types (brave-core `chromium_src/components/sync/base/data_type.cc:16-23`)
**[code]**. Every SESSIONS and HISTORY row on the throwaway chain is
encrypted, while NIGORI and the bookmark folders are not **[test]**. An
encrypted entity sets `EntitySpecifics.encrypted` (go-sync
`entity_specifics.proto:72-77`) and also an empty member of the oneof, because
go-sync derives the data type from whichever oneof member is set
(`datastore/sync_entity.go:819-823`) **[code]**.

`plaintext` returns unencrypted specifics as they are, which is the dev
server's case before encryption is set up. Otherwise it decrypts and decodes
the inner `EntitySpecifics`. It then checks that the inner variant matches the
outer one. That check turns a wrong assumption about what ChainCrypto returns
into a loud error, not a misfiled record.

### 6.3 One batch

```js file=src/decode.js
export async function decodeBatch(entries, { chain, index }) {
  const next = structuredClone(index);
  const records = [];
  const nigoriFirst = [...entries].sort(
    (a, b) => (b.specifics?.specificsVariant === 'nigori') - (a.specifics?.specificsVariant === 'nigori'),
  );
```

`decodeBatch` works on a copy of the index (§7) and writes nothing. It returns
the records and the new index together. The caller persists both, or neither
if anything throws (§6.4).

The batch is sorted so the NIGORI entity comes first. go-sync already returns
NIGORI first, because it is first in the request (§5.3). The sort keeps the
decoder correct without relying on that.

```js file=src/decode.js
  for (const entry of nigoriFirst) {
    const entity = entityMeta(entry);
    const type = entry.specifics?.specificsVariant;

    if (entity.deleted) {
      records.push({ kind: 'tombstone', type, ...(next.sessionEntities[entity.id] ?? {}), entity });
    } else if (type === 'nigori') {
      await chain.setNigori(entry.specifics.nigori);
      records.push({ kind: 'nigori', entity });
    } else if (type === 'session') {
      records.push(sessionRecord((await plaintext(entry.specifics, chain)).session, entity, next));
    } else if (type === 'history') {
      records.push(visitRecord((await plaintext(entry.specifics, chain)).history, entity, next));
    } else {
      throw new Error(`entity ${entity.id} has type ${type}, which was never requested`);
    }
  }
```

The four cases:

- **Tombstones.** A deleted entity carries no useful specifics. On the
  throwaway chain the deleted session's specifics are 4 bytes: the field tag
  and a zero length for an empty `session` **[test]**. The record keeps the
  type and whatever the index knows about that entity ID: the session tag,
  and for a tab, the tab node.
- **NIGORI.** The NIGORI entity is not encrypted as an entity. Only the keybag
  inside it is (§2.4). It goes to `setNigori`, and the archive gets only its
  metadata, so a key rotation leaves a trace while no key material, encrypted
  or not, reaches the disk.
- **SESSIONS and HISTORY** go to §7 and §8.
- **Anything else** is an error. The client asked for three types, so a
  fourth means a broken server or a broken client.

```js file=src/decode.js
  for (const record of records) {
    if (record.kind === 'tab') record.device ??= next.devices[record.sessionTag]?.name ?? null;
    if (record.kind === 'visit') {
      record.device ??= next.devices[next.cacheGuids[record.originatorCacheGuid]]?.name ?? null;
    }
  }
  return { records, index: next };
}
```

Last, tabs and visits whose device was unknown when they were decoded get it
from the batch's final index. A tab decoded ahead of its own header in the
same batch still names its device. The throwaway chain's first pull had
exactly that order **[test]**.

### 6.4 When a key is missing

If `decrypt` rejects, `decodeBatch` rejects. Nothing is appended, no marker
moves, and the next pull asks for the same entities again. The archive never
holds a hole where an undecryptable entity was.

For SESSIONS and HISTORY, the key is always there in time. A device commits
the new NIGORI before it commits data encrypted under a new key
**[inferred]**. Each request lists NIGORI first, so every response carries the
newest NIGORI before any other entity. And each run starts NIGORI from token
zero (§10), so a fresh process rebuilds the keybag before it decrypts anything.

## 7. SESSIONS: tabs and devices

### 7.1 The model

A device's open tabs are spread over several entities **[code]**:

- **One header** per device, keyed by `session_tag`. It names the device
  (`client_name`, `device_form_factor`) and lists its windows. Each window
  lists its tabs by `tab_id` (go-sync `session_specifics.proto:23-57`).
- **One entity per tab node**, keyed by `session_tag` and `tab_node_id`. The
  client tag is the string `"<session_tag> <tab_node_id>"` (chromium
  `components/sync_sessions/session_store.cc:57-61`, `:329-338`). It holds one
  tab: its `tab_id`, `window_id`, navigation stack, and
  `current_navigation_index`.

Tab nodes are recycled: when a tab closes, its node can carry a different tab
later. One entity ID therefore holds several tabs over its life, one version at
a time. Devices also delete other devices' sessions that have gone stale for 28
days (chromium `components/sync_sessions/session_sync_bridge.cc:44`,
`:447-456`) **[code]**. Both are reasons to archive every version and every
tombstone.

### 7.2 Which entities are valid

```js file=src/sessions.js
import { unixMillisToIso } from './time.js';

export function invalidReason(session) {
  if (!session.sessionTag) return 'no session_tag';
  if (Boolean(session.header) === Boolean(session.tab)) return 'not exactly one of header and tab';
  const tabNodeId = session.tabNodeId ?? -1;
  if (session.tab) {
    if (tabNodeId < 0) return 'tab without a tab_node_id';
    if ((session.tab.tabId ?? -1) <= 0) return 'tab without a tab_id';
    return null;
  }
  if (tabNodeId !== -1) return 'header with a tab_node_id';
  const seen = new Set();
  for (const window of session.header.window ?? []) {
    for (const tabId of window.tab ?? []) {
      if (seen.has(tabId)) return `tab_id ${tabId} twice in one header`;
      seen.add(tabId);
    }
  }
  return null;
}
```

This is a line-by-line port of `SessionStore::AreValidSpecifics` (chromium
`components/sync_sessions/session_store.cc:283-326`) **[code]**. It requires a
session tag and exactly one of header or tab. A tab needs a non-negative tab
node ID and a positive tab ID. A header must not have a tab node ID, and must
not list one tab ID twice. `tab_node_id` defaults to -1 in the proto
(`session_specifics.proto:31`), which is why an absent value reads as -1. Chromium
drops an invalid entity. The archive keeps it, with the reason, in
`invalid.jsonl`.

### 7.3 Headers and tabs

```js file=src/sessions.js
export function sessionRecord(session, entity, index) {
  const reason = invalidReason(session);
  if (reason) return { kind: 'session-invalid', reason, entity, specifics: session };

  const { sessionTag } = session;
  if (session.header) {
    const device = {
      name: session.header.clientName ?? null,
      formFactor: session.header.deviceFormFactor ?? null,
    };
    index.devices[sessionTag] = { ...device, cacheGuid: entity.originatorCacheGuid ?? null };
    if (entity.originatorCacheGuid) index.cacheGuids[entity.originatorCacheGuid] = sessionTag;
    index.sessionEntities[entity.id] = { sessionTag };
    return { kind: 'session-header', sessionTag, device, entity, specifics: session };
  }

  const { tab, tabNodeId } = session;
  index.sessionEntities[entity.id] = { sessionTag, tabNodeId };
  const navigations = tab.navigation ?? [];
  const current = navigations[tab.currentNavigationIndex ?? -1] ?? navigations.at(-1) ?? {};
  return {
    kind: 'tab',
    sessionTag,
    tabNodeId,
    device: index.devices[sessionTag]?.name ?? null,
    url: current.virtualUrl ?? null,
    title: current.title ?? null,
    navigatedAt: unixMillisToIso(current.timestampMsec),
    lastActiveAt: unixMillisToIso(tab.lastActiveTimeUnixEpochMillis),
    entity,
    specifics: session,
  };
}
```

A header updates the index in three ways. It maps the session tag to a device
name and form factor (`session_specifics.proto:39-46`; the older `device_type`
is deprecated), the device's cache GUID to its session tag, and the header's
entity ID to its session tag for a later tombstone. A tab maps its entity ID
to its session tag and tab node.

A tab record adds a few fields for reading and grepping, then keeps the whole
decoded `SessionSpecifics` as `specifics`. The derived fields are
conveniences. `specifics` is the record.

- `url`, `title`, `navigatedAt`: from the current navigation, or the last one
  when `current_navigation_index` is absent. `virtual_url` is the URL the user
  sees (`session_specifics.proto:99`).
- `timestamp_msec` is "in client time" (`session_specifics.proto:110-112`) and
  `last_active_time_unix_epoch_millis` says so in its name (`:80-82`). Both are
  Unix milliseconds **[inferred]** for `timestamp_msec`, **[code]** for the
  other. `global_id` (`:121`) is kept in `specifics` without conversion.
- `device` is null only when no header from that device has been seen, in
  this batch or before (§6.3). The record keeps `sessionTag`, so a reader can
  join it later.

## 8. HISTORY: visits

### 8.1 The model

A HISTORY entity is one visit, including its whole redirect chain (go-sync
`schema/protobuf/sync_pb/history_specifics.proto:23-49`) **[code]**. The
client tag is the visit time as a decimal string (chromium
`components/history/core/browser/sync/history_sync_bridge.cc:735-741`), and
go-sync uses the client tag hash as the entity ID for history only
(`datastore/sync_entity.go:844-848`) **[code]**. A later change to the same
visit, such as its duration once the page closes, overwrites the entity in
place. The archive appends each version it sees.

### 8.2 Time

```js file=src/time.js
const WINDOWS_EPOCH_OFFSET_MICROS = 11_644_473_600_000_000n;

export function unixMillisToIso(millis) {
  if (millis == null) return null;
  return new Date(Number(millis)).toISOString();
}

export function windowsMicrosToIso(micros) {
  if (micros == null) return null;
  return unixMillisToIso((BigInt(micros) - WINDOWS_EPOCH_OFFSET_MICROS) / 1000n);
}
```

`visit_time_windows_epoch_micros` (`history_specifics.proto:29`) counts
microseconds since 1601-01-01 UTC. The offset to 1970 is 11,644,473,600
seconds. The conversion runs in `BigInt` (§3.2), and the test vector was
checked against Python's `datetime` **[test]**.

### 8.3 A visit record

```js file=src/history.js
import { windowsMicrosToIso } from './time.js';

export function visitRecord(history, entity, index) {
  const last = history.redirectEntries?.at(-1) ?? {};
  const cacheGuid = history.originatorCacheGuid ?? entity.originatorCacheGuid ?? null;
  return {
    kind: 'visit',
    visitedAt: windowsMicrosToIso(history.visitTimeWindowsEpochMicros),
    url: last.url ?? null,
    title: last.title ?? null,
    originatorCacheGuid: cacheGuid,
    device: index.devices[index.cacheGuids[cacheGuid]]?.name ?? null,
    entity,
    specifics: history,
  };
}
```

The URL and title come from the last redirect entry, which is where the user
ended up (`history_specifics.proto:45-49`). The device name comes through the
originator cache GUID (`:32`), joined to the session header that the same
device committed (§7.3). DEVICE_INFO would name devices directly, but it is
outside Q-001.

### 8.4 What the server keeps, and what it never sees

- **The server keeps history for 14 days.** go-sync gives every HISTORY and
  HISTORY_DELETE_DIRECTIVES write an expiration 14 days out
  (`datastore/sync_entity.go:35-37`, `:852-855`) and drops expired items on
  read (`:767-777`) **[code]**. The comment at `:767` says 90 days, but the
  constant is 14. An archiver that is offline for more than 14 days loses
  every visit written and left unchanged in that window.
- **It drops history over quota, silently.** Past 30,000 history items per
  chain, go-sync drops new history commits and reports success to the device
  (`command/command.go:21`, `:413-418`) **[code]**. Those visits never reach
  the server.
- **Only history written after a device turned history sync on is uploaded**
  (the finding in PROMPT.md) **[inferred]**, not re-verified here.
- **Deletions are invisible.** Users delete history through
  HISTORY_DELETE_DIRECTIVES (type 150251), which Q-001 does not cover. The
  archive neither honors nor records them. That is the owner's open decision
  from the prompt. If HISTORY tombstones ever arrive, they are recorded.

## 9. The archive

### 9.1 Files and records

```js file=src/archive.js
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const FILES = {
  'session-header': 'sessions.jsonl',
  'session-invalid': 'invalid.jsonl',
  tab: 'tabs.jsonl',
  visit: 'visits.jsonl',
  tombstone: 'tombstones.jsonl',
  nigori: 'nigori.jsonl',
};
```

There is one file per record kind. Each line is one JSON record:
`archivedAt`, the kind, its derived fields, `entity` (§6.1) and, for tabs and
visits, the whole decoded `specifics`. With `specifics` kept, the archive is
lossless, and any later normalization can be redone from it.

Delivery is at least once. A crash after an append and before the state save
(§10) makes the next pull archive the same versions again. Readers should
treat `(entity.id, entity.version)` as the key and keep the first occurrence.

### 9.2 The state

```js file=src/archive.js
export function freshState() {
  return {
    version: 1,
    cacheGuid: globalThis.crypto.randomUUID(),
    storeBirthday: null,
    markers: {},
    index: { devices: {}, cacheGuids: {}, sessionEntities: {} },
  };
}
```

`state.json` holds the progress markers (base64), the store birthday, the
cache GUID and the index from §7. It never holds the sync code, the seed, a
key, a token, the keybag or the NIGORI marker (§10). `cacheGuid` is a random
UUID made once. go-sync reads a cache GUID only from Commit messages
(`datastore/sync_entity.go:835-842`) **[code]**, so here it only appears in
the URL (§4.3).

### 9.3 Writing durably

```js file=src/archive.js
async function writeDurably(path, text, flags) {
  const file = await open(path, flags);
  try {
    await file.writeFile(text);
    await file.sync();
  } finally {
    await file.close();
  }
}
```

Every write opens, writes, fsyncs and closes. The archive opens its files only
with `'a'`, which is `O_APPEND`: the client has no code path that truncates or
rewrites a record.

```js file=src/archive.js
export async function openArchive(dir) {
  await mkdir(dir, { recursive: true });
  const statePath = join(dir, 'state.json');

  return {
    dir,

    async append(records, archivedAt) {
      const lines = {};
      for (const record of records) {
        const file = FILES[record.kind];
        lines[file] = (lines[file] ?? '') + JSON.stringify({ archivedAt, ...record }) + '\n';
      }
      for (const [file, text] of Object.entries(lines)) {
        await writeDurably(join(dir, file), text, 'a');
      }
    },

    async loadState() {
      try {
        return JSON.parse(await readFile(statePath, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return freshState();
        throw error;
      }
    },

    async saveState(state) {
      await writeDurably(`${statePath}.tmp`, JSON.stringify(state, null, 2) + '\n', 'w');
      await rename(`${statePath}.tmp`, statePath);
    },
  };
}
```

`append` groups a batch by file and makes one durable write per file.
`saveState` writes a temporary file, fsyncs it and renames it over the old
one, so `state.json` is always a whole old version or a whole new one. The
directory itself is not fsynced. After a power cut the rename may be lost,
which costs only a re-fetch and some duplicates (§9.1).

## 10. One pull

```js file=src/pull.js
import { TYPES } from './transport.js';
import { getUpdates, shareFor } from './get-updates.js';
import { decodeBatch } from './decode.js';

function withoutNigori(markers) {
  const { [TYPES.NIGORI]: _, ...rest } = markers;
  return rest;
}

export async function pull({ chain, post, archive, state, now = () => new Date() }) {
  let records = 0;
  let pollIntervalSeconds = null;

  for await (const batch of getUpdates({
    post,
    share: shareFor(chain.clientId),
    storeBirthday: state.storeBirthday,
    markers: withoutNigori(state.markers),
  })) {
    const decoded = await decodeBatch(batch.entries, { chain, index: state.index });
    await archive.append(decoded.records, now().toISOString());
    state.markers = withoutNigori(batch.markers);
    state.storeBirthday = batch.storeBirthday;
    state.index = decoded.index;
    await archive.saveState(state);
    records += decoded.records.length;
    pollIntervalSeconds = batch.pollIntervalSeconds ?? pollIntervalSeconds;
  }
  return { records, pollIntervalSeconds };
}
```

`pull` ties the pieces together, and each step happens strictly after the one
before:

1. ask for the next batch (§5),
2. decode it, all or nothing (§6),
3. append the records and fsync (§9.3),
4. save the markers, the birthday and the index (§9.2).

**The NIGORI marker is never saved.** The keybag lives only in memory (ground
rules), so every new process has to rebuild it, and that needs the NIGORI
entity, which the server sends only when the NIGORI token is behind it. Not
saving the NIGORI marker does exactly that: every run asks for NIGORI from
zero, which costs one entity. Within a run the generator keeps the NIGORI
marker in memory, so later pages do not fetch it again. `test/archive.test.js`
checks both the saved state and the first request.

## 11. The command line

```js file=src/cli.js
#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { openChain } from './chain-crypto.js';
import { openArchive } from './archive.js';
import { createTransport } from './transport.js';
import { pull } from './pull.js';
import { tokenMtime } from './proto.js';

const DEV_SERVER = 'http://localhost:8295/v2';
const PRODUCTION = 'https://sync-v2.brave.com/v2';

const USAGE = `usage: brave-sync <pull|watch|status> [options]
  --archive DIR     archive directory (default: archive)
  --server URL      sync server (default: ${DEV_SERVER})
  --production      use ${PRODUCTION}
  --interval SECS   watch: seconds between pulls (default: 300)
  --reset           pull: forget progress markers and re-read everything
The sync code is read from the file named by BRAVE_SYNC_CODE_FILE.`;
```

The default server is the local dev server from `hack/dev.sh native`. Brave's
production server is reached only through `--production`. Q-001 approves
production access, and the flag keeps it a deliberate choice for each run.

```js file=src/cli.js
function die(message) {
  console.error(`brave-sync: ${message}`);
  process.exit(1);
}

function serverUrl({ server, production }) {
  if (production) return PRODUCTION;
  if (new URL(server).hostname.endsWith('brave.com')) die('a brave.com server needs --production');
  return server;
}

async function readSyncCode() {
  const path = process.env.BRAVE_SYNC_CODE_FILE;
  if (!path) die('set BRAVE_SYNC_CODE_FILE to the file that holds the sync code');
  return (await readFile(path, 'utf8')).trim();
}
```

A `brave.com` URL without `--production` is refused, so a typo cannot reach
production either. The sync code is read from the file named by
`BRAVE_SYNC_CODE_FILE`, as the PROMPT.md override requires, and trimmed. It is
read only when a command needs the network, and it passes straight to
`openChain`.

```js file=src/cli.js
async function connect(options, state) {
  const server = serverUrl(options);
  const chain = await openChain(await readSyncCode());
  const post = createTransport({ server, chain, cacheGuid: state.cacheGuid });
  return { chain, post };
}
```

`connect` checks the server before it reads the sync code, so a refused URL
never touches the code. Then it opens the chain and builds the transport.

```js file=src/cli.js
const commands = {
  async pull(options, archive, state) {
    if (options.reset) Object.assign(state, { markers: {}, storeBirthday: null });
    const { chain, post } = await connect(options, state);
    const { records } = await pull({ chain, post, archive, state });
    console.log(`archived ${records} records in ${archive.dir}`);
  },

  async watch(options, archive, state) {
    const { chain, post } = await connect(options, state);
    const interval = Number(options.interval);
    for (;;) {
      try {
        const { records, pollIntervalSeconds } = await pull({ chain, post, archive, state });
        console.log(`${new Date().toISOString()} archived ${records} records`);
        await sleep(1000 * Math.max(interval, pollIntervalSeconds ?? 0));
      } catch (error) {
        if (!error.retryable) throw error;
        console.error(`${new Date().toISOString()} ${error.message}; retrying`);
        await sleep(1000 * interval);
      }
    }
  },

  async status(options, archive, state) {
    console.log(`archive ${archive.dir}`);
    console.log(`store birthday ${state.storeBirthday ?? '(none yet)'}`);
    for (const [type, token] of Object.entries(state.markers)) {
      const mtime = tokenMtime(token);
      console.log(`type ${type}: through ${new Date(Number(mtime)).toISOString()} (mtime ${mtime})`);
    }
    console.log(`devices ${Object.values(state.index.devices).map((d) => d.name).join(', ') || '(none yet)'}`);
  },
};
```

- `pull` pages until the server has nothing more, then exits. `--reset` clears
  the markers and the birthday first (§5.3).
- `watch` pulls, then sleeps for `--interval` seconds (default 300) or the
  server's poll interval, whichever is longer. Retryable errors (network, 5xx,
  `THROTTLED`, `TRANSIENT_ERROR`) are logged and retried after one interval.
  Everything else ends the process.
- `status` reads only local state. It prints each saved marker as the mtime it
  encodes (§3.4), and the device names the index knows.

```js file=src/cli.js
const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    archive: { type: 'string', default: 'archive' },
    server: { type: 'string', default: DEV_SERVER },
    production: { type: 'boolean', default: false },
    interval: { type: 'string', default: '300' },
    reset: { type: 'boolean', default: false },
  },
});

const command = commands[positionals[0]];
if (!command) die(USAGE);
const archive = await openArchive(options.archive);
const state = await archive.loadState();
await archive.saveState(state);
await command(options, archive, state).catch((error) => die(error.message));
```

The state is loaded and saved once before any command runs, so a new archive
gets its cache GUID before the first request. Every failure ends in `die`
with `error.message` and nothing more (§2.6).

## 12. Tests

All tests use synthetic data and public vectors. None uses the throwaway
chain's words or anything derived from them. `npm test` runs them with
`node:test`.

ChainCrypto's own tests use public vectors from brave-core and Chromium, each
cited in the test. Every other test uses a fake chain, so a decoder test never
depends on real cryptography. The fake's "encryption" is base64 of the
serialized `EntitySpecifics` under the key name `k1`. Any other key name
rejects with `UNKNOWN_KEY`.

```js file=test/chain-crypto.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveNigoriKeys, hkdfSha512, nigori, openChain, pureWords, signingKeys } from '../src/chain-crypto.js';
import { EncryptionKeys, encode } from '../src/proto.js';

// Every vector here is public: brave-core and Chromium unit tests, and the
// HKDF-SHA512 vectors brave-core cites. None comes from a real sync chain.
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const unhex = (text) => Uint8Array.from(Buffer.from(text, 'hex'));

// brave-core components/brave_sync/test/test_sync_code.h
const BRAVE_TEST_CODE =
  'fringe digital begin feed equal output proof cheap exotic ill sure question ' +
  'trial squirrel glove celery awkward push jelly logic broccoli almost grocery drift';

test('HKDF-SHA512 matches the vectors brave-core tests against', async () => {
  const okm = await hkdfSha512(unhex('0b'.repeat(22)), unhex('000102030405060708090a0b0c'), unhex('f0f1f2f3f4f5f6f7f8f9'), 42);
  assert.equal(hex(okm), '832390086cda71fb47625bb5ceb168e4c8e26a1a16ed34d9fc7fe92c1481579338da362cb8d9f925d7cb');
  const bare = await hkdfSha512(unhex('0b'.repeat(22)), new Uint8Array(), new Uint8Array(), 42);
  assert.equal(hex(bare), 'f5fa02b18298a72a8c23898a8703472c6eb179dc204c03425c970e3b164bf90fff22d04836d0e2343bac');
});

test('signing keys match brave-core Ed25519KeyDerivation', async () => {
  const seed = unhex('5bb5ceb168e4c8e26a1a16ed34d9fc7fe92c1481579338da362cb8d9f925d7cb');
  const { publicKey, secretKey } = await signingKeys(seed, Uint8Array.of(0));
  assert.equal(hex(publicKey), 'f58ca446f0c33ee7e8e9874466da442b2e764afd77ad46034bdff9e01f9b87d4');
  assert.equal(hex(secretKey), 'b5abda6940984c5153a2ba3653f047f98dfb19e39c3e02f07c8bbb0bd8e8872e');
});

test('the 25th word is dropped and bad codes fail without echoing words', () => {
  assert.equal(pureWords(BRAVE_TEST_CODE), BRAVE_TEST_CODE);
  assert.equal(pureWords(`  ${BRAVE_TEST_CODE.toUpperCase()}\n abandon `), BRAVE_TEST_CODE);
  const invalid = BRAVE_TEST_CODE.replace(/drift$/, 'driftZ');
  assert.throws(() => pureWords(invalid), (error) => !/fringe|drift/.test(error.message));
  assert.throws(() => pureWords('fringe digital'), /24 or 25 words, this one has 2/);
});

test('client ID and access token match brave-core BraveSyncAuthManagerTest', async () => {
  // brave-core components/sync/service/brave_sync_auth_manager_unittest.cc:26-42
  const chain = await openChain(
    'badge unique kiwi orient spring venue piano lake admit ill roof brother grant hour better ' +
      'proud cabbage fee slow economy wage final fox cancel',
  );
  assert.equal(chain.clientId, '502042270C8145247ED70A18F87022A39886900AB36F2FFF655635DBE516765E');
  assert.equal(
    await chain.accessToken(1234567),
    'MzEzMjMzMzQzNTM2Mzd8MDBGNkExNjgxODkxQzU5RDZGMEYwNkVDQ0VGQzBFMTQ3QjA2NDE2RD' +
      'EzNzE0QkQ3MzE3ODJGRjE1NUZFNjMxMTNBNTE2Qzk2NTFFM0ZGQTEyRDhDMzcyQTcyNUZEMzZG' +
      'RjE3QUIxMDRDNDVBNTcyMDVCRkIwNjUwRjgxQ0MyMDl8NTAyMDQyMjcwQzgxNDUyNDdFRDcwQT' +
      'E4Rjg3MDIyQTM5ODg2OTAwQUIzNkYyRkZGNjU1NjM1REJFNTE2NzY1RQ==',
  );
});

test('Nigori key derivation matches Chromium nigori_unittest', async () => {
  const pbkdf2 = await deriveNigoriKeys('hunter2', 1);
  assert.equal(hex(pbkdf2.encryptionKey), '4596bf346572497d92b2a0e2146d93c1');
  assert.equal(hex(pbkdf2.macKey), '2292ad9db96fe590b22a58db50f6f545');
  const scrypted = await deriveNigoriKeys('hunter2', 2, new TextEncoder().encode('alpensalz'));
  assert.equal(hex(scrypted.encryptionKey), '8aa735e0091339a5e51da3b3dd1b328a');
  assert.equal(hex(scrypted.macKey), 'a7e73611968dfd2bca5b3382aed451ba');
});

test('key name and both MAC layouts match Chromium nigori_unittest goldens', async () => {
  const key = await nigori(await deriveNigoriKeys('password', 1));
  assert.equal(key.name, 'ibGL7ymU0Si+eYCXGS6SBHPFT+JCYiB6GDOYqj6vIwEiWJ7RENSHxmIQ8Q3rXd/UnZUmFHYB+jSIbthQADXvrQ==');
  const plain = (bytes) => new TextDecoder().decode(bytes);
  const ciphertextOnlyMac =
    'NNYlnzaaLPXWXyzz8J+u4OKgLiKRBPu2GJdjHWk0m3ADZrJhnmer30Zgiy4Ulxlfh6fmS71k8rop+UvSJdL1k/fcNLJ1C6sY5Z86ijyl1Jo=';
  const ivAndCiphertextMac =
    'WaACU5CT+wnttSXFQmXgVjv4W1AqKdYURasywlvTZwv2RYvrOs3nc507759fvB1tMi32oOU77PSw1qg3ySF8kdF9VYEknEX+eC8vJni9vaE=';
  assert.equal(plain(await key.decrypt(ciphertextOnlyMac)), 'test, test, 1, 2, 3');
  assert.equal(plain(await key.decrypt(ivAndCiphertextMac)), 'test, test, 1, 2, 3');
  const tampered = ivAndCiphertextMac.replace('WaAC', 'WaAD');
  await assert.rejects(key.decrypt(tampered), /integrity/);
});

// Encrypts the way Nigori::EncryptToBytes does, with a fixed IV, for test data only.
async function seal({ encryptionKey, macKey }, plaintext) {
  const { subtle } = globalThis.crypto;
  const iv = new Uint8Array(16).fill(7);
  const aes = await subtle.importKey('raw', encryptionKey, 'AES-CBC', false, ['encrypt']);
  const hmac = await subtle.importKey('raw', macKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const body = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, aes, plaintext));
  const mac = new Uint8Array(await subtle.sign('HMAC', hmac, Buffer.concat([iv, body])));
  return Buffer.concat([iv, body, mac]).toString('base64');
}

async function testNigori(passphrase) {
  const keys = await deriveNigoriKeys(passphrase, 1);
  const { name } = await nigori(keys);
  const bag = encode(EncryptionKeys, {
    key: [{ encryptionKey: Buffer.from(keys.encryptionKey).toString('base64'), macKey: Buffer.from(keys.macKey).toString('base64') }],
  });
  const specifics = {
    passphraseType: 4,
    customPassphraseKeyDerivationMethod: 1,
    encryptionKeybag: { keyName: name, blob: await seal(keys, bag) },
  };
  return { keys, name, specifics };
}

test('setNigori opens the keybag with the sync code, then decrypt uses it', async () => {
  const chain = await openChain(BRAVE_TEST_CODE);
  const { keys, name, specifics } = await testNigori(BRAVE_TEST_CODE);
  await chain.setNigori(specifics);
  const blob = await seal(keys, new TextEncoder().encode('entity specifics'));
  assert.equal(new TextDecoder().decode(await chain.decrypt({ keyName: name, blob })), 'entity specifics');
  await assert.rejects(chain.decrypt({ keyName: 'not-a-key', blob }), (error) => error.code === 'UNKNOWN_KEY');
});

test('setNigori refuses another chain, and passphrase types it cannot open', async () => {
  const chain = await openChain(BRAVE_TEST_CODE);
  const other = await testNigori('another passphrase');
  await assert.rejects(chain.setNigori(other.specifics), /does not open/);
  await assert.rejects(chain.setNigori({ ...other.specifics, passphraseType: 2 }), /type is 2/);
});
```

```js file=test/fakes.js
import { EntitySpecifics, encode } from '../src/proto.js';

export function fakeChain() {
  return {
    clientId: 'AB'.repeat(32),
    nigori: null,
    async accessToken(nowMs) {
      return `fake-token-${nowMs}`;
    },
    async setNigori(nigori) {
      this.nigori = nigori;
    },
    async decrypt({ keyName, blob }) {
      if (keyName !== 'k1') throw Object.assign(new Error(`no key ${keyName}`), { code: 'UNKNOWN_KEY' });
      return Uint8Array.from(Buffer.from(blob, 'base64'));
    },
  };
}

export function encrypted(variant, specifics, keyName = 'k1') {
  const blob = Buffer.from(encode(EntitySpecifics, { [variant]: specifics })).toString('base64');
  return { encrypted: { keyName, blob }, [variant]: {}, specificsVariant: variant };
}
```

```js file=test/proto.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClientToServerMessage, decode, encode, tokenMtime } from '../src/proto.js';

test('a GetUpdates message survives encode and decode', () => {
  const message = {
    share: 'AB CD @brave.com',
    protocolVersion: 99,
    messageContents: 'GET_UPDATES',
    getUpdates: { fetchFolders: true, getUpdatesOrigin: 'PERIODIC', fromProgressMarker: [{ dataTypeId: 47745 }] },
  };
  assert.deepEqual(decode(ClientToServerMessage, encode(ClientToServerMessage, message)), message);
});

test('a progress marker token is a zigzag varint of the mtime, padded to 10 bytes', () => {
  // binary.PutVarint(token, 1792617531700) into make([]byte, binary.MaxVarintLen64), as go-sync writes it.
  assert.equal(tokenMtime('6KSmhaxoAAAAAA=='), '1792617531700');
  // binary.PutVarint(token, 0), the token go-sync returns for a type with no entities.
  assert.equal(tokenMtime('AAAAAAAAAAAAAA=='), '0');
});
```

```js file=test/get-updates.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertReadOnly, TYPES } from '../src/transport.js';
import { buildGetUpdates, getUpdates, shareFor } from '../src/get-updates.js';

const share = shareFor('AB'.repeat(32));

test('share is the client id split in half, as Brave builds the account email', () => {
  assert.equal(shareFor('ABCD'), 'AB CD @brave.com');
});

test('the request asks for exactly NIGORI, SESSIONS and HISTORY, and is read-only', () => {
  const message = buildGetUpdates({ share, storeBirthday: null, markers: {} });
  assert.deepEqual(message.getUpdates.fromProgressMarker.map((m) => m.dataTypeId), [47745, 50119, 963985]);
  assert.equal(message.getUpdates.fetchFolders, true);
  assert.equal(message.storeBirthday, undefined);
  assert.doesNotThrow(() => assertReadOnly(message));
});

test('assertReadOnly refuses commits, NEW_CLIENT and other data types', () => {
  const message = buildGetUpdates({ share, storeBirthday: '1', markers: {} });
  assert.throws(() => assertReadOnly({ ...message, messageContents: 'COMMIT' }), /refusing COMMIT/);
  assert.throws(
    () => assertReadOnly({ ...message, getUpdates: { ...message.getUpdates, getUpdatesOrigin: 'NEW_CLIENT' } }),
    /NEW_CLIENT/,
  );
  const passwords = { ...message.getUpdates, fromProgressMarker: [{ dataTypeId: 45873 }] };
  assert.throws(() => assertReadOnly({ ...message, getUpdates: passwords }), /data type 45873/);
});

function fakePost(responses) {
  const sent = [];
  const post = async (message) => {
    sent.push(structuredClone(message));
    return responses.shift();
  };
  return { post, sent };
}

const page = (token, entries, changesRemaining) => ({
  errorCode: 'SUCCESS',
  storeBirthday: '1',
  clientCommand: { setSyncPollInterval: 30 },
  getUpdates: {
    entries,
    changesRemaining: String(changesRemaining),
    newProgressMarker: [{ dataTypeId: TYPES.HISTORY, token }],
  },
});

test('pages until changes_remaining is 0, sending back each new token', async () => {
  const { post, sent } = fakePost([page('t1', [{ idString: 'a' }], 1), page('t2', [{ idString: 'b' }], 0)]);
  const batches = [];
  for await (const batch of getUpdates({ post, share })) batches.push(batch);
  assert.equal(batches.length, 2);
  assert.equal(batches[1].markers[TYPES.HISTORY], 't2');
  assert.equal(sent[1].getUpdates.fromProgressMarker[2].token, 't1');
  assert.equal(sent[1].storeBirthday, '1');
});

test('stops with STALLED when changes remain but nothing moved', async () => {
  const { post } = fakePost([page('t1', [], 1)]);
  await assert.rejects(async () => {
    for await (const _ of getUpdates({ post, share, markers: { [TYPES.HISTORY]: 't1' } }));
  }, /STALLED/);
});

test('maps sync error codes to retryable and fatal errors', async () => {
  for (const [errorCode, retryable] of [['THROTTLED', true], ['TRANSIENT_ERROR', true], ['DISABLED_BY_ADMIN', false]]) {
    const { post } = fakePost([{ errorCode }]);
    await assert.rejects(
      async () => {
        for await (const _ of getUpdates({ post, share }));
      },
      (error) => error.code === errorCode && error.retryable === retryable,
    );
  }
});

test('a changed store birthday stops the pull', async () => {
  const { post } = fakePost([{ ...page('t1', [], 0), storeBirthday: '2' }]);
  await assert.rejects(async () => {
    for await (const _ of getUpdates({ post, share, storeBirthday: '1' }));
  }, /BIRTHDAY_CHANGED/);
});
```

```js file=test/decode.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBatch } from '../src/decode.js';
import { invalidReason } from '../src/sessions.js';
import { windowsMicrosToIso } from '../src/time.js';
import { encrypted, fakeChain } from './fakes.js';

const emptyIndex = () => ({ devices: {}, cacheGuids: {}, sessionEntities: {} });

const header = {
  sessionTag: 'session_sync_1',
  header: { clientName: 'Test Phone', deviceFormFactor: 'DEVICE_FORM_FACTOR_PHONE', window: [{ windowId: 1, tab: [7] }] },
};
const tab = {
  sessionTag: 'session_sync_1',
  tabNodeId: 0,
  tab: {
    tabId: 7,
    windowId: 1,
    currentNavigationIndex: 0,
    lastActiveTimeUnixEpochMillis: '1792617501654',
    navigation: [{ virtualUrl: 'https://example.com/', title: 'Example Domain', timestampMsec: '1792617501000' }],
  },
};
const visit = {
  visitTimeWindowsEpochMicros: String(11_644_473_600_000_000n + 1_792_617_501_000_000n),
  originatorCacheGuid: 'cache-guid-1',
  redirectEntries: [
    { url: 'http://example.com/', title: '' },
    { url: 'https://example.com/', title: 'Example Domain' },
  ],
};

const entry = (id, specifics, extra = {}) => ({
  idString: id,
  version: '1',
  mtime: '1792617501654',
  originatorCacheGuid: 'cache-guid-1',
  specifics,
  ...extra,
});

test('Windows epoch micros become ISO time', () => {
  assert.equal(windowsMicrosToIso('11644473600000000'), '1970-01-01T00:00:00.000Z');
  assert.equal(windowsMicrosToIso('13404146400000000'), '2025-10-05T14:00:00.000Z');
});

test('session validity follows SessionStore::AreValidSpecifics', () => {
  assert.equal(invalidReason(header), null);
  assert.equal(invalidReason(tab), null);
  assert.match(invalidReason({ ...tab, sessionTag: '' }), /session_tag/);
  assert.match(invalidReason({ ...tab, header: header.header }), /exactly one/);
  assert.match(invalidReason({ ...tab, tabNodeId: -1 }), /tab_node_id/);
  assert.match(invalidReason({ ...header, tabNodeId: 3 }), /header with/);
  const twice = { ...header, header: { window: [{ tab: [7] }, { tab: [7] }] } };
  assert.match(invalidReason(twice), /twice/);
});

test('decodes nigori first, then sessions and history, joining device names', async () => {
  const chain = fakeChain();
  const nigori = { specificsVariant: 'nigori', nigori: { passphraseType: 4 } };
  const entries = [
    entry('v1', encrypted('history', visit)),
    entry('t1', encrypted('session', tab)),
    entry('h1', encrypted('session', header)),
    entry('n1', nigori, { folder: true }),
  ];
  const { records, index } = await decodeBatch(entries, { chain, index: emptyIndex() });
  assert.deepEqual(records.map((r) => r.kind), ['nigori', 'visit', 'tab', 'session-header']);
  assert.deepEqual(chain.nigori, { passphraseType: 4 });

  const again = await decodeBatch(entries.slice(0, 2), { chain, index });
  const [v, t] = again.records;
  assert.equal(v.visitedAt, '2026-10-21T21:18:21.000Z');
  assert.equal(v.url, 'https://example.com/');
  assert.equal(v.device, 'Test Phone');
  assert.equal(t.device, 'Test Phone');
  assert.equal(t.title, 'Example Domain');
  assert.equal(t.lastActiveAt, '2026-10-21T21:18:21.654Z');
});

test('a tab that arrives before its header in the same batch still gets the device name', async () => {
  const entries = [entry('t1', encrypted('session', tab)), entry('h1', encrypted('session', header))];
  const { records } = await decodeBatch(entries, { chain: fakeChain(), index: emptyIndex() });
  assert.equal(records[0].kind, 'tab');
  assert.equal(records[0].device, 'Test Phone');
});

test('a tombstone keeps the session tag and tab node it deleted', async () => {
  const chain = fakeChain();
  const first = await decodeBatch([entry('t1', encrypted('session', tab))], { chain, index: emptyIndex() });
  const gone = entry('t1', { specificsVariant: 'session', session: {} }, { deleted: true, version: '2' });
  const { records } = await decodeBatch([gone], { chain, index: first.index });
  assert.deepEqual(records[0], {
    kind: 'tombstone',
    type: 'session',
    sessionTag: 'session_sync_1',
    tabNodeId: 0,
    entity: { ...records[0].entity, id: 't1', deleted: true },
  });
});

test('an unknown key fails the whole batch and leaves the index untouched', async () => {
  const index = emptyIndex();
  const entries = [entry('h1', encrypted('session', header)), entry('v1', encrypted('history', visit, 'k2'))];
  await assert.rejects(decodeBatch(entries, { chain: fakeChain(), index }), (e) => e.code === 'UNKNOWN_KEY');
  assert.deepEqual(index, emptyIndex());
});

test('a decrypted payload of the wrong type is refused', async () => {
  const wrong = { ...encrypted('history', visit), session: {}, specificsVariant: 'session' };
  delete wrong.history;
  await assert.rejects(decodeBatch([entry('x', wrong)], { chain: fakeChain(), index: emptyIndex() }), /inside a session/);
});
```

```js file=test/archive.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openArchive } from '../src/archive.js';
import { pull } from '../src/pull.js';
import { TYPES } from '../src/transport.js';
import { encrypted, fakeChain } from './fakes.js';

const tempArchive = async () => openArchive(await mkdtemp(join(tmpdir(), 'brave-sync-')));

test('append only ever adds lines', async () => {
  const archive = await tempArchive();
  await archive.append([{ kind: 'visit', url: 'a' }], 't0');
  await archive.append([{ kind: 'visit', url: 'b' }], 't1');
  const lines = (await readFile(join(archive.dir, 'visits.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines, [{ archivedAt: 't0', kind: 'visit', url: 'a' }, { archivedAt: 't1', kind: 'visit', url: 'b' }]);
});

test('pull archives, then saves markers without the NIGORI marker', async () => {
  const archive = await tempArchive();
  const state = await archive.loadState();
  const visit = { visitTimeWindowsEpochMicros: '13404146400000000', redirectEntries: [{ url: 'https://example.com/' }] };
  const sent = [];
  const post = async (message) => {
    sent.push(message);
    return {
      storeBirthday: '1',
      getUpdates: {
        changesRemaining: '0',
        entries: [
          { idString: 'n', version: '1', folder: true, specifics: { specificsVariant: 'nigori', nigori: {} } },
          { idString: 'v', version: '1', specifics: encrypted('history', visit) },
        ],
        newProgressMarker: [
          { dataTypeId: TYPES.NIGORI, token: 'nigori-token' },
          { dataTypeId: TYPES.HISTORY, token: 'history-token' },
        ],
      },
    };
  };
  const result = await pull({ chain: fakeChain(), post, archive, state, now: () => new Date(0) });
  assert.equal(result.records, 2);
  const saved = await archive.loadState();
  assert.deepEqual(saved.markers, { [TYPES.HISTORY]: 'history-token' });
  assert.equal(saved.storeBirthday, '1');
  assert.equal(sent[0].getUpdates.fromProgressMarker[0].token, undefined);
  const visits = await readFile(join(archive.dir, 'visits.jsonl'), 'utf8');
  assert.match(visits, /"url":"https:\/\/example.com\/"/);
});
```

## 13. What was run, and what it means for archiving

### 13.1 Runs on 2026-10-22

1. **Unit tests.** I tangled this document into a scratch directory, ran
   `npm install`, `npm run proto` and `npm test`, and got 27 passing, 0
   failing.
2. **Token vectors.** A Go program calling `binary.PutVarint` on
   1792617531700 and on 0 printed `6KSmhaxoAAAAAA==` and `AAAAAAAAAAAAAA==`,
   the vectors in `test/proto.test.js`.
3. **The live loop.** I ran go-sync with `hack/dev.sh native` on a scratch
   SQLite file, never `vendor/go-sync-dev.db`. go-sync's own
   `authtest.GenerateToken` signed a token with a fresh random key, so the
   requests went to a new, empty chain. `createTransport` and `getUpdates`
   then pulled once: one round, 0 entries, birthday `1`, poll interval 30, and
   three zero tokens. Afterwards the store held 0 entities and 3 cache keys.
   A PERIODIC GetUpdates writes nothing to the datastore.
4. **The contrast.** One NEW_CLIENT GetUpdates on another fresh key, sent
   around the guard, returned the Nigori root and left 5 entities in the
   store.
5. **A bad token** returned HTTP 401 with the server's `Date` header in the
   error.
6. **The throwaway chain**, read through `hack/dev.sh sqlite` (read-only,
   never printing specifics), shows one device, NIGORI as a folder, and every
   SESSIONS and HISTORY row encrypted. One session tombstone has 4 bytes of
   specifics.

7. **The golden test.** `openChain` on the throwaway code file, passed only
   through `BRAVE_SYNC_CODE_FILE`, gave a client ID beginning `556E89CCD8F`,
   the chain in `vendor/go-sync-dev.db`. Only that prefix was printed.
8. **The end-to-end pull.** I ran go-sync on `vendor/go-sync-dev.db`, locally,
   and `brave-sync pull` into a scratch archive. The throwaway chain's NIGORI
   is a custom passphrase with scrypt (§2.7.4), read from the store by
   printing only those two fields. The pull archived 9 records, one for each
   of the chain's 9 entities of the three types: 1 NIGORI, 4 SESSIONS (one a
   tombstone) and 4 HISTORY. Every SESSIONS and HISTORY entity decrypted, and
   every inner variant matched its entity. A second pull archived 1 record,
   the NIGORI metadata that every run re-reads (§10). The server wrote only its
   mtime cache entries. go-sync's SIGTERM handler waits 60 seconds before it
   exits (go-sync `server/server.go:139-151`), so stopping it takes a minute.

Not run: anything against production. No test or fixture holds the throwaway
chain's words or anything derived from them.

### 13.2 What polling can and cannot catch

- **History.** Any poll interval under 14 days sees every visit the server
  accepted (§8.4). Shorter intervals add intermediate versions of a visit,
  such as the first write before its duration is known.
- **Tabs.** A tab entity is overwritten as the tab navigates. The archive
  holds one snapshot per poll per changed tab, and pages that came and went
  between polls are missing from SESSIONS. They should still be in HISTORY.
  The default of 300 seconds is a guess at a useful grain **[inferred]**. The
  server's 30 seconds is the floor.
- **Never seen:** history before each device turned on history sync, history
  over the 30,000 quota, deletions (§8.4), and devices that sync neither tabs
  nor history.

### 13.3 Open questions

1. **BraveServiceKey in production** (§4.3). The first production pull
   answers it. A 4xx not explained by clock skew means stop and report.
2. **The 25th word's date** (§2.7.2). brave-sync ignores it, as Brave's
   `ParseIgnoreDate` does. If you want an expired time-limited code refused,
   that takes one check against the v2 epoch.
3. **Delete directives** (§8.4). Honoring them, recording them, or neither is
   the owner's call. Recording them would need type 150251 added to Q-001.
4. **Device names** come only from session headers (§8.3). A device that
   syncs history but not tabs shows up only as a cache GUID. DEVICE_INFO would
   fix that, outside Q-001.

## Appendix A: the tangler

```js file=tangle.mjs
// Tangle LITERATE.md: each fenced block whose info string has file=PATH is
// added, in document order, to PATH under the output directory. Chunks of
// one file are joined by a blank line.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const [source = 'LITERATE.md', out = 'client'] = process.argv.slice(2);
const fence = /^```\w*\s+file=(\S+)\n([\s\S]*?)\n```$/gm;
const files = new Map();
for (const [, path, body] of (await readFile(source, 'utf8')).matchAll(fence)) {
  files.set(path, [...(files.get(path) ?? []), body]);
}
for (const [path, chunks] of files) {
  await mkdir(dirname(join(out, path)), { recursive: true });
  await writeFile(join(out, path), chunks.join('\n\n') + '\n');
}
console.log(`tangled ${files.size} files into ${out}/`);
```
