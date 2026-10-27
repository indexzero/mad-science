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
