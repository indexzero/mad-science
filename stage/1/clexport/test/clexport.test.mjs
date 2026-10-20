import fs from 'fs';
import assert from 'assert/strict';
const SCRIPT = new URL('../clexport.js', import.meta.url);
const ORG = '00000000-0000-4000-8000-000000000001';
const KEY = 'ccd/dframe-store';
let failures = 0;
const ok = (name, fn) => fn().then(() => console.log('PASS', name), e => { failures++; console.log('FAIL', name, '\n   ', e.message); });

// ---------- fixtures: shaped like a real list and blob, synthetic names ----------
const chatList = [
  { uuid: 'c-spa', name: 'Tree layout notes', summary: 'tree layouts, spacing, nesting', created_at: '2026-10-07T19:49:40Z', updated_at: '2026-10-08T15:18:15Z', project: { uuid: 'p-dl', name: 'Alpha Archive' } },
  { uuid: 'c-wf', name: 'Exporting a grocery order history on a schedule', summary: 'one-file export script', created_at: '2026-10-04T16:55:08Z', updated_at: '2026-10-04T16:56:04Z', project: { uuid: 'p-dl', name: 'Alpha Archive' } },
  { uuid: 'c-tmp', name: 'Draft license terms for shared model files', summary: '', created_at: '2026-07-30T17:00:54Z', updated_at: '2026-10-08T15:51:03Z', project: { uuid: 'p-dl', name: 'Alpha Archive' } },
  { uuid: 'c-bldg', name: 'Exporting thermostat temperature readings', summary: 'CSV download', created_at: '2026-06-15T23:53:25Z', updated_at: '2026-06-16T00:01:09Z', project: { uuid: 'p-549', name: '101 Sample Science ' } },
  { uuid: 'c-who', name: 'Reading the output of a login list', summary: 'counting unwashed dishes', created_at: '2026-08-11T14:21:37Z', updated_at: '2026-08-11T14:21:47Z', project: null },
  { uuid: 'c-blind', name: '', summary: 'blinds for the office window', created_at: '2026-08-02T00:57:25Z', updated_at: '2026-08-02T01:00:13Z', project: null },
  { uuid: 'c-meta', name: 'Tracing the history of an idea through citations', summary: 'three early authors', created_at: '2026-07-26T05:39:54Z', updated_at: '2026-10-09T14:30:38Z', project: null },
];
const makeBlob = () => ({
  state: {
    pinnedOrder: [], groupByByMode: { cowork: 'custom' }, navPinV: 2,
    sidebarSections: [
      { id: 'pinned', kind: 'pinned', name: '', order: 0, sortBy: 'recency', ascending: false, show: { metadata: true, emptyGroups: false }, collapsed: false, shown: true },
      { id: 'cg-dl', kind: 'manual', name: 'Alpha Archive', order: 2, sortBy: 'recency', ascending: false, show: { metadata: false, emptyGroups: false }, collapsed: false, shown: true, members: ['chat:c-tmp'] },
      { id: 'cg-cdev', kind: 'manual', name: 'beta.site', order: 3, sortBy: 'recency', ascending: false, show: { metadata: false, emptyGroups: false }, collapsed: false, shown: true, members: ['chat:c-spa'] },
      { id: 'cg-cf', kind: 'manual', name: 'gamma.home', order: 1, sortBy: 'recency', ascending: false, show: { metadata: false, emptyGroups: false }, collapsed: false, shown: true, members: ['chat:c-wf'] },
      { id: 'cg-meta', kind: 'manual', name: 'deltacog', order: 4, members: ['chat:c-meta'], sortBy: 'recency', ascending: false, show: { metadata: true, emptyGroups: false }, collapsed: false, shown: true },
      { id: 'sessions', kind: 'sessions', name: '', order: 5, sortBy: 'recency', ascending: false, show: { metadata: true, emptyGroups: false }, collapsed: false, shown: true },
    ],
    customGroups: [{ id: 'cg-dl', name: 'Alpha Archive' }, { id: 'cg-cdev', name: 'beta.site' }, { id: 'cg-cf', name: 'gamma.home' }, { id: 'cg-meta', name: 'deltacog' }],
    customGroupAssignments: { 'chat:c-tmp': 'cg-dl', 'chat:c-spa': 'cg-cdev', 'chat:c-wf': 'cg-cf', 'chat:c-meta': 'cg-meta' },
    customGroupOrder: { 'cg-dl': ['chat:c-tmp'], 'cg-cdev': ['chat:c-spa'], 'cg-cf': ['chat:c-wf'], 'cg-meta': ['chat:c-meta'] },
  },
  version: 1, updatedAt: 1791557060165,
});
const fixtureStore = () => {
  const s = { blob: makeBlob(), writes: 0, failNext: false };
  s.read = async () => structuredClone(s.blob);
  s.write = async b => { if (s.failNext) { s.failNext = false; throw new Error('boom'); } s.writes++; s.blob = structuredClone(b); };
  return s;
};
const source = { load: async () => structuredClone(chatList) };
const consistent = st => {
  for (const [k, gid] of Object.entries(st.customGroupAssignments)) {
    assert.ok(st.customGroupOrder[gid]?.includes(k), `${k} missing from order of ${gid}`);
    assert.ok(st.sidebarSections.find(x => x.id === gid).members.includes(k), `${k} missing from members of ${gid}`);
  }
  for (const sec of st.sidebarSections.filter(x => x.members)) for (const k of sec.members) assert.equal(st.customGroupAssignments[k], sec.id);
  for (const [gid, ks] of Object.entries(st.customGroupOrder)) { assert.ok(ks.length, `empty order kept for ${gid}`); for (const k of ks) assert.equal(st.customGroupAssignments[k], gid); }
};

