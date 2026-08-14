# dsh-session-link

[![npm](https://img.shields.io/npm/v/dsh-session-link.svg)](https://www.npmjs.com/package/dsh-session-link) [![npm downloads](https://img.shields.io/npm/dm/dsh-session-link.svg)](https://www.npmjs.com/package/dsh-session-link) · [English](https://github.com/PwnKY/dsh-session-link/blob/master/README.en.md) · 中文

**DeepSeek Harness 的 Codex 式会话深度链接插件**

复制任意会话的链接，粘贴到另一个对话里 —— 被引用会话的上下文会被快照，并作为**受控的只读背景上下文**注入到你的提示词之前；同一链接也能在浏览器中直接打开对应会话。

## 一键安装

```bash
# 一条命令装完：安装包 + 自动加入 profile 的 bundle 层 + 自动应用配置行
dsh plugin --profile web add dsh-session-link

# 重启 Web GUI 并刷新页面
dsh web
```

无需手动修改任何 yml —— 插件自带 `dsh.bundle` patch（`cordis.patch.yml`），`dsh plugin add` 检测到后会自动把它加进 `dsh.profile.bundles`，启动时自动组合 `session-reference` 与 `session-link` 两行配置。

> 通用 npm 安装（只装包、不进 profile）：`npm install dsh-session-link`
> 手动安装方式（不依赖 bundle 机制）：见[快速开始](#快速开始)。

```
┌─ 会话 A ─────────────────┐        ┌─ 会话 B ─────────────────────────┐
│  🔗 复制会话链接          │        │  用户: 请参考这个会话:           │
│  → dsh://session/session-│ ─────▶ │        dsh://session/session-…   │
│    …abc                   │  粘贴  │                                  │
└───────────────────────────┘        │  模型: (收到 A 的快照            │
                                     │         + 提示词，链接变 @label) │
                                     └──────────────────────────────────┘
```

## 特性

- 🔗 **一键复制** —— 会话头部「复制会话链接」按钮，输出 `dsh://session/<会话ID>`（codex:// / claude:// 同款格式）
- 📖 **跨对话读上下文** —— 把链接粘进任意对话，源会话内容被快照（有上限、只读）并注入到你的提示词之前
- 🖱️ **可点击深链（Windows）** —— 注册 `dsh` 协议处理器后，点击 `dsh://` 链接直接打开 Web GUI 并选中该会话
- 🛡️ **容错** —— 畸形链接、会话不可读、自引用都不会打断对话：链接保留为原文，失败记录在服务端日志

## 工作原理

本插件复用官方 [`@deepseek-ai/dsh-session-reference`](https://www.npmjs.com/package/@deepseek-ai/dsh-session-reference) 服务（它已实现规范 URI、mention 解析、快照投影与字节预算保留），再把它接入 agent 循环和 Web 界面：

- **服务端（`lib/index.js`）** —— cordis 插件，挂在 `agent/pre-step` 钩子上：用户消息里出现会话深链时，把各种链接形式统一成规范 `dsh-session:` mention，解析为结构化引用，通过 `sessionReferenceResolver.prepare()` 快照源会话，并把聚合的只读快照放在直接提示之前。钩子与传输层无关，TUI 里粘贴规范 URI 同样生效。
- **浏览器端（`lib/client.js`）** —— 静态客户端包（`dsh.client` 声明），在 `conversation.session.header.actions` 渲染复制按钮，并在以 `/s/<会话ID>` 打开页面时自动选中目标会话。

## 链接格式

| 形式 | 示例 | 用途 |
|---|---|---|
| 深链 | `dsh://session/<会话ID>` | **按钮复制**；协议处理器可点击；粘贴可解析 |
| 浏览器地址 | `http://<主机>:3080/s/<会话ID>` | 协议处理器打开的目标；粘贴同样识别 |
| 规范 URI | `dsh-session:<base64url(JSON 会话ID)>` | `dsh-session-reference` 的无损 URI；粘贴可解析 |
| Markdown mention | `@[标签](dsh-session:…)` | 解析后显示为 `@标签`（TUI mention 形式） |

只有带 `session-…` 形态会话 ID 的链接才会被当作引用，无关的 `dsh://…`、`/s/…` 文本不会被误伤。

## 快速开始

需要 DeepSeek Harness 的 `dsh`（任意带 Web 界面的 profile）。

```bash
# 1. 一条命令安装（自动加入 bundle 层并应用配置，见上方「一键安装」）：
dsh plugin --profile web add dsh-session-link

# 2. 重启 Web GUI 并刷新页面。
dsh web

# 3.（Windows，可选）让 dsh:// 链接可点击：
powershell -ExecutionPolicy Bypass -File register-protocol.ps1
```

> **手动安装（不依赖 bundle 机制）**：先 `pnpm add dsh-session-link`（在 profile 目录），再在 profile 的 patch 层（如 `~/.dsh/profiles/web/cordis.patch.yml`）加入：
>
> ```yaml
> - insert:
>     - id: session-reference
>       name: '@deepseek-ai/dsh-session-reference'
>
>     - id: session-link
>       name: 'dsh-session-link'
> ```
> 然后重启 `dsh web`。

## 使用

1. 点会话标题旁的 🔗 按钮复制深链。
2. 粘到另一个对话并发送 —— 模型先收到被引用会话的只读快照，再收到你的提示（链接会替换为可读的 `@会话ID`）。
3. 或者直接点击 `dsh://` 链接，在浏览器中打开该会话。

## Windows `dsh://` 协议处理器

`register-protocol.ps1` 在当前用户下注册 `dsh` URL 协议（HKCU，无需管理员权限）：任何地方点击 `dsh://session/<ID>`（浏览器、聊天软件、终端）都会打开 `http://127.0.0.1:3080/s/<ID>` 并选中该会话。启动器为 `dsh-open.cmd`。

```powershell
# 注册
powershell -ExecutionPolicy Bypass -File register-protocol.ps1
# 注销
powershell -ExecutionPolicy Bypass -File register-protocol.ps1 -Uninstall
```

打开会话需要 `dsh web` 正在运行。

## 模型看到的

模型会看到连续两条 user 消息：`## Referenced sessions` 不可信快照（每个源最多 64 KiB JSON，优先丢弃较早的非检查点消息，长消息头尾截断并给出精确省略提示），随后是链接已被替换为 `@会话ID` 的直接提示。快照内的指令、权限声明、工具请求除非当前用户重申，否则一律不执行。

## 配置

默认使用底层服务的配置（每条消息最多 3 个引用、每源 64 KiB）。在 profile 的 patch 层覆盖 `session-reference` 行即可调整，例如：

```yaml
- id: session-reference
  config:
    maxReferenceBytes: 131072
```

## 测试

```bash
pnpm install
npm test
```

- `host-half.test.mjs` —— 用真实 cordis waterfall 驱动 `agent/pre-step` 监听器（`dsh://` 链接、web 链接、规范 URI、普通文本、畸形 URI、prepare 失败）
- `client-half.test.mjs` —— 在 DOM shim 下加载浏览器 bundle，检查插件表面、头部按钮注册、深链打开器与复制的 `dsh://` 值
- `inspect-logs.mjs <会话目录> [会话ID…]` —— 解压拼接式 zstd 会话日志并报告 `session-reference` 事件（便于验证注入）

## 已知限制

- 链接仅在本机（持有两个会话的 `$DSH_HOME`）有效，会话 ID 是不透明且本地的。
- 浏览器深链只打开当前会话列表（同一工作区）内的会话，列表外的会话不会自动恢复。
- 引用会话不可读时（不存在、超预算、自引用），链接保留为原文，消息照常发送，失败记录在服务端日志。
- 仅文本投影：图片等非文本块不跨会话传播（上游服务限制）。

## 许可

[MIT](LICENSE) © PwnKY。基于 [`@deepseek-ai/dsh-session-reference`](https://www.npmjs.com/package/@deepseek-ai/dsh-session-reference)（MIT，DeepSeek）。
