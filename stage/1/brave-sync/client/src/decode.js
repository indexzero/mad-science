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

async function plaintext(specifics, chain) {
  if (!specifics.encrypted) return specifics;
  const inner = decode(EntitySpecifics, await chain.decrypt(specifics.encrypted));
  if (inner.specificsVariant !== specifics.specificsVariant) {
    throw new Error(`decrypted ${inner.specificsVariant} inside a ${specifics.specificsVariant} entity`);
  }
  return inner;
}

export async function decodeBatch(entries, { chain, index }) {
  const next = structuredClone(index);
  const records = [];
  const nigoriFirst = [...entries].sort(
    (a, b) => (b.specifics?.specificsVariant === 'nigori') - (a.specifics?.specificsVariant === 'nigori'),
  );

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

  for (const record of records) {
    if (record.kind === 'tab') record.device ??= next.devices[record.sessionTag]?.name ?? null;
    if (record.kind === 'visit') {
      record.device ??= next.devices[next.cacheGuids[record.originatorCacheGuid]]?.name ?? null;
    }
  }
  return { records, index: next };
}
