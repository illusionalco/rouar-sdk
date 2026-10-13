import { a as parseRouarConfig, i as ROUAR_CONFIG_FILE, t as DEFAULT_AGENT_ROUTES } from "./config-Dx9yx3Hq.mjs";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
/** start から上へたどって rouar.json を探す。.git のあるディレクトリで止める */
function findRouarConfig(start) {
	let dir = start;
	for (;;) {
		const candidate = join(dir, ROUAR_CONFIG_FILE);
		if (existsSync(candidate)) return candidate;
		if (existsSync(join(dir, ".git"))) return void 0;
		const parent = dirname(dir);
		if (parent === dir) return void 0;
		dir = parent;
	}
}
/** 接頭辞を / で始まり / で終わらない形にそろえる。合わない値は例外にする */
function normalizeAgentRoute(route, where) {
	if (typeof route !== "string" || !route.startsWith("/")) throw new Error(`[rouar] ${where} must be a path that starts with "/", got ${JSON.stringify(route)}.`);
	const trimmed = route.replace(/\/+$/, "");
	if (!trimmed || /[?#\s]/.test(trimmed)) throw new Error(`[rouar] ${where} must be a path prefix such as "/agents", got ${JSON.stringify(route)}.`);
	return trimmed;
}
/**
* エージェントの経路の接頭辞を決める。渡した値を先に使い、なければ rouar.json の agent.routes を読む。
* どちらもなければ既定の /agents を返す
*/
function resolveAgentRoutes(start, explicit) {
	if (explicit) {
		if (explicit.length === 0) throw new Error("[rouar] agentRoutes must not be empty.");
		return explicit.map((route) => normalizeAgentRoute(route, "agentRoutes"));
	}
	const path = findRouarConfig(start);
	if (!path) return [...DEFAULT_AGENT_ROUTES];
	const parsed = parseRouarConfig(readFileSync(path, "utf8"));
	if (!parsed.success) {
		const details = parsed.issues.map((issue) => `${issue.path || "(root)"}: ${issue.message}`).join("; ");
		throw new Error(`[rouar] ${path} is invalid: ${details}`);
	}
	return (parsed.config.agent?.routes ?? DEFAULT_AGENT_ROUTES).map((route) => normalizeAgentRoute(route, `agent.routes in ${path}`));
}
/** 開発のときの中継先。ROUAR_AGENT_DEV_URL があればそれを使う */
function resolveAgentDevUrl(env = process.env) {
	const value = env.ROUAR_AGENT_DEV_URL?.trim() || "http://localhost:5173";
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`[rouar] ROUAR_AGENT_DEV_URL must be an http or https URL, got ${JSON.stringify(value)}.`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`[rouar] ROUAR_AGENT_DEV_URL must be an http or https URL, got ${JSON.stringify(value)}.`);
	return url.origin;
}
/** ブラウザで会話の URL の接頭辞を決めるスクリプト。Symbol の鍵は @rouar/sdk/client と同じ */
function clientConfigScript(agentRoute) {
	return `globalThis[Symbol.for("rouar.sdk.client")]=Object.assign(globalThis[Symbol.for("rouar.sdk.client")]||{},{agentRoute:${JSON.stringify(agentRoute).replace(/</g, "\\u003c")}});`;
}
//#endregion
export { resolveAgentDevUrl as n, resolveAgentRoutes as r, clientConfigScript as t };

//# sourceMappingURL=frontend-config-BLWEAmN3.mjs.map