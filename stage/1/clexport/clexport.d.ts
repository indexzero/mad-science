// clexport.d.ts: top-level API, signatures only. Eight names.

declare const clexport: {
  chats: Chats;                      // the default instance, created when the script is pasted
  groups: Groups;
  get orgId(): string;               // the pinned value if set, else getOrgId()
  set orgId(id: string | undefined); // pin it; undefined unpins
  /** The page's own same-origin requests first, lastActiveOrg cookie second.
   *  Warns once per disagreement; throws when neither yields an org. */
  getOrgId(): string;
};

// ---------------------------------------------------------------- data

interface Chat {
  uuid: string;
  name: string;
  summary: string;
  created_at: string;
  updated_at: string;
  project: { uuid: string; name: string } | null;
  [field: string]: unknown; // every other field as the API returns it, chat_messages included
}

/** Group names, not ids. null means ungrouped. */
interface Move { uuid: string; name: string; from: string | null; to: string | null }

// ---------------------------------------------------------------- seams

/** All groups.load needs. Any Chats instance fits, and so does a fixture. */
interface ChatSource {
  load(): Promise<Chat[]>;
}

/** The parsed ccd/dframe-store blob. A fixture makes commit a dry run.
 *  write may throw an error with `conflict: true` to make commit re-read and retry. */
interface SettingsStore {
  read(): Promise<{ state: object; version: number; updatedAt: number }>;
  write(store: { state: object; version: number; updatedAt: number }): Promise<void>;
}

// ---------------------------------------------------------------- behavior

interface Chats {
  /** Configuration happens here, once; the verbs below take none. org beats clexport.orgId. */
  create(opts?: {
    org?: string; limit?: number; archived?: boolean;
    consistency?: 'eventual' | 'strong'; delay?: number; maxPasses?: number;
  }): Chats;
  /** Fresh snapshot of every chat. */
  load(): Promise<Chat[]>;
  /** One page merged into `all` by uuid; no offset continues from the last page. */
  page(offset?: number): Promise<{
    offset: number; returned: number; added: number; total: number;
    hasMore: boolean; nextOffset: number; uuids: string[];
  }>;
  reset(): void;
  readonly all: Chat[];
  /** Saves `all` as .json. Never fetches. */
  download(filename?: string): void;
  readonly messages: Messages;
}

interface Messages {
  /** Full transcripts into `all`. uuids default to the parent instance's `all`. */
  load(uuids?: Array<string | { uuid: string }>): Promise<{
    loaded: Chat[]; failed: Array<{ uuid: string; error: string }>;
  }>;
  readonly all: Chat[]; // oldest first by created_at
  /** Saves `all` as .jsonl. Never fetches. */
  download(filename?: string): void;
}

interface Groups {
  /** Calls chats.load(), reads the blob for the org those chats came from, joins them. */
  load(opts?: { chats?: ChatSource; settings?: SettingsStore }): Promise<Array<{ name: string; count: number }>>;
  /** Every loaded chat with its group. Ungrouped: all.where({ group: null }). */
  readonly all: View;
  plan(): Move[];
  /** Imports a plan built elsewhere; plan() output round-trips. */
  stage(moves: Array<{ uuid: string; to: string | null }>): { staged: Move[]; skipped: Move[] };
  clear(): void;
  /** Fresh read, apply the plan, one write. Moves a sidebar change invalidated come back as dropped. */
  commit(): Promise<{ applied: Move[]; dropped: Move[] }>;
  /** The inverse of the last commit, applied to a fresh read. */
  undo(): Promise<{ applied: Move[]; dropped: Move[] }>;
}

/** A fixed set of rows. Indexes refer to this view only. Nothing prints except show(). */
interface View extends ReadonlyArray<{
  index: number; uuid: string; name: string;
  project: string | null; group: string | null; updated: string;
}> {
  show(): View;
  pick(...indexes: number[]): View;
  where(q:
    | RegExp // name and summary
    | ((chat: Chat, group: string | null) => boolean)
    | { project?: string | RegExp | null; group?: string | null; text?: RegExp; after?: string; before?: string }
  ): View;
  /** Chats already in a group are skipped unless move is true. Unknown group names throw. */
  to(group: string, opts?: { move?: boolean }): { staged: Move[]; skipped: Move[] };
  ungroup(): { staged: Move[]; skipped: Move[] };
}