// ---------- browser shims ----------
const reqs = []; let files = []; let pending; let tables = [];
const N = 65;
const list = Array.from({ length: N }, (_, i) => ({ uuid: 'u' + i, name: 'chat ' + i, created_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), updated_at: '2026-10-01T00:00:00Z', project: null }));
// A small user_settings server shaped like the real one: versioned envelope, sha256 checksum,
// PUT merges entries and requires if-match to equal the current checksum.
const SIBLING = 'ccd/dframe-starred-cowork-remote';
const server = { entries: {}, n: 65, interfere: 0, override: null };
const resetServer = () => { server.entries = { [SIBLING]: '{"starred":["x"]}', [KEY]: JSON.stringify(makeBlob()) }; server.n = 65; server.interfere = 0; server.override = null; };
const checksumOf = () => 'sha256:' + server.n.toString(16).padStart(64, '0');
resetServer();
globalThis.fetch = async (url, opts = {}) => {
  reqs.push({ url, method: opts.method ?? 'GET', body: opts.body, headers: opts.headers ?? {}, cache: opts.cache });
  if (url.includes('/user_settings')) {
    if (!opts.method || opts.method === 'GET') {
      if (server.override) return { ok: true, json: async () => server.override };
      return { ok: true, json: async () => ({ userId: 'u', version: server.n, lastModified: 'x', checksum: checksumOf(),
        content: { entries: { ...server.entries } } }) };
    }
    if (server.interfere > 0) {                 // someone else writes between our read and our write
      server.interfere--; server.n++;
      const st = JSON.parse(server.entries[KEY]);
      st.state.customGroupAssignments['chat:c-blind'] = 'cg-dl';
      st.state.customGroupOrder['cg-dl'].push('chat:c-blind');
      st.state.sidebarSections.find(x => x.id === 'cg-dl').members.push('chat:c-blind');
      server.entries[KEY] = JSON.stringify(st);
    }
    if (opts.headers?.['if-match'] !== checksumOf()) return { ok: false, status: 412, json: async () => ({}), text: async () => 'precondition failed' };
    Object.assign(server.entries, JSON.parse(opts.body).entries);
    server.n++;
    return { ok: true, json: async () => ({}), text: async () => '' };
  }
  const m = url.match(/chat_conversations\/([^?]+)\?/);
  if (m) {
    const c = list.find(x => x.uuid === m[1]);
    return c ? { ok: true, json: async () => ({ ...c, chat_messages: [{ index: 0 }] }) } : { ok: false, status: 404, text: async () => 'gone' };
  }
  const q = new URL('http://x' + url).searchParams, off = +q.get('offset'), lim = +q.get('limit');
  return { ok: true, json: async () => ({ data: list.slice(off, off + lim), has_more: off + lim < N }) };
};
globalThis.Blob = class { constructor(p, o) { this.parts = p; this.type = o.type; } };
URL.createObjectURL = b => { pending = b; return 'blob:x'; };
URL.revokeObjectURL = () => {};
globalThis.document = { createElement: () => ({ click() { files.push({ name: this.download, type: pending.type, text: pending.parts.join('') }); }, remove() {} }), body: { append() {} } };
globalThis.localStorage = { 'unrelated': 'x', [KEY]: JSON.stringify(makeBlob()), getItem(k) { return this[k] ?? null; }, setItem(k, v) { this[k] = v; } };
Object.defineProperty(localStorage, 'getItem', { enumerable: false }); Object.defineProperty(localStorage, 'setItem', { enumerable: false });
console.log = () => {}; console.warn = () => {}; const log = (...a) => process.stdout.write(a.join(' ') + '\n');
console.table = (v, cols) => tables.push({ v, cols });
global.console.log = () => {};
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
const okv = (name, fn) => fn().then(() => say('PASS', name), e => { failures++; say('FAIL', name, '\n   ', e.message.slice(0, 600)); });

