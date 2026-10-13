import { AgentAbortResult, AgentAbortResult as AgentAbortResult$1, AgentPromptOptions, AgentSendResult, AgentSendResult as AgentSendResult$1, ConversationLiveMode, ConversationLiveMode as ConversationLiveMode$1, CreateFlueClientOptions, DeliveredAttachment, DeliveredAttachment as DeliveredAttachment$1, DeliveredDocumentAttachment, DeliveredDocumentAttachment as DeliveredDocumentAttachment$1, DeliveredImageAttachment, FlueClient, FlueClient as FlueClient$1, FlueConversationMessage, FlueConversationMessage as FlueConversationMessage$1, FlueConversationPart, FlueConversationSettlement, FlueConversationSettlement as FlueConversationSettlement$1, PromptUsage } from "@flue/sdk";
//#region src/client/agent-session.d.ts
type AgentStatus = "idle" | "connecting" | "submitted" | "streaming" | "error";
/** One locally-submitted message whose send failed, retained for retry UIs. */
interface FailedSend {
  /** Id of the retained optimistic message in `messages` (the local id). */
  id: string;
  /** The text the user tried to send. */
  message: string;
  error: Error;
}
interface AgentSnapshot {
  messages: FlueConversationMessage[];
  status: AgentStatus;
  historyReady: boolean;
  error: Error | undefined;
  /**
   * Sends whose admission receipt never reached the client. Their optimistic
   * messages remain in `messages` (keyed by `id`) so a UI can show them with
   * a retry affordance.
   */
  failedSends: FailedSend[];
  /** Terminal outcomes of the conversation's tracked submissions. */
  settlements: FlueConversationSettlement[];
}
/**
 * Options for one `sendMessage` call. Everything `client.send()` accepts
 * except the `message` itself is passed through untouched; `images` and
 * `documents` are folded into the delivered message's `attachments`.
 */
type SendMessageOptions = Omit<AgentPromptOptions, "message"> & {
  images?: DeliveredAttachment[];
  documents?: DeliveredDocumentAttachment[];
};
/** 受け付けた送信が観測に戻ってくるのを待つ時間の既定 */
declare const SEND_ECHO_TIMEOUT_MS = 5000;
type AgentSessionOptions = {
  /**
   * 受け付けた送信が観測に戻ってくるのを待つ時間。過ぎても戻らなければ観測をやり直す。
   * やり直すたびに待つ時間を倍にし、3 回まで繰り返す。0 なら待たない
   */
  echoTimeoutMs?: number;
};
/**
 * 1 つの会話の状態を、観測と楽観的な送信から組み立てる。
 * subscribe と getSnapshot は外部ストアの契約に合わせてあり、
 * 各フレームワークの包みはこの 2 つと sendMessage、refresh、abort を使う
 */
declare class AgentSession {
  readonly client: FlueClient;
  private readonly live;
  private state;
  private snapshot;
  private readonly listeners;
  private observation;
  private unsubscribeObservation;
  private active;
  private localId;
  private readonly echoTimers;
  private readonly echoTimeoutMs;
  constructor(client: FlueClient, live?: ConversationLiveMode, options?: AgentSessionOptions);
  /** 観測を始める。2 回目からは何もしない */
  start(): void;
  subscribe: (listener: () => void) => (() => void);
  getSnapshot: () => AgentSnapshot;
  /**
   * Re-runs the observation's history catch-up and resumes live updates.
   * No-op before `start()` or after `dispose()`.
   */
  refresh: () => void;
  sendMessage: (message: string, options?: SendMessageOptions) => Promise<AgentSendResult>;
  /** 会話の実行中と待ちの仕事を止める。止めた結果は観測の settlements に届く */
  abort: (options?: {
    signal?: AbortSignal;
  }) => Promise<AgentAbortResult>;
  dispose(): void;
  /**
   * 受け付けた送信が観測に戻ってくるのを見張る。
   * サーバーは受け付けた時点で利用者の発言を会話に書くので、生きている観測なら数秒で届く。
   * 届かないのは、SSE の接続が切れないまま止まっているときで、@flue/sdk はそれに 90 秒気づかない。
   * そこで待つ時間を過ぎたら観測をやり直し、履歴を読み直して新しい接続を開く
   */
  private watchEcho;
  /** 受け付けた送信が、まだ観測に戻っていないか */
  private awaitingEcho;
  private applyObservation;
  private dispatch;
}
/** 会話の URL がないときや SSR の間に返す、空の状態 */
declare const emptyAgentSnapshot: AgentSnapshot;
//#endregion
//#region src/client/stream-watch.d.ts
/**
 * SSE の応答が、切れないまま何も届かなくなったことに気づくための fetch の包み。
 * Flue の SSE は 15 秒ごとに `: heartbeat` の注釈を送るが、@durable-streams/client は注釈を読み捨てる。
 * そのため @flue/sdk の観測は、出来事のない 90 秒が過ぎるまで止まった接続に気づかない。
 * ここで本文のバイトを見張り、注釈も含めて何も来ない時間が続いたら本文を誤りで終える。
 * 誤りで終わった接続は、@flue/sdk の観測が履歴を読み直して、つなぎ直す
 */
