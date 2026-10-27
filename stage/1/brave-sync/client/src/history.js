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
