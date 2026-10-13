import { n as resolveAgentDevUrl, r as resolveAgentRoutes, t as clientConfigScript } from "./frontend-config-BLWEAmN3.mjs";
import { resolve } from "node:path";
//#region src/vite.ts
/**
* Vue と Vite の SPA のための Vite のプラグイン。
* 開発のときにエージェントの経路を手元の Flue の開発のサーバーへ中継し、
* ページに会話の URL の接頭辞を埋め込む。許可の関数は Flue の開発のサーバーの中で動く
*/
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** 接頭辞と、その下のパスだけに当てる。/agents は /agents-old に当てない */
function proxyKey(route) {
	return `^${escapeRegExp(route)}(?:[/?]|$)`;
}
function rouar(options = {}) {
	let routes = [];
	return {
		name: "rouar",
		config(config, env) {
			routes = resolveAgentRoutes(resolve(config.root ?? process.cwd()), options.agentRoutes);
			if (env.command !== "serve") return;
			const target = options.target ?? resolveAgentDevUrl();
			return { server: { proxy: Object.fromEntries(routes.map((route) => [proxyKey(route), {
				target,
				changeOrigin: false,
				ws: false
			}])) } };
		},
		transformIndexHtml() {
			const route = routes[0];
			if (!route) return;
			return [{
				tag: "script",
				children: clientConfigScript(route),
				injectTo: "head-prepend"
			}];
		}
	};
}
//#endregion
export { rouar as default, rouar, proxyKey };

//# sourceMappingURL=vite.mjs.map