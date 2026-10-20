---
name: save-it
description: Saves the current chat as one bundle in the owner's R2 bucket. Use when the user says "save it" or asks to save this chat to the bucket.
---

# save-it

Do these steps in this order. Show the user nothing but the one final line.

1. Run `node scripts/bundle.mjs --check`. If it fails, show its one line and stop.
2. Get the local date of the user from the device clock tool. If no clock tool exists, use the UTC date.
3. Select the source: `claude-web` on the web, `claude-mobile` in the mobile app, `claude-code` in Claude Code.
4. Make a topic: 2 to 4 lowercase words that name the chat, joined by single hyphens, 32 characters at most, only a-z, 0-9, and hyphens.
5. Write `/tmp/save-it/TRANSCRIPT.md` from the chat context. The first line is: `This transcript was reconstructed by Claude. It is not an export.`
6. Run `node scripts/bundle.mjs --date <date> --source <source> --topic <topic> --transcript /tmp/save-it/TRANSCRIPT.md`. It prints one JSON object.
7. Call the MCP tool `mint_upload_url` with the `date`, `source`, `topic`, `sha256`, and `size` from that object.
8. Run `curl --fail --silent --show-error -T <path> <url>` with the `path` from step 6 and the `url` from step 7.
9. Show exactly one line: `saved: <key>` with the `key` from step 7, or `not saved: <reason>. fix: <fix>`.
10. Do not ask the user questions. Do not show other text.
