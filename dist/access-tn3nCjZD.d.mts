import { IncomingMessage, ServerResponse } from "node:http";
//#region src/access.d.ts
/** 許可の関数が返す値。principal は呼び出し元を表す、利用者が決めた文字列 */
type BrowserPrincipal = {
  principal: string;
};
/** 許可の関数に渡す、要求の本文のほかの情報 */
type BrowserAuthorizeContext = {
  /**
   * Node の要求と応答。フレームワークのセッションの仕組みで確かめる包みのために渡す。
   * 本文は読まないこと。読むとエージェントに本文が届かない
   */
  node?: {
    req: IncomingMessage;
    res: ServerResponse;
  };
};
/**
 * 要求ごとに呼ぶ許可の関数。許すなら呼び出し元を返し、断るなら null か undefined を返す。
 * 渡す要求は本文を持たない写しで、URL と見出しは元の要求と同じ
 */
type BrowserAuthorize = (request: Request, context: BrowserAuthorizeContext) => BrowserPrincipal | null | undefined | Promise<BrowserPrincipal | null | undefined>;
type AllowBrowserAgentsOptions = {
  authorize: BrowserAuthorize;
};
/** SDK のサーバーの入口が登録する、プロセスの中の Flue の fetch を呼ぶ関数 */
type InProcessAgentFetch = (request: Request, principal: string | undefined) => Promise<Response>;
/** 呼び出し元をエージェントに渡す見出し。利用者が送った値は捨てる */
declare const PRINCIPAL_HEADER = "x-rouar-principal";
/** @internal 呼び出し元の文字列が使えるかを確かめる */
declare function isValidPrincipal(value: unknown): value is string;
/**
 * ブラウザから、同じオリジンのエージェントの会話の URL を、アクセストークンなしで呼べるようにする。
 * authorize は要求ごとに呼ばれ、許すなら呼び出し元を返す。会話は呼び出し元ごとに分かれる。
 * もう一度呼ぶと、前の関数を置き換える
 */
declare function allowBrowserAgents(options: AllowBrowserAgentsOptions): void;
/** @internal 登録された許可の関数を返す。SDK のサーバーの入口が使う */
declare function getBrowserAuthorize(): BrowserAuthorize | undefined;
/** @internal 許可の関数の登録を外す。テストで使う */
declare function resetBrowserAgentsForTests(): void;
/** @internal SDK のサーバーの入口が、Flue のアプリを読み込んだあとに登録する */
declare function registerInProcessAgentFetch(fetch: InProcessAgentFetch | undefined): void;
type AgentFetchOptions = {
  /**
   * 呼び出し元。渡すと、ブラウザから呼んだときと同じく会話を呼び出し元ごとに分け、
   * x-rouar-principal でエージェントに渡す。省くと、アクセストークンで呼んだときと同じく分けない
   */
  principal?: string;
};
/**
 * 同じプロセスの Flue のアプリを、アクセストークンなしで直接呼ぶ。
 * フロントエンドのサーバーのコードから使う。Rouar のサーバーの入口の外では使えない。
 * パスだけを渡すと、内部のホストの URL として扱う
 */
declare function agentFetch(input: Request | URL | string, options?: AgentFetchOptions): Promise<Response>;
//#endregion
export { BrowserPrincipal as a, agentFetch as c, isValidPrincipal as d, registerInProcessAgentFetch as f, BrowserAuthorizeContext as i, allowBrowserAgents as l, AllowBrowserAgentsOptions as n, InProcessAgentFetch as o, resetBrowserAgentsForTests as p, BrowserAuthorize as r, PRINCIPAL_HEADER as s, AgentFetchOptions as t, getBrowserAuthorize as u };
//# sourceMappingURL=access-tn3nCjZD.d.mts.map