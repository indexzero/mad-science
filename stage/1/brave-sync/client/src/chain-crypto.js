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

export function pureWords(syncCode) {
  const words = syncCode.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length !== 24 && words.length !== 25) {
    throw new Error(`a sync code has 24 or 25 words, this one has ${words.length}`);
  }
  const pure = words.slice(0, 24).join(' ');
  if (!validateMnemonic(pure, wordlist)) throw new Error('the sync code is not a valid BIP39 mnemonic');
  return pure;
}

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

  return {
    clientId,

    async accessToken(nowMs) {
      const timestamp = utf8.encode(String(Math.trunc(nowMs)));
      const signature = await ed.signAsync(timestamp, secretKey);
      return btoa(`${toHex(timestamp)}|${toHex(signature)}|${clientId}`);
    },

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

    async decrypt({ keyName, blob }) {
      const key = keybag.get(keyName);
      if (!key) {
        throw Object.assign(new Error(`no key named ${keyName.slice(0, 8)}… in the keybag`), { code: 'UNKNOWN_KEY' });
      }
      return key.decrypt(blob);
    },
  };
}
