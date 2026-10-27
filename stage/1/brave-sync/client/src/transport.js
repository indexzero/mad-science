import { ClientToServerMessage, ClientToServerResponse, encode, decode } from './proto.js';

export const TYPES = Object.freeze({ NIGORI: 47745, SESSIONS: 50119, HISTORY: 963985 });
const ALLOWED = new Set(Object.values(TYPES));

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

export class HttpError extends Error {
  constructor(status, serverDate, text) {
    super(`HTTP ${status} from sync server (server date ${serverDate}): ${text}`);
    this.status = status;
    this.serverDate = serverDate;
    this.retryable = status >= 500;
  }
}

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
