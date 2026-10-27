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