const ORG_B = '11111111-2222-3333-4444-555555555555';
const ORG_C = '99999999-8888-7777-6666-555555555555';
let entries = [{ name: `https://claude.ai/api/organizations/${ORG}/chat_conversations_v2?limit=30&offset=0` }];
Object.defineProperty(globalThis, 'performance', { value: { getEntriesByType: t => (t === 'resource' ? entries : []) }, configurable: true, writable: true });
globalThis.location = { origin: 'https://claude.ai' };
document.cookie = `intercom-id=1; lastActiveOrg=${ORG}; theme=dark`;
let warnings = [];
console.warn = (...a) => warnings.push(a.join(' '));

eval(fs.readFileSync(SCRIPT, 'utf8'));
const { chats, groups } = clexport;

// ---------- chats ----------
await okv('chats.load pages with the app params and returns every chat', async () => {
  reqs.length = 0;
  const all = await chats.load();
  assert.equal(all.length, N);
  const first = reqs[0].url;
  assert.match(first, /chat_conversations_v2\?limit=30&offset=0&archived=false&consistency=eventual$/);
  assert.deepEqual(chats.all.map(c => c.uuid), list.map(c => c.uuid));
});
await okv('chats.page steps from the last offset and merges by uuid', async () => {
  chats.reset();
  assert.equal((await chats.page()).offset, 0);
  assert.equal((await chats.page()).offset, 30);
  const again = await chats.page(30);
  assert.equal(again.added, 0);
  assert.equal(chats.all.length, 60);
});
await okv('create bakes config in, inherits from its parent, and leaves the default alone', async () => {
  const strong = chats.create({ consistency: 'strong' });
  const strongArchived = strong.create({ archived: true });
  reqs.length = 0;
  await strongArchived.page(0);
  assert.match(reqs[0].url, /archived=true&consistency=strong/);
  reqs.length = 0;
  await chats.page(0);
  assert.match(reqs[0].url, /archived=false&consistency=eventual/);
});
await okv('chats.download saves the loaded list without fetching', async () => {
  await chats.load(); files = []; reqs.length = 0;
  chats.download();
  assert.equal(reqs.length, 0);
  assert.equal(files.length, 1);
  assert.match(files[0].name, /^claude-chats-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(JSON.parse(files[0].text).length, N);
  assert.throws(() => chats.create().download(), /nothing loaded/);
});

// ---------- messages ----------
await okv('messages.load defaults to the parent list, keeps the transcript query, sorts oldest first', async () => {
  reqs.length = 0;
  const shuffled = [...chats.all].reverse().slice(0, 5);
  const r = await chats.messages.load([...shuffled, 'missing', shuffled[0].uuid]);
  assert.equal(r.loaded.length, 5);
  assert.deepEqual(r.failed.map(f => f.uuid), ['missing']);
  assert.ok(reqs.some(x => x.url.endsWith('?tree=True&rendering_mode=messages&render_all_tools=true&include_inline_comparison=true&consistency=strong')));
  assert.equal(reqs.filter(x => x.url.includes('/chat_conversations/')).length, 6, 'duplicate uuid fetched twice');
  const dates = chats.messages.all.map(c => c.created_at);
  assert.deepEqual(dates, [...dates].sort());
});
await okv('messages.download writes one .jsonl, one chat per line, no fetch', async () => {
  files = []; reqs.length = 0;
  chats.messages.download();
  assert.equal(reqs.length, 0);
  assert.match(files[0].name, /^claude-messages-\d{4}-\d{2}-\d{2}\.jsonl$/);
  const lines = files[0].text.split('\n');
  assert.equal(lines.at(-1), '');
  assert.equal(lines.length - 1, 5);
  const archived = chats.create({ archived: true });
  await archived.page(0); await archived.messages.load(archived.all.slice(0, 1));
  files = []; archived.messages.download();
  assert.match(files[0].name, /^claude-messages-archived-/);
});

// ---------- groups with a fixture store ----------
let store = fixtureStore();
await okv('groups.load joins chats and blob, returns counts in sidebar order', async () => {
  const counts = await groups.load({ chats: source, settings: store });
  assert.deepEqual(counts, [
    { name: 'gamma.home', count: 1 }, { name: 'Alpha Archive', count: 1 },
    { name: 'beta.site', count: 1 }, { name: 'deltacog', count: 1 },
  ]);
  assert.equal(groups.all.length, chatList.length);
});
await okv('where: group null, project with stray whitespace, regex over summary (/g stays stable), predicate', async () => {
  assert.deepEqual(groups.all.where({ group: null }).map(r => r.uuid), ['c-bldg', 'c-who', 'c-blind']);
  assert.deepEqual(groups.all.where({ project: '101 Sample Science' }).map(r => r.uuid), ['c-bldg']);
  const g = /washe|blinds/gi;
  assert.equal(groups.all.where(g).length, 2);
  assert.equal(groups.all.where(g).length, 2);
  assert.deepEqual(groups.all.where({ project: /archive/i, group: 'beta.site' }).map(r => r.uuid), ['c-spa']);
  assert.deepEqual(groups.all.where((c, group) => group === null && !c.name).map(r => r.uuid), ['c-blind']);
  assert.deepEqual(groups.all.where({ after: '2026-10-08', before: '2026-10-09' }).map(r => r.uuid).sort(), ['c-spa', 'c-tmp']);
  assert.throws(() => groups.all.where({ projet: 'x' }), /unknown query key projet/);
});
await okv('views reindex, pick refers to its own view, show prints and returns itself', async () => {
  const u = groups.all.where({ group: null });
  assert.deepEqual(u.map(r => r.index), [0, 1, 2]);
  const p = u.pick(2, 0, 2);
  assert.deepEqual(p.map(r => [r.index, r.uuid]), [[0, 'c-blind'], [1, 'c-bldg']]);
  assert.throws(() => u.pick(7), /no row 7 in this view \(0\.\.2\)/);
  tables = [];
  assert.equal(u.show(), u);
  assert.deepEqual(tables[0].cols, ['name', 'project', 'group', 'updated', 'uuid']);
  assert.ok(Object.isFrozen(u) && Object.isFrozen(u[0]));
  const extra = Object.getOwnPropertyNames(tables[0].v).filter(k => k !== 'length' && !/^\d+$/.test(k));
  assert.deepEqual(extra, [], 'console.table must get rows only; Chrome lists non-enumerable own props');
  assert.equal(tables[0].v.length, u.length);
});
await okv('to: unknown name throws, grouped chats skipped unless move, same group is a no-op', async () => {
  assert.throws(() => groups.all.pick(0).to('Bear & Pear'), /no group named "Bear & Pear"/);
  const r = groups.all.where({ project: 'Alpha Archive' }).to('Alpha Archive');
  assert.deepEqual(r.staged.map(m => m.uuid), []);
  assert.deepEqual(r.skipped.map(m => m.uuid).sort(), ['c-spa', 'c-tmp', 'c-wf']);
  const r2 = groups.all.where({ project: 'Alpha Archive' }).to('Alpha Archive', { move: true });
  assert.deepEqual(r2.staged.map(m => m.uuid).sort(), ['c-spa', 'c-wf']);
  groups.clear();
  assert.deepEqual(groups.plan(), []);
});
await okv('plan round-trips through stage; stage is all-or-nothing on unknown names', async () => {
  groups.all.where({ group: null }).pick(0, 1).to('beta.site');
  groups.all.where({ uuid: undefined }.uuid ? 0 : { group: 'deltacog' }).ungroup();
  const plan = JSON.parse(JSON.stringify(groups.plan()));
  assert.deepEqual(plan.map(m => [m.uuid, m.from, m.to]), [['c-bldg', null, 'beta.site'], ['c-who', null, 'beta.site'], ['c-meta', 'deltacog', null]]);
  groups.clear();
  assert.throws(() => groups.stage([{ uuid: 'c-bldg', to: 'beta.site' }, { uuid: 'c-who', to: 'nope' }]), /no group named "nope"; nothing staged/);
  assert.equal(groups.plan().length, 0);
  const s = groups.stage(plan);
  assert.equal(s.staged.length, 3);
  assert.deepEqual(groups.plan(), plan);
});
await okv('commit: one write, three structures in step, emptied group mirrors the app, no new keys', async () => {
  const keysBefore = Object.keys(store.blob.state).sort();
  const t0 = store.blob.updatedAt;
  const r = await groups.commit();
  assert.equal(r.applied.length, 3); assert.equal(r.dropped.length, 0);
  assert.equal(store.writes, 1);
  const st = store.blob.state;
  consistent(st);
  assert.equal(st.customGroupAssignments['chat:c-bldg'], 'cg-cdev');
  assert.equal(st.customGroupAssignments['chat:c-meta'], undefined);
  assert.ok(!('cg-meta' in st.customGroupOrder), 'emptied group should lose its customGroupOrder key');
  assert.deepEqual(st.sidebarSections.find(x => x.id === 'cg-meta').members, []);
  assert.deepEqual(Object.keys(st).sort(), keysBefore);
  assert.ok(store.blob.updatedAt > t0);
  assert.deepEqual(groups.all.where({ group: 'beta.site' }).map(r => r.uuid).sort(), ['c-bldg', 'c-spa', 'c-who']);
  assert.deepEqual(groups.plan(), []);
});
await okv('commit with an empty plan writes nothing', async () => {
  const w = store.writes;
  assert.deepEqual(await groups.commit(), { applied: [], dropped: [] });
  assert.equal(store.writes, w);
});
await okv('undo applies the inverse to a fresh read and restores every assignment', async () => {
  const r = await groups.undo();
  assert.equal(r.applied.length, 3);
  const st = store.blob.state;
  consistent(st);
  assert.deepEqual(st.customGroupAssignments, makeBlob().state.customGroupAssignments);
  assert.deepEqual(st.customGroupOrder['cg-meta'], ['chat:c-meta']);
  await assert.rejects(groups.undo(), /nothing to undo/);
});
await okv('sidebar changes between stage and commit come back as dropped, not forced', async () => {
  groups.all.where({ group: null }).to('gamma.home');                 // c-bldg, c-who, c-blind
  store.blob.state.customGroupAssignments['chat:c-who'] = 'cg-dl';           // someone filed it meanwhile
  store.blob.state.customGroupOrder['cg-dl'].push('chat:c-who');
  store.blob.state.sidebarSections.find(x => x.id === 'cg-dl').members.push('chat:c-who');
  const r = await groups.commit();
  assert.deepEqual(r.applied.map(m => m.uuid).sort(), ['c-bldg', 'c-blind']);
  assert.deepEqual(r.dropped.map(m => m.uuid), ['c-who']);
  assert.equal(store.blob.state.customGroupAssignments['chat:c-who'], 'cg-dl');
  consistent(store.blob.state);
});
await okv('a group renamed between stage and commit drops its moves', async () => {
  await groups.undo();
  groups.all.pick(groups.all.findIndex(r => r.uuid === 'c-blind')).to('deltacog');
  store.blob.state.customGroups.find(g => g.id === 'cg-meta').name = 'deltacognition';
  const w = store.writes;
  const r = await groups.commit();
  assert.equal(r.applied.length, 0); assert.equal(r.dropped.length, 1);
  assert.equal(store.writes, w, 'nothing applied, nothing written');
});
await okv('a failed write keeps the plan staged and the undo history intact', async () => {
  groups.all.where({ group: null }).pick(0).to('beta.site');
  store.failNext = true;
  await assert.rejects(groups.commit(), /boom/);
  assert.equal(groups.plan().length, 1);
  const r = await groups.commit();
  assert.equal(r.applied.length, 1);
});
await okv('load starts a new session: staged moves and undo history cleared', async () => {
  groups.all.where({ group: null }).pick(0).to('beta.site');
  await groups.load({ chats: source, settings: store });
  assert.equal(groups.plan().length, 0);
  await assert.rejects(groups.undo(), /nothing to undo/);
});

// ---------- default settings store over fetch ----------
await okv('default store reads entries[KEY], writes the same envelope, syncs localStorage', async () => {
  reqs.length = 0;
  await groups.load({ chats: source });
  assert.ok(reqs.some(r => r.method === 'GET' && r.url === `/api/claude_code/organizations/${ORG}/user_settings`));
  groups.all.where({ group: null }).pick(0).to('deltacog');
  await groups.commit();
  const w = reqs.find(r => r.method === 'PUT');
  const body = JSON.parse(w.body);
  assert.deepEqual(Object.keys(body), ['entries']);
  assert.deepEqual(Object.keys(body.entries), [KEY]);
  assert.equal(typeof body.entries[KEY], 'string');
  const written = JSON.parse(body.entries[KEY]);
  consistent(written.state);
  assert.equal(localStorage[KEY], body.entries[KEY]);
  assert.equal(localStorage.unrelated, 'x');
});
await okv('default store fails loudly when the blob is not where it expects', async () => {
  server.override = { userId: 'u', version: 1, entries: {} };
  await assert.rejects(groups.load({ chats: source }), /no ccd\/dframe-store in user_settings; top-level keys: userId, version, entries/);
  server.override = { content: { other: 1 } };
  await assert.rejects(groups.load({ chats: source }), /content keys: other/);
  server.override = { content: { entries: { [SIBLING]: '{}' } } };
  await assert.rejects(groups.load({ chats: source }), /content\.entries keys: ccd\/dframe-starred-cowork-remote/);
  resetServer();
});
const fresh = (0, eval)(fs.readFileSync(SCRIPT, 'utf8').replace('globalThis.clexport = ', '(') .replace(/\}\)\(\);\s*$/, '})())'));
await okv('groups before load: empty view, verbs explain what to do', async () => {
  assert.equal(fresh.groups.all.length, 0);
  assert.throws(() => fresh.groups.stage([]), /run await clexport.groups.load\(\) first/);
  await assert.rejects(fresh.groups.commit(), /run await clexport.groups.load\(\) first/);
});

