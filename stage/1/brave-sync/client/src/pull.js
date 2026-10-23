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
