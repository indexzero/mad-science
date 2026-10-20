// clexport.js: paste into the DevTools console on claude.ai. Shapes are in clexport.d.ts.
//   clexport.orgId                       inferred from the page; assign a uuid to pin it, undefined to unpin
//   await clexport.chats.load(); clexport.chats.download()
//   await clexport.chats.messages.load(); clexport.chats.messages.download()
//   await clexport.groups.load()
//   clexport.groups.all.where({ group: null }).show().pick(0, 4).to('Group name')
//   clexport.groups.plan(); await clexport.groups.commit(); await clexport.groups.undo()
globalThis.clexport = (() => {
  const KEY = 'ccd/dframe-store';
  // Transcripts keep the exact query string they have always used. No `bodies` param: every body comes back.
  const TRANSCRIPT_QS = 'tree=True&rendering_mode=messages&render_all_tools=true' +
    '&include_inline_comparison=true&consistency=strong';

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const byCreated = (a, b) => ((a.created_at ?? '') < (b.created_at ?? '') ? -1 : (a.created_at ?? '') > (b.created_at ?? '') ? 1 : 0);

  async function get(url, init = {}, tries = 5) {
    for (let i = 0; ; i++) {
      const r = await fetch(url, init);
      if (r.ok) return r.json();
      if ((r.status === 429 || r.status >= 500) && i < tries) {
        console.warn(`${r.status}, retrying in ${1000 * 2 ** i}ms`);
        await sleep(1000 * 2 ** i);
        continue;
      }
      throw new Error(`${r.status} ${await r.text()} (${url})`);
    }
  }

  function saveFile(name, parts, type) {
    const url = URL.createObjectURL(new Blob(parts, { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ------------------------------------------------------------------ org

  // The org the page itself is using: its own same-origin requests first (most recent wins),
  // the lastActiveOrg cookie second. Warns once per disagreement; throws when neither has one.
  const ORG_IN_PATH = /organizations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;
  const warned = new Set();
  const warnOnce = msg => { if (!warned.has(msg)) { warned.add(msg); console.warn(msg); } };

  function getOrgId() {
    const seen = []; // distinct ids, most recent last
    for (const e of performance.getEntriesByType('resource')) {
      let u;
      try { u = new URL(e.name); } catch { continue; }
      if (u.origin !== location.origin) continue;
      const id = u.pathname.match(ORG_IN_PATH)?.[1];
      if (!id) continue;
      const i = seen.indexOf(id);
      if (i !== -1) seen.splice(i, 1);
      seen.push(id);
    }
    const raw = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/)?.[1];
    const cookie = raw && ORG_IN_PATH.test(`organizations/${decodeURIComponent(raw)}`) ? decodeURIComponent(raw) : undefined;
    const recent = seen.at(-1);
    if (seen.length > 1) warnOnce(`page requests name ${seen.length} orgs (${seen.join(', ')}); using the most recent, ${recent}`);
    if (recent && cookie && recent !== cookie) warnOnce(`org ${recent} from page requests does not match lastActiveOrg cookie ${cookie}; using ${recent}`);
    const id = recent ?? cookie;
    if (!id) throw new Error('cannot infer the org from page requests or the lastActiveOrg cookie; set clexport.orgId = "<uuid>"');
    return id;
  }

  let pinnedOrg;
  const resolveOrg = () => pinnedOrg ?? getOrgId();

  // The org each Chats instance's loaded data came from, for code that builds on that data.
  const orgOf = new WeakMap();

  // YYYY-MM-DD in your local time zone.
  function localDate(when) {
    const d = new Date(when), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // ------------------------------------------------------------------ chats

  function makeChats(config) {
    const cfg = { limit: 30, archived: false, consistency: 'eventual', delay: 150, maxPasses: 3, ...config };
    const suffix = cfg.archived ? '-archived' : '';
    const byId = new Map(); // first-seen order; a later fetch refreshes the entry in place
    let nextOffset = 0;
    let boundOrg; // the org the loaded list came from; set by the first page after a reset

    // Continuing a list keeps the org it started with; reset() or load() resolve it again.
    async function page(offset = nextOffset) {
      boundOrg ??= cfg.org ?? resolveOrg();
      return pageOf(boundOrg, offset);
    }

    async function pageOf(org, offset) {
      const qs = new URLSearchParams({ limit: cfg.limit, offset, archived: cfg.archived, consistency: cfg.consistency });
      const j = await get(`/api/organizations/${org}/chat_conversations_v2?${qs}`);
      const rows = Array.isArray(j) ? j : (j.data ?? j.conversations ?? j.items);
      if (!Array.isArray(rows)) throw new Error(`unexpected shape: ${JSON.stringify(j).slice(0, 300)}`);
      const before = byId.size;
      for (const c of rows) byId.set(c.uuid, c);
      nextOffset = offset + rows.length;
      console.log(`offset ${offset}: ${rows.length} returned, ${byId.size - before} new, ${byId.size} total`);
      return {
        offset, returned: rows.length, added: byId.size - before, total: byId.size,
        hasMore: rows.length > 0 && j.has_more !== false, nextOffset, uuids: rows.map(c => c.uuid),
      };
    }

    function reset() { byId.clear(); nextOffset = 0; boundOrg = undefined; }

    // Offset paging over a recency sort skips a chat whenever one gets bumped mid-scan,
    // so repeat full passes until one adds nothing new.
    async function load() {
      reset();
      const org = boundOrg = cfg.org ?? resolveOrg(); // bound once for every page and pass
      for (let pass = 1; pass <= cfg.maxPasses; pass++) {
        const before = byId.size, seen = new Set();
        for (let offset = 0; ; ) {
          const p = await pageOf(org, offset);
          const fresh = p.uuids.filter(u => !seen.has(u)).length;
          p.uuids.forEach(u => seen.add(u));
          if (!p.hasMore || !fresh) break; // end of list, or the server ignoring offset
          offset = p.nextOffset;
          await sleep(cfg.delay);
        }
        console.log(`pass ${pass}: ${byId.size - before} new, ${byId.size} total`);
        if (pass > 1 && byId.size === before) break;
        if (pass === cfg.maxPasses) console.warn('still finding new chats after max passes; load again to be sure');
      }
      return [...byId.values()];
    }

    function download(filename = `claude-chats${suffix}-${localDate(Date.now())}.json`) {
      if (!byId.size) throw new Error('nothing loaded; run load() first');
      saveFile(filename, [JSON.stringify([...byId.values()], null, 2)], 'application/json');
    }

    const self = {
      create: opts => makeChats({ ...cfg, ...opts }),
      load, page, reset, download,
      get all() { return [...byId.values()]; },
    };
    const orgForData = () => boundOrg ?? cfg.org ?? resolveOrg();
    self.messages = makeMessages(self, orgForData, cfg.delay, suffix);
    orgOf.set(self, orgForData);
    return Object.freeze(self);
  }

  function makeMessages(parent, orgForData, delay, suffix) {
    const byId = new Map();
    const all = () => [...byId.values()].sort(byCreated);

    async function load(uuids) {
      const ids = [...new Set([].concat(uuids ?? parent.all).map(u => u?.uuid ?? u))];
      if (!ids.length) throw new Error('pass uuids, or load chats first');
      const api = `/api/organizations/${orgForData()}`; // the org the parent list came from
      const loaded = [], failed = [];
      for (const [i, id] of ids.entries()) {
        try {
          const c = await get(`${api}/chat_conversations/${id}?${TRANSCRIPT_QS}`);
          byId.set(c.uuid ?? id, c);
          loaded.push(c);
          console.log(`${i + 1}/${ids.length} ${c.name || '(untitled)'}: ${c.chat_messages?.length ?? 0} messages`);
        } catch (e) {
          failed.push({ uuid: id, error: e.message });
          console.warn(`${i + 1}/${ids.length} failed ${id}: ${e.message}`);
        }
        if (i < ids.length - 1) await sleep(delay);
      }
      console.log(`loaded ${loaded.length}, failed ${failed.length}`);
      return { loaded: loaded.sort(byCreated), failed };
    }

    // One chat per line, oldest first; each line handed to the Blob separately, never one giant string.
    function download(filename = `claude-messages${suffix}-${localDate(Date.now())}.jsonl`) {
      if (!byId.size) throw new Error('nothing loaded; run load() first');
      saveFile(filename, all().map(c => JSON.stringify(c) + '\n'), 'application/x-ndjson');
    }

    return Object.freeze({ load, download, get all() { return all(); } });
  }

  // ------------------------------------------------------------------ settings

  // The user_settings endpoint, matched to the app's observed traffic:
  //   GET  -> { userId, version, lastModified, checksum, content: { entries: { [KEY]: ... } } }
  //   PUT  { entries: { [KEY]: ... } } with if-match: <checksum of the doc being replaced>
  // The PUT merges entries (the app never sends the sibling entries), and a stale if-match is
  // rejected, so a write can never silently overwrite a change made since the read.
  const CHECKSUM = /^sha256:[0-9a-f]{64}$/;
  function makeSettingsStore(org) {
    const url = `/api/claude_code/organizations/${org}/user_settings`;
    let checksum; // from the last read; spent by the next write
    return {
      async read() {
        const j = await get(url, { cache: 'no-store' }); // a cached read would carry a stale checksum
        checksum = j?.checksum;
        const raw = j?.content?.entries?.[KEY];
        if (raw == null) {
          const at = !j?.content ? ['top-level', j] : !j.content.entries ? ['content', j.content] : ['content.entries', j.content.entries];
          throw new Error(`no ${KEY} in user_settings; ${at[0]} keys: ${Object.keys(at[1] ?? {}).join(', ')}`);
        }
        const store = typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw);
        if (!Array.isArray(store?.state?.customGroups)) throw new Error(`${KEY} has no customGroups`);
        return store;
      },
      async write(store) {
        if (!CHECKSUM.test(checksum ?? '')) {
          throw new Error(`refusing to write: checksum from the read is ${JSON.stringify(checksum)}, not the sha256:<hex> form the app sends as if-match`);
        }
        const json = JSON.stringify(store);
        const ifMatch = checksum;
        checksum = undefined;
        const r = await fetch(url, {
          method: 'PUT',
          cache: 'no-store',
          headers: { 'content-type': 'application/json', 'if-match': ifMatch },
          body: JSON.stringify({ entries: { [KEY]: json } }),
        });
        if (r.status === 412 || r.status === 409) {
          const e = new Error(`settings changed since the read (${r.status}); nothing written`);
          e.conflict = true; // tells commit to re-read and re-apply
          throw e;
        }
        if (!r.ok) throw new Error(`write ${r.status}: ${await r.text()}`);
        // Keep any locally persisted copy in step so a reload cannot resurrect the old state.
        for (const k of Object.keys(localStorage)) {
          try { if (JSON.parse(localStorage.getItem(k))?.state?.customGroupAssignments) localStorage.setItem(k, json); } catch {}
        }
      },
    };
  }

  // ------------------------------------------------------------------ groups

  // Membership lives in three places: customGroupAssignments, customGroupOrder, and each
  // section's members. These helpers keep them in step and mirror the app: an emptied group
  // loses its customGroupOrder key but keeps `members: []`.
  const chatKey = uuid => `chat:${uuid}`;
  const groupName = (state, id) => state.customGroups.find(g => g.id === id)?.name ?? null;
  const currentGroup = (state, uuid) => {
    const id = state.customGroupAssignments?.[chatKey(uuid)];
    return id ? groupName(state, id) : null;
  };
  function groupId(state, name) {
    const hits = state.customGroups.filter(g => g.name === name);
    if (hits.length > 1) throw new Error(`more than one group named "${name}"`);
    return hits[0]?.id ?? null;
  }

  // Applies one move to a fresh state. False means the move no longer applies: the chat
  // changed groups since staging, or the target group was renamed or deleted.
  function applyMove(state, m) {
    if (currentGroup(state, m.uuid) !== m.from) return false;
    const toId = m.to === null ? null : groupId(state, m.to);
    if (m.to !== null && !toId) return false;
    const key = chatKey(m.uuid);
    const fromId = state.customGroupAssignments?.[key];
    if (fromId) {
      delete state.customGroupAssignments[key];
      const order = (state.customGroupOrder?.[fromId] ?? []).filter(k => k !== key);
      if (order.length) state.customGroupOrder[fromId] = order;
      else if (state.customGroupOrder) delete state.customGroupOrder[fromId];
      const sec = state.sidebarSections?.find(x => x.id === fromId);
      if (sec?.members) sec.members = sec.members.filter(k => k !== key);
    }
    if (toId) {
      (state.customGroupAssignments ??= {})[key] = toId;
      ((state.customGroupOrder ??= {})[toId] ??= []).push(key);
      const sec = state.sidebarSections?.find(x => x.id === toId);
      if (sec) (sec.members ??= []).push(key);
    }
    return true;
  }

  const textOf = c => `${c?.name ?? ''}\n${c?.summary ?? ''}`;
  const test = (re, s) => { re.lastIndex = 0; return re.test(s); }; // a /g regex is stateful
  const QUERY_KEYS = ['project', 'group', 'text', 'after', 'before'];

  // after/before compare updated_at, the field the list is sorted by.
  function matcher(q) {
    if (q instanceof RegExp) return c => test(q, textOf(c));
    if (typeof q === 'function') return (c, row) => !!q(c, row.group);
    const bad = Object.keys(q ?? {}).filter(k => !QUERY_KEYS.includes(k));
    if (bad.length) throw new Error(`unknown query key ${bad.join(', ')}; use ${QUERY_KEYS.join(', ')}`);
    const { project, group, text, after, before } = q ?? {};
    const t = d => new Date(d).getTime();
    return (c, row) =>
      (project === undefined || (project === null ? row.project === null
        : project instanceof RegExp ? row.project !== null && test(project, row.project)
        : row.project?.trim() === String(project).trim())) &&
      (group === undefined || row.group === group) &&
      (text === undefined || test(text, textOf(c))) &&
      (after === undefined || t(c?.updated_at) >= t(after)) &&
      (before === undefined || t(c?.updated_at) < t(before));
  }

  function makeGroups(defaultChats) {
    let settings = null, store = null, chatsById = new Map();
    const staging = new Map(); // uuid -> Move
    const history = [];        // applied moves per commit, for undo

    const need = () => { if (!store) throw new Error('run await clexport.groups.load() first'); };

    function rows() {
      return [...chatsById.values()].map(c => ({
        uuid: c.uuid, name: c.name ?? '', project: c.project?.name ?? null,
        group: currentGroup(store.state, c.uuid), updated: c.updated_at ? localDate(c.updated_at) : '',
      }));
    }

    function stageRows(rs, group, { move = false } = {}) {
      need();
      if (group !== null && !groupId(store.state, group)) {
        throw new Error(`no group named "${group}"; groups: ${store.state.customGroups.map(g => g.name).join(', ')}`);
      }
      const staged = [], skipped = [];
      for (const r of rs) {
        const m = { uuid: r.uuid, name: r.name, from: r.group, to: group };
        if (r.group === group || (r.group !== null && group !== null && !move)) skipped.push(m);
        else { staging.set(r.uuid, m); staged.push(m); }
      }
      return { staged, skipped };
    }

    function makeView(rs) {
      const v = rs.map((r, i) => Object.freeze({ ...r, index: i }));
      Object.defineProperties(v, {
        show: { value() { console.table([...v], ['name', 'project', 'group', 'updated', 'uuid']); return v; } }, // a plain copy: Chrome tables own non-enumerable props too
        pick: {
          value(...ix) {
            return makeView([...new Set(ix)].map(i => {
              if (!Number.isInteger(i) || !(i in v)) throw new RangeError(`no row ${i} in this view (0..${v.length - 1})`);
              return v[i];
            }));
          },
        },
        where: { value(q) { const ok = matcher(q); return makeView(v.filter(r => ok(chatsById.get(r.uuid), r))); } },
        to: { value(group, opts) { return stageRows(v, group, opts); } },
        ungroup: { value() { return stageRows(v, null); } },
      });
      return Object.freeze(v);
    }

    // Fresh read, apply, one write. Nothing is written when no move applies. If the store
    // reports a conflict (someone wrote since the read), re-read and re-apply, up to 3 times;
    // every move is checked again against the newer state.
    async function applyAndWrite(moves) {
      for (let attempt = 1; ; attempt++) {
        const fresh = await settings.read();
        const applied = [], dropped = [];
        for (const m of moves) (applyMove(fresh.state, m) ? applied : dropped).push(m);
        if (!applied.length) { store = fresh; return { applied, dropped }; }
        fresh.updatedAt = Date.now();
        try {
          await settings.write(fresh);
          store = fresh;
          return { applied, dropped };
        } catch (e) {
          if (!e.conflict || attempt >= 3) throw e;
          console.warn(`settings changed during commit; re-reading (attempt ${attempt + 1} of 3)`);
        }
      }
    }

    // A new load is a new session: it clears staged moves and undo history.
    // The default store targets the org the chats came from, and commit/undo keep using it.
    async function load({ chats = defaultChats, settings: s } = {}) {
      const list = await chats.load();
      s ??= makeSettingsStore(orgOf.get(chats)?.() ?? resolveOrg());
      const fresh = await s.read();
      settings = s; store = fresh;
      chatsById = new Map(list.map(c => [c.uuid, c]));
      staging.clear(); history.length = 0;
      const counts = {};
      for (const id of Object.values(fresh.state.customGroupAssignments ?? {})) counts[id] = (counts[id] ?? 0) + 1;
      const order = new Map((fresh.state.sidebarSections ?? []).map(x => [x.id, x.order]));
      return [...fresh.state.customGroups]
        .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity))
        .map(g => ({ name: g.name, count: counts[g.id] ?? 0 }));
    }

    function stage(entries) {
      need();
      const unknown = [...new Set(entries.map(e => e.to).filter(t => t !== null && !groupId(store.state, t)))];
      if (unknown.length) throw new Error(`no group named ${unknown.map(n => `"${n}"`).join(', ')}; nothing staged`);
      const staged = [], skipped = [];
      for (const { uuid, to } of entries) {
        const m = { uuid, name: chatsById.get(uuid)?.name ?? '', from: currentGroup(store.state, uuid), to };
        if (m.from === to) skipped.push(m);
        else { staging.set(uuid, m); staged.push(m); }
      }
      return { staged, skipped };
    }

    async function commit() {
      need();
      const moves = [...staging.values()];
      if (!moves.length) return { applied: [], dropped: [] };
      const result = await applyAndWrite(moves);
      staging.clear();
      if (result.applied.length) history.push(result.applied);
      return result;
    }

    async function undo() {
      need();
      const last = history.pop();
      if (!last) throw new Error('nothing to undo');
      try {
        return await applyAndWrite(last.map(m => ({ ...m, from: m.to, to: m.from })));
      } catch (e) {
        history.push(last);
        throw e;
      }
    }

    return Object.freeze({
      load, stage, commit, undo,
      get all() { return makeView(store ? rows() : []); },
      plan: () => [...staging.values()],
      clear: () => staging.clear(),
    });
  }

  const chats = makeChats();
  return Object.freeze({
    chats,
    groups: makeGroups(chats),
    getOrgId,
    get orgId() { return resolveOrg(); },
    set orgId(id) { pinnedOrg = id || undefined; },
  });
})();
