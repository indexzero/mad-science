export async function latestTabs(records) {
  const latest = new Map();
  for await (const record of records) {
    const seen = latest.get(record.entity.id);
    if (!seen || BigInt(record.entity.version ?? 0) >= BigInt(seen.entity.version ?? 0)) {
      latest.set(record.entity.id, record);
    }
  }
  return [...latest.values()];
}

const minute = (iso) => (iso ? `${iso.slice(0, 16).replace('T', ' ')}Z` : '(no time)');
const activity = (tab) => tab.lastActiveAt ?? tab.navigatedAt ?? '';

export function renderTabs(tabs) {
  if (tabs.length === 0) return 'no tabs archived yet';
  const devices = Map.groupBy(tabs, (tab) => tab.device ?? `session ${tab.sessionTag}`);
  const sections = [];
  for (const device of [...devices.keys()].sort()) {
    const group = devices.get(device).sort((a, b) => activity(b).localeCompare(activity(a)));
    const lines = [`${device}  (${group.length} ${group.length === 1 ? 'tab' : 'tabs'})`];
    for (const tab of group) {
      const pinned = tab.specifics?.tab?.pinned ? '  [pinned]' : '';
      lines.push(`  ${minute(activity(tab))}  ${tab.title || '(untitled)'}${pinned}`);
      lines.push(`  ${' '.repeat(17)}  ${tab.url ?? '(no url)'}`);
    }
    sections.push(lines.join('\n'));
  }
  return sections.join('\n\n');
}
