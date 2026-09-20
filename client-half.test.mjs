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
  location: { origin: "http://127.0.0.1:3180", pathname: "/", search: "", hash: "" },
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

// --- the URL forms the deep-link opener accepts: `?session=<id>` is the
// browser-openable form the protocol handler opens (the harness dropped its
// SPA fallback in 0.1.1-rc.2, so `/s/<id>` is a 404 and the session marker
// has to ride on the index route); the legacy path and the hash forms stay
// accepted for older links. ---
function setLocation({ pathname = "/", search = "", hash = "" }) {
  globalThis.window.location = { origin: "http://127.0.0.1:3180", pathname, search, hash };
}
setLocation({ search: "?session=session-abc123" });

// --- apply against a ctx that mirrors the harness >= 0.1.2 slot lifecycle: the
// parent entry declares `conversation.session.header.actions` only when its
// view is assembled, which can be after this plugin activates. A direct
// `register` there throws "slot ... is not declared", so `slots.inject` must
// defer the registration until the declaration arrives.
let opened = null;
let registered = null;
let injection = null;
let slotDeclared = false;
function registrationReset() {
  registered = null;
  injection = null;
  slotDeclared = false;
}
function fakeCtx() {
  return {
    slots: {
      register(options, component) {
        if (!slotDeclared) throw new Error(`slot "${options.name}" is not declared (a parent entry's children table must declare it)`);
        registered = { options, component };
        return () => {};
      },
      inject(name, callback) {
        injection = { name, callback };
        if (slotDeclared) callback();
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
}
exportsObj.apply(fakeCtx());
check("late declaration: no eager registration", registered === null);
check("late declaration: inject waits for header actions", injection !== null && injection.name === "conversation.session.header.actions");
slotDeclared = true;
injection.callback();
check("registered header action once declared", registered !== null && registered.options.name === "conversation.session.header.actions" && registered.options.id === "dsh-session-link.copy");
check("query form opens target session", opened === "session-abc123");

// --- legacy `/s/<id>` path (harness builds that still serve index there) ---
opened = null;
registrationReset();
setLocation({ pathname: "/s/session-abc123" });
exportsObj.apply(fakeCtx());
check("legacy path form opens target session", opened === "session-abc123");

// --- hash forms ---
opened = null;
registrationReset();
setLocation({ hash: "#/s/session-abc123" });
exportsObj.apply(fakeCtx());
check("hash path form opens target session", opened === "session-abc123");

opened = null;
registrationReset();
setLocation({ hash: "#session=session-abc123" });
exportsObj.apply(fakeCtx());
check("hash query form opens target session", opened === "session-abc123");

// --- an unrelated URL must not select anything ---
opened = null;
registrationReset();
setLocation({ search: "?other=1" });
exportsObj.apply(fakeCtx());
check("unrelated query leaves the selection alone", opened === null);

// --- legacy harness without slots.inject: direct registration still works ---
registrationReset();
slotDeclared = true;
setLocation({ search: "?session=session-abc123" });
const legacyCtx = fakeCtx();
legacyCtx.slots.inject = void 0;
exportsObj.apply(legacyCtx);
check("legacy fallback registers directly", registered !== null && injection === null);

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
