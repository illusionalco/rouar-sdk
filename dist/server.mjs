import { a as isValidPrincipal, i as getBrowserAuthorize, o as registerInProcessAgentFetch, t as PRINCIPAL_HEADER } from "./access-C8tGVOdd.mjs";
import { n as registerRouarProvider } from "./providers-CCvWwUe4.mjs";
import { t as getUnsettledSubmissionsProbe } from "./persistence-probe-Bj7JZ0pr.mjs";
import { t as DEFAULT_AGENT_ROUTES } from "./config-Dx9yx3Hq.mjs";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { pino } from "pino";
import pg from "pg";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
//#region ../../packages/env/src/url.ts
const LOOPBACK_HOSTS = /* @__PURE__ */ new Set([
	"localhost",
	"127.0.0.1",
	"[::1]"
]);
/**
* https の URL。手元で動かすための loopback だけは http を許す。
* ROUAR_TOKEN のような秘密を送る先や、デプロイした環境に入れる URL に使う。
*/
const secureUrl = z.url().refine((value) => {
	const { protocol, hostname } = new URL(value);
	return protocol === "https:" || protocol === "http:" && LOOPBACK_HOSTS.has(hostname);
}, { message: "must use https, except for localhost" });
//#endregion
//#region ../../packages/env/src/sdk.ts
/** カンマ区切りの値を、空の要素を除いた配列にする */
const commaList = z.string().optional().transform((value) => (value ?? "").split(",").map((item) => item.trim()).filter((item) => item.length > 0));
/** @rouar/sdk のサーバーエントリが実行時に読む環境変数 */
function loadSdkServerEnv(runtimeEnv = process.env) {
	return createEnv({
		server: {
			PORT: z.coerce.number().int().positive().default(8080),
			LOG_LEVEL: z.enum([
				"fatal",
				"error",
				"warn",
				"info",
				"debug",
				"trace"
			]).default("info"),
			ROUAR_APP_ENTRY: z.string().default("dist/app.mjs"),
			DATABASE_URL: z.string().optional(),
			ROUAR_GATEWAY_URL: secureUrl.optional(),
			ROUAR_API_URL: secureUrl.optional(),
			ROUAR_VM_URL: secureUrl.optional(),
			ROUAR_TOKEN: z.string().optional(),
			ROUAR_MODELS: z.string().optional(),
			ROUAR_ACCESS_TOKEN_HASHES: commaList,
			ROUAR_PUBLIC: z.string().optional().transform((value) => value?.trim().toLowerCase() === "true"),
			ROUAR_PUBLIC_PATHS: commaList,
			ROUAR_EDGE_TOKEN: z.string().optional(),
			ROUAR_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(0).default(600),
			ROUAR_ENVIRONMENT_ID: z.string().optional(),
			ROUAR_BROWSER_SENDS_PER_MINUTE: z.coerce.number().int().positive().default(10),
			ROUAR_BROWSER_SENDS_PER_DAY: z.coerce.number().int().positive().default(200),
			ROUAR_BROWSER_ENVIRONMENT_SENDS_PER_DAY: z.coerce.number().int().positive().default(5e3),
			ROUAR_ALWAYS_ON: z.string().optional().transform((value) => value?.trim().toLowerCase() === "true")
		},
		runtimeEnv,
		emptyStringAsUndefined: true
	});
}
//#endregion
//#region ../../packages/log/src/index.ts
/** 秘密の値をログに残さないために、既定で伏せるキー */
const REDACT_PATHS = [
	"password",
	"token",
	"secret",
	"authorization",
	"*.password",
	"*.token",
	"*.secret",
	"*.authorization",
	"req.headers.authorization",
	"req.headers.cookie"
];
/** pino のロガーを作る。出力は JSON の 1 行で、集約先での検索を前提にする */
function createLogger({ name, level }) {
	return pino({
		name,
		level: level ?? "info",
		redact: {
			paths: REDACT_PATHS,
			censor: "[redacted]"
		}
	});
}
//#endregion
//#region ../../packages/error/src/index.ts
const PROBLEM_CONTENT_TYPE = "application/problem+json; charset=utf-8";
const PROBLEM_TYPE_BASE = "https://rouar.com/problems/";
/** アプリの中で投げ、境界で Problem Details に変換するエラー */
var AppError = class extends Error {
	status;
	code;
	detail;
	constructor(status, code, title, options) {
		super(title, { cause: options?.cause });
		this.name = "AppError";
		this.status = status;
		this.code = code;
		this.detail = options?.detail;
	}
};
/** エラーを Problem Details に変換する。AppError 以外は中身を出さずに 500 にする */
function toProblem(error, instance) {
	if (error instanceof AppError) return {
		type: `${PROBLEM_TYPE_BASE}${error.code}`,
		title: error.message,
		status: error.status,
		...error.detail === void 0 ? {} : { detail: error.detail },
		...instance === void 0 ? {} : { instance }
	};
	return {
		type: `${PROBLEM_TYPE_BASE}internal`,
		title: "Internal server error",
		status: 500,
		...instance === void 0 ? {} : { instance }
	};
}
//#endregion
//#region src/server/edge.ts
/**
* 入口が付けるトークンのヘッダー。apps/edge の EDGE_TOKEN_HEADER と同じ名前にする。
* 値は HMAC-SHA256(EDGE_TENANT_KEY, <ラベル>) の 16 進表記で、ワーカーが同じ値を ROUAR_EDGE_TOKEN に入れる
*/
const EDGE_TOKEN_HEADER = "x-rouar-edge-token";
function sha256$1(value) {
	return createHash("sha256").update(value, "utf8").digest();
}
/**
* 入口を通った要求かを判定する関数を作る。
* トークンがなければ、すべての要求を通す。トークンを入れる前にデプロイしたアプリを壊さないため。
* 長さの違いで比較の時間が変わらないよう、両方のハッシュを比べる
*/
function createEdgeCheck(token) {
	const matches = createEdgeTokenMatcher(token);
	return (request) => matches(request.headers.get(EDGE_TOKEN_HEADER));
}
/** 入口のトークンのヘッダーの値を比べる関数を作る。Fetch の要求と Node の要求の両方で使う */
function createEdgeTokenMatcher(token) {
	const expected = token?.trim();
	if (!expected) return () => true;
	const expectedDigest = sha256$1(expected);
	return (received) => {
		if (received === null || received === void 0) return false;
		return timingSafeEqual(sha256$1(received.trim()), expectedDigest);
	};
}
/** 入口を通っていない要求への応答。アプリの有無も実行基盤の名前も示さない */
function edgeNotFound() {
	return new Response("not found\n", {
		status: 404,
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "no-store"
		}
	});
}
/** 利用者のコードに渡す前に、入口のトークンを外す。ヘッダーを変えられない要求は作り直す */
function withoutEdgeToken(request) {
	if (!request.headers.has("x-rouar-edge-token")) return request;
	try {
		request.headers.delete(EDGE_TOKEN_HEADER);
		if (!request.headers.has("x-rouar-edge-token")) return request;
	} catch {}
	const headers = new Headers(request.headers);
	headers.delete(EDGE_TOKEN_HEADER);
	return new Request(request, { headers });
}
/**
* 入口が付ける、利用者が見たホストと scheme のヘッダー。
* apps/edge の forwardRequestHeaders が、利用者の送った値を捨ててから付け直す
*/
const FORWARDED_HOST_HEADER = "x-forwarded-host";
const FORWARDED_PROTO_HEADER = "x-forwarded-proto";
/** 点で区切った DNS のラベルだけを受ける。ポート、パス、利用者情報、複数の値を含む値は通さない */
const FORWARDED_HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const FORWARDED_PROTOS = /* @__PURE__ */ new Set(["https", "http"]);
/** 転送のヘッダーの値を確かめ、小文字にしたホストと scheme を返す。形式が違えば undefined を返す */
function forwardedOrigin(hostHeader, protoHeader) {
	const host = hostHeader?.trim().toLowerCase();
	const proto = protoHeader?.trim().toLowerCase();
	if (!host || !proto) return void 0;
	if (!FORWARDED_HOST.test(host) || !FORWARDED_PROTOS.has(proto)) return;
	return {
		host,
		proto
	};
}
/**
* 入口のヘッダーから、利用者が送った URL を組み立てる。パスとクエリは要求のものを使う。
* ヘッダーがないか、形式が違えば undefined を返す
*/
function forwardedUrl(request) {
	const forwarded = forwardedOrigin(request.headers.get(FORWARDED_HOST_HEADER), request.headers.get(FORWARDED_PROTO_HEADER));
	if (!forwarded) return void 0;
	const { host, proto } = forwarded;
	const url = new URL(request.url);
	url.protocol = `${proto}:`;
	url.hostname = host;
	url.port = "";
	url.username = "";
	url.password = "";
	if (url.hostname !== host || url.protocol !== `${proto}:`) return void 0;
	return url;
}
/**
* 要求の URL を、入口のヘッダーが示す利用者側の URL に置き換える。
* Flue は要求の URL から streamUrl と Location を作るので、置き換えないと実行基盤のホストが利用者に見える。
* 入口のトークンを確かめた要求にだけ使う
*/
function withForwardedUrl(request) {
	const url = forwardedUrl(request);
	if (!url || url.href === request.url) return request;
	return new Request(url, request);
}
/**
* 入口を通った要求を、利用者のコードに渡す形にする関数を作る。入口を通っていなければ undefined を返す。
* トークンがあれば、トークンを確かめた要求でだけ、転送のヘッダーから URL を組み立て直す。
* トークンがなければ、だれでも転送のヘッダーを付けられるので、URL は変えない
*/
function createEdgeAdmission(token) {
	const check = createEdgeCheck(token);
	const verified = Boolean(token?.trim());
	return (request) => {
		if (!check(request)) return void 0;
		const stripped = withoutEdgeToken(request);
		return verified ? withForwardedUrl(stripped) : stripped;
	};
}
function singleHeader(value) {
	return Array.isArray(value) ? value.join(", ") : value;
}
/**
* createEdgeAdmission の Node の要求の版。フロントエンドの listener に渡す前に使う。
* 入口を通っていなければ false を返す。通っていれば、要求のヘッダーをその場で書き換えて true を返す。
* トークンのヘッダーを外し、トークンがあれば Host を転送のヘッダーのホストに置き換える。
* Nitro は Host と X-Forwarded-Proto から要求の URL を組み立てるので、Flue の streamUrl と同じく利用者側の URL になる
*/
function createNodeEdgeAdmission(token) {
	const matches = createEdgeTokenMatcher(token);
	const verified = Boolean(token?.trim());
	return (request) => {
		if (!matches(singleHeader(request.headers["x-rouar-edge-token"]))) return false;
		const forwarded = verified ? forwardedOrigin(singleHeader(request.headers[FORWARDED_HOST_HEADER]), singleHeader(request.headers[FORWARDED_PROTO_HEADER])) : void 0;
		delete request.headers[EDGE_TOKEN_HEADER];
		if (forwarded) request.headers.host = forwarded.host;
		const raw = [];
		for (let index = 0; index + 1 < request.rawHeaders.length; index += 2) {
			const name = request.rawHeaders[index];
			const value = request.rawHeaders[index + 1];
			const lower = name.toLowerCase();
			if (lower === "x-rouar-edge-token") continue;
			if (forwarded && lower === "host") continue;
			raw.push(name, value);
		}
		if (forwarded) raw.push("Host", forwarded.host);
		request.rawHeaders.splice(0, request.rawHeaders.length, ...raw);
		return true;
	};
}
const SHA256_HEX = /^[0-9a-f]{64}$/;
function sha256(value) {
	return createHash("sha256").update(value, "utf8").digest();
}
/** 16 進表記のハッシュを Buffer にする。形式が違うものは捨てる */
function parseTokenHashes(hashes) {
	return hashes.map((hash) => hash.trim().toLowerCase()).filter((hash) => SHA256_HEX.test(hash)).map((hash) => Buffer.from(hash, "hex"));
}
/**
* パスが接頭辞に一致するかを、区切りの / 単位で判定する。
* `/channels` は `/channels` と `/channels/slack` に一致し、`/channelsx` には一致しない。
*/
function matchesPathPrefix(pathname, prefix) {
	const normalized = prefix.startsWith("/") ? prefix : `/${prefix}`;
	if (normalized === "/") return true;
	const base = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
	return pathname === base || pathname.startsWith(`${base}/`);
}
function bearerToken(request) {
	const header = request.headers.get("authorization");
	if (!header) return void 0;
	return /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header)?.[1];
}
/** トークンのハッシュをすべての登録値と比べる。途中で打ち切らず、比較の時間を一定にする */
function tokenMatches(token, hashes) {
	const digest = sha256(token);
	let matched = false;
	for (const hash of hashes) if (timingSafeEqual(digest, hash)) matched = true;
	return matched;
}
function unauthorized(request, detail) {
	const problem = toProblem(new AppError(401, "unauthorized", "Unauthorized", { detail }), new URL(request.url).pathname);
	return new Response(JSON.stringify(problem), {
		status: 401,
		headers: {
			"content-type": PROBLEM_CONTENT_TYPE,
			"www-authenticate": "Bearer realm=\"rouar\"",
			"cache-control": "no-store"
		}
	});
}
/**
* アクセスの検査を作る。通すときは undefined を、拒むときは 401 の応答を返す。
* ハッシュが 1 つも登録されていなければ、公開パス以外をすべて拒む。
*/
function createAccessGate(options) {
	const hashes = parseTokenHashes(options.tokenHashes);
	const publicPaths = [...options.publicPaths];
	return (request) => {
		if (options.public) return void 0;
		const { pathname } = new URL(request.url);
		if (publicPaths.some((prefix) => matchesPathPrefix(pathname, prefix))) return;
		const token = bearerToken(request);
		if (token === void 0) return unauthorized(request, "Send the deployment access token as Authorization: Bearer <token>.");
		if (!tokenMatches(token, hashes)) return unauthorized(request, "The access token is not valid.");
	};
}
/** ヘルスチェックの応答。draft-inadarei-api-health-check の形にする */
function healthResponse(method) {
	const body = method === "HEAD" ? null : JSON.stringify({ status: "pass" });
	return new Response(body, {
		status: 200,
		headers: {
			"content-type": "application/health+json; charset=utf-8",
			"cache-control": "no-store"
		}
	});
}
/**
* Flue アプリの fetch に、ヘルスチェック、入口の検査、アクセスの検査をかぶせる。
* ヘルスチェックは実行基盤が入口を通さずに確かめるので、入口の検査より前に答える。
* admitFromEdge が undefined を返した要求は入口を通っていないので 404 にし、
* 返した要求を先へ渡す。createEdgeAdmission がトークンのヘッダーを外し、URL を利用者側のものに直す。
* アクセスの検査で断った要求は、browser があれば許可の関数で確かめ直す。
* onAdmitted は検査を通った要求でだけ呼ぶ。ヘルスチェックと拒んだ要求では呼ばない
*/
function createRouarFetch(appFetch, gate, onAdmitted, admitFromEdge = withoutEdgeToken, browser) {
	return async (incoming, bindings) => {
		const { pathname } = new URL(incoming.url);
		if (pathname === "/_rouar/health" && (incoming.method === "GET" || incoming.method === "HEAD")) return healthResponse(incoming.method);
		const admitted = admitFromEdge(incoming);
		if (!admitted) return edgeNotFound();
		const request = withoutPrincipalHeader(admitted);
		const denied = gate(request);
		if (!denied) {
			onAdmitted?.(request, bindings);
			return appFetch(request, bindings);
		}
		if (!browser) return denied;
		const browserAdmission = await browser.admit(request, nodeContext(bindings));
		if (browserAdmission === void 0) return denied;
		if (browserAdmission instanceof Response) return browserAdmission;
		onAdmitted?.(browserAdmission.request, bindings);
		return browserAdmission.finish(await appFetch(browserAdmission.request, bindings));
	};
}
/** @hono/node-server が渡す Node の要求と応答を、許可の関数に渡す形にする */
function nodeContext(bindings) {
	const node = bindings;
	if (!node?.incoming || !node.outgoing) return {};
	return { node: {
		req: node.incoming,
		res: node.outgoing
	} };
}
//#endregion
//#region src/server/browser.ts
/** 書き換えたあとの会話の id の接頭辞の形。rv_ と 16 桁の 16 進と _ */
const NAMESPACED_ID = /^rv_([0-9a-f]{16})_/;
/** 鍵を導くときの文脈。値を変えると、すべての会話の id が変わる */
const TAG_KEY_CONTEXT = "rouar browser conversation tag v1";
const MINUTE_MS = 6e4;
const DAY_MS = 864e5;
function problem(request, status, code, title, detail, headers = {}) {
	const body = toProblem(new AppError(status, code, title, detail === void 0 ? {} : { detail }), new URL(request.url).pathname);
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": PROBLEM_CONTENT_TYPE,
			"cache-control": "no-store",
			...headers
		}
	});
}
/** 要求から、利用者が送った呼び出し元の見出しを外す。ヘッダーを変えられない要求は作り直す */
function withoutPrincipalHeader(request) {
	if (!request.headers.has("x-rouar-principal")) return request;
	try {
		request.headers.delete(PRINCIPAL_HEADER);
		if (!request.headers.has("x-rouar-principal")) return request;
	} catch {}
	const next = new Request(request);
	next.headers.delete(PRINCIPAL_HEADER);
	return next;
}
/** パスの区切りに使えない値。符号化した / と \ と、. と .. を断り、ルーターとの解釈の違いをなくす */
function unsafeSegment(segment) {
	return segment === "" || segment === "." || segment === ".." || /%2f|%5c/i.test(segment);
}
/**
* パスが Flue の会話の URL かを確かめて分ける。
* <接頭辞>/<mount の名前>/<会話の id> と、そのあとの /abort と /attachments/<id> だけを会話の URL とみなす
*/
function parseConversationPath(pathname, agentRoutes) {
	for (const route of agentRoutes) {
		if (!matchesPathPrefix(pathname, route)) continue;
		const normalized = route.startsWith("/") ? route : `/${route}`;
		const prefix = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
		const [, name, id, ...tail] = pathname.slice(prefix.length).split("/");
		if (name === void 0 || id === void 0) continue;
		if (unsafeSegment(name) || unsafeSegment(id)) continue;
		const tailPath = tail.length === 0 ? "" : `/${tail.join("/")}`;
		if (!(tail.length === 0 || tail.length === 1 && tail[0] === "abort" || tail.length === 2 && tail[0] === "attachments" && !unsafeSegment(tail[1]))) continue;
		return {
			base: `${prefix}/${name}`,
			id,
			tail: tailPath
		};
	}
}
/**
* 呼び出し元から会話の id の tag を作る関数を作る。
* 鍵の材料は、環境ごとに変わらない値を使う。デプロイのたびに変わる値を使うと、前の会話を読めなくなる
*/
function createConversationTagger(keyMaterial) {
	const key = createHmac("sha256", keyMaterial).update(TAG_KEY_CONTEXT).digest();
	return (principal) => createHmac("sha256", key).update(principal, "utf8").digest("hex").slice(0, 16);
}
/**
* 会話の id を呼び出し元の tag で分けた要求を作る。別の呼び出し元の id なら 404 の応答を返す。
* すでに同じ tag の id なら書き換えない。応答の streamUrl に入った id でそのまま呼べるようにするため
*/
function namespaceConversation(request, conversation, tag, principal) {
	const owned = NAMESPACED_ID.exec(conversation.id);
	if (owned && owned[1] !== tag) return problem(request, 404, "not_found", "Not Found");
	const url = new URL(request.url);
	if (!owned) url.pathname = `${conversation.base}/rv_${tag}_${conversation.id}${conversation.tail}`;
	const next = url.href === request.url ? new Request(request) : new Request(url, request);
	next.headers.set(PRINCIPAL_HEADER, principal);
	return next;
}
/** 状態を変える要求か。GET と HEAD と OPTIONS のほかを CSRF の確かめの対象にする */
function changesState(method) {
	return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}
