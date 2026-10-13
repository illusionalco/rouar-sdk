import { createProvider, envApiKeyAuth } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { OPENROUTER_MODELS } from "@earendil-works/pi-ai/providers/openrouter.models";
import { setProvider } from "@flue/runtime";
//#region src/server/providers.ts
/**
* Provider id for rouar models. `rouar/<name>` is a custom model you registered on rouar,
* and `rouar/<vendor>/<model>` is a hosted model such as `rouar/anthropic/claude-sonnet-4.6`.
*/
const ROUAR_PROVIDER_ID = "rouar";
/**
* Flue がカタログにない id を受け付ける provider に付ける印。
* `@flue/runtime` の resolveModel が Symbol.for で同じ値を読み、メタデータのないモデルを作る
*/
const DYNAMIC_MODEL_TEMPLATE = Symbol.for("flue.dynamicModelTemplate");
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
/** 上流そのものを指すモデルと名前。利用者に見せないのでカタログから外す */
const VENDOR_TEXT = /openrouter/i;
function isPositiveInteger(value) {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}
/**
* ROUAR_MODELS の JSON を読む。形式が違う要素は捨てる。
* JSON として読めなければ例外を投げる。
*/
function parseRouarModels(json) {
	if (json === void 0 || json.trim() === "") return [];
	const parsed = JSON.parse(json);
	if (!Array.isArray(parsed)) throw new Error("ROUAR_MODELS must be a JSON array.");
	const models = [];
	for (const item of parsed) {
		if (typeof item !== "object" || item === null) continue;
		const { name, contextWindow, maxTokens } = item;
		if (typeof name !== "string" || !MODEL_NAME.test(name)) continue;
		if (!isPositiveInteger(contextWindow) || !isPositiveInteger(maxTokens)) continue;
		models.push({
			name,
			contextWindow,
			maxTokens
		});
	}
	return models;
}
/** 料金は rouar の利用量で数えるので、pi の計算では 0 にする */
const ZERO_COST = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0
};
/** vLLM の OpenAI 互換サーバーに合わせたモデルの定義を作る */
function toPiModel(spec, baseUrl) {
	return {
		id: spec.name,
		name: spec.name,
		api: "openai-completions",
		provider: ROUAR_PROVIDER_ID,
		baseUrl,
		reasoning: false,
		input: ["text"],
		cost: ZERO_COST,
		contextWindow: spec.contextWindow,
		maxTokens: spec.maxTokens,
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			supportsUsageInStreaming: true,
			maxTokensField: "max_tokens"
		}
	};
}
/**
* ホスト済みのモデルの定義を、rouar のゲートウェイに向けて作り直す。
* pi は上流の URL と provider の id から送り方を決めるので、同じ送り方を compat に明示する。
* カタログ自身の compat はそのまま優先する
*/
function toHostedModel(model, urls) {
	if (model.api === "anthropic-messages") return {
		...model,
		provider: ROUAR_PROVIDER_ID,
		baseUrl: urls.anthropic,
		cost: ZERO_COST,
		compat: {
			sendSessionAffinityHeaders: true,
			sessionAffinityFormat: "openrouter",
			...model.compat
		}
	};
	if (model.api === "openai-completions") {
		const isAnthropic = model.id.startsWith("anthropic/");
		return {
			...model,
			provider: ROUAR_PROVIDER_ID,
			baseUrl: urls.openai,
			cost: ZERO_COST,
			compat: {
				supportsDeveloperRole: isAnthropic || model.id.startsWith("openai/"),
				thinkingFormat: "openrouter",
				sendSessionAffinityHeaders: true,
				sessionAffinityFormat: "openrouter",
				...isAnthropic ? { cacheControlFormat: "anthropic" } : {},
				...model.compat
			}
		};
	}
}
/** pi のカタログにある、rouar が中継するホスト済みのモデル。id は `<vendor>/<model>` */
function hostedModels(urls) {
	const models = [];
	for (const model of Object.values(OPENROUTER_MODELS)) {
		if (!model.id.includes("/")) continue;
		if (VENDOR_TEXT.test(model.id) || VENDOR_TEXT.test(model.name)) continue;
		const hosted = toHostedModel(model, urls);
		if (hosted) models.push(hosted);
	}
	return models;
}
/**
* Registers the `rouar` model provider with Flue.
*
* - `rouar/<vendor>/<model>` addresses a hosted model, for example `rouar/anthropic/claude-sonnet-4.6`.
*   Ids missing from the bundled catalog are accepted without metadata.
* - `rouar/<name>` addresses a custom model listed in `ROUAR_MODELS`.
*
* Requests go to `ROUAR_GATEWAY_URL` and are authenticated with `ROUAR_TOKEN`, read on every call.
* rouar's server entry calls this before loading your app. Call it yourself in `app.ts` when running
* locally with `flue dev`. Returns the registered custom model names, or an empty array when the URL
* or the token is missing.
*/
function registerRouarProvider(env = process.env) {
	const base = env.ROUAR_GATEWAY_URL || env.ROUAR_API_URL;
	if (!base || !env.ROUAR_TOKEN) return [];
	const specs = parseRouarModels(env.ROUAR_MODELS);
	const root = `${base.replace(/\/+$/, "")}/models`;
	const urls = {
		openai: `${root}/v1`,
		anthropic: root
	};
	const custom = specs.map((spec) => toPiModel(spec, urls.openai));
	const customIds = new Set(custom.map((model) => model.id));
	const provider = createProvider({
		id: ROUAR_PROVIDER_ID,
		name: "rouar",
		baseUrl: urls.openai,
		auth: { apiKey: envApiKeyAuth("rouar runtime token", ["ROUAR_TOKEN"]) },
		models: [...custom, ...hostedModels(urls).filter((model) => !customIds.has(model.id))],
		api: {
			"openai-completions": openAICompletionsApi(),
			"anthropic-messages": anthropicMessagesApi()
		}
	});
	Object.defineProperty(provider, DYNAMIC_MODEL_TEMPLATE, {
		value: {
			api: "openai-completions",
			baseUrl: urls.openai
		},
		enumerable: false
	});
	setProvider(provider);
	return specs.map((spec) => spec.name);
}
//#endregion
export { registerRouarProvider as n, ROUAR_PROVIDER_ID as t };

//# sourceMappingURL=providers-CCvWwUe4.mjs.map