// ---------- org inference ----------
await okv('getOrgId: requests only, cookie only, both agreeing without a warning', async () => {
  const save = [entries, document.cookie];
  document.cookie = 'theme=dark';
  assert.equal(clexport.getOrgId(), ORG);
  entries = []; document.cookie = `lastActiveOrg=${ORG_B}`;
  assert.equal(clexport.getOrgId(), ORG_B);
  [entries, document.cookie] = save; warnings = [];
  assert.equal(clexport.getOrgId(), ORG);
  assert.deepEqual(warnings, []);
});
await okv('getOrgId: requests win a disagreement and warn once, not on every read', async () => {
  const save = document.cookie;
  document.cookie = `lastActiveOrg=${ORG_B}`; warnings = [];
  for (let i = 0; i < 5; i++) assert.equal(clexport.getOrgId(), ORG);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], new RegExp(`${ORG} from page requests does not match lastActiveOrg cookie ${ORG_B}`));
  document.cookie = save;
});
await okv('getOrgId: most recent request wins when several orgs appear; cross-origin and junk ignored', async () => {
  const save = entries; warnings = [];
  entries = [
    { name: `https://claude.ai/api/organizations/${ORG_B}/projects` },
    { name: `https://evil.example/api/organizations/${ORG_C}/x` },
    { name: 'not a url' },
    { name: `https://claude.ai/api/claude_code/organizations/${ORG}/user_settings` },
    { name: `https://claude.ai/api/organizations/${ORG_B}/chat_conversations_v2` },
  ];
  assert.equal(clexport.getOrgId(), ORG_B);
  assert.match(warnings.join('\n'), /page requests name 2 orgs/);
  assert.doesNotMatch(warnings.join('\n'), new RegExp(ORG_C));
  entries = save;
});
await okv('getOrgId: neither source throws with the fix in the message', async () => {
  const save = [entries, document.cookie];
  entries = []; document.cookie = 'lastActiveOrg=not-a-uuid';
  assert.throws(() => clexport.getOrgId(), /set clexport\.orgId = "<uuid>"/);
  [entries, document.cookie] = save;
});
await okv('orgId: defaults to getOrgId, pins on assignment, unpins on undefined', async () => {
  assert.equal(clexport.orgId, ORG);
  clexport.orgId = ORG_B;
  assert.equal(clexport.orgId, ORG_B);
  clexport.orgId = undefined;
  assert.equal(clexport.orgId, ORG);
  assert.ok(Object.isFrozen(clexport));
});
await okv('a list keeps the org it was loaded with; load() and reset() resolve again', async () => {
  await chats.load();
  clexport.orgId = ORG_B; reqs.length = 0;
  await chats.page();                                        // continuing: still ORG
  await chats.messages.load(chats.all.slice(0, 1));          // built on the list: still ORG
  assert.ok(reqs.length >= 2 && reqs.every(r => r.url.includes(ORG)), reqs.map(r => r.url).join('\n'));
  reqs.length = 0;
  chats.reset(); await chats.page();                         // fresh list: pinned ORG_B
  assert.ok(reqs[0].url.includes(ORG_B));
  reqs.length = 0;
  await chats.load();
  assert.ok(reqs.every(r => r.url.includes(ORG_B)));
  clexport.orgId = undefined;
});
await okv('create({ org }) beats the pin', async () => {
  clexport.orgId = ORG_B; reqs.length = 0;
  await chats.create({ org: ORG_C }).page(0);
  assert.ok(reqs[0].url.includes(ORG_C));
  clexport.orgId = undefined;
});
await okv('a groups session reads and writes the org its chats came from, even after a re-pin', async () => {
  resetServer();
  reqs.length = 0;
  await groups.load({ chats: chats.create({ org: ORG_C }) });
  assert.ok(reqs.some(r => r.method === 'GET' && r.url === `/api/claude_code/organizations/${ORG_C}/user_settings`));
  clexport.orgId = ORG_B; reqs.length = 0;
  groups.all.pick(0).to('deltacog', { move: true });
  await groups.commit();
  const io = reqs.filter(r => r.url.includes('user_settings'));
  assert.ok(io.length === 2 && io.every(r => r.url === `/api/claude_code/organizations/${ORG_C}/user_settings`), io.map(r => r.method + ' ' + r.url).join('\n'));
  clexport.orgId = undefined;
});