/**
* ほかのオリジンからの送信を断る。Sec-Fetch-Site があれば same-origin だけを、
* なければ Origin が要求の URL のオリジンと同じものだけを受ける。どちらもなければ断る。
* 要求の URL は、入口のトークンを確かめた要求なら X-Forwarded-Host から組み立て直してある
*/
function checkSameOrigin(request) {
	if (!changesState(request.method)) return void 0;
	const site = request.headers.get("sec-fetch-site");
	if (site !== null) {
		if (site.trim().toLowerCase() === "same-origin") return void 0;
		return forbiddenOrigin(request);
	}
	const origin = request.headers.get("origin");
	if (origin !== null && origin !== "null") try {
		if (new URL(origin).origin === new URL(request.url).origin) return;
	} catch {}
	return forbiddenOrigin(request);
}
function forbiddenOrigin(request) {
	return problem(request, 403, "cross_origin_request", "Forbidden", "Browser requests to the agent must come from the same origin.");
}
/** 本文を持つ要求か。Content-Length が 0 でなく、または Transfer-Encoding があれば持つとみなす */
function hasBody(request) {
	const length = request.headers.get("content-length");
	if (request.headers.has("transfer-encoding")) return true;
	if (length !== null) return length.trim() !== "0";
	return request.body !== null;
}
/**
* POST の本文を application/json に限る。form から送れる形を断るため。
* 本文のない POST は、会話を止める /abort のために受ける
*/
function checkJsonBody(request) {
	if (request.method !== "POST") return void 0;
	const type = request.headers.get("content-type");
	if (type?.split(";")[0]?.trim().toLowerCase() === "application/json") return void 0;
	if (type === null && !hasBody(request)) return void 0;
	return problem(request, 415, "unsupported_media_type", "Unsupported Media Type", "Send the request body as application/json.");
}
/**
* 呼び出し元ごとと環境の全体の送信を、固定の窓で数える。マシンが止まると数はなくなる。
* 超えたら、次の窓までの秒数を返す
*/
function createSendLimiter(limits, now = Date.now) {
	const minutes = /* @__PURE__ */ new Map();
	const days = /* @__PURE__ */ new Map();
	let environment = {
		window: -1,
		count: 0
	};
	let sweptMinute = -1;
	const bump = (map, key, window) => {
		const current = map.get(key);
		if (current && current.window === window) return current;
		const fresh = {
			window,
			count: 0
		};
		map.set(key, fresh);
		return fresh;
	};
	return (principal) => {
		const at = now();
		const minute = Math.floor(at / MINUTE_MS);
		const day = Math.floor(at / DAY_MS);
		if (sweptMinute !== minute) {
			sweptMinute = minute;
			for (const [key, counter] of minutes) if (counter.window !== minute) minutes.delete(key);
			for (const [key, counter] of days) if (counter.window !== day) days.delete(key);
		}
		if (environment.window !== day) environment = {
			window: day,
			count: 0
		};
		const untilNextMinute = Math.ceil(((minute + 1) * MINUTE_MS - at) / 1e3);
		const untilNextDay = Math.ceil(((day + 1) * DAY_MS - at) / 1e3);
		const perMinute = bump(minutes, principal, minute);
		const perDay = bump(days, principal, day);
		if (environment.count >= limits.environmentPerDay) return { retryAfterSeconds: untilNextDay };
		if (perDay.count >= limits.perDay) return { retryAfterSeconds: untilNextDay };
		if (perMinute.count >= limits.perMinute) return { retryAfterSeconds: untilNextMinute };
		perMinute.count += 1;
		perDay.count += 1;
		environment.count += 1;
	};
}
/** SSE の応答をキャッシュさせない */
function noStoreStream(response) {
	if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/event-stream")) return response;
	const next = new Response(response.body, response);
	next.headers.set("cache-control", "no-store");
	return next;
}
/** 本文を持たない写し。許可の関数に本文を読ませない */
function withoutBody(request) {
	return new Request(request.url, {
		method: request.method,
		headers: request.headers,
		signal: request.signal
	});
}
function createBrowserAccess(options) {
	const tagOf = createConversationTagger(options.tagKey);
	const limit = createSendLimiter(options.limits, options.now);
	const readAuthorize = options.authorize ?? getBrowserAuthorize;
	return {
		async admit(request, context) {
			const authorize = readAuthorize();
			if (!authorize) return void 0;
			const conversation = parseConversationPath(new URL(request.url).pathname, options.agentRoutes);
			if (!conversation) return void 0;
			const crossOrigin = checkSameOrigin(request);
			if (crossOrigin) return crossOrigin;
			const notJson = checkJsonBody(request);
			if (notJson) return notJson;
			let result;
			try {
				result = await authorize(withoutBody(request), context);
			} catch (error) {
				options.logger.error({ err: error }, "the browser authorize function threw");
				return problem(request, 500, "internal", "Internal server error");
			}
			if (result === null || result === void 0) return void 0;
			if (!isValidPrincipal(result.principal)) {
				options.logger.error("the browser authorize function returned an invalid principal; use 1 to 256 printable ASCII characters");
				return problem(request, 500, "internal", "Internal server error");
			}
			const principal = result.principal;
			const scoped = namespaceConversation(request, conversation, tagOf(principal), principal);
			if (scoped instanceof Response) return scoped;
			if (request.method === "POST" && conversation.tail === "") {
				const limited = limit(principal);
				if (limited) return problem(request, 429, "too_many_requests", "Too Many Requests", "Too many messages were sent from this browser. Try again later.", { "retry-after": String(limited.retryAfterSeconds) });
			}
			return {
				request: scoped,
				finish: noStoreStream
			};
		},
		scope(request, principal) {
			const stripped = withoutPrincipalHeader(request);
			if (principal === void 0) return stripped;
			if (!isValidPrincipal(principal)) throw new TypeError("[rouar] agentFetch() principal must be 1 to 256 printable ASCII characters.");
			const conversation = parseConversationPath(new URL(stripped.url).pathname, options.agentRoutes);
			if (!conversation) {
				const next = new Request(stripped);
				next.headers.set(PRINCIPAL_HEADER, principal);
				return next;
			}
			return namespaceConversation(stripped, conversation, tagOf(principal), principal);
		}
	};
}
/**
* 会話の id の tag を作る鍵の材料を選ぶ。デプロイのたびに変わる ROUAR_TOKEN は使わない。
* 入口のトークンは環境のラベルから導かれ、変わらず、秘密なので先に使う。
* なければ環境の id を使い、それもなければプロセスごとの乱数にする
*/
function selectTagKey(env, logger) {
	const edge = env.ROUAR_EDGE_TOKEN?.trim();
	if (edge) return `edge:${edge}`;
	const environment = env.ROUAR_ENVIRONMENT_ID?.trim();
	if (environment) return `environment:${environment}`;
	logger.debug("no stable key for browser conversation ids; browser conversations are kept only until the server restarts");
	return `process:${randomBytes(32).toString("hex")}`;
}
//#endregion
//#region src/server/static.ts
/** 名前にハッシュの入ったファイルに付ける見出し。入口がこの応答だけをキャッシュする */
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
/** HTML とハッシュのないファイルに付ける見出し。毎回確かめさせ、デプロイの切り替えをすぐ届ける */
const REVALIDATE_CACHE_CONTROL = "no-cache";
const CONTENT_TYPES = {
	".html": "text/html; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".xml": "application/xml; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".wasm": "application/wasm",
	".pdf": "application/pdf",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".mp3": "audio/mpeg"
};
/** 圧縮済みのファイルの拡張子。良いものから順に選ぶ */
const ENCODINGS = [{
	name: "br",
	suffix: ".br"
}, {
	name: "gzip",
	suffix: ".gz"
}];
/** SPA の戻り先。Nuxt の nuxt generate は 200.html を、Vite は index.html を出す */
const SPA_FALLBACKS = ["200.html", "index.html"];
function contentType(path) {
	return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}
