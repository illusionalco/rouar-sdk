import { A as SendMessageOptions, D as AgentStatus, E as AgentSnapshot, O as FailedSend, a as CreateAgentSessionOptions, d as FlueConversationMessage, f as FlueConversationPart, i as ConversationLiveMode, r as AgentSendResult, t as AgentAbortResult, u as FlueClient } from "./client-CRs-uq3p.mjs";
import { MaybeRefOrGetter } from "vue";
//#region src/vue.d.ts
export type UseAgentOptions = {
  /**
   * 会話の id。ref か getter を渡すと、変わったときに会話を切り替える。
   * 省くと、ブラウザで乱数の id を作り、sessionStorage に覚える
   */
  conversationId?: MaybeRefOrGetter<string | null | undefined>;
  /** 会話の URL の接頭辞。既定は Nuxt のモジュールか Vite のプラグインが rouar.json から入れた値 */
  route?: string;
  /** 会話の URL をそのまま渡す。name と conversationId より優先する */
  url?: MaybeRefOrGetter<string | null | undefined>;
  /** 作ってある会話のクライアント。url より優先する */
  client?: FlueClient;
  /** 観測の方式。既定は sse */
  live?: ConversationLiveMode;
  fetch?: CreateAgentSessionOptions["fetch"];
  headers?: CreateAgentSessionOptions["headers"];
};
export type UseAgentResult = AgentSnapshot & {
  /** 今の会話の URL。SSR の間とマウントの前は undefined */
  readonly url: string | undefined;
  sendMessage(message: string, options?: SendMessageOptions): Promise<AgentSendResult>;
  /** 履歴を読み直し、観測をやり直す */
  refresh(): void;
  /** 会話の実行中と待ちの仕事を止める */
  abort(options?: {
    signal?: AbortSignal;
  }): Promise<AgentAbortResult>;
};
/**
 * エージェントの会話を観測し、送れるようにする。
 * 返す値は @flue/react の useFlueAgent と同じ形に abort と url を足したもの。
 * 項目は getter なので、分割代入せずに `agent.messages` の形で読む
 */
export declare function useAgent(name: MaybeRefOrGetter<string>, options?: UseAgentOptions): UseAgentResult;
//#endregion
export type { AgentSendResult, AgentSnapshot, AgentStatus, FailedSend, FlueConversationMessage, FlueConversationPart, SendMessageOptions };
//# sourceMappingURL=vue.d.mts.map