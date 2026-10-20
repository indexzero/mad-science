# clexport

A DevTools client for claude.ai. It exports every chat, every transcript,
and the sidebar groups of one account. It is one file. It has no build
step, no package, no extension, and no dependency.

## Purpose

The claude.ai web app has no export button for a full account. The data
is behind three same-origin endpoints that the app itself calls. This
script pages the chat list, pulls each transcript, and reads the sidebar
group blob. You paste it into the DevTools console of a logged-in tab. It
then saves the results as files from the browser.

The script also has a write path for sidebar groups. That path is marked
risky below. The export paths only read.

## DevTools steps

1. Open https://claude.ai in a browser and log in.
2. Open DevTools. On macOS press Cmd+Option+I. On Windows or Linux press
   F12 or Ctrl+Shift+I. Select the Console tab.
3. Paste the whole content of `clexport.js` into the console. Press Enter.
   On the first paste the browser can refuse it and print a warning about
   pasting code. If it does, type `allow pasting` and press Enter, then
   paste again. The console then prints an object with `chats` and
   `groups`. That is the loaded client.
4. Make sure that `clexport.orgId` prints a uuid. If it throws, set
   `clexport.orgId = '<your org uuid>'`. The org uuid is in the path of
   any request on the Network tab.
5. Run the chat list export:

   ```js
   await clexport.chats.load()
   clexport.chats.download()
   ```

6. Run the transcript export:

   ```js
   await clexport.chats.messages.load()
   clexport.chats.messages.download()
   ```

7. Run the sidebar group export:

   ```js
   await clexport.groups.load()
   copy(JSON.stringify(clexport.groups.all))
   ```

   Paste the clipboard into a new file named `claude-settings-<date>.json`.

8. Repeat steps 5 and 6 for the archived chats. The recipe is under
   Archived chats below.

`load()` makes repeat passes over the list until a pass adds no new chat.
The list is sorted by recency. A chat that moves during a scan can slip
between two pages. The repeat pass catches it. The console prints one line
per page and one line per pass.

The script retries a 429 or a 5xx response with exponential backoff, five
times at most. The full API is in `clexport.d.ts`.

## Outputs

The script writes three files. The date in each name is the local date of
the download. The shapes below are synthetic examples. The real files
carry every field the API returns.

The chat and transcript commands start browser downloads. If the browser
asks for a destination, choose one. Otherwise the files land in the
download folder of the browser, usually `Downloads`. The sidebar command
copies JSON to the clipboard. Paste it into a text editor. Save it beside
the downloads as `claude-settings-<date>.json` with the local date.

`claude-chats-<date>.json` is one JSON array of chat list entries:

```json
[
  {
    "uuid": "00000000-0000-4000-8000-000000000101",
    "name": "A chat title",
    "summary": "A short summary",
    "created_at": "2026-01-02T03:04:05Z",
    "updated_at": "2026-01-03T04:05:06Z",
    "project": { "uuid": "00000000-0000-4000-8000-000000000201", "name": "A project" }
  }
]
```

`claude-messages-<date>.jsonl` is one JSON object per line. Each line is one
chat with its full transcript under `chat_messages`:

```json
{
  "uuid": "00000000-0000-4000-8000-000000000101",
  "name": "A chat title",
  "chat_messages": [
    {
      "uuid": "00000000-0000-4000-8000-000000000301",
      "sender": "human",
      "index": 0,
      "content": [{ "type": "text", "text": "A question" }],
      "attachments": [{ "file_name": "notes.txt", "extracted_content": "The file text" }]
    },
    {
      "uuid": "00000000-0000-4000-8000-000000000302",
      "sender": "assistant",
      "index": 1,
      "content": [
        { "type": "thinking", "thinking": "", "thinking_hidden": true },
        { "type": "tool_use", "name": "bash_tool", "input": { "command": "ls" } },
        { "type": "tool_result", "name": "bash_tool", "content": [] },
        { "type": "text", "text": "An answer" }
      ]
    }
  ]
}
```

Lines are sorted by `created_at`, oldest first. Message bodies are in
`chat_messages[].content[].text`. Attachment bodies are in
`attachments[].extracted_content`. Code that the assistant wrote with a tool
is in `content[].input`.

`claude-settings-<date>.json` is the sidebar group view. You save it by hand
from the clipboard in step 7. It is one JSON array of rows:

```json
[
  {
    "index": 0,
    "uuid": "00000000-0000-4000-8000-000000000101",
    "name": "A chat title",
    "project": "A project",
    "group": "A group name",
    "updated": "2026-01-03"
  }
]
```

A `group` of `null` means the chat is in no group. `updated` is the local
date of the last update, `YYYY-MM-DD`.

### Groups write path (risky)

`clexport.groups` can also move chats between sidebar groups. This is the
risky half of the script. It writes to your account settings.

1. `await clexport.groups.load()` reads the chats and the group blob.
2. Save and show the ungrouped view:

   ```js
   const ungrouped = clexport.groups.all.where({ group: null }).show()
   ```

3. Choose rows from that table. The `index` column of a view counts
   from zero inside that view. If rows 0 and 4 are the chats you want,
   stage them into an existing group:

   ```js
   ungrouped.pick(0, 4).to('A group name')
   ```

4. `clexport.groups.plan()` shows the staged moves. Nothing is written yet.
5. `await clexport.groups.commit()` writes the plan.
6. `await clexport.groups.undo()` reverses the last commit.

`groups.commit` does a fresh uncached GET of the settings document. It then
applies the plan to that fresh state and sends one PUT. The PUT carries an
`if-match` header with the checksum from the GET. If the server answers
412, another writer changed the settings after the read. The script then
reads again, applies the plan again, and retries. It gives up after three
attempts and writes nothing. A move that the newer state has invalidated
comes back as `dropped`.

The checksum must have the form `sha256:<hex>`. If it does not, the script
refuses to write. Use the write path on an account you can repair by hand.

## Hidden thinking fallback

A transcript carries the thinking of the assistant for some chats. For
other chats the API returns `thinking: ""` with `thinking_hidden: true`.
The API does not return that text. The rendered page still shows it.

If a message in your export has `thinking_hidden: true`, open that chat in
the browser, expand the thinking blocks, and run this snippet in the
console:

```js
copy(
  [...document.querySelectorAll('div[data-timeline-text]')].map(
    block => [...block.querySelectorAll('.standard-markdown p')]
      .map(p => p.textContent.trim())
  )
)
```

The clipboard then holds one array per rendered block, with one string per
paragraph. Paste it into a file beside the export. The snippet reads the
DOM only. It sends no request. The selectors can change when the app
changes.

## Archived chats

The chat list endpoint is called with `archived=false`. An archived chat
never appears in that list. The pager cannot see it. The owner of this
script saw eleven such chats missing from a full export.

To export the archived chats, create a second instance with
`archived: true`. The instance has its own list and its own transcripts.
Its file names carry the suffix `-archived`.

```js
const archived = clexport.chats.create({ archived: true })
await archived.load()
archived.download()
await archived.messages.load()
archived.messages.download()
```

This writes `claude-chats-archived-<date>.json` and
`claude-messages-archived-<date>.jsonl`. The sidebar group view in step 7
covers the default instance only.