/** Accept-Encoding が encoding を受け付けるか。q=0 は断りとみなす */
function acceptsEncoding(header, encoding) {
	if (!header) return false;
	for (const part of header.split(",")) {
		const [name, ...params] = part.trim().toLowerCase().split(";");
		if (name?.trim() !== encoding) continue;
		const q = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
		return q === void 0 || Number(q.slice(2)) > 0;
	}
	return false;
}
async function fileStats(path) {
	try {
		const stats = await stat(path);
		return stats.isFile() ? stats : void 0;
	} catch {
		return;
	}
}
/**
* 要求のパスを、root の中のファイルのパスにする。root の外を指すもの、隠しファイル、読めない符号は undefined を返す。
* `/.well-known/` だけは隠しファイルでも配る
*/
function resolveStaticPath(root, rawPath) {
	let pathname;
	try {
		pathname = decodeURIComponent(rawPath);
	} catch {
		return;
	}
	if (pathname.includes("\0") || pathname.includes("\\")) return void 0;
	const segments = pathname.split("/").filter((segment) => segment !== "");
	for (const [index, segment] of segments.entries()) {
		if (segment === "." || segment === "..") return void 0;
		if (segment.startsWith(".") && !(index === 0 && segment === ".well-known")) return;
	}
	const absolute = resolve(root, ...segments);
	if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) return;
	return absolute;
}
/** 要求の行からパスを取り出す。クエリを除き、復号はしない */
function requestPath(request) {
	const raw = request.url ?? "/";
	if (raw.startsWith("/")) return raw.split("?")[0] ?? "/";
	try {
		return new URL(raw).pathname;
	} catch {
		return "/";
	}
}
/** パスに当たるファイルを探す。ディレクトリなら index.html、拡張子がなければ .html を足したものも見る */
async function findFile(root, pathname) {
	const target = resolveStaticPath(root, pathname);
	if (!target) return void 0;
	const candidates = [target, join(target, "index.html")];
	if (extname(target) === "") candidates.push(`${target}.html`);
	for (const candidate of candidates) {
		const stats = await fileStats(candidate);
		if (stats) return {
			path: candidate,
			stats,
			fallback: false
		};
	}
}
/** 拡張子のないパスはページとみなし、SPA の戻り先を返す。ファイルらしいパスには返さない */
async function findFallback(root, pathname) {
	if (extname(pathname) !== "") return void 0;
	for (const name of SPA_FALLBACKS) {
		const path = join(root, name);
		const stats = await fileStats(path);
		if (stats) return {
			path,
			stats,
			fallback: true
		};
	}
}
function sendText(response, status, body, headers = {}) {
	response.writeHead(status, {
		"content-type": "text/plain; charset=utf-8",
		"cache-control": "no-store",
		...headers
	});
	response.end(body);
}
/**
* ビルドしたフロントエンドの静的なファイルを返す Node の handler を作る。
* 圧縮済みの .br と .gz があれば Accept-Encoding に合わせて返し、ハッシュの入ったファイルには immutable を付ける。
* 見つからないページのパスには、SPA の戻り先の HTML を 200 で返す。
* fallthrough があれば、見つからない要求をそこへ渡す
*/
function createStaticHandler(options) {
	const root = resolve(options.root);
	const mutablePrefixes = options.mutablePrefixes ?? [];
	const isImmutable = (pathname) => options.immutablePrefixes.some((prefix) => pathname.startsWith(prefix)) && !mutablePrefixes.some((prefix) => pathname.startsWith(prefix));
	return async (request, response) => {
		const { fallthrough } = options;
		if (request.method !== "GET" && request.method !== "HEAD") {
			if (fallthrough) return fallthrough(request, response);
			sendText(response, 405, "method not allowed\n", { allow: "GET, HEAD" });
			return;
		}
		const pathname = requestPath(request);
		const file = await findFile(root, pathname);
		if (!file && fallthrough) return fallthrough(request, response);
		const found = file ?? await findFallback(root, pathname);
		if (!found) {
			const notFound = await fileStats(join(root, "404.html"));
			if (notFound && extname(pathname) === "") {
				await sendFile(request, response, {
					path: join(root, "404.html"),
					stats: notFound,
					status: 404,
					cacheControl: REVALIDATE_CACHE_CONTROL
				});
				return;
			}
			sendText(response, 404, "not found\n");
			return;
		}
		const cacheControl = !found.fallback && isImmutable(pathname) && extname(found.path) !== ".html" ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL;
		await sendFile(request, response, {
			path: found.path,
			stats: found.stats,
			status: 200,
			cacheControl
		});
	};
}
async function sendFile(request, response, file) {
	const acceptEncoding = request.headers["accept-encoding"];
	let servedPath = file.path;
	let servedSize = file.stats.size;
	let encoding;
	for (const candidate of ENCODINGS) {
		if (!acceptsEncoding(acceptEncoding, candidate.name)) continue;
		const stats = await fileStats(`${file.path}${candidate.suffix}`);
		if (!stats) continue;
		servedPath = `${file.path}${candidate.suffix}`;
		servedSize = stats.size;
		encoding = candidate.name;
		break;
	}
	const etag = `W/"${file.stats.size.toString(16)}-${Math.floor(file.stats.mtimeMs).toString(16)}${encoding ? `-${encoding}` : ""}"`;
	const headers = {
		"content-type": contentType(file.path),
		"cache-control": file.cacheControl,
		vary: "accept-encoding",
		etag,
		"last-modified": file.stats.mtime.toUTCString(),
		"x-content-type-options": "nosniff"
	};
	if (encoding) headers["content-encoding"] = encoding;
	if (file.status === 200 && request.headers["if-none-match"] === etag) {
		response.writeHead(304, headers);
		response.end();
		return;
	}
	headers["content-length"] = servedSize;
	response.writeHead(file.status, headers);
	if (request.method === "HEAD") {
		response.end();
		return;
	}
	await new Promise((resolveSent) => {
		const stream = createReadStream(servedPath);
		stream.once("error", () => {
			response.destroy();
			resolveSent();
		});
		response.once("close", () => {
			stream.destroy();
			resolveSent();
		});
		stream.pipe(response);
	});
}
/** frontend.json のファイル名 */
const FRONTEND_MANIFEST = "frontend.json";
/** 成果物の中のパス。frontend.json のあるディレクトリからの相対パスに限る */
const innerPath = z.string().min(1).refine((value) => !isAbsolute(value) && !value.includes("\0"), { message: "must be a relative path" });
/**
* ワーカーがビルドのあとに書く frontend.json の形。
* 知らない項目は無視し、ワーカーが先に項目を足しても起動できるようにする
*/
const frontendManifestSchema = z.discriminatedUnion("mode", [z.object({
	framework: z.enum([
		"nuxt",
		"vue-vite",
		"sveltekit",
		"react-vite"
	]),
	mode: z.literal("ssr"),
	/** Node の listener を export するファイル。Nuxt なら server/index.mjs */
	entry: innerPath,
	/**
	* SSR のサーバーより先に返す静的なファイルのディレクトリ。Nuxt なら public。
	* Nitro の node-listener は serveStatic を持たず、.output/public を自分では返さない
	*/
	publicDir: innerPath.optional(),
	agentRoutes: z.array(z.string().min(1)).optional()
}), z.object({
	framework: z.enum([
		"nuxt",
		"vue-vite",
		"sveltekit",
		"react-vite"
	]),
	mode: z.literal("static"),
	/** 静的なファイルのディレクトリ。Nuxt なら public、Vite なら dist の中身を置いたところ */
	publicDir: innerPath,
	agentRoutes: z.array(z.string().min(1)).optional()
})]);
/** 名前にハッシュの入ったファイルを置く接頭辞。フレームワークのビルドの既定に合わせる */
function immutablePrefixes(framework) {
	if (framework === "nuxt") return {
		immutablePrefixes: ["/_nuxt/"],
		mutablePrefixes: ["/_nuxt/builds/"]
	};
	if (framework === "sveltekit") return {
		immutablePrefixes: ["/_app/immutable/"],
		mutablePrefixes: []
	};
	return {
		immutablePrefixes: ["/assets/"],
		mutablePrefixes: []
	};
}
/** 成果物の中のパスを絶対パスにする。ディレクトリの外を指せば例外にする */
function insideDir(dir, path) {
	const absolute = resolve(dir, path);
	const rel = relative(dir, absolute);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`[rouar] ${FRONTEND_MANIFEST} points outside ${dir}`);
	return absolute;
}
const TRAPPED_EVENTS = ["uncaughtException", "unhandledRejection"];
/** process の型は event ごとの多重定義で、名前の配列から引けないので EventEmitter として扱う */
const processEvents = process;
/**
* Nitro の node-listener の成果物を読み込み、listener を返す。
* Nitro は読み込みのときに uncaughtException と unhandledRejection の handler を process に足し、
* 例外を記録してプロセスを落とさない。SSR の不具合で同じプロセスのエージェントを落とさないよう、この handler は残す。
* そのうえで、足された handler を SDK のログに残す包みに置き換え、何が起きたかを利用者のログで追えるようにする。
* Nitro はシグナルを扱わないので、SIGTERM と暇な間の停止は今までどおり SDK の入口が process.exit で終える。
* Nitro を別のプロセスに移すときに差し替えられるよう、Nitro を読むところはこの関数だけにする
*/
async function loadNodeListener(entry, logger) {
	const before = new Map(TRAPPED_EVENTS.map((event) => [event, new Set(processEvents.listeners(event))]));
	const mod = await import(pathToFileURL(entry).href);
	for (const event of TRAPPED_EVENTS) {
		const existing = before.get(event) ?? /* @__PURE__ */ new Set();
		for (const added of processEvents.listeners(event)) {
			if (existing.has(added)) continue;
			const original = added;
			processEvents.removeListener(event, original);
			processEvents.on(event, (...args) => {
				logger.error({
					err: args[0],
					event
				}, "unhandled error in the process; the server keeps running");
				try {
					original(...args);
				} catch (error) {
					logger.error({
						err: error,
						event
					}, "process error handler failed");
				}
			});
		}
	}
	const listener = [
		mod.listener,
		mod.handler,
		mod.default
	].find((candidate) => typeof candidate === "function");
	if (!listener) throw new Error(`[rouar] ${entry} does not export a Node listener. Build the frontend server for a Node listener target.`);
	return listener;
}
/** listener が投げたか、応答を始める前に失敗したときの応答。中身はログにだけ残す */
function wrapListener(listener, logger) {
	return async (request, response) => {
		try {
			await listener(request, response);
		} catch (error) {
			logger.error({ err: error }, "frontend server failed");
			if (!response.headersSent) {
				response.writeHead(500, {
					"content-type": "text/plain; charset=utf-8",
					"cache-control": "no-store"
				});
				response.end("internal server error\n");
			} else response.destroy();
		}
	};
}
/**
* frontend.json を読み、フロントエンドを返す handler を作る。
* frontend.json がなければ、フロントエンドのない環境として undefined を返す。
* 形が合わないか、SSR の成果物を読み込めなければ例外にし、デプロイを失敗させる
*/
async function loadFrontend(dir, logger) {
	const root = resolve(dir);
	let text;
	try {
		text = await readFile(join(root, FRONTEND_MANIFEST), "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return void 0;
		throw error;
	}
	const parsed = frontendManifestSchema.safeParse(JSON.parse(text));
	if (!parsed.success) throw new Error(`[rouar] ${FRONTEND_MANIFEST} is not valid: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")}`);
	const manifest = parsed.data;
	const agentRoutes = manifest.agentRoutes ?? [...DEFAULT_AGENT_ROUTES];
	if (manifest.mode === "ssr") {
		const server = wrapListener(await loadNodeListener(insideDir(root, manifest.entry), logger), logger);
		return {
			manifest,
			agentRoutes,
			handle: manifest.publicDir ? createStaticHandler({
				root: insideDir(root, manifest.publicDir),
				...immutablePrefixes(manifest.framework),
				fallthrough: server
			}) : server
		};
	}
	return {
		manifest,
		agentRoutes,
		handle: createStaticHandler({
			root: insideDir(root, manifest.publicDir),
			...immutablePrefixes(manifest.framework)
		})
	};
}
//#endregion
//#region src/server/idle.ts
/**
* 暇な間に止めるまでの時間を決める。0 なら止めない。
* 常に動かす環境と、未完了の submission を確かめられないときは止めない
*/
function idleTimeoutMs(options) {
	if (options.alwaysOn || !options.canProbe) return 0;
	return options.timeoutSeconds * 1e3;
}
/**
* 要求がなく、未完了の submission もない状態が続いたら onIdle を呼ぶ。
* Flue は 202 を返したあとも裏でエージェントを動かすので、HTTP の静けさだけでは止めない。
*/
function createIdleMonitor(options) {
	const now = options.now ?? Date.now;
	let lastActivity = now();
	let timer;
	let checking = false;
	let fired = false;
	const check = async () => {
		if (fired || checking || options.timeoutMs <= 0) return false;
		if (options.inFlight() > 0) {
			lastActivity = now();
			return false;
		}
		if (now() - lastActivity < options.timeoutMs) return false;
		checking = true;
		try {
			let unsettled;
			try {
				unsettled = await options.hasUnsettled();
			} catch {
				unsettled = void 0;
			}
			if (unsettled !== false) return false;
			if (options.inFlight() > 0 || now() - lastActivity < options.timeoutMs) return false;
			fired = true;
			if (timer) clearInterval(timer);
			options.onIdle();
			return true;
		} finally {
			checking = false;
		}
	};
	if (options.timeoutMs > 0) {
		const interval = options.checkIntervalMs ?? Math.min(6e4, Math.max(15e3, Math.floor(options.timeoutMs / 4)));
		timer = setInterval(() => {
			check();
		}, interval);
		timer.unref();
	}
	return {
		touch() {
			lastActivity = now();
		},
		check,
		stop() {
			if (timer) clearInterval(timer);
			timer = void 0;
		}
	};
}
/**
* アクセスの検査を通った要求だけを数え、そのたびに onActivity を呼ぶ。
* ヘルスチェックや拒んだ要求でアイドル停止を先送りさせないために、検査のあとで呼ぶ
*/
function createAdmissionTracker(onActivity) {
	let inFlight = 0;
	return {
		inFlight: () => inFlight,
		admit(outgoing) {
			onActivity();
			if (!outgoing) return;
			inFlight += 1;
			outgoing.once("close", () => {
				inFlight -= 1;
				onActivity();
			});
		}
	};
}
//#endregion
//#region src/server/lag.ts
/** 既定の閾値。SSR の 1 回の描画やエージェントの処理で、これより長く止まるのはまれ */
const DEFAULT_THRESHOLD_MS = 500;
const DEFAULT_INTERVAL_MS = 3e4;
/**
* イベントループの遅れを測り、閾値を超えた周期の最大と p99 をログに残す。
* フロントエンドとエージェントが同じプロセスで動くので、片方の重い処理がもう片方を止めたことを後で追えるようにする
*/
function startEventLoopLagMonitor(options) {
	const thresholdMs = options.thresholdMs ?? DEFAULT_THRESHOLD_MS;
	const histogram = monitorEventLoopDelay({ resolution: 20 });
	histogram.enable();
	const timer = setInterval(() => {
		const maxMs = histogram.max / 1e6;
		if (maxMs >= thresholdMs) options.logger.warn({
			maxMs: Math.round(maxMs),
			p99Ms: Math.round(histogram.percentile(99) / 1e6),
			meanMs: Math.round(histogram.mean / 1e6)
		}, "event loop was blocked");
		histogram.reset();
	}, options.intervalMs ?? DEFAULT_INTERVAL_MS);
	timer.unref();
	return { stop() {
		clearInterval(timer);
		histogram.disable();
	} };
}
//#endregion
//#region src/server/router.ts
async function sendResponse(response, fetched) {
	response.writeHead(fetched.status, Object.fromEntries(fetched.headers));
	response.end(await fetched.text());
}
/**
* Node の HTTP のサーバーの段で、エージェントとフロントエンドに振り分ける listener を作る。
* ヘルスチェックとエージェントの経路は、今までと同じ検査を通す agent に渡す。
* そのほかは入口の検査だけをして frontend に渡す。フロントエンドからは Flue を呼べないので、アクセスの検査は要らない
*/
function createRouarListener(options) {
	return async (request, response) => {
		const pathname = requestPath(request);
		if (pathname === "/_rouar/health" || options.agentRoutes.some((prefix) => matchesPathPrefix(pathname, prefix))) {
			await options.agent(request, response);
			return;
		}
		if (!options.admitFromEdge(request)) {
			await sendResponse(response, edgeNotFound());
			return;
		}
		options.onAdmitted?.(response);
		await options.frontend(request, response);
	};
}
//#endregion
//#region src/server/start.ts
/** Flue の終了処理に渡す時間。実行基盤が強制終了する 60 秒に収める */
const FLUE_STOP_TIMEOUT_MS = 45e3;
/** アイドル判定でデータベースに問い合わせるときの上限 */
const PROBE_TIMEOUT_MS = 5e3;
const UNSETTLED_SQL = "SELECT 1 FROM flue_agent_submissions WHERE status IN ('queued', 'running', 'terminalizing', 'joining', 'joined') LIMIT 1";
/** DATABASE_URL から flue_agent_submissions を直接見る。読めなければ undefined を返す */
function createDatabaseProbe(connectionString) {
	let pool;
	return {
		async query() {
			try {
				pool ??= new pg.Pool({
					connectionString,
					max: 1,
					connectionTimeoutMillis: PROBE_TIMEOUT_MS,
					query_timeout: PROBE_TIMEOUT_MS
				});
				const result = await pool.query(UNSETTLED_SQL);
				return result.rowCount !== null && result.rowCount > 0;
			} catch {
				return;
			}
		},
		async close() {
			const current = pool;
			pool = void 0;
			await current?.end().catch(() => void 0);
		}
	};
}
async function loadFlueApplication(entry, cwd, env) {
	const mod = await import(pathToFileURL(resolve(cwd, entry)).href);
	if (typeof mod.loadFlueNodeApplication !== "function") throw new Error(`[rouar] ${entry} does not export loadFlueNodeApplication. Build the Flue app with \`vite build\` for the Node target.`);
	return mod.loadFlueNodeApplication({ env });
}
/**
* Rouar のサーバーを起動する。
* provider を登録してから Flue のアプリを読み込み、アクセスの検査とヘルスチェックをかぶせて配信する。
*/
async function startRouarServer(options = {}) {
	const runtimeEnv = options.env ?? process.env;
	const env = loadSdkServerEnv(runtimeEnv);
	const cwd = options.cwd ?? process.cwd();
	const logger = options.logger ?? createLogger({
		name: "rouar-sdk",
		level: env.LOG_LEVEL
	});
	let models = [];
	try {
		models = registerRouarProvider(env);
	} catch (error) {
		logger.error({ err: error }, "ROUAR_MODELS could not be read");
	}
	if (models.length > 0) logger.info({ models }, "registered custom models for provider rouar");
	const [app, frontend] = await Promise.all([loadFlueApplication(env.ROUAR_APP_ENTRY, cwd, runtimeEnv), loadFrontend(resolve(cwd, options.frontendDir ?? "/app/.rouar/frontend"), logger)]);
	if (frontend) logger.info({
		framework: frontend.manifest.framework,
		mode: frontend.manifest.mode,
		agentRoutes: frontend.agentRoutes
	}, "serving the frontend alongside the agent");
	const gate = createAccessGate({
		tokenHashes: env.ROUAR_ACCESS_TOKEN_HASHES,
		public: env.ROUAR_PUBLIC,
		publicPaths: env.ROUAR_PUBLIC_PATHS
	});
	const validHashes = parseTokenHashes(env.ROUAR_ACCESS_TOKEN_HASHES).length;
	const malformedHashes = env.ROUAR_ACCESS_TOKEN_HASHES.length - validHashes;
	if (malformedHashes > 0) logger.warn({ count: malformedHashes }, "ignored malformed entries in ROUAR_ACCESS_TOKEN_HASHES");
	if (!env.ROUAR_PUBLIC && validHashes === 0) logger.warn("no ROUAR_ACCESS_TOKEN_HASHES and ROUAR_PUBLIC is not true; agent routes reject every request");
	const databaseProbe = env.DATABASE_URL ? createDatabaseProbe(env.DATABASE_URL) : void 0;
	const canProbe = getUnsettledSubmissionsProbe() !== void 0 || databaseProbe !== void 0;
	const hasUnsettled = async () => {
		const registered = getUnsettledSubmissionsProbe();
		if (registered) return registered();
		return databaseProbe?.query();
	};
	let resolveIdle;
	const idle = new Promise((resolve) => {
		resolveIdle = resolve;
	});
	if (env.ROUAR_ALWAYS_ON) logger.info("idle self-stop is disabled because ROUAR_ALWAYS_ON is true");
	else if (!canProbe && env.ROUAR_IDLE_TIMEOUT_SECONDS > 0) logger.info("idle self-stop is disabled because unfinished submissions cannot be checked");
	const monitor = createIdleMonitor({
		timeoutMs: idleTimeoutMs({
			timeoutSeconds: env.ROUAR_IDLE_TIMEOUT_SECONDS,
			alwaysOn: env.ROUAR_ALWAYS_ON,
			canProbe
		}),
		inFlight: () => tracker.inFlight(),
		hasUnsettled,
		onIdle: () => resolveIdle()
	});
	const tracker = createAdmissionTracker(() => monitor.touch());
	const browser = createBrowserAccess({
		agentRoutes: frontend?.agentRoutes ?? DEFAULT_AGENT_ROUTES,
		tagKey: selectTagKey(env, logger),
		limits: {
			perMinute: env.ROUAR_BROWSER_SENDS_PER_MINUTE,
			perDay: env.ROUAR_BROWSER_SENDS_PER_DAY,
			environmentPerDay: env.ROUAR_BROWSER_ENVIRONMENT_SENDS_PER_DAY
		},
		logger
	});
	const handler = createRouarFetch((request) => app.fetch(request), gate, (_request, bindings) => tracker.admit(bindings?.outgoing), createEdgeAdmission(env.ROUAR_EDGE_TOKEN), browser);
	registerInProcessAgentFetch(async (request, principal) => {
		const scoped = browser.scope(request, principal);
		if (scoped instanceof Response) return scoped;
		return app.fetch(scoped);
	});
	const agentListener = getRequestListener(handler, { ...options.hostname ? { hostname: options.hostname } : {} });
	const listener = frontend ? createRouarListener({
		agent: agentListener,
		frontend: frontend.handle,
		agentRoutes: [...frontend.agentRoutes, ...env.ROUAR_PUBLIC_PATHS],
		admitFromEdge: createNodeEdgeAdmission(env.ROUAR_EDGE_TOKEN),
		onAdmitted: (response) => tracker.admit(response)
	}) : agentListener;
	const lag = startEventLoopLagMonitor({ logger });
	const port = options.port ?? env.PORT;
	const server = createServer({ requestTimeout: 0 }, listener);
	await new Promise((resolveServer, rejectServer) => {
		server.once("error", rejectServer);
		server.listen(port, options.hostname, () => {
			server.off("error", rejectServer);
			resolveServer();
		});
	});
	const listeningPort = server.address().port;
	logger.info({ port: listeningPort }, "rouar server listening");
	let stopping;
	const shutdown = (reason) => {
		if (stopping) return stopping;
		stopping = (async () => {
			logger.info({ reason }, "shutting down");
			monitor.stop();
			lag.stop();
			app.pauseAdmissions();
			registerInProcessAgentFetch(void 0);
			const httpClosed = new Promise((resolveClosed) => server.close(() => resolveClosed()));
			try {
				await app.stop(FLUE_STOP_TIMEOUT_MS);
			} catch (error) {
				logger.error({ err: error }, "flue shutdown failed");
			}
			server.closeAllConnections();
			await httpClosed;
			await databaseProbe?.close();
		})();
		return stopping;
	};
	return {
		server,
		port: listeningPort,
		shutdown,
		idle
	};
}
//#endregion
//#region src/server.ts
/**
* rouar のサーバーエントリ。`node node_modules/@rouar/sdk/dist/server.mjs` で起動する。
* ビルド済みの Flue アプリを読み込み、PORT で配信する。
*/
/** 終了処理全体の上限。実行基盤が強制終了する 60 秒より前に必ず終わらせる */
const HARD_EXIT_MS = 55e3;
const rouar = await startRouarServer();
function exitAfterShutdown(reason, exitCode) {
	setTimeout(() => {
		console.error("[rouar] shutdown timed out, exiting");
		process.exit(exitCode);
	}, HARD_EXIT_MS).unref();
	rouar.shutdown(reason).then(() => process.exit(exitCode), () => process.exit(exitCode === 0 ? 1 : exitCode));
}
process.once("SIGTERM", () => exitAfterShutdown("SIGTERM", 143));
process.once("SIGINT", () => exitAfterShutdown("SIGINT", 130));
rouar.idle.then(() => exitAfterShutdown("idle", 0));
//#endregion
export {};

//# sourceMappingURL=server.mjs.map