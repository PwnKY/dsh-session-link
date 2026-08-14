// Client-half contract smoke test: loads the hand-written browser bundle
// through a minimal DOM/ModuleLoader shim and verifies the plugin surface
// (name/inject/apply), the copy-link button render, and the deep-link opener.
import { readFileSync } from "node:fs";

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
  location: { origin: "http://127.0.0.1:3180", pathname: "/s/session-abc123" },
  isSecureContext: true,
  setTimeout: (fn) => fn()
};
globalThis.document = shimDocument;
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => {} } }, configurable: true });
globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");
globalThis.TextEncoder = TextEncoder;
globalThis.window.setTimeout = globalThis.setTimeout;

const code = readFileSync(new URL("./lib/client.js", import.meta.url), "utf8");
new Function("window", code)(globalThis.window);

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures += 1;
}

check("bundle registered with ModuleLoader", capturedFactory !== null && capturedFactory.id === "dsh-session-link");
const factory = capturedFactory.factory;
const module = { exports: {} };
const require = (name) => {
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
const exportsObj = factory(require) ?? module.exports;
check("factory returned exports", exportsObj !== null && typeof exportsObj === "object");
check("plugin name", exportsObj.name === "dsh-session-link");
check("plugin inject lists slots/sessions/locale", Array.isArray(exportsObj.inject) && ["slots", "sessions", "locale"].every((s) => exportsObj.inject.includes(s)));
check("plugin has apply", typeof exportsObj.apply === "function");

// --- simulate apply with a fake ctx ---
let opened = null;
let registered = null;
const fakeCtx = {
  slots: {
    register(options, component) {
      registered = { options, component };
      return () => {};
    }
  },
  sessions: {
    list: {
      getSnapshot: () => ({ byId: { "session-abc123": { id: "session-abc123" } }, ids: ["session-abc123"] })
    },
    open(id) { opened = id; }
  },
  locale: {
    register() { return () => {}; }
  },
  effect() { return () => {}; }
};
exportsObj.apply(fakeCtx);
check("registered header action", registered !== null && registered.options.name === "conversation.session.header.actions" && registered.options.id === "dsh-session-link.copy");
check("deep link opened target session", opened === "session-abc123");

// --- render the button component and simulate a click ---
let copiedText = null;
globalThis.navigator.clipboard.writeText = async (text) => { copiedText = text; };
const Component = registered.component;
const rendered = Component({ sessionId: "session-abc123", t: (k) => k });
check("button renders", rendered !== null && rendered.props.type === "button" && rendered.props.className === "dshsl-copy");
rendered.props.onClick();
check("copied dsh:// deep link", copiedText === "dsh://session/session-abc123");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
