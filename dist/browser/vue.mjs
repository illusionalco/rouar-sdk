import { i as createAgentSession, l as emptyAgentSnapshot, n as agentConversationUrl, o as isBrowser, s as rememberedConversationId } from "./client-uAhJJ7LP.mjs";
import { getCurrentInstance, getCurrentScope, onMounted, onScopeDispose, shallowRef, toValue, watch } from "vue";
//#region src/vue.ts
/**
* Vue から 1 つのエージェントの会話を使う composable。
* 状態は shallowRef に入れ、スコープが終わると観測を止める。
* SSR の間は接続を開かず、ブラウザでマウントしてから動き出す
*/
function notOpen() {
	return /* @__PURE__ */ new Error("[rouar] useAgent() has no open conversation. It opens in the browser after the component is mounted.");
}
/**
* エージェントの会話を観測し、送れるようにする。
* 返す値は @flue/react の useFlueAgent と同じ形に abort と url を足したもの。
* 項目は getter なので、分割代入せずに `agent.messages` の形で読む
*/
function useAgent(name, options = {}) {
	const snapshot = shallowRef(emptyAgentSnapshot);
	const currentUrl = shallowRef(void 0);
	let session;
	let unsubscribe;
	let stopWatch;
	let disposed = false;
	function close() {
		unsubscribe?.();
		unsubscribe = void 0;
		session?.dispose();
		session = void 0;
		currentUrl.value = void 0;
		snapshot.value = emptyAgentSnapshot;
	}
	function open(url) {
		close();
		const next = createAgentSession({
			...url !== void 0 ? { url } : {},
			...options.client ? { client: options.client } : {},
			...options.live ? { live: options.live } : {},
			...options.fetch ? { fetch: options.fetch } : {},
			...options.headers ? { headers: options.headers } : {}
		});
		if (!next) return;
		session = next;
		currentUrl.value = next.client.url;
		unsubscribe = next.subscribe(() => {
			snapshot.value = next.getSnapshot();
		});
		next.start();
		snapshot.value = next.getSnapshot();
	}
	function resolveUrl() {
		const explicit = toValue(options.url);
		if (explicit) return explicit;
		const agentName = toValue(name);
		const route = options.route;
		const conversationId = toValue(options.conversationId) || rememberedConversationId(agentName, route ? { route } : {});
		if (!conversationId) return void 0;
		return agentConversationUrl(agentName, conversationId, route ? { route } : {});
	}
	function begin() {
		if (disposed) return;
		if (options.client) {
			open(void 0);
			return;
		}
		stopWatch = watch(resolveUrl, (url) => open(url), { immediate: true });
	}
	if (isBrowser()) {
		const instance = getCurrentInstance();
		if (instance && !instance.isMounted) onMounted(begin);
		else begin();
	}
	if (getCurrentScope()) onScopeDispose(() => {
		disposed = true;
		stopWatch?.();
		close();
	});
	return {
		get messages() {
			return snapshot.value.messages;
		},
		get status() {
			return snapshot.value.status;
		},
		get historyReady() {
			return snapshot.value.historyReady;
		},
		get error() {
			return snapshot.value.error;
		},
		get failedSends() {
			return snapshot.value.failedSends;
		},
		get settlements() {
			return snapshot.value.settlements;
		},
		get url() {
			return currentUrl.value;
		},
		sendMessage(message, sendOptions) {
			return session ? session.sendMessage(message, sendOptions) : Promise.reject(notOpen());
		},
		refresh() {
			session?.refresh();
		},
		abort(abortOptions) {
			return session ? session.abort(abortOptions) : Promise.reject(notOpen());
		}
	};
}
//#endregion
export { useAgent };

//# sourceMappingURL=vue.mjs.map