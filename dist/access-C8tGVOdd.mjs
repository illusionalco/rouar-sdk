//#region src/access.ts
const REGISTRY_KEY = Symbol.for("rouar.sdk.browser-agents");
/** 呼び出し元をエージェントに渡す見出し。利用者が送った値は捨てる */
const PRINCIPAL_HEADER = "x-rouar-principal";
/** 呼び出し元の文字列の上限。見出しに入れるので、表示できる ASCII に限る */
const PRINCIPAL_MAX_LENGTH = 256;
const PRINCIPAL_PATTERN = /^[\x20-\x7e]+$/;
/** @internal 呼び出し元の文字列が使えるかを確かめる */
function isValidPrincipal(value) {
	return typeof value === "string" && value.trim().length > 0 && value.length <= PRINCIPAL_MAX_LENGTH && PRINCIPAL_PATTERN.test(value);
}
function registry() {
	const holder = globalThis;
	holder[REGISTRY_KEY] ??= {};
	return holder[REGISTRY_KEY];
}
/**
* ブラウザから、同じオリジンのエージェントの会話の URL を、アクセストークンなしで呼べるようにする。
* authorize は要求ごとに呼ばれ、許すなら呼び出し元を返す。会話は呼び出し元ごとに分かれる。
* もう一度呼ぶと、前の関数を置き換える
*/
function allowBrowserAgents(options) {
	if (typeof options?.authorize !== "function") throw new TypeError("[rouar] allowBrowserAgents() needs an authorize function.");
	registry().authorize = options.authorize;
}
/** @internal 登録された許可の関数を返す。SDK のサーバーの入口が使う */
function getBrowserAuthorize() {
	return registry().authorize;
}
/** @internal 許可の関数の登録を外す。テストで使う */
function resetBrowserAgentsForTests() {
	const current = registry();
	delete current.authorize;
	delete current.agentFetch;
}
/** @internal SDK のサーバーの入口が、Flue のアプリを読み込んだあとに登録する */
function registerInProcessAgentFetch(fetch) {
	registry().agentFetch = fetch;
}
/**
* 同じプロセスの Flue のアプリを、アクセストークンなしで直接呼ぶ。
* フロントエンドのサーバーのコードから使う。Rouar のサーバーの入口の外では使えない。
* パスだけを渡すと、内部のホストの URL として扱う
*/
async function agentFetch(input, options = {}) {
	const fetch = registry().agentFetch;
	if (!fetch) throw new Error("[rouar] agentFetch() works only inside the rouar server. Run the app with the rouar server entry, or call the agent over HTTP with an access token.");
	return fetch(input instanceof Request ? input : new Request(new URL(input, "http://rouar.internal")), options.principal);
}
//#endregion
export { isValidPrincipal as a, getBrowserAuthorize as i, agentFetch as n, registerInProcessAgentFetch as o, allowBrowserAgents as r, resetBrowserAgentsForTests as s, PRINCIPAL_HEADER as t };

//# sourceMappingURL=access-C8tGVOdd.mjs.map