// ---------- the observed write protocol ----------
await okv('reads bypass the cache; the write is a PUT with if-match from the read, merging entries', async () => {
  resetServer(); clexport.orgId = undefined;
  await groups.load({ chats: source });
  const read = reqs.filter(r => r.url.includes('user_settings')).at(-1);
  assert.equal(read.cache, 'no-store');
  const before = checksumOf();
  reqs.length = 0;
  groups.all.where({ group: null }).pick(0).to('deltacog');
  await groups.commit();
  const io = reqs.filter(r => r.url.includes('user_settings'));
  assert.deepEqual(io.map(r => r.method), ['GET', 'PUT']);
  assert.equal(io[1].headers['if-match'], before);
  assert.equal(io[1].cache, 'no-store');
  assert.deepEqual(Object.keys(JSON.parse(io[1].body).entries), [KEY]);
  assert.equal(server.entries[SIBLING], '{"starred":["x"]}', 'sibling entry untouched');
  consistent(JSON.parse(server.entries[KEY]).state);
});
await okv('a conflict re-reads and re-applies, checking every move against the newer state', async () => {
  resetServer();
  await groups.load({ chats: source });
  groups.all.where({ group: null }).to('gamma.home');     // c-bldg, c-who, c-blind
  server.interfere = 1;                                          // c-blind gets filed elsewhere mid-commit
  warnings = []; reqs.length = 0;
  const r = await groups.commit();
  assert.deepEqual(reqs.filter(x => x.url.includes('user_settings')).map(x => x.method), ['GET', 'PUT', 'GET', 'PUT']);
  assert.deepEqual(r.applied.map(m => m.uuid).sort(), ['c-bldg', 'c-who']);
  assert.deepEqual(r.dropped.map(m => m.uuid), ['c-blind']);
  assert.match(warnings.join('\n'), /re-reading \(attempt 2 of 3\)/);
  const st = JSON.parse(server.entries[KEY]).state;
  consistent(st);
  assert.equal(st.customGroupAssignments['chat:c-blind'], 'cg-dl', 'the other writer wins');
});
await okv('persistent conflict gives up after 3 attempts, writes nothing, keeps the plan', async () => {
  resetServer();
  await groups.load({ chats: source });
  groups.all.where({ group: null }).pick(0).to('beta.site');
  const original = server.entries[KEY];
  server.interfere = 3;
  await assert.rejects(groups.commit(), /settings changed since the read \(412\); nothing written/);
  assert.equal(groups.plan().length, 1);
  assert.equal(JSON.parse(server.entries[KEY]).state.customGroupAssignments['chat:c-bldg'], undefined);
  assert.notEqual(server.entries[KEY], original, 'only the interfering writer changed it');
});
await okv('an unexpected checksum form refuses to write rather than guess', async () => {
  resetServer();
  await groups.load({ chats: source });
  groups.all.where({ group: null }).pick(0).to('beta.site');
  server.override = { userId: 'u', version: 1, checksum: 'fcc660d8', content: { entries: { ...server.entries } } };
  reqs.length = 0;
  await assert.rejects(groups.commit(), /refusing to write: checksum from the read is "fcc660d8"/);
  assert.equal(reqs.filter(r => r.method === 'PUT').length, 0);
  assert.equal(groups.plan().length, 1);
  resetServer();
});
await okv('messages.load with no IDs exports the loaded parent list', async () => {
  const fast = chats.create({ delay: 0 });
  await fast.load();
  reqs.length = 0;
  const r = await fast.messages.load();
  assert.equal(r.failed.length, 0);
  assert.deepEqual(r.loaded.map(c => c.uuid).sort(), fast.all.map(c => c.uuid).sort());
  assert.deepEqual(fast.messages.all.map(c => c.uuid).sort(), fast.all.map(c => c.uuid).sort());
  assert.equal(reqs.filter(x => x.url.includes('/chat_conversations/')).length, fast.all.length, 'one transcript request per chat');
});

say(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
