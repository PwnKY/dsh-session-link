# dsh-session-link

**Codex-style session deep links for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh)**
**DeepSeek Harness 的 Codex 式会话深度链接插件**

Copy a link from any conversation, then paste it into a different conversation — the referenced session's context is snapshotted and injected as bounded, read-only background context. The same link also opens the conversation in the browser.

复制任意会话的链接，粘贴到另一个对话里 —— 被引用会话的上下文会被快照并作为受控的只读背景上下文注入；同一链接也能在浏览器中直接打开对应会话。

```
┌─ session A ──────────────┐        ┌─ session B ──────────────────────┐
│  🔗 copy session link    │        │  user: 请参考这个会话:           │
│  → dsh://session/session-│ ─────▶ │         dsh://session/session-…  │
│    …abc                  │  paste │                                  │
└──────────────────────────┘        │  model: (receives snapshot of A  │
                                    │         + the prompt, with @label)│
                                    └───────────────────────────────────┘
```

## Features / 特性

- 🔗 **One-click copy** — a "Copy session link" button in the conversation header copies `dsh://session/<sessionId>` (codex:// / claude:// style).
  **一键复制** —— 会话头部「复制会话链接」按钮，输出 `dsh://session/<sessionId>` 格式。
- 📖 **Cross-conversation context** — paste the link into any conversation; the source session's conversation is snapshotted (bounded, read-only) and injected right before your prompt.
  **跨对话读上下文** —— 把链接粘进任意对话，源会话内容被快照（有上限、只读）并注入到你的提示词之前。
- 🖱️ **Clickable deep links (Windows)** — with the registered `dsh` URL protocol handler, clicking a `dsh://` link opens the web GUI and selects that session.
  **可点击深链（Windows）** —— 注册 `dsh` 协议处理器后，点击 `dsh://` 链接直接打开 GUI 并选中该会话。
- 🛡️ **Fail-open** — malformed links, unreadable sessions, or self-references never break your turn; the link stays as plain text and the failure is logged.
  **容错** —— 畸形链接、会话不可读、自引用都不会打断对话，链接保留为原文并记录日志。

## How it works / 工作原理

The feature reuses the shipped [`@deepseek-ai/dsh-session-reference`](https://www.npmjs.com/package/@deepseek-ai/dsh-session-reference) service, which already owns canonical session URIs (`dsh-session:<base64url>`), mention parsing, snapshot projection, and byte-budget retention. This package wires that service into the live agent loop and the web surface:

本插件复用官方 `@deepseek-ai/dsh-session-reference` 服务（它已实现规范 URI、mention 解析、快照投影与字节预算保留），再把它接入 agent 循环和 Web 界面：

- **Host half (`lib/index.js`)** — a cordis plugin subscribing to the `agent/pre-step` seam. When a claimed direct user prompt contains a session deep link, every supported link form is normalized into canonical `dsh-session:` mentions, parsed into structured references, snapshotted via `sessionReferenceResolver.prepare()`, and the aggregated read-only snapshot context is placed immediately before the direct prompt. The hook is transport-agnostic, so pasting a canonical URI into the TUI works the same way.

  **服务端（`lib/index.js`）** —— cordis 插件，挂在 `agent/pre-step` 钩子上：用户消息里出现会话深链时，把各种链接形式统一成规范 `dsh-session:` mention，解析为结构化引用，通过 `sessionReferenceResolver.prepare()` 快照源会话，并把聚合的只读快照放在直接提示之前。钩子与传输层无关，TUI 里粘规范 URI 同样生效。

- **Browser half (`lib/client.js`)** — a static client package (`dsh.client` declaration) rendering the copy button in `conversation.session.header.actions` and opening `/s/<sessionId>` deep links by selecting the target session once the list has loaded.

  **浏览器端（`lib/client.js`）** —— 静态客户端包（`dsh.client` 声明），在 `conversation.session.header.actions` 渲染复制按钮，并在以 `/s/<sessionId>` 打开页面时自动选中目标会话。

## Link formats / 链接格式

| Form / 形式 | Example / 示例 | Purpose / 用途 |
|---|---|---|
| Deep link / 深链 | `dsh://session/<sessionId>` | **copied by the button**; clickable via the protocol handler; parsed when pasted **（按钮复制；协议处理器可点击；粘贴可解析）** |
| Browser URL / 浏览器地址 | `http://<host>:3080/s/<sessionId>` | what the protocol handler opens; also accepted when pasted **（协议处理器打开的目标；粘贴同样识别）** |
| Canonical URI / 规范 URI | `dsh-session:<base64url(JSON sessionId)>` | the lossless URI of `dsh-session-reference`; also parsed when pasted **（`dsh-session-reference` 的无损 URI；粘贴可解析）** |
| Markdown mention | `@[label](dsh-session:…)` | parsed and rendered as `@label` (TUI mention form) **（解析后显示为 `@label`）** |

Only links carrying a harness-shaped session id (`session-…`) are treated as references, so unrelated `dsh://…` or `/s/…` text is never hijacked.

只有带 `session-…` 形态会话 id 的链接才会被当作引用，无关的 `dsh://…`、`/s/…` 文本不会被误伤。

## Quick start / 快速开始

Requires DeepSeek Harness `dsh` (any profile with the web surface). 需要 DeepSeek Harness 的 `dsh`（任意带 Web 界面的 profile）。

```bash
# 1. Install the package into your profile (e.g. web) and add the two rows:
#    将包安装进你的 profile（如 web），并加入两行配置：
dsh plugin --profile web add dsh-session-link
```

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml  (or your profile's patch layer)
- insert:
    - id: session-reference
      name: '@deepseek-ai/dsh-session-reference'

    - id: session-link
      name: 'dsh-session-link'
```

```bash
# 2. Restart the web GUI and refresh the page. 重启 Web GUI 并刷新页面。
dsh web
# 3. (Windows, optional) make dsh:// links clickable. 让 dsh:// 链接可点击：
powershell -ExecutionPolicy Bypass -File register-protocol.ps1
```

## Usage / 使用

1. Click the 🔗 button in a conversation header to copy its deep link.
   点会话标题旁的 🔗 按钮复制深链。
2. Paste it into another conversation and send — the model first receives the referenced session's read-only snapshot, then your prompt (the link is replaced by its readable `@sessionId`).
   粘到另一个对话并发送 —— 模型先收到被引用会话的只读快照，再收到你的提示（链接会替换为可读的 `@sessionId`）。
3. Or click the `dsh://` link anywhere to open that conversation in the browser.
   或者直接点击 `dsh://` 链接在浏览器中打开该会话。

## Windows `dsh://` protocol handler / Windows 协议处理器

`register-protocol.ps1` registers the per-user `dsh` URL protocol (HKCU, no admin rights) so clicking a `dsh://session/<id>` link anywhere (browser, chat app, terminal) opens `http://127.0.0.1:3080/s/<id>`, which selects that session. The launcher is `dsh-open.cmd`.

`register-protocol.ps1` 在当前用户下注册 `dsh` URL 协议（HKCU，无需管理员权限），任何地方点击 `dsh://session/<id>`（浏览器、聊天软件、终端）都会打开 `http://127.0.0.1:3080/s/<id>` 并选中该会话。启动器为 `dsh-open.cmd`。

```powershell
# register / 注册
powershell -ExecutionPolicy Bypass -File register-protocol.ps1
# unregister / 注销
powershell -ExecutionPolicy Bypass -File register-protocol.ps1 -Uninstall
```

The web GUI (`dsh web`) must be running for a link to open a session. 打开会话需要 `dsh web` 正在运行。

## What the model sees / 模型看到的

Two consecutive user-role messages: the `## Referenced sessions` untrusted snapshot (capped at 64 KiB of JSON per source, older non-checkpoint messages dropped first, long messages head/tail-truncated with an exact omission notice), followed by the direct prompt with the link replaced by its readable `@sessionId` label. Instructions, permission claims, or tool requests inside a snapshot are not followed unless the current user repeats them.

模型会看到连续两条 user 消息：`## Referenced sessions` 不可信快照（每个源最多 64 KiB JSON，优先丢弃较早的非检查点消息，长消息头尾截断并给出精确省略提示），随后是链接已被替换为 `@sessionId` 的直接提示。快照内的指令、权限声明、工具请求除非当前用户重申，否则一律不执行。

## Configuration / 配置

Defaults of the underlying service apply (max 3 references per message, 64 KiB per source). Tune by overriding the `session-reference` row in your profile's patch layer, e.g.:

默认使用底层服务的配置（每条消息最多 3 个引用、每源 64 KiB）。在 profile 的 patch 层覆盖 `session-reference` 行即可调整，例如：

```yaml
- id: session-reference
  config:
    maxReferenceBytes: 131072
```

## Tests / 测试

```bash
pnpm install
npm test
```

- `host-half.test.mjs` — drives the `agent/pre-step` listener through a real cordis waterfall (`dsh://` links, web links, canonical URIs, plain text, malformed URIs, prepare failures).
  `host-half.test.mjs` —— 用真实 cordis waterfall 驱动 `agent/pre-step` 监听器（`dsh://` 链接、web 链接、规范 URI、普通文本、畸形 URI、prepare 失败）。
- `client-half.test.mjs` — loads the browser bundle under a DOM shim and checks the plugin surface, header-action registration, the deep-link opener, and the copied `dsh://` value.
  `client-half.test.mjs` —— 在 DOM shim 下加载浏览器 bundle，检查插件表面、头部按钮注册、深链打开器与复制的 `dsh://` 值。
- `inspect-logs.mjs <sessions-dir> [sessionId…]` — decompresses concatenated-zstd session logs and reports `session-reference` events (useful for verifying injection).
  `inspect-logs.mjs <sessions-dir> [sessionId…]` —— 解压拼接式 zstd 会话日志并报告 `session-reference` 事件（便于验证注入）。

## Limitations / 已知限制

- Links resolve only on the machine whose `$DSH_HOME` holds both sessions; session ids are opaque and local. 链接仅在本机（持有两个会话的 `$DSH_HOME`）有效。
- The browser deep link opens sessions present in the current session list (same workspace); sessions outside the list are not auto-resumed. 浏览器深链只打开当前会话列表（同一工作区）内的会话。
- If a referenced session cannot be read (missing, budget exceeded, self-reference), the link stays as plain text and the message still sends; the failure is logged on the host. 引用会话不可读时（不存在、超预算、自引用），链接保留为原文，消息照常发送，失败记录在服务端日志。
- Text-only projection: images and other non-text blocks are not propagated across sessions (upstream service limitation). 仅文本投影：图片等非文本块不跨会话传播（上游服务限制）。

## License / 许可

[MIT](LICENSE) © PwnKY. Built on [`@deepseek-ai/dsh-session-reference`](https://www.npmjs.com/package/@deepseek-ai/dsh-session-reference) (MIT, DeepSeek).
