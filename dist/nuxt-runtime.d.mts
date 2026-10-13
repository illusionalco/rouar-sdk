import { a as BrowserPrincipal, r as BrowserAuthorize } from "./access-tn3nCjZD.mjs";
import { IncomingMessage, ServerResponse } from "node:http";
import { H3Event } from "h3";
//#region src/nuxt-runtime.d.ts
/** Nuxt の server/ に書く許可の関数。許すなら呼び出し元を返し、断るなら null を返す */
export type RouarAuthorize = (event: H3Event) => BrowserPrincipal | null | undefined | Promise<BrowserPrincipal | null | undefined>;
/** 許可の関数に型を付ける。中身はそのまま返す */
export declare function defineRouarAuthorize(authorize: RouarAuthorize): RouarAuthorize;
type CreateEvent = (req: IncomingMessage, res: ServerResponse) => H3Event;
/**
 * h3 の event を受け取る許可の関数を、SDK の許可の関数に包む。
 * SDK のサーバーの入口は context.node に Node の要求と応答を入れて呼ぶ
 */
export declare function toBrowserAuthorize(authorize: RouarAuthorize, createEvent: CreateEvent): BrowserAuthorize;
/** Nitro の起動のときに、許可の関数を SDK の登録先に入れる */
export declare function registerNuxtAuthorize(authorize: RouarAuthorize, createEvent: CreateEvent): void;
type ProxyRequest = (event: H3Event, target: string, options: {
  headers: Record<string, string>;
}) => Promise<unknown>;
export type DevAgentProxyOptions = {
  /** 手元の Flue の開発のサーバーのオリジン */
  target: string;
  authorize?: RouarAuthorize;
  proxyRequest: ProxyRequest;
};
/**
 * 開発のときに、エージェントの経路への要求を手元の Flue の開発のサーバーへ中継する。
 * 許可の関数があれば中継の前に呼び、呼び出し元を x-rouar-principal で渡す。
 * 会話の id の書き換えと CSRF の確かめは、デプロイしたサーバーの入口だけが行う
 */
export declare function handleDevAgentRequest(event: H3Event, options: DevAgentProxyOptions): Promise<unknown>;
//#endregion
//# sourceMappingURL=nuxt-runtime.d.mts.map