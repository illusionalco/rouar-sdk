import { n as resolveAgentDevUrl, r as resolveAgentRoutes } from "./frontend-config-BLWEAmN3.mjs";
import { isAbsolute, join, resolve } from "node:path";
import { existsSync } from "node:fs";
//#region src/nuxt.ts
/**
* Nuxt のモジュール。useAgent の自動の import、許可の関数の登録、開発のときの中継を受け持つ。
* @nuxt/kit を読み込まずに nuxt.options と hook だけで書く。
* pnpm では利用者のプロジェクトから @nuxt/kit が見えないことがあり、省ける peer dependency にしておくため
*/
const SCRIPT_EXTENSIONS = [
	".ts",
	".mts",
	".js",
	".mjs"
];
/** Nuxt の alias を当てて、許可の関数のファイルの絶対パスを決める。見つからなければ例外にする */
function resolveAuthorizePath(path, options) {
	let resolved = path;
	const aliases = Object.keys(options.alias).sort((a, b) => b.length - a.length);
	for (const alias of aliases) if (resolved === alias || resolved.startsWith(`${alias}/`)) {
		resolved = `${options.alias[alias]}${resolved.slice(alias.length)}`;
		break;
	}
	if (!isAbsolute(resolved)) resolved = resolve(options.rootDir, resolved);
	const candidates = [
		resolved,
		...SCRIPT_EXTENSIONS.map((extension) => `${resolved}${extension}`),
		...SCRIPT_EXTENSIONS.map((extension) => join(resolved, `index${extension}`))
	];
	for (const candidate of candidates) if (existsSync(candidate) && SCRIPT_EXTENSIONS.some((extension) => candidate.endsWith(extension))) return candidate;
	throw new Error(`[rouar] The authorize file ${JSON.stringify(path)} in nuxt.config was not found.`);
}
function authorizePluginCode(authorizePath) {
	return [
		"import { createEvent } from \"h3\";",
		"import { registerNuxtAuthorize } from \"@rouar/sdk/nuxt/runtime\";",
		`import authorize from ${JSON.stringify(authorizePath)};`,
		"export default function rouarAuthorize() {",
		"  registerNuxtAuthorize(authorize, createEvent);",
		"}",
		""
	].join("\n");
}
function devProxyCode(target, authorizePath) {
	return [
		"import { defineEventHandler, proxyRequest } from \"h3\";",
		"import { handleDevAgentRequest } from \"@rouar/sdk/nuxt/runtime\";",
		authorizePath ? `import authorize from ${JSON.stringify(authorizePath)};` : "const authorize = undefined;",
		"export default defineEventHandler((event) =>",
		`  handleDevAgentRequest(event, { target: ${JSON.stringify(target)}, authorize, proxyRequest }),`,
		");",
		""
	].join("\n");
}
function clientPluginCode(agentRoute) {
	return [
		"import { defineNuxtPlugin } from \"#app\";",
		"import { configureAgentClient } from \"@rouar/sdk/client\";",
		"export default defineNuxtPlugin({",
		"  name: \"rouar:client\",",
		"  setup() {",
		`    configureAgentClient({ agentRoute: ${JSON.stringify(agentRoute)} });`,
		"  },",
		"});",
		""
	].join("\n");
}
/** Nuxt のモジュールの本体。nuxt.config の modules に "@rouar/sdk/nuxt" を書くと呼ばれる */
function rouarNuxtModule(inlineOptions, nuxt) {
	const options = {
		...nuxt.options.rouar,
		...inlineOptions
	};
	const routes = resolveAgentRoutes(nuxt.options.rootDir, options.agentRoutes);
	const agentRoute = routes[0];
	const authorizePath = options.authorize ? resolveAuthorizePath(options.authorize, nuxt.options) : void 0;
	const devTarget = nuxt.options.dev && options.devProxy !== false ? resolveAgentDevUrl(options.devTarget ? { ROUAR_AGENT_DEV_URL: options.devTarget } : process.env) : void 0;
	nuxt.hook("imports:extend", (imports) => {
		imports.push({
			name: "useAgent",
			from: "@rouar/sdk/vue"
		});
	});
	const clientFile = "rouar-client.mjs";
	nuxt.options.build.templates.push({
		filename: clientFile,
		write: true,
		getContents: () => clientPluginCode(agentRoute)
	});
	nuxt.options.plugins.unshift({ src: join(nuxt.options.buildDir, clientFile) });
	nuxt.hook("nitro:config", (config) => {
		config.virtual ??= {};
		if (config.imports !== false) {
			config.imports ??= {};
			config.imports.imports ??= [];
			config.imports.imports.push({
				name: "defineRouarAuthorize",
				from: "@rouar/sdk/nuxt/runtime"
			});
		}
		if (authorizePath) {
			const pluginId = join(nuxt.options.buildDir, "rouar", "authorize.mjs");
			config.virtual[pluginId] = authorizePluginCode(authorizePath);
			config.plugins ??= [];
			config.plugins.push(pluginId);
		}
		if (devTarget) {
			const handlerId = join(nuxt.options.buildDir, "rouar", "dev-proxy.mjs");
			config.virtual[handlerId] = devProxyCode(devTarget, authorizePath);
			config.handlers ??= [];
			for (const route of routes) {
				config.handlers.push({
					route,
					handler: handlerId
				});
				config.handlers.push({
					route: `${route}/**`,
					handler: handlerId
				});
			}
		}
	});
}
rouarNuxtModule.getMeta = async () => ({
	name: "@rouar/sdk/nuxt",
	configKey: "rouar"
});
//#endregion
export { rouarNuxtModule as default, resolveAuthorizePath };

//# sourceMappingURL=nuxt.mjs.map