type FetchLike = typeof fetch;
/** Flue の注釈の間隔の 3 倍。2 回続けて届かなくても、誤りにはしない */
declare const EVENT_STREAM_IDLE_TIMEOUT_MS = 45000;
/** SSE の本文が、決めた時間のあいだ 1 バイトも届かなかったときの誤り */
declare class EventStreamStalledError extends Error {
  constructor(timeoutMs: number);
}
/**
 * fetch を包み、text/event-stream の応答の本文に見張りを付ける。ほかの応答はそのまま返す。
 * timeoutMs に 0 を渡すと見張らない
 */
declare function watchEventStreams(fetchImpl: FetchLike, timeoutMs?: number): FetchLike;
//#endregion
//#region src/client.d.ts
/** エージェントの経路の接頭辞の既定。rouar.json の agent.routes の既定と同じ */
declare const DEFAULT_AGENT_ROUTE = "/agents";
type AgentClientConfig = {
  /** 会話の URL の接頭辞。rouar.json の agent.routes の最初の値 */
  agentRoute?: string;
};
/** 会話の URL の接頭辞などを決める。Nuxt のモジュールと Vite のプラグインが呼ぶ */
declare function configureAgentClient(config: AgentClientConfig): void;
/** 今の会話の URL の接頭辞を返す。末尾の / は除く */
declare function getAgentRoute(): string;
/** `<接頭辞>/<エージェントの名前>/<会話の id>` を作る。名前と id は 1 つの区切りに符号化する */
declare function agentConversationUrl(name: string, conversationId: string, options?: {
  route?: string;
}): string;
/** ブラウザで動いているか。SSR の間は false を返し、接続を開かせない */
declare function isBrowser(): boolean;
/**
 * 会話の id を省いたときに使う id を返す。ブラウザで乱数の id を作り、sessionStorage に覚える。
 * 同じタブで読み直しても同じ会話を続け、別のタブでは別の会話にする。ブラウザの外では undefined を返す
 */
declare function rememberedConversationId(name: string, options?: {
  route?: string;
}): string | undefined;
type CreateAgentSessionOptions = {
  /** 会話の URL。相対の URL はブラウザのオリジンで解決する */
  url?: string;
  /** 作ってある会話のクライアント。url より優先する */
  client?: FlueClient;
  /** 観測の方式。既定は sse */
  live?: ConversationLiveMode;
  /** 要求に使う fetch。テストや独自の転送に使う */
  fetch?: CreateFlueClientOptions["fetch"];
  /** すべての要求に足す見出し。同じオリジンの cookie は何もしなくても送られる */
  headers?: CreateFlueClientOptions["headers"];
  /**
   * SSE の接続に何も届かないまま、切れたとみなすまでの時間。既定は 45 秒。0 なら見張らない。
   * client を渡したときは使わない
   */
  streamIdleTimeoutMs?: number;
  /** 受け付けた送信が観測に戻ってくるのを待つ時間。既定は 5 秒。過ぎたら観測をやり直す */
  echoTimeoutMs?: number;
};
/**
 * 1 つの会話の AgentSession を作る。まだ観測は始めないので、start() を呼ぶ。
 * 相対の URL をブラウザの外で渡したときと、URL もクライアントもないときは undefined を返す
 */
declare function createAgentSession(options: CreateAgentSessionOptions): AgentSession | undefined;
//#endregion
export { SendMessageOptions as A, watchEventStreams as C, AgentStatus as D, AgentSnapshot as E, FailedSend as O, EventStreamStalledError as S, AgentSessionOptions as T, createAgentSession as _, CreateAgentSessionOptions as a, rememberedConversationId as b, DeliveredDocumentAttachment$1 as c, FlueConversationMessage$1 as d, FlueConversationPart as f, configureAgentClient as g, agentConversationUrl as h, ConversationLiveMode$1 as i, emptyAgentSnapshot as j, SEND_ECHO_TIMEOUT_MS as k, DeliveredImageAttachment as l, PromptUsage as m, AgentClientConfig as n, DEFAULT_AGENT_ROUTE as o, FlueConversationSettlement$1 as p, AgentSendResult$1 as r, DeliveredAttachment$1 as s, AgentAbortResult$1 as t, FlueClient$1 as u, getAgentRoute as v, AgentSession as w, EVENT_STREAM_IDLE_TIMEOUT_MS as x, isBrowser as y };
//# sourceMappingURL=client-CRs-uq3p.d.mts.map