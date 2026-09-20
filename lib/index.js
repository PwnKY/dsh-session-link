// dsh-session-link — node half (host plugin).
//
// Turns session deep links into read-only model context through the shipped
// `dsh-session-reference` service: when a user message contains a session
// deep link (this deployment's `dsh://session/<sessionId>` deep link, the web
// deep links `http(s)://<host>/?session=<sessionId>` and
// `http(s)://<host>/s/<sessionId>`, or the canonical
// `dsh-session:<base64url>` URI), the link is normalized into a canonical
// mention, parsed into structured references, snapshotted via
// `sessionReferenceResolver.prepare()`, and the bounded snapshot is placed as
// read-only context immediately before the direct prompt.
//
// Since dsh 0.1.0-rc.8 the service also subscribes to `agent/pre-step` itself
// (for canonical mentions). This listener runs outermost — `{ prepend: true }`
// plus the `sessionReferenceResolver` injection makes it activate after the
// service — so by the time it post-processes the decision the service has
// already handled every canonical URI it could handle. Only the deep-link
// forms it does not know about are resolved here: one snapshot per link,
// never two. The copy/open affordances live in the browser half.
import { encodeSessionReferenceUri, parseSessionReferenceText } from "@deepseek-ai/dsh-session-reference";

/** Stable Cordis plugin name (also the package id the client half rides on). */
const name = "dsh-session-link";
/** Services this host row needs before it activates. */
const inject = ["sessionReferenceResolver"];

/**
 * `dsh://` deep links copied by the header button: `dsh://session/<sessionId>`.
 * Only ids shaped like harness session ids (`session-…`) are treated as
 * references, so an unrelated `dsh://` URI cannot hijack a message.
 */
const DSH_URI_RE = /dsh:\/\/session\/(session-[A-Za-z0-9_-]+)/gu;
/**
 * Legacy web deep links: `/s/<sessionId>`. The harness used to answer unknown
 * paths with index.html (SPA fallback), so this form opened the session in the
 * browser; it stays supported for older pasted copies and for the redirect
 * route below. The host part is ignored: session ids are opaque and local to
 * this DSH home.
 */
const WEB_DEEP_LINK_RE = /https?:\/\/[^\s"'<>()\]\\]+?\/s\/(session-[A-Za-z0-9_-]+)/gu;
/**
 * Browser deep links in the form this plugin's protocol handler opens since
 * the harness removed its SPA fallback (dsh 0.1.1-rc.2 returns 404 for
 * unknown paths): `…/?session=<sessionId>` keeps the session marker on an
 * index entry point. Also the form copied out of the address bar.
 */
const WEB_QUERY_LINK_RE = /https?:\/\/[^\s"'<>()\]\\]+?[?&]session=(session-[A-Za-z0-9_-]+)/gu;
/** Session ids this plugin treats as references: harness-shaped `session-…`. */
const SESSION_ID_RE = /^session-[A-Za-z0-9_-]+$/u;
/** Any occurrence of a supported link form, used as a cheap pre-filter. */
const ANY_LINK_RE = /dsh-session:[A-Za-z0-9_-]+|dsh:\/\/session\/session-[A-Za-z0-9_-]+|\/s\/session-[A-Za-z0-9_-]+|[?&]session=session-[A-Za-z0-9_-]+/u;

/** True when the message is a direct user prompt rather than injected context. */
function isDirectUserMessage(message) {
	return message !== null && typeof message === "object" && message?.source?.kind === "user";
}

/** All text of one content block array, in order. */
function textOf(content) {
	if (!Array.isArray(content)) return "";
	return content.flatMap((block) => block?.type === "text" && typeof block?.text === "string" ? [block.text] : []).join("\n");
}

/**
 * Normalize one content block array for references: `dsh://` and web deep
 * links become markdown mentions, then every `dsh-session:` form is parsed
 * into a structured reference and replaced with its readable `@label` text.
 * Malformed or non-canonical URIs throw — callers must never let that fail a
 * user's turn.
 * @param content - the user message content.
 * @returns the normalized content and the structured references, or
 *   `null` when no reference-shaped text was present.
 */
function normalizeReferences(content) {
	let references = [];
	let changed = false;
	const normalized = content.map((block) => {
		if (block?.type !== "text" || typeof block?.text !== "string") return block;
		if (!ANY_LINK_RE.test(block.text)) return block;
		const withMentions = block.text
			.replace(DSH_URI_RE, (_full, sessionId) => `@[${sessionId}](${encodeSessionReferenceUri(sessionId)})`)
			.replace(WEB_DEEP_LINK_RE, (_full, sessionId) => `@[${sessionId}](${encodeSessionReferenceUri(sessionId)})`)
			.replace(WEB_QUERY_LINK_RE, (_full, sessionId) => `@[${sessionId}](${encodeSessionReferenceUri(sessionId)})`);
		const parsed = parseSessionReferenceText(withMentions);
		if (parsed.references.length > 0) changed = true;
		references = [...references, ...parsed.references];
		return { ...block, text: parsed.text };
	});
	return changed ? { content: normalized, references } : null;
}

/**
 * Register the legacy `/s/<sessionId>` browser route when the composition
 * serves the Web surface. The harness used to fall back to index.html for
 * unknown paths, so `/s/<id>` opened the session directly; since dsh
 * 0.1.1-rc.2 that path is a 404 and the browser-openable form is
 * `/?session=<id>`. Redirect old links instead of letting them die.
 * Best-effort: a composition without `webServer`, or one where the `/s`
 * prefix is already claimed (a future upstream route), keeps working without
 * this route — the query form and the client opener do not depend on it.
 * @param ctx - plugin context possibly carrying the `webServer` service.
 */
function registerLegacyBrowserRoute(ctx) {
	ctx.inject(["webServer"], (webCtx) => {
		webCtx.effect(() => {
			try {
				return webCtx.webServer.register({
					kind: "prefix",
					path: "/s",
					handler: (req, res) => {
						if (req.method !== "GET" && req.method !== "HEAD") {
							res.writeHead(405);
							res.end();
							return;
						}
						let pathname = "/";
						try {
							pathname = new URL(req.url ?? "/", "http://dsh.invalid").pathname;
						} catch {
							/* malformed request target — answered as a 404 below */
						}
						const match = pathname.match(/^\/s\/([^/]+)$/u);
						const sessionId = match === null ? void 0 : match[1];
						if (sessionId === void 0 || !SESSION_ID_RE.test(sessionId)) {
							res.writeHead(404);
							res.end();
							return;
						}
						res.writeHead(302, { "cache-control": "no-store", location: `/?session=${encodeURIComponent(sessionId)}` });
						res.end();
					}
				});
			} catch (error) {
				ctx.logger?.warn?.(`dsh-session-link: legacy /s route not registered: ${error instanceof Error ? error.message : String(error)}`);
				return () => {};
			}
		}, "dsh-session-link: legacy /s deep-link redirect");
	});
}

/**
 * Host plugin body. Registers one `agent/pre-step` listener that turns deep
 * links found in direct user prompts into sourced snapshot context, and the
 * legacy `/s/<id>` browser route when the Web surface is composed.
 * @param ctx - plugin context carrying the `sessionReferenceResolver` service.
 */
function apply(ctx) {
	ctx.on("agent/pre-step", async ({ agent, turn, step, signal }, next) => {
		const decision = await next();
		if (decision.kind === "reject" || signal?.aborted === true) return decision;
		// Fail open: no parse or snapshot failure may ever break a user turn.
		const targets = [];
		for (const message of decision.messages) {
			if (!isDirectUserMessage(message)) continue;
			try {
				const text = textOf(message.content);
				if (text === "" || !ANY_LINK_RE.test(text)) continue;
				const normalized = normalizeReferences(message.content);
				if (normalized !== null) targets.push({ message, ...normalized });
			} catch (error) {
				ctx.logger?.warn?.(`dsh-session-link: leaving a malformed link as plain text: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		if (targets.length === 0) return decision;
		// Build the modified decision; every later failure leaves it untouched.
		const result = { ...decision, messages: [...decision.messages] };
		for (const target of targets) {
			try {
				const prepared = await ctx.sessionReferenceResolver.prepare(agent, target.content, target.references, signal);
				const index = result.messages.indexOf(target.message);
				if (index === -1) continue;
				const replaced = { ...target.message, content: prepared.content };
				// Sourced snapshot first, then the readable direct prompt. The resolver
				// omits `additionalContext` when nothing survived normalization (no
				// readable source left), so never splice an undefined message in.
				const insertion = prepared.additionalContext === void 0 ? [replaced] : [prepared.additionalContext, replaced];
				result.messages.splice(index, 1, ...insertion);
			} catch (error) {
				if (signal?.aborted === true) return decision;
				ctx.logger?.warn?.(`dsh-session-link: skipped references in turn ${turn} step ${step}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		return result;
	}, { prepend: true });
	registerLegacyBrowserRoute(ctx);
}

export { apply, inject, name };
