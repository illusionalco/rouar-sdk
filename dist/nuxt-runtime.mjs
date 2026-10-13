import { a as isValidPrincipal, r as allowBrowserAgents, t as PRINCIPAL_HEADER } from "./access-C8tGVOdd.mjs";
//#region src/nuxt-runtime.ts
/** 許可の関数に型を付ける。中身はそのまま返す */
function defineRouarAuthorize(authorize) {
	return authorize;
}
/** Nitro の外で作った event に、Nitro のユーティリティが読む context を足す */
function withNitroContext(event) {
	const context = event.context;
	context.nitro ??= { errors: [] };
	return event;
}
/**
* h3 の event を受け取る許可の関数を、SDK の許可の関数に包む。
* SDK のサーバーの入口は context.node に Node の要求と応答を入れて呼ぶ
*/
function toBrowserAuthorize(authorize, createEvent) {
	return (_request, context) => {
		if (!context.node) throw new Error("[rouar] The Nuxt authorize function needs the Node request. It runs only inside the rouar server.");
		return authorize(withNitroContext(createEvent(context.node.req, context.node.res)));
	};
}
/** Nitro の起動のときに、許可の関数を SDK の登録先に入れる */
function registerNuxtAuthorize(authorize, createEvent) {
	allowBrowserAgents({ authorize: toBrowserAuthorize(authorize, createEvent) });
}
function problem(event, status, title) {
	event.node.res.statusCode = status;
	event.node.res.setHeader("content-type", "application/problem+json");
	return JSON.stringify({
		type: "about:blank",
		title,
		status
	});
}
/**
* 開発のときに、エージェントの経路への要求を手元の Flue の開発のサーバーへ中継する。
* 許可の関数があれば中継の前に呼び、呼び出し元を x-rouar-principal で渡す。
* 会話の id の書き換えと CSRF の確かめは、デプロイしたサーバーの入口だけが行う
*/
async function handleDevAgentRequest(event, options) {
	delete event.node.req.headers[PRINCIPAL_HEADER];
	const headers = {};
	if (options.authorize) {
		let result;
		try {
			result = await options.authorize(withNitroContext(event));
		} catch (error) {
			console.error("[rouar] the authorize function threw", error);
			return problem(event, 500, "Internal Server Error");
		}
		if (!result) return problem(event, 401, "Unauthorized");
		if (!isValidPrincipal(result.principal)) {
			console.error("[rouar] the authorize function returned an invalid principal; use 1 to 256 printable ASCII characters");
			return problem(event, 500, "Internal Server Error");
		}
		headers[PRINCIPAL_HEADER] = result.principal;
	}
	const path = event.path ?? event.node.req.url ?? "/";
	return options.proxyRequest(event, `${options.target}${path}`, { headers });
}
//#endregion
export { defineRouarAuthorize, handleDevAgentRequest, registerNuxtAuthorize, toBrowserAuthorize };

//# sourceMappingURL=nuxt-runtime.mjs.map