// dsh-session-link — browser half (client bundle).
//
// Rendered in the web shell as a static client package (`dsh.client`
// declaration in package.json; served by dsh-client-modules at
// /plugins/dsh-session-link/client.js). Owns the two user-facing halves of
// the deep-link feature:
//  1. a "copy session link" button in the conversation header action strip,
//     copying `dsh://session/<sessionId>` — the same link the host half
//     understands when pasted into any conversation; and
//  2. the deep-link opener: when the page boots with a session marker
//     (`/?session=<sessionId>`, plus the legacy `/s/<sessionId>` and hash
//     forms), select that session once the session catalog has loaded.
// No client→host RPC is needed: the link is self-contained and the host
// parses it server-side at the agent pre-step seam.
window.__ModuleLoader__.load({
	id: "dsh-session-link",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var React = require("react");

		// --- styles (module scope, mirroring compiled client bundles) ---
		const CSS_ID = "dsh-session-link/client.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_ID) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-session-link";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = [
				".dshsl-copy{display:grid;place-items:center;width:28px;height:28px;flex:none;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:14px;line-height:1;padding:0}",
				".dshsl-copy:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
				".dshsl-copy:focus-visible{outline:2px solid var(--dsw-alias-label-tertiary);outline-offset:-2px}",
				".dshsl-copy[data-copied=\"true\"]{color:var(--dsw-alias-state-success-primary)}"
			].join("");
			document.head.appendChild(tag);
		}

		// --- link encoding (browser twin of dsh-session-reference/uri) ---
		/** Canonical `dsh-session:` URI for one session id. */
		function encodeSessionReferenceUri(sessionId) {
			const bytes = new TextEncoder().encode(JSON.stringify(sessionId));
			let bin = "";
			for (const b of bytes) bin += String.fromCharCode(b);
			return "dsh-session:" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
		}
		/** `dsh://` deep link for one session id — the format the copy button emits. */
		function dshDeepLink(sessionId) {
			return "dsh://session/" + encodeURIComponent(sessionId);
		}

		// --- copy fallback for non-secure contexts ---
		function fallbackCopy(text) {
			try {
				const ta = document.createElement("textarea");
				ta.value = text;
				ta.setAttribute("readonly", "");
				ta.style.position = "fixed";
				ta.style.opacity = "0";
				document.body.appendChild(ta);
				ta.select();
				document.execCommand("copy");
				document.body.removeChild(ta);
				return true;
			} catch {
				return false;
			}
		}

		// --- the copy button (registered into conversation.session.header.actions) ---
		function CopySessionLinkButton({ sessionId, t }) {
			const [copied, setCopied] = React.useState(false);
			const copy = React.useCallback(() => {
				const link = dshDeepLink(sessionId);
				const flash = () => {
					setCopied(true);
					window.setTimeout(() => setCopied(false), 1600);
				};
				if (navigator.clipboard !== void 0 && window.isSecureContext === true) {
					navigator.clipboard.writeText(link).then(flash, () => {
						if (fallbackCopy(link)) flash();
					});
				} else if (fallbackCopy(link)) flash();
			}, [sessionId]);
			const label = copied ? t("copied") : t("copyLink");
			return React.createElement("button", {
				type: "button",
				className: "dshsl-copy",
				"data-copied": copied ? "true" : "false",
				title: label,
				"aria-label": label,
				onClick: copy
			}, copied ? "\u2713" : "\uD83D\uDD17");
		}

		// --- deep-link opener: the current URL selects that session at boot ---
		/** Decode one raw URL component, or null when it is malformed/empty. */
		function decodeDeepLinkId(raw) {
			try {
				const id = decodeURIComponent(raw);
				return typeof id === "string" && id.length > 0 ? id : null;
			} catch {
				return null;
			}
		}
		/**
		 * Session id carried by the current URL, or null. `?session=<id>` on the
		 * index route is the browser-openable form: since dsh 0.1.1-rc.2 the web
		 * server answers unknown paths (including `/s/<id>`) with 404 instead of
		 * falling back to index.html. The legacy path and the hash forms stay
		 * supported for older links and for harness builds that still serve them.
		 */
		function deepLinkedSessionId() {
			const location = window.location;
			const search = typeof location.search === "string" ? location.search : "";
			if (search !== "") {
				try {
					const fromQuery = new URLSearchParams(search).get("session");
					if (typeof fromQuery === "string" && fromQuery.length > 0) return fromQuery;
				} catch {
					/* malformed query string — fall through to the path forms */
				}
			}
			const path = typeof location.pathname === "string" ? location.pathname : "";
			const fromPath = path.match(/^\/s\/([^/]+)$/);
			if (fromPath !== null) return decodeDeepLinkId(fromPath[1]);
			const hash = typeof location.hash === "string" ? location.hash : "";
			const fromHashPath = hash.match(/^#\/?s\/([^/?#]+)$/);
			if (fromHashPath !== null) return decodeDeepLinkId(fromHashPath[1]);
			const fromHashQuery = hash.match(/^#session=([^&/?#]+)$/);
			if (fromHashQuery !== null) return decodeDeepLinkId(fromHashQuery[1]);
			return null;
		}
		/** Retry cadence for the deep-link opener: 200 ms steps for a ~10 s budget. */
		const DEEP_LINK_RETRY_INTERVAL_MS = 200;
		const DEEP_LINK_RETRY_TIMEOUT_MS = 10000;
		/**
		 * Select the session named by the current URL.
		 *
		 * `ctx.uiWorkspace.openSession` is the harness ≥ 0.1.7-rc.1 navigation seam:
		 * it synchronously retains the target and replaces the main view, and throws
		 * while the target is still unknown to the loaded session catalog. The
		 * opener therefore waits for the catalog row, retries a bounded number of
		 * times on not-ready snapshots and synchronous navigation failures, and
		 * stops the moment one attempt succeeds (never navigating twice).
		 * @param ctx - plugin context carrying `sessions` and `uiWorkspace`.
		 * @returns a disposer that cancels any queued retry.
		 */
		function openDeepLinkedSession(ctx) {
			const id = deepLinkedSessionId();
			if (id === null) return () => {};
			let timer = null;
			let stopped = false;
			let waited = 0;
			const attempt = () => {
				timer = null;
				if (stopped) return;
				let catalogued = false;
				try {
					const snapshot = ctx.sessions.list.getSnapshot();
					catalogued = snapshot !== null && snapshot.byId !== void 0 && Object.prototype.hasOwnProperty.call(snapshot.byId, id);
				} catch {
					/* sessions service not ready yet — retry */
				}
				if (catalogued) {
					// The link stays in the address bar, so a refresh re-opens the same
					// session; only the selection happens here.
					try {
						ctx.uiWorkspace.openSession(id);
						return;
					} catch {
						/* navigation not ready yet — retry */
					}
				}
				if (waited >= DEEP_LINK_RETRY_TIMEOUT_MS) {
					const message = `dsh-session-link: deep-linked session ${id} was not available after ${DEEP_LINK_RETRY_TIMEOUT_MS}ms`;
					if (typeof ctx.logger?.warn === "function") ctx.logger.warn(message);
					else console.warn(message);
					return;
				}
				waited += DEEP_LINK_RETRY_INTERVAL_MS;
				timer = window.setTimeout(attempt, DEEP_LINK_RETRY_INTERVAL_MS);
			};
			attempt();
			return () => {
				stopped = true;
				if (timer !== null) {
					window.clearTimeout(timer);
					timer = null;
				}
			};
		}

		// --- plugin ---
		function apply(ctx) {
			ctx.effect(() => {
				const disposeEn = ctx.locale.register("dsh-session-link", "en", {
					copyLink: "Copy session link",
					copied: "Link copied"
				});
				const disposeZh = ctx.locale.register("dsh-session-link", "zh", {
					copyLink: "复制会话链接",
					copied: "已复制链接"
				});
				return () => {
					disposeEn();
					disposeZh();
				};
			}, "dsh-session-link: locale dictionaries");
			// The conversation header declares `conversation.session.header.actions`
			// when its view is assembled, which can happen after this plugin
			// activates. `slots.inject` (harness >= 0.1.2-rc.1) defers the
			// registration until the parent's children table declares the slot, and
			// re-runs it after a declaration epoch change; older builds declare the
			// slot eagerly, so a direct registration is correct there.
			const registerCopyButton = () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "dsh-session-link.copy",
				order: 500,
				locale: "dsh-session-link"
			}, CopySessionLinkButton);
			if (typeof ctx.slots.inject === "function") ctx.slots.inject("conversation.session.header.actions", registerCopyButton);
			else registerCopyButton();
			ctx.effect(() => openDeepLinkedSession(ctx), "dsh-session-link: deep-link opener");
		}

		module.exports = { name: "dsh-session-link", inject: ["slots", "sessions", "uiWorkspace", "locale"], apply };
		return module.exports;
	}
});
