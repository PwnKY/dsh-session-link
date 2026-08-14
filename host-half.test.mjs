// Unit smoke test for the dsh-session-link host half: drives the registered
// agent/pre-step listener through a real cordis waterfall with a stubbed
// sessionReferenceResolver and verifies the decision transformation.
// Run after `pnpm install` (devDependencies: @deepseek-ai/cordis,
// @deepseek-ai/dsh-session-reference).
import { Context } from "@deepseek-ai/cordis";
import { apply } from "./lib/index.js";

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures += 1;
}

const ctx = new Context();
const prepared = [];
let failWith = null;
const fakeResolver = {
  async prepare(agent, content, references, signal) {
    if (failWith !== null) throw failWith;
    prepared.push({ references });
    return {
      content,
      additionalContext: { id: "injected-1", role: "user", source: { kind: "session-reference" }, content: [{ type: "text", text: "SNIPPET" }] }
    };
  }
};
ctx.provide("sessionReferenceResolver", fakeResolver);
apply(ctx);

// Case 1: web deep link in a direct user prompt → context injected before prompt.
const prompt1 = { id: "m1", role: "user", source: { kind: "user", rpcId: "r1" }, content: [{ type: "text", text: "请参考 http://127.0.0.1:3080/s/session-abc123 继续" }] };
const decision1 = await ctx.waterfall({}, "agent/pre-step", { messages: [prompt1], turn: 1, step: 1 }, () => Promise.resolve({ kind: "enter", messages: [{ ...prompt1 }] }));
check("decision is enter", decision1.kind === "enter");
check("context injected before prompt", decision1.messages.length === 2 && decision1.messages[0].id === "injected-1" && decision1.messages[1].id === "m1");
check("prompt text normalized to @label", decision1.messages[1].content[0].text === "请参考 @session-abc123 继续");
check("references parsed", prepared.length === 1 && prepared[0].references[0].sessionId === "session-abc123");

// Case 2: plain message without links → untouched, no prepare call.
const prompt2 = { id: "m2", role: "user", source: { kind: "user" }, content: [{ type: "text", text: "普通消息" }] };
const decision2 = await ctx.waterfall({}, "agent/pre-step", { messages: [prompt2], turn: 2, step: 1 }, () => Promise.resolve({ kind: "enter", messages: [{ ...prompt2 }] }));
check("plain message untouched", decision2.messages.length === 1 && decision2.messages[0].content[0].text === "普通消息");
check("no extra prepare", prepared.length === 1);

// Case 3: context (non-user) message with a link is ignored.
const contextMsg = { id: "c1", role: "user", source: { kind: "plugin" }, content: [{ type: "text", text: "http://127.0.0.1:3080/s/session-xyz" }] };
const decision3 = await ctx.waterfall({}, "agent/pre-step", { messages: [contextMsg], turn: 3, step: 1 }, () => Promise.resolve({ kind: "enter", messages: [{ ...contextMsg }] }));
check("context message ignored", decision3.messages.length === 1);

// Case 4: malformed canonical URI must not break the turn.
const prompt4 = { id: "m4", role: "user", source: { kind: "user" }, content: [{ type: "text", text: "dsh-session:garbage-not-json 消息" }] };
const decision4 = await ctx.waterfall({}, "agent/pre-step", { messages: [prompt4], turn: 4, step: 1 }, () => Promise.resolve({ kind: "enter", messages: [{ ...prompt4 }] }));
check("malformed URI keeps turn intact", decision4.kind === "enter" && decision4.messages.length === 1);
check("malformed URI left as text", decision4.messages[0].content[0].text === "dsh-session:garbage-not-json 消息");

// Case 5: prepare failure (self-reference) leaves the message untouched.
failWith = new Error("SESSION_REFERENCE_SELF_REFERENCE");
const prompt5 = { id: "m5", role: "user", source: { kind: "user" }, content: [{ type: "text", text: "参考 http://127.0.0.1:3080/s/session-self 会话" }] };
const decision5 = await ctx.waterfall({}, "agent/pre-step", { messages: [prompt5], turn: 5, step: 1 }, () => Promise.resolve({ kind: "enter", messages: [{ ...prompt5 }] }));
check("prepare failure keeps turn intact", decision5.kind === "enter" && decision5.messages.length === 1);

// Case 6: canonical bare URI works.
failWith = null;
const uri = "dsh-session:InNlc3Npb24tMDY5Y2I2MmEtNTY4My00MDczLTlhYTMtNmZmZDZiMDc5NTNhIg";
const prompt6 = { id: "m6", role: "user", source: { kind: "user" }, content: [{ type: "text", text: `canonical ${uri} end` }] };
const decision6 = await ctx.waterfall({}, "agent/pre-step", { messages: [prompt6], turn: 6, step: 1 }, () => Promise.resolve({ kind: "enter", messages: [{ ...prompt6 }] }));
check("canonical URI injected", decision6.messages.length === 2 && decision6.messages[1].content[0].text === "canonical @session-069cb62a-5683-4073-9aa3-6ffd6b07953a end");

// Case 7: dsh:// deep link (the copied format) works.
const prompt7 = { id: "m7", role: "user", source: { kind: "user" }, content: [{ type: "text", text: "参考 dsh://session/session-069cb62a-5683-4073-9aa3-6ffd6b07953a 会话" }] };
const decision7 = await ctx.waterfall({}, "agent/pre-step", { messages: [prompt7], turn: 7, step: 1 }, () => Promise.resolve({ kind: "enter", messages: [{ ...prompt7 }] }));
check("dsh:// link injected", decision7.messages.length === 2 && decision7.messages[1].content[0].text === "参考 @session-069cb62a-5683-4073-9aa3-6ffd6b07953a 会话");

// Case 8: unrelated dsh:// URI without a session id is left as plain text.
const prompt8 = { id: "m8", role: "user", source: { kind: "user" }, content: [{ type: "text", text: "app dsh://settings/theme 说明" }] };
const decision8 = await ctx.waterfall({}, "agent/pre-step", { messages: [prompt8], turn: 8, step: 1 }, () => Promise.resolve({ kind: "enter", messages: [{ ...prompt8 }] }));
check("unrelated dsh:// untouched", decision8.messages.length === 1 && decision8.messages[0].content[0].text === "app dsh://settings/theme 说明");

// Case 9: dsh:// inside a markdown link destination is still resolved.
const prompt9 = { id: "m9", role: "user", source: { kind: "user" }, content: [{ type: "text", text: "[看这个](dsh://session/session-abc123) 继续" }] };
const decision9 = await ctx.waterfall({}, "agent/pre-step", { messages: [prompt9], turn: 9, step: 1 }, () => Promise.resolve({ kind: "enter", messages: [{ ...prompt9 }] }));
const text9 = decision9.messages[1].content[0].text;
check("dsh:// in markdown destination injected", decision9.messages.length === 2 && text9.includes("@session-abc123"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
