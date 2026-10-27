import { TYPES } from './transport.js';

const ORDER = [TYPES.NIGORI, TYPES.SESSIONS, TYPES.HISTORY];

export function shareFor(clientId) {
  const middle = clientId.length / 2;
  return `${clientId.slice(0, middle)} ${clientId.slice(middle)} @brave.com`;
}

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

export async function* getUpdates({ post, share, storeBirthday = null, markers = {}, maxRounds = 1000 }) {
  for (let round = 0; round < maxRounds; round++) {
    const response = await post(buildGetUpdates({ share, storeBirthday, markers }));
    checkErrorCode(response);

    const birthday = response.storeBirthday ?? storeBirthday;
    if (storeBirthday && birthday !== storeBirthday) {
      throw new SyncError('BIRTHDAY_CHANGED', `store birthday ${storeBirthday} became ${birthday}; run pull --reset`);
    }

    const updates = response.getUpdates ?? {};
    const entries = updates.entries ?? [];
    const next = { ...markers };
    for (const marker of updates.newProgressMarker ?? []) {
      if (marker.token) next[marker.dataTypeId] = marker.token;
    }
    const moved = entries.length > 0 || ORDER.some((id) => next[id] !== markers[id]);

    yield {
      entries,
      markers: next,
      storeBirthday: birthday,
      pollIntervalSeconds: response.clientCommand?.setSyncPollInterval ?? null,
    };

    markers = next;
    storeBirthday = birthday;
    if (Number(updates.changesRemaining ?? 0) === 0) return;
    if (!moved) throw new SyncError('STALLED', 'changes remain but the server returned nothing new');
  }
  throw new SyncError('TOO_MANY_ROUNDS', `still paging after ${maxRounds} rounds`);
}
