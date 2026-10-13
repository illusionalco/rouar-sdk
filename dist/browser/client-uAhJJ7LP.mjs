import { createFlueClient } from "@flue/sdk";
//#region src/client/agent-session.ts
/*!
* @license Apache-2.0
* Ported from @flue/react 2.2.2 (src/agent-reducer.ts and src/agent-session.ts,
* https://github.com/withastro/flue/tree/main/packages/react).
*
* Copyright the Flue authors.
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*
* Modifications: reconstructed as TypeScript from the published build,
* reformatted with Biome, the reducer and the session merged into one file,
* and an abort() method added to AgentSession. The state logic is otherwise
* unchanged.
*/
const emptyAgentState = {
	messages: [],
	status: "idle",
	historyReady: false,
	error: void 0,
	failedSends: [],
	settlements: [],
	conversation: void 0,
	pendingSends: [],
	failedOptimistic: [],
	localMessageIds: [],
	localSubmissionIds: [],
	activeSubmissionIds: []
};
function reduceAgentEvent(state, event) {
	switch (event.type) {
		case "local_send_submitted": {
			const settledIds = new Set(state.conversation?.settlements.map((settlement) => settlement.submissionId) ?? []);
			return converge({
				...state,
				pendingSends: [...state.pendingSends, {
					localId: event.localId,
					optimistic: optimisticMessage(event)
				}],
				localSubmissionIds: state.localSubmissionIds.filter((id) => !settledIds.has(id)),
				failedSends: [],
				failedOptimistic: [],
				error: void 0
			});
		}
		case "local_send_admitted": return converge({
			...state,
			pendingSends: state.pendingSends.map((send) => send.localId === event.localId ? {
				...send,
				submissionId: event.submissionId
			} : send),
			localMessageIds: [...state.localMessageIds, {
				submissionId: event.submissionId,
				localId: event.localId
			}],
			localSubmissionIds: addUnique(state.localSubmissionIds, event.submissionId),
			activeSubmissionIds: addUnique(state.activeSubmissionIds, event.submissionId)
		});
		case "local_send_failed": {
			const failed = state.pendingSends.find((send) => send.localId === event.localId);
			return converge({
				...state,
				pendingSends: state.pendingSends.filter((send) => send.localId !== event.localId),
				...failed ? {
					failedOptimistic: [...state.failedOptimistic, failed.optimistic],
					failedSends: [...state.failedSends, {
						id: failed.localId,
						message: messageText(failed.optimistic),
						error: event.error
					}]
				} : {}
			});
		}
		case "local_observation": {
			if (event.phase === "error") return {
				...state,
				status: "error",
				error: event.error
			};
			if (event.phase === "absent") return converge({
				...state,
				conversation: void 0,
				historyReady: true
			});
			const connecting = event.phase === "loading" || event.phase === "connecting";
			if (event.conversation) {
				const merged = converge({
					...state,
					conversation: event.conversation,
					historyReady: true
				});
				return connecting ? {
					...merged,
					status: merged.status === "idle" ? "connecting" : merged.status,
					error: event.error ?? merged.error
				} : merged;
			}
			return {
				...state,
				status: connecting ? "connecting" : state.status,
				error: event.error
			};
		}
	}
}
function converge(state) {
	const conversation = state.conversation;
	const settledIds = new Set(conversation?.settlements.map((settlement) => settlement.submissionId) ?? []);
	const localIdBySubmissionId = new Map(state.localMessageIds.map((entry) => [entry.submissionId, entry.localId]));
	const canonical = (conversation?.messages ?? []).map((message) => {
		const localId = message.role === "user" && message.submissionId ? localIdBySubmissionId.get(message.submissionId) : void 0;
		return localId ? {
			...message,
			id: localId
		} : message;
	});
	const canonicalSubmissionIds = new Set((conversation?.messages ?? []).map((message) => message.submissionId).filter((value) => typeof value === "string"));
	const pendingSends = [];
	const pendingEchoes = [];
	for (const pending of state.pendingSends) {
		if (pending.submissionId ? canonicalSubmissionIds.has(pending.submissionId) || settledIds.has(pending.submissionId) : false) continue;
		pendingSends.push(pending);
		pendingEchoes.push(pending.optimistic);
	}
	const messages = [
		...canonical,
		...pendingEchoes,
		...state.failedOptimistic
	];
	const ownStreaming = (conversation?.messages ?? []).some((message) => message.role === "assistant" && message.parts.some((part) => (part.type === "text" || part.type === "reasoning") && part.state === "streaming"));
	const settlementBySubmissionId = new Map((conversation?.settlements ?? []).map((settlement) => [settlement.submissionId, settlement]));
	const lastSettledLocalSubmission = [...state.localSubmissionIds].reverse().map((id) => settlementBySubmissionId.get(id)).find((settlement) => settlement !== void 0);
	const failedSettlement = lastSettledLocalSubmission?.outcome === "failed" ? lastSettledLocalSubmission : void 0;
	const localActiveSubmissionIds = state.activeSubmissionIds.filter((id) => !settledIds.has(id));
	const observedActiveSubmissionIds = [...canonicalSubmissionIds].filter((id) => !settledIds.has(id));
	const hasActiveSubmission = localActiveSubmissionIds.length > 0 || observedActiveSubmissionIds.length > 0;
	const hasFailedSend = state.failedSends.length > 0;
	const status = failedSettlement ? "error" : ownStreaming ? "streaming" : pendingSends.length > 0 ? "submitted" : hasActiveSubmission ? "streaming" : hasFailedSend ? "error" : "idle";
	return {
		...state,
		messages,
		settlements: conversation?.settlements ?? [],
		pendingSends,
		activeSubmissionIds: localActiveSubmissionIds,
		status,
		error: failedSettlement ? new Error(settlementError(failedSettlement.error)) : status === "error" && hasFailedSend ? state.failedSends[state.failedSends.length - 1]?.error : void 0
	};
}
function optimisticMessage(event) {
	return {
		id: event.localId,
		role: "user",
		purpose: "user",
		display: "visible",
		parts: [{
			type: "text",
			text: event.message,
			state: "done"
		}, ...(event.attachments ?? []).map((attachment) => ({
			type: "file",
			mediaType: attachment.mimeType,
			url: `data:${attachment.mimeType};base64,${attachment.data}`,
			...attachment.filename ? { filename: attachment.filename } : {}
		}))]
	};
}
function messageText(message) {
	const part = message.parts.find((value) => value.type === "text");
	return part && part.type === "text" ? part.text : "";
}
function addUnique(values, value) {
	return values.includes(value) ? values : [...values, value];
}
function settlementError(value) {
	if (value && typeof value === "object" && "message" in value) return String(value.message);
	return "Agent submission failed";
}
/**
* 1 つの会話の状態を、観測と楽観的な送信から組み立てる。
* subscribe と getSnapshot は外部ストアの契約に合わせてあり、
* 各フレームワークの包みはこの 2 つと sendMessage、refresh、abort を使う
*/
var AgentSession = class {
	client;
	live;
	state = { ...emptyAgentState };
	snapshot = publicSnapshot(this.state);
	listeners = /* @__PURE__ */ new Set();
	observation;
	unsubscribeObservation;
	active = false;
	localId = 0;
	constructor(client, live = "sse") {
		this.client = client;
		this.live = live;
	}
	/** 観測を始める。2 回目からは何もしない */
	start() {
		if (this.active) return;
		this.active = true;
		this.observation = this.client.observe({ live: this.live });
		this.unsubscribeObservation = this.observation.subscribe(() => this.applyObservation());
		this.applyObservation();
	}
	subscribe = (listener) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	getSnapshot = () => this.snapshot;
	/**
	* Re-runs the observation's history catch-up and resumes live updates.
	* No-op before `start()` or after `dispose()`.
	*/
	refresh = () => {
		this.observation?.refresh();
	};
	sendMessage = async (message, options = {}) => {
		const localId = `local:${++this.localId}`;
		const { images, documents, ...sendOptions } = options;
		const attachments = [...images ?? [], ...documents ?? []];
		this.dispatch({
			type: "local_send_submitted",
			localId,
			message,
			attachments
		});
		try {
			const receipt = await this.client.send({
				...sendOptions,
				message: {
					kind: "user",
					body: message,
					...attachments.length ? { attachments } : {}
				}
			});
			this.dispatch({
				type: "local_send_admitted",
				localId,
				submissionId: receipt.submissionId
			});
			if (this.observation?.getSnapshot().phase === "absent") this.observation.refresh();
			return receipt;
		} catch (error) {
			this.dispatch({
				type: "local_send_failed",
				localId,
				error: toError(error)
			});
			throw error;
		}
	};
	/** 会話の実行中と待ちの仕事を止める。止めた結果は観測の settlements に届く */
	abort = (options) => this.client.abort(options);
	dispose() {
		if (!this.active) return;
		this.active = false;
		this.unsubscribeObservation?.();
		this.unsubscribeObservation = void 0;
		this.observation?.close();
		this.observation = void 0;
	}
	applyObservation() {
		const observed = this.observation?.getSnapshot();
		if (!observed) return;
		this.dispatch({
			type: "local_observation",
			conversation: observed.conversation,
			phase: observed.phase,
			error: observed.error
		});
	}
	dispatch(event) {
		const next = reduceAgentEvent(this.state, event);
		if (next === this.state) return;
		this.state = next;
		this.snapshot = publicSnapshot(this.state);
		for (const listener of this.listeners) listener();
	}
};
function publicSnapshot(state) {
	return {
		messages: state.messages,
		status: state.status,
		historyReady: state.historyReady,
		error: state.error,
		failedSends: state.failedSends,
		settlements: state.settlements
	};
}
function toError(error) {
	return error instanceof Error ? error : new Error(String(error));
}
/** 会話の URL がないときや SSR の間に返す、空の状態 */
const emptyAgentSnapshot = publicSnapshot(emptyAgentState);
//#endregion
//#region src/client.ts
/**
* ブラウザからエージェントの会話を呼ぶ、フレームワークに依存しない芯。
* @flue/sdk の createFlueClient を同じオリジンの会話の URL で作り、AgentSession で状態にする。
* ブラウザに入るので、Node の API と @flue/runtime を読み込まない。ビルドのあとに scripts/check-browser.mjs が確かめる
*/
/** エージェントの経路の接頭辞の既定。rouar.json の agent.routes の既定と同じ */
const DEFAULT_AGENT_ROUTE = "/agents";
/**
* 設定はプロセスかページの globalThis の Symbol の鍵に置く。
* Nuxt のモジュールと Vite のプラグインが入れる値を、別の写しの @rouar/sdk からも読めるようにするため
*/
const CONFIG_KEY = Symbol.for("rouar.sdk.client");
/** 会話の URL の接頭辞などを決める。Nuxt のモジュールと Vite のプラグインが呼ぶ */
function configureAgentClient(config) {
	const holder = globalThis;
	holder[CONFIG_KEY] = {
		...holder[CONFIG_KEY],
		...config
	};
}
/** 今の会話の URL の接頭辞を返す。末尾の / は除く */
function getAgentRoute() {
	return trimTrailingSlash(globalThis[CONFIG_KEY]?.agentRoute ?? "/agents") || "/agents";
}
function trimTrailingSlash(value) {
	return value.replace(/\/+$/, "");
}
/** `<接頭辞>/<エージェントの名前>/<会話の id>` を作る。名前と id は 1 つの区切りに符号化する */
function agentConversationUrl(name, conversationId, options = {}) {
	if (!name) throw new TypeError("[rouar] The agent name must not be empty.");
	if (!conversationId) throw new TypeError("[rouar] The conversation id must not be empty.");
	return `${trimTrailingSlash(options.route ?? getAgentRoute())}/${encodeURIComponent(name)}/${encodeURIComponent(conversationId)}`;
}
/** ブラウザで動いているか。SSR の間は false を返し、接続を開かせない */
function isBrowser() {
	return typeof globalThis.window !== "undefined" && typeof globalThis.location !== "undefined";
}
function sessionStorageOrUndefined() {
	try {
		return globalThis.sessionStorage;
	} catch {
		return;
	}
}
function randomId() {
	const crypto = globalThis.crypto;
	if (crypto?.randomUUID) return crypto.randomUUID();
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
/**
* 会話の id を省いたときに使う id を返す。ブラウザで乱数の id を作り、sessionStorage に覚える。
* 同じタブで読み直しても同じ会話を続け、別のタブでは別の会話にする。ブラウザの外では undefined を返す
*/
function rememberedConversationId(name, options = {}) {
	if (!isBrowser()) return void 0;
	const key = `rouar:conversation:${options.route ?? getAgentRoute()}/${name}`;
	const storage = sessionStorageOrUndefined();
	try {
		const saved = storage?.getItem(key);
		if (saved) return saved;
	} catch {}
	const id = randomId();
	try {
		storage?.setItem(key, id);
	} catch {}
	return id;
}
function isAbsoluteUrl(url) {
	try {
		new URL(url);
		return true;
	} catch {
		return false;
	}
}
/**
* 1 つの会話の AgentSession を作る。まだ観測は始めないので、start() を呼ぶ。
* 相対の URL をブラウザの外で渡したときと、URL もクライアントもないときは undefined を返す
*/
function createAgentSession(options) {
	let client = options.client;
	if (!client) {
		if (options.url === void 0) return void 0;
		if (!isBrowser() && !isAbsoluteUrl(options.url)) return void 0;
		client = createFlueClient({
			url: options.url,
			...options.fetch ? { fetch: options.fetch } : {},
			...options.headers ? { headers: options.headers } : {}
		});
	}
	return new AgentSession(client, options.live ?? "sse");
}
//#endregion
export { getAgentRoute as a, AgentSession as c, createAgentSession as i, emptyAgentSnapshot as l, agentConversationUrl as n, isBrowser as o, configureAgentClient as r, rememberedConversationId as s, DEFAULT_AGENT_ROUTE as t };

//# sourceMappingURL=client-uAhJJ7LP.mjs.map