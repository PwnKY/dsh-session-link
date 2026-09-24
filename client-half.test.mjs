// Client-half contract test: loads the hand-written browser bundle through a
// minimal DOM/ModuleLoader shim and verifies the plugin surface
// (name/inject/apply), the copy-link button render, and the deep-link opener.
//
// The opener drives the harness >= 0.1.7-rc.1 navigation seam
// `ctx.uiWorkspace.openSession(id)`. The fake context deliberately exposes NO
// `sessions.open`, so a regression to the obsolete API fails here. Retries run
// on controllable fake timers, so the bounded ~10 s budget and the teardown
// cancellation are asserted without real waiting.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const nodeRequire = createRequire(import.meta.url);

// --- minimal browser shims ---
const createdNodes = [];
const shimDocument = {
  querySelector: () => null,
  createElement(tag) {
    const node = { tagName: tag, dataset: {}, style: {}, textContent: "", value: "", select() {}, remove() {}, setAttribute() {}, appendChild() {}, removeChild() {} };
    createdNodes.push(node);
    return node;
  },
  head: { appendChild() {} },
  body: { appendChild() {} }
};
let capturedFactory = null;
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      capturedFactory = { id, factory };
    }
  },
  location: { origin: "http://127.0.0.1:3180", pathname: "/", search: "", hash: "" },
  isSecureContext: true
};
globalThis.document = shimDocument;
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => {} } }, configurable: true });
globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");
globalThis.TextEncoder = TextEncoder;

// --- controllable fake timers (the bundle only uses window.setTimeout/clearTimeout) ---
const timers = [];
let timerSeq = 0;
globalThis.window.setTimeout = (fn, ms) => {
  const handle = { id: ++timerSeq, fn, ms, cancelled: false };
  timers.push(handle);
  return handle;
};
globalThis.window.clearTimeout = (handle) => {
  if (handle !== null && typeof handle === "object") handle.cancelled = true;
};
function pendingTimers() {
  return timers.filter((timer) => !timer.cancelled);
}
function runNextTimer() {
  const next = pendingTimers()[0];
  if (next === void 0) return false;
  next.cancelled = true;
  next.fn();
  return true;
}
function runAllTimers(limit = 5000) {
  let count = 0;
  while (runNextTimer()) {
    if (++count > limit) throw new Error("fake timers did not settle");
  }
  return count;
}

const code = readFileSync(new URL("./lib/client.js", import.meta.url), "utf8");
new Function("window", code)(globalThis.window);

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures += 1;
}

check("bundle registered with ModuleLoader", capturedFactory !== null && capturedFactory.id === "dsh-session-link");
const factory = capturedFactory.factory;
const requireShim = (name) => {
  if (name === "react") return awaitImportReact();
  throw new Error(`unexpected require: ${name}`);
};
function awaitImportReact() {
  return {
    useState: (v) => [v, () => {}],
    useCallback: (f) => f,
    createElement: (t, props, ...kids) => ({ t, props, kids })
  };
}
const exportsObj = factory(requireShim);
check("factory returned exports", exportsObj !== null && typeof exportsObj === "object");
check("plugin name", exportsObj.name === "dsh-session-link");
check("plugin inject lists slots/sessions/uiWorkspace/locale", Array.isArray(exportsObj.inject) && ["slots", "sessions", "uiWorkspace", "locale"].every((s) => exportsObj.inject.includes(s)));
check("plugin has apply", typeof exportsObj.apply === "function");

// --- the old navigation seam must not come back (the fake ctx below omits it) ---
check("client bundle no longer references sessions.open", !/\.sessions\.open\s*\(/.test(code));

// --- package manifest metadata: client module injection + aligned DSH minimums ---
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
// The declared minimum is ^0.1.7-rc.1, so any later patch or release stays
// valid: report the installed version instead of pinning it.
console.log(`INFO  dsh-session-link package version ${pkg.version}`);
check("package version present", typeof pkg.version === "string" && /^\d+\.\d+\.\d+/.test(pkg.version));
check("dsh.client.inject includes ui-workspace", pkg.dsh?.client?.inject?.includes("@deepseek-ai/dsh-client-ui-workspace") === true);
check("dsh.client.inject keeps locale + ui-conversation", ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-conversation"].every((id) => pkg.dsh.client.inject.includes(id)));
check("peer client packages require ^0.1.7-rc.1", ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-conversation", "@deepseek-ai/dsh-client-ui-workspace"].every((id) => pkg.peerDependencies[id] === "^0.1.7-rc.1"));
check("session-reference dependency requires ^0.1.7-rc.1", pkg.dependencies["@deepseek-ai/dsh-session-reference"] === "^0.1.7-rc.1");

// --- confirm the installed (real) workspace package exposes the navigation seam ---
{
  let realVersion = null;
  let realNavigation = null;
  try {
    const pkgPath = nodeRequire.resolve("@deepseek-ai/dsh-client-ui-workspace/package.json");
    realVersion = JSON.parse(readFileSync(pkgPath, "utf8")).version;
    realNavigation = readFileSync(join(dirname(pkgPath), "lib/types/client/navigation.d.ts"), "utf8");
  } catch {
    /* left null — reported by the checks below */
  }
  // The dependency minimum is ^0.1.7-rc.1: report the exact installed version
  // (diagnostic) and assert the navigation seam exists rather than pinning it.
  console.log(`INFO  installed @deepseek-ai/dsh-client-ui-workspace version ${realVersion ?? "unresolved"}`);
  check("installed real workspace package present", typeof realVersion === "string" && realVersion.length > 0);
  check("installed real workspace declares openSession(target: SessionTarget): void", realNavigation !== null && /openSession\(target:\s*SessionTarget\):\s*void/.test(realNavigation));
}

// --- shared harness ---------------------------------------------------------
function setLocation({ pathname = "/", search = "", hash = "" }) {
  globalThis.window.location = { origin: "http://127.0.0.1:3180", pathname, search, hash };
}

/** Session catalog + `uiWorkspace` double: `openSession` mirrors `sessions.retain` (throws for unknown ids). */
function catalogWorld(initialById = {}) {
  const state = { byId: { ...initialById } };
  const calls = [];
  return {
    state,
    calls,
    sessions: { list: { getSnapshot: () => state } },
    uiWorkspace: {
      openSession(id) {
        calls.push(id);
        if (!Object.prototype.hasOwnProperty.call(state.byId, id)) throw new Error(`sessions.retain: unknown session ${id}`);
      }
    }
  };
}

/**
 * Apply the bundle against a fresh context. The context has no `sessions.open`
 * and (optionally) no `slots.inject`; `effect` records its disposer so the
 * deep-link opener can be torn down by the test.
 */
function mountPlugin({ location, sessions, uiWorkspace, slotDeclared = true, injectSupported = true }) {
  setLocation(location);
  const record = { warns: [], registered: null, injection: null, effectLabels: [], disposers: [] };
  const slotState = { declared: slotDeclared };
  const ctx = {
    slots: {
      register(options, component) {
        if (!slotState.declared) throw new Error(`slot "${options.name}" is not declared (a parent entry's children table must declare it)`);
        record.registered = { options, component };
        return () => {};
      },
      inject(name, callback) {
        record.injection = { name, callback };
        if (slotState.declared) callback();
        return () => {};
      }
    },
    sessions,
    uiWorkspace,
    locale: { register() { return () => {}; } },
    logger: { warn(message) { record.warns.push(message); } },
    effect(callback, label) {
      record.effectLabels.push(label);
      const dispose = callback();
      record.disposers.push(typeof dispose === "function" ? dispose : () => {});
      return () => {};
    }
  };
  if (!injectSupported) ctx.slots.inject = void 0;
  exportsObj.apply(ctx);
  return { ctx, record, slotState };
}

/** Mount one opener URL against a catalog that already holds the target. */
function opener(location, byId) {
  const world = catalogWorld(byId);
  mountPlugin({ location, sessions: world.sessions, uiWorkspace: world.uiWorkspace });
  return world;
}

// --- every accepted URL form opens the target session ---
const FORMS = [
  ["query form", { search: "?session=session-abc123" }],
  ["legacy path form", { pathname: "/s/session-abc123" }],
  ["hash path form", { hash: "#/s/session-abc123" }],
  ["hash query form", { hash: "#session=session-abc123" }]
];
for (const [label, location] of FORMS) {
  const world = opener(location, { "session-abc123": { id: "session-abc123" } });
  check(`${label} opens target session`, world.calls.length === 1 && world.calls[0] === "session-abc123");
}

// --- precedence: the query form is the browser-openable one and wins ---
{
  const world = opener(
    { pathname: "/s/session-path", search: "?session=session-query", hash: "#session=session-hash" },
    { "session-path": { id: "session-path" }, "session-query": { id: "session-query" }, "session-hash": { id: "session-hash" } }
  );
  check("query form wins over path and hash", world.calls.length === 1 && world.calls[0] === "session-query");
}

// --- percent-encoded ids are decoded in both query and path forms ---
{
  const fromQuery = opener({ search: "?session=session-a%2Fb" }, { "session-a/b": { id: "session-a/b" } });
  check("query id is percent-decoded", fromQuery.calls.length === 1 && fromQuery.calls[0] === "session-a/b");
  const fromPath = opener({ pathname: "/s/session-a%2Fb" }, { "session-a/b": { id: "session-a/b" } });
  check("path id is percent-decoded", fromPath.calls.length === 1 && fromPath.calls[0] === "session-a/b");
}

// --- malformed / empty / unrelated URLs never navigate (and never retry) ---
function expectNoOpen(label, location) {
  const before = pendingTimers().length;
  const world = opener(location, {});
  check(label, world.calls.length === 0 && pendingTimers().length === before);
}
expectNoOpen("malformed path id is ignored", { pathname: "/s/session-%E0%A4%A" });
expectNoOpen("empty query is ignored", { search: "?session=" });
expectNoOpen("empty hash is ignored", { hash: "#session=" });
expectNoOpen("unrelated query is ignored", { search: "?other=1" });
expectNoOpen("unrelated path is ignored", { pathname: "/other" });
expectNoOpen("unrelated hash is ignored", { hash: "#top" });

// --- delayed catalog: wait on the bounded retry, then navigate exactly once ---
{
  const world = catalogWorld({});
  mountPlugin({ location: { search: "?session=session-delayed" }, sessions: world.sessions, uiWorkspace: world.uiWorkspace });
  check("delayed catalog: no navigation while empty", world.calls.length === 0);
  check("delayed catalog: one retry queued", pendingTimers().length === 1);
  world.state.byId["session-delayed"] = { id: "session-delayed" };
  runAllTimers();
  check("delayed catalog: navigates once when the row arrives", world.calls.length === 1 && world.calls[0] === "session-delayed");
  check("delayed catalog: no retry left after success", pendingTimers().length === 0);
}

// --- transient synchronous navigation failure: retried to a single success ---
{
  const world = catalogWorld({ "session-transient": { id: "session-transient" } });
  let remainingFailures = 2;
  const attempts = [];
  let successes = 0;
  world.uiWorkspace.openSession = (id) => {
    attempts.push(id);
    if (remainingFailures-- > 0) throw new Error("navigation not ready");
    successes += 1;
  };
  mountPlugin({ location: { search: "?session=session-transient" }, sessions: world.sessions, uiWorkspace: world.uiWorkspace });
  check("transient failure: first attempt fails, no success yet", attempts.length === 1 && successes === 0);
  runAllTimers();
  check("transient failure: retried to exactly one success", attempts.length === 3 && successes === 1);
  check("transient failure: no retry left after success", pendingTimers().length === 0);
}

// --- transient getSnapshot throw: retried until the catalog is readable ---
{
  const world = catalogWorld({ "session-snapshot": { id: "session-snapshot" } });
  const readableSnapshot = world.sessions.list.getSnapshot;
  let remainingThrows = 2;
  world.sessions.list.getSnapshot = () => {
    if (remainingThrows-- > 0) throw new Error("sessions service not ready");
    return readableSnapshot();
  };
  mountPlugin({ location: { search: "?session=session-snapshot" }, sessions: world.sessions, uiWorkspace: world.uiWorkspace });
  check("getSnapshot throw: no navigation while the snapshot throws", world.calls.length === 0);
  check("getSnapshot throw: a retry is queued", pendingTimers().length === 1);
  runAllTimers();
  check("getSnapshot throw: recovers and navigates exactly once", world.calls.length === 1 && world.calls[0] === "session-snapshot");
  check("getSnapshot throw: no retry left after success", pendingTimers().length === 0);
}

// --- missing target: the retry budget is bounded and ends in a warning ---
{
  const world = catalogWorld({});
  const before = timers.length;
  const mounted = mountPlugin({ location: { search: "?session=session-missing" }, sessions: world.sessions, uiWorkspace: world.uiWorkspace });
  const retries = runAllTimers();
  const queued = timers.slice(before);
  check(
    "missing target: queues 50 retries of 200ms (~10000ms)",
    retries === 50 && queued.length === 50 && queued.every((timer) => timer.ms === 200) && queued.reduce((sum, timer) => sum + timer.ms, 0) === 10000
  );
  check("missing target: never navigates", world.calls.length === 0);
  check("missing target: warns once at the timeout", mounted.record.warns.length === 1 && mounted.record.warns[0].includes("session-missing"));
  check("missing target: no retry left after timeout", pendingTimers().length === 0);
}

// --- teardown cancels queued retries and prevents late navigation ---
{
  const world = catalogWorld({});
  const mounted = mountPlugin({ location: { search: "?session=session-teardown" }, sessions: world.sessions, uiWorkspace: world.uiWorkspace });
  check("teardown: a retry is queued", pendingTimers().length === 1);
  const openerIndex = mounted.record.effectLabels.indexOf("dsh-session-link: deep-link opener");
  check("teardown: deep-link effect registered", openerIndex !== -1);
  mounted.record.disposers[openerIndex]();
  check("teardown: queued retry cancelled", pendingTimers().length === 0);
  world.state.byId["session-teardown"] = { id: "session-teardown" };
  runAllTimers();
  check("teardown: no navigation after dispose", world.calls.length === 0);
}

// --- disposal guard: a callback already dequeued by the runtime must be a no-op ---
// clearTimeout cannot un-queue a callback the event loop already took, so after
// disposal the attempt must observe `stopped` (not just a cancelled timer) and
// refuse to navigate or requeue.
{
  const world = catalogWorld({});
  const mounted = mountPlugin({ location: { search: "?session=session-disposed" }, sessions: world.sessions, uiWorkspace: world.uiWorkspace });
  const queued = pendingTimers()[0];
  check("disposal guard: a retry is queued", queued !== void 0);
  const openerIndex = mounted.record.effectLabels.indexOf("dsh-session-link: deep-link opener");
  mounted.record.disposers[openerIndex]();
  world.state.byId["session-disposed"] = { id: "session-disposed" };
  queued.fn();
  check("disposal guard: late callback does not navigate", world.calls.length === 0);
  check("disposal guard: late callback does not requeue", pendingTimers().length === 0);
}

// --- exactly-once navigation (no duplicate after success) ---
{
  const world = catalogWorld({ "session-once": { id: "session-once" } });
  mountPlugin({ location: { search: "?session=session-once" }, sessions: world.sessions, uiWorkspace: world.uiWorkspace });
  check("exactly-once: navigated on boot", world.calls.length === 1);
  runAllTimers();
  check("exactly-once: no duplicate navigation", world.calls.length === 1);
}

// --- late slot declaration still defers the copy-button registration ---
{
  const world = catalogWorld({ "session-abc123": { id: "session-abc123" } });
  const mounted = mountPlugin({ location: { search: "?session=session-abc123" }, sessions: world.sessions, uiWorkspace: world.uiWorkspace, slotDeclared: false });
  check("late declaration: no eager registration", mounted.record.registered === null);
  check("late declaration: inject waits for header actions", mounted.record.injection !== null && mounted.record.injection.name === "conversation.session.header.actions");
  mounted.slotState.declared = true;
  mounted.record.injection.callback();
  check("registered header action once declared", mounted.record.registered !== null && mounted.record.registered.options.name === "conversation.session.header.actions" && mounted.record.registered.options.id === "dsh-session-link.copy");
  check("late declaration: deep link still opened", world.calls.length === 1 && world.calls[0] === "session-abc123");
}

// --- a context without slots.inject registers directly ---
{
  const world = catalogWorld({ "session-legacy": { id: "session-legacy" } });
  const mounted = mountPlugin({ location: { search: "?session=session-legacy" }, sessions: world.sessions, uiWorkspace: world.uiWorkspace, injectSupported: false });
  check("no slots.inject: direct registration still works", mounted.record.registered !== null && mounted.record.registered.options.id === "dsh-session-link.copy" && mounted.record.injection === null);
}

// --- render the button component and simulate a click (copy feature intact) ---
{
  const world = catalogWorld({ "session-abc123": { id: "session-abc123" } });
  const mounted = mountPlugin({ location: { search: "?session=session-abc123" }, sessions: world.sessions, uiWorkspace: world.uiWorkspace });
  let copiedText = null;
  globalThis.navigator.clipboard.writeText = async (text) => { copiedText = text; };
  const Component = mounted.record.registered.component;
  const rendered = Component({ sessionId: "session-abc123", t: (k) => k });
  check("button renders", rendered !== null && rendered.props.type === "button" && rendered.props.className === "dshsl-copy");
  rendered.props.onClick();
  check("copied dsh:// deep link", copiedText === "dsh://session/session-abc123");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
