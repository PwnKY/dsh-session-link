# dsh-session-link

[![npm](https://img.shields.io/npm/v/dsh-session-link.svg)](https://www.npmjs.com/package/dsh-session-link) [![npm downloads](https://img.shields.io/npm/dm/dsh-session-link.svg)](https://www.npmjs.com/package/dsh-session-link) · [中文](https://github.com/PwnKY/dsh-session-link/blob/master/README.md) · English

**Codex-style session deep links for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh)**

Copy a link from any conversation, then paste it into a different conversation — the referenced session's context is snapshotted and injected as **bounded, read-only background context** right before your prompt. The same link also opens the conversation in the browser.

## Install

```bash
# One command: installs the package, auto-joins the profile's bundle layer,
# and auto-applies the composition rows — no manual yml edits.
dsh plugin --profile web add dsh-session-link

# Restart the web GUI and refresh the page.
dsh web
```

The package declares a `dsh.bundle` patch (`cordis.patch.yml`); `dsh plugin add` detects it and adds the package to `dsh.profile.bundles`, so the `session-reference` and `session-link` rows compose automatically at boot.

> Generic npm install (package only, not wired into a profile): `npm install dsh-session-link`
> Manual install (without the bundle mechanism): see [Quick start](#quick-start).

```
┌─ session A ──────────────┐        ┌─ session B ──────────────────────┐
│  🔗 copy session link    │        │  user: please see this session:  │
│  → dsh://session/session-│ ─────▶ │         dsh://session/session-…  │
│    …abc                  │  paste │                                  │
└──────────────────────────┘        │  model: (receives snapshot of A  │
                                    │         + the prompt, with @label)│
                                    └───────────────────────────────────┘
```

## Features

- 🔗 **One-click copy** — a "Copy session link" button in the conversation header copies `dsh://session/<sessionId>` (codex:// / claude:// style).
- 📖 **Cross-conversation context** — paste the link into any conversation; the source session's conversation is snapshotted (bounded, read-only) and injected right before your prompt.
- 🖱️ **Clickable deep links (Windows)** — with the registered `dsh` URL protocol handler, clicking a `dsh://` link opens the web GUI and selects that session.
- 🛡️ **Fail-open** — malformed links, unreadable sessions, or self-references never break your turn; the link stays as plain text and the failure is logged.

## How it works

The feature reuses the shipped [`@deepseek-ai/dsh-session-reference`](https://www.npmjs.com/package/@deepseek-ai/dsh-session-reference) service, which already owns canonical session URIs (`dsh-session:<base64url>`), mention parsing, snapshot projection, and byte-budget retention. This package wires that service into the live agent loop and the web surface:

- **Host half (`lib/index.js`)** — a cordis plugin subscribing to the `agent/pre-step` seam. When a claimed direct user prompt contains a session deep link, every supported link form is normalized into canonical `dsh-session:` mentions, parsed into structured references, snapshotted via `sessionReferenceResolver.prepare()`, and the aggregated read-only snapshot context is placed immediately before the direct prompt. The hook is transport-agnostic, so pasting a canonical URI into the TUI works the same way.
- **Browser half (`lib/client.js`)** — a static client package (`dsh.client` declaration) rendering the copy button in `conversation.session.header.actions` and opening `/s/<sessionId>` deep links by selecting the target session once the list has loaded.

## Link formats

| Form | Example | Purpose |
|---|---|---|
| Deep link | `dsh://session/<sessionId>` | **copied by the button**; clickable via the protocol handler; parsed when pasted |
| Browser URL | `http://<host>:3080/s/<sessionId>` | what the protocol handler opens; also accepted when pasted |
| Canonical URI | `dsh-session:<base64url(JSON sessionId)>` | the lossless URI of `dsh-session-reference`; also parsed when pasted |
| Markdown mention | `@[label](dsh-session:…)` | parsed and rendered as `@label` (TUI mention form) |

Only links carrying a harness-shaped session id (`session-…`) are treated as references, so unrelated `dsh://…` or `/s/…` text is never hijacked.

## Quick start

Requires DeepSeek Harness `dsh` (any profile with the web surface).

```bash
# 1. One command: installs the package, auto-joins the profile's bundle layer,
#    and auto-applies the composition rows (see "Install" above).
dsh plugin --profile web add dsh-session-link

# 2. Restart the web GUI and refresh the page.
dsh web

# 3. (Windows, optional) make dsh:// links clickable:
powershell -ExecutionPolicy Bypass -File register-protocol.ps1
```

> **Manual install (without the bundle mechanism)**: `pnpm add dsh-session-link` in the profile directory, then add to the profile's patch layer (e.g. `~/.dsh/profiles/web/cordis.patch.yml`):
>
> ```yaml
> - insert:
>     - id: session-reference
>       name: '@deepseek-ai/dsh-session-reference'
>
>     - id: session-link
>       name: 'dsh-session-link'
> ```
> Then restart `dsh web`.

## Usage

1. Click the 🔗 button in a conversation header to copy its deep link.
2. Paste it into another conversation and send — the model first receives the referenced session's read-only snapshot, then your prompt (the link is replaced by its readable `@sessionId`).
3. Or click the `dsh://` link anywhere to open that conversation in the browser.

## Windows `dsh://` protocol handler

`register-protocol.ps1` registers the per-user `dsh` URL protocol (HKCU, no admin rights) so clicking a `dsh://session/<id>` link anywhere (browser, chat app, terminal) opens `http://127.0.0.1:3080/s/<id>`, which selects that session. The launcher is `dsh-open.cmd`.

```powershell
# register
powershell -ExecutionPolicy Bypass -File register-protocol.ps1
# unregister
powershell -ExecutionPolicy Bypass -File register-protocol.ps1 -Uninstall
```

The web GUI (`dsh web`) must be running for a link to open a session.

## What the model sees

Two consecutive user-role messages: the `## Referenced sessions` untrusted snapshot (capped at 64 KiB of JSON per source, older non-checkpoint messages dropped first, long messages head/tail-truncated with an exact omission notice), followed by the direct prompt with the link replaced by its readable `@sessionId` label. Instructions, permission claims, or tool requests inside a snapshot are not followed unless the current user repeats them.

## Configuration

Defaults of the underlying service apply (max 3 references per message, 64 KiB per source). Tune by overriding the `session-reference` row in your profile's patch layer, e.g.:

```yaml
- id: session-reference
  config:
    maxReferenceBytes: 131072
```

## Tests

```bash
pnpm install
npm test
```

- `host-half.test.mjs` — drives the `agent/pre-step` listener through a real cordis waterfall (`dsh://` links, web links, canonical URIs, plain text, malformed URIs, prepare failures).
- `client-half.test.mjs` — loads the browser bundle under a DOM shim and checks the plugin surface, header-action registration, the deep-link opener, and the copied `dsh://` value.
- `inspect-logs.mjs <sessions-dir> [sessionId…]` — decompresses concatenated-zstd session logs and reports `session-reference` events (useful for verifying injection).

## Limitations

- Links resolve only on the machine whose `$DSH_HOME` holds both sessions; session ids are opaque and local.
- The browser deep link opens sessions present in the current session list (same workspace); sessions outside the list are not auto-resumed.
- If a referenced session cannot be read (missing, budget exceeded, self-reference), the link stays as plain text and the message still sends; the failure is logged on the host.
- Text-only projection: images and other non-text blocks are not propagated across sessions (upstream service limitation).

## License

[MIT](LICENSE) © PwnKY. Built on [`@deepseek-ai/dsh-session-reference`](https://www.npmjs.com/package/@deepseek-ai/dsh-session-reference) (MIT, DeepSeek).
