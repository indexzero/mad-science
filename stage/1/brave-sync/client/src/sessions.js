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
