// Integration check against the REAL shipped resolver: composes
// `@deepseek-ai/dsh-session-reference` (which, since dsh 0.1.0-rc.8, listens on
// `agent/pre-step` itself) together with this package's host half on one cordis
// context, then drives the seam. The fake-resolver cases in
// `host-half.test.mjs` cannot catch an ordering regression between the two
// listeners; this file pins the two properties that matter:
//   1. `dsh://` deep links (unknown to upstream) still inject one snapshot; and
//   2. a canonical `dsh-session:` URI is injected exactly once, not by both.
// Run after `pnpm install`.
import { Context } from "@deepseek-ai/cordis";
import SessionReferenceResolver, { encodeSessionReferenceUri } from "@deepseek-ai/dsh-session-reference";
import { apply } from "./lib/index.js";

const SOURCE_ID = "session-069cb62a-5683-4073-9aa3-6ffd6b07953a";
const TARGET_ID = "session-target-1111";

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures += 1;
}

/** Minimal current-surface stub the resolver's projection accepts. */
function surface(id) {
  return {
    session: { id, cwd: "C:/work", version: 1 },
    capturedThroughSeq: 3,
    events: [
      { type: "user/message", data: { source: { kind: "user" }, content: [{ type: "text", text: "hello from source" }] } },
      { type: "assistant/message", data: { message: { content: [{ type: "text", text: "assistant reply" }] } } }
    ]
  };
}

const ctx = new Context();
ctx.provide("sessionQuery", {
  async readSurface(id) {
    if (id !== SOURCE_ID) throw new Error(`unknown session ${id}`);
    return surface(id);
  }
});
ctx.plugin(SessionReferenceResolver, { maxReferenceBytes: 65536 });
apply(ctx);

const agent = { id: TARGET_ID, session: { id: TARGET_ID }, options: {} };

async function run(id, text) {
  const prompt = { id, role: "user", source: { kind: "user" }, content: [{ type: "text", text }] };
  const decision = await ctx.waterfall({}, "agent/pre-step", { agent, messages: [prompt], turn: 1, step: 1, signal: undefined }, () => Promise.resolve({ kind: "enter", messages: [prompt] }));
  return {
    decision,
    snapshots: decision.messages.filter((message) => message.source?.kind === "session-reference"),
    direct: decision.messages.filter((message) => message.source?.kind === "user")
  };
}

// 1. dsh:// deep link — resolved by this package, untouched by upstream.
{
  const { decision, snapshots, direct } = await run("m1", `参考 dsh://session/${SOURCE_ID} 继续`);
  check("dsh:// link injects exactly one snapshot", snapshots.length === 1);
  check("dsh:// link keeps two messages", decision.messages.length === 2);
  check("dsh:// prompt normalized to @label", direct[0].content[0].text === `参考 @${SOURCE_ID} 继续`);
  check("dsh:// snapshot carries recall provenance", snapshots[0].source.form === "recall" && snapshots[0].source.references[0].sessionId === SOURCE_ID);
}

// 2. canonical URI — resolved by the upstream listener; the plugin must not add
// a second snapshot on top of it.
{
  const uri = encodeSessionReferenceUri(SOURCE_ID);
  const { decision, snapshots, direct } = await run("m2", `参考 ${uri} 继续`);
  check("canonical URI injects exactly one snapshot", snapshots.length === 1);
  check("canonical URI keeps two messages", decision.messages.length === 2);
  check("canonical URI prompt normalized to @label", direct[0].content[0].text === `参考 @${SOURCE_ID} 继续`);
}

// 3. self-reference through the plugin path stays fail-open.
{
  const { decision, snapshots } = await run("m3", `dsh://session/${TARGET_ID} 看这个`);
  check("self-referencing dsh:// link does not break the turn", decision.kind === "enter" && snapshots.length === 0);
}

// 4. unreadable source through the plugin path stays fail-open.
{
  const { decision, snapshots } = await run("m4", "参考 dsh://session/session-does-not-exist 继续");
  check("unreadable dsh:// link does not break the turn", decision.kind === "enter" && snapshots.length === 0);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
