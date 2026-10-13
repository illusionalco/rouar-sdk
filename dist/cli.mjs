#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { access, chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { defineCommand, runMain } from "citty";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fg from "fast-glob";
//#region src/cli/terminal.ts
/**
* 端末を操作する文字。C0 と DEL と C1 の制御文字に加え、表示の向きを変える Unicode の書式文字も含める
*/
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
/** サーバーから受け取った文字列を端末に出す前に、制御文字を取り除く */
function terminalSafe(value) {
	return String(value).replace(UNSAFE, "");
}
//#endregion
//#region src/cli/api.ts
var ApiError = class extends Error {
	status;
	constructor(status, message) {
		super(message);
		this.status = status;
		this.name = "ApiError";
	}
};
async function errorMessage(response) {
	try {
		const body = await response.json();
		const detail = body.detail ?? body.title ?? body.message ?? body.error;
		if (typeof detail === "string") return terminalSafe(detail);
	} catch {}
	return terminalSafe(`${response.status} ${response.statusText}`);
}
/** Rouar の API を API キーで呼ぶ */
async function apiGet(auth, path, fetchImpl = fetch) {
	const response = await fetchImpl(`${auth.apiUrl}${path}`, { headers: {
		authorization: `Bearer ${auth.apiKey}`,
		accept: "application/json"
	} });
	if (!response.ok) throw new ApiError(response.status, await errorMessage(response));
	return await response.json();
}
async function postJson(url, body, options = {}) {
	const response = await (options.fetchImpl ?? fetch)(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
			...options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}
		},
		body: JSON.stringify(body)
	});
	let parsed = {};
	try {
		parsed = await response.json();
	} catch {
		parsed = {};
	}
	return {
		status: response.status,
		body: parsed
	};
}
//#endregion
//#region src/cli/files.ts
/** 他の利用者から読めないファイルを書く。途中で失敗しても元のファイルを壊さないよう、別名で書いてから置き換える */
async function writePrivateFile(path, content) {
	await mkdir(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `.${randomBytes(6).toString("hex")}.tmp`);
	try {
		await writeFile(temporary, content, {
			mode: 384,
			flag: "wx"
		});
		await chmod(temporary, 384);
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
	await chmod(path, 384);
}
function configDir(env = process.env) {
	const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
	return join(base, "rouar");
}
function authFilePath(env = process.env) {
	return join(configDir(env), "auth.json");
}
function normalizeUrl(name, url) {
	const parsed = new URL(url);
	if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback(parsed.hostname))) throw new Error(`${name} must use https: ${url}`);
	return parsed.href.replace(/\/+$/, "");
}
function normalizeApiUrl(url) {
	return normalizeUrl("ROUAR_API_URL", url);
}
function resolveConsoleUrl(env = process.env) {
	return normalizeUrl("ROUAR_CONSOLE_URL", env.ROUAR_CONSOLE_URL || "https://console.rouar.com");
}
function isLoopback(hostname) {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
async function readAuth(env = process.env) {
	try {
		const parsed = JSON.parse(await readFile(authFilePath(env), "utf8"));
		if (typeof parsed === "object" && parsed !== null && typeof parsed.apiUrl === "string" && typeof parsed.apiKey === "string") {
			const { apiUrl, apiKey, keyId } = parsed;
			return typeof keyId === "string" ? {
				apiUrl,
				apiKey,
				keyId
			} : {
				apiUrl,
				apiKey
			};
		}
		return;
	} catch (error) {
		if (error.code === "ENOENT") return void 0;
		throw error;
	}
}
/** API キーを 0600 で保存する。ディレクトリは 0700 で作る */
async function saveAuth(auth, env = process.env) {
	const path = authFilePath(env);
	await mkdir(configDir(env), {
		recursive: true,
		mode: 448
	});
	await chmod(configDir(env), 448);
	await writePrivateFile(path, `${JSON.stringify(auth, null, 2)}\n`);
	return path;
}
async function removeAuth(env = process.env) {
	const existing = await readAuth(env).catch(() => void 0);
	await rm(authFilePath(env), { force: true });
	return existing !== void 0;
}
/** 使う API の URL を決める。ROUAR_API_URL、保存した URL、既定の URL の順に見る */
function resolveApiUrl(env, auth) {
	return normalizeApiUrl(env.ROUAR_API_URL || auth?.apiUrl || "https://api.rouar.com");
}
/** ログインしていないことを表す。CLI は rouar login を案内して終わる */
var NotLoggedInError = class extends Error {
	name = "NotLoggedInError";
};
/** 保存した API キーを返す。別の API にログインしていたら使わない */
async function requireAuth(env = process.env) {
	const auth = await readAuth(env);
	const apiUrl = resolveApiUrl(env, auth);
	if (!auth || normalizeApiUrl(auth.apiUrl) !== apiUrl) throw new NotLoggedInError(`Not logged in to ${apiUrl}. Run \`rouar login\` first.`);
	return {
		apiUrl,
		apiKey: auth.apiKey
	};
}
//#endregion
//#region src/cli/env-pull.ts
/**
* API が env pull に値を返すのは development だけ。preview と production は 403 になる。
* 実行時の秘密を手元に出さないための決まりなので、CLI でも受け付けない。
*/
const PULLABLE_ENVIRONMENTS = ["development"];
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
* dotenv の 1 行の値にする。dotenv は二重引用符の中の改行のエスケープしか解かないので、
* 値に合わせて引用符を選ぶ。どの形でも読み戻せない値は undefined を返す。
*/
function quoteEnvValue(value) {
	if (value.includes("\r")) return void 0;
	const multiline = value.includes("\n");
	if (!multiline && !value.includes("'")) return `'${value}'`;
	if (!value.includes("\"") && !value.includes("\\")) return `"${value.replace(/\n/g, "\\n")}"`;
	if (!multiline && !value.includes("`")) return `\`${value}\``;
}
function formatEnvFile(variables) {
	const skipped = [];
	const lines = ["# Created by `rouar env pull`. Do not commit this file."];
	const sorted = [...variables].sort((a, b) => a.key.localeCompare(b.key));
	for (const { key, value } of sorted) {
		if (!ENV_KEY.test(key)) {
			skipped.push(key);
			continue;
		}
		const quoted = quoteEnvValue(value);
		if (quoted === void 0) {
			skipped.push(key);
			continue;
		}
		lines.push(`${key}=${quoted}`);
	}
	return {
		content: `${lines.join("\n")}\n`,
		skipped
	};
}
var EnvFileConflictError = class extends Error {
	path;
	constructor(path) {
		super(`${path} already exists and differs. Re-run with --yes to overwrite it.`);
		this.path = path;
		this.name = "EnvFileConflictError";
	}
};
/**
* .env を 0600 で書く。中身の違う既存のファイルは、overwrite が true のときだけ置き換える。
*/
async function writeEnvFile(path, content, overwrite) {
	let existing;
	try {
		existing = await readFile(path, "utf8");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (existing === content) return "unchanged";
	if (existing !== void 0 && !overwrite) throw new EnvFileConflictError(path);
	await writePrivateFile(path, content);
	return existing === void 0 ? "created" : "updated";
}
//#endregion
//#region src/cli/link.ts
const LINK_DIR = ".rouar";
const LINK_FILE = join(LINK_DIR, "project.json");
/** git の remote の URL から owner/repo を取り出す */
function repositoryFullName(remoteUrl) {
	const match = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(remoteUrl.trim());
	return match ? `${match[1]}/${match[2]}` : void 0;
}
async function gitOriginFullName(cwd) {
	try {
		const { stdout } = await promisify(execFile)("git", [
			"remote",
			"get-url",
			"origin"
		], { cwd });
		return repositoryFullName(stdout);
	} catch {
		return;
	}
}
/**
* id が完全に一致するものを先に選び、なければ slug で選ぶ。
* slug が他のプロジェクトの id と重なっても、id の方を選ぶ。複数が一致したら選ばずに止める。
*/
function findProject(projects, selector) {
	for (const field of ["id", "slug"]) {
		const matches = projects.filter((p) => p[field] === selector);
		if (matches.length > 1) throw new Error(`More than one project matches "${terminalSafe(selector)}". Pass the project id instead.`);
		if (matches[0]) return matches[0];
	}
	throw new Error(`No project matches "${terminalSafe(selector)}".`);
}
/** --project の指定か、git の origin に一致するプロジェクトを選ぶ */
function selectProject(projects, selector, originFullName) {
	if (selector) return findProject(projects, selector);
	if (originFullName) {
		const matches = projects.filter((p) => p.repository?.fullName?.toLowerCase() === originFullName.toLowerCase());
		if (matches.length === 1 && matches[0]) return matches[0];
	}
	const list = projects.map((p) => `  ${terminalSafe(p.slug)}  ${terminalSafe(p.repository?.fullName ?? "")}`).join("\n");
	throw new Error(`Could not pick a project from the git remote. Pass --project <slug>.${list ? `\n${list}` : ""}`);
}
/** プロジェクトの一覧を API から読む */
async function listProjects(auth, get = apiGet) {
	const { items } = await get(auth, "/api/v1/projects");
	return items;
}
/**
* --project に渡された id か slug を、プロジェクトの id にする。
* 指定がなければ、リンクしたプロジェクトの id をそのまま使う。
*/
async function resolveProjectId(auth, selector, cwd, get = apiGet) {
	if (selector) return selectProject(await listProjects(auth, get), selector, void 0).id;
	const linked = await readLink(cwd);
	if (!linked) throw new Error("This directory is not linked. Run `rouar link` or pass --project <id or slug>.");
	return linked;
}
async function readLink(cwd) {
	try {
		const parsed = JSON.parse(await readFile(join(cwd, LINK_FILE), "utf8"));
		return typeof parsed.projectId === "string" ? parsed.projectId : void 0;
	} catch {
		return;
	}
}
/** パスがシンボリックリンクなら止める。リンクの先にある別のファイルを書き換えないため */
async function refuseSymlink$1(path) {
	try {
		if ((await lstat(path)).isSymbolicLink()) throw new Error(`${path} is a symbolic link. rouar does not write through symbolic links; replace it with a regular file or directory.`);
	} catch (error) {
		if (error.code === "ENOENT") return;
		throw error;
	}
}
/** .gitignore を書くときもリンクをたどらない。O_NOFOLLOW がない環境では lstat の確認だけになる */
const NO_FOLLOW_WRITE = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);
/** .rouar/project.json を書き、.gitignore に .rouar/ がなければ足す。rouar sdk add が直した .rouar/* の形も無視の指定とみなす */
async function writeLink(cwd, projectId) {
	const gitignorePath = join(cwd, ".gitignore");
	for (const path of [
		join(cwd, LINK_DIR),
		join(cwd, LINK_FILE),
		gitignorePath
	]) await refuseSymlink$1(path);
	await writePrivateFile(join(cwd, LINK_FILE), `${JSON.stringify({ projectId }, null, 2)}\n`);
	let gitignore = "";
	try {
		gitignore = await readFile(gitignorePath, "utf8");
	} catch {
		gitignore = "";
	}
	if (gitignore.split(/\r?\n/).some((line) => [
		"/.rouar",
		"/.rouar/",
		".rouar",
		".rouar/",
		"/.rouar/*",
		".rouar/*"
	].includes(line.trim()))) return { gitignoreUpdated: false };
	const prefix = gitignore === "" || gitignore.endsWith("\n") ? "" : "\n";
	await writeFile(gitignorePath, `${gitignore}${prefix}.rouar/\n`, { flag: NO_FOLLOW_WRITE });
	return { gitignoreUpdated: true };
}
//#endregion
//#region src/cli/login.ts
const CLI_CLIENT_ID = "rouar-cli";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const isOk = (status) => status >= 200 && status < 300;
/**
* サーバーが返した承認の URL を確かめる。API かコンソールと同じ origin でなければ拒む。
* 偽の URL に誘導されて、攻撃者のコードを承認させられるのを防ぐ
*/
function trustedVerificationUri(value, apiUrl, consoleUrl) {
	let parsed;
	try {
		parsed = new URL(String(value ?? ""), `${apiUrl}/`);
	} catch {
		throw new Error("The server returned an invalid verification URL.");
	}
	if (![new URL(apiUrl).origin, new URL(consoleUrl).origin].includes(parsed.origin) || parsed.username !== "" || parsed.password !== "") throw new Error(`Refusing to open a verification URL on an unexpected host: ${terminalSafe(parsed.host)}. Set ROUAR_CONSOLE_URL if your console runs elsewhere.`);
	return parsed.href;
}
/** デバイスの承認で得たセッションを閉じる。失敗しても API キーは使えるので無視する */
async function signOut(apiUrl, sessionToken, fetchImpl) {
	try {
		await postJson(`${apiUrl}/api/auth/sign-out`, {}, {
			bearer: sessionToken,
			fetchImpl
		});
	} catch {}
}
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
* better-auth のデバイス認可でログインし、長く使える API キーを発行して返す。
* 返すのは API キーだけで、途中のセッションのトークンは保存しない。
*/
async function deviceLogin(options) {
	const { apiUrl, fetchImpl } = options;
	const sleep = options.sleep ?? defaultSleep;
	const code = await postJson(`${apiUrl}/api/auth/device/code`, { client_id: CLI_CLIENT_ID }, { fetchImpl });
	const deviceCode = code.body.device_code;
	const userCode = code.body.user_code;
	if (!isOk(code.status) || typeof deviceCode !== "string" || typeof userCode !== "string") throw new Error(`Could not start login (HTTP ${code.status}).`);
	const verificationUri = trustedVerificationUri(typeof code.body.verification_uri_complete === "string" ? code.body.verification_uri_complete : code.body.verification_uri, apiUrl, options.consoleUrl);
	options.prompt({
		userCode: terminalSafe(userCode),
		verificationUri: terminalSafe(verificationUri)
	});
	let intervalMs = (Number(code.body.interval) || 5) * 1e3;
	const deadline = Date.now() + (Number(code.body.expires_in) || 1800) * 1e3;
	let accessToken;
	while (Date.now() < deadline) {
		await sleep(intervalMs);
		const token = await postJson(`${apiUrl}/api/auth/device/token`, {
			grant_type: DEVICE_GRANT,
			device_code: deviceCode,
			client_id: CLI_CLIENT_ID
		}, { fetchImpl });
		if (isOk(token.status) && typeof token.body.access_token === "string") {
			accessToken = token.body.access_token;
			break;
		}
		const error = token.body.error;
		if (error === "authorization_pending") continue;
		if (error === "slow_down") {
			intervalMs += 5e3;
			continue;
		}
		if (error === "access_denied") throw new Error("Login was denied.");
		if (error === "expired_token") throw new Error("The login code expired. Run `rouar login` again.");
		throw new Error(`Login failed (HTTP ${token.status}${typeof error === "string" ? `, ${terminalSafe(error)}` : ""}).`);
	}
	if (!accessToken) throw new Error("The login code expired. Run `rouar login` again.");
	let created;
	try {
		created = await postJson(`${apiUrl}/api/auth/api-key/create`, { name: CLI_CLIENT_ID }, {
			bearer: accessToken,
			fetchImpl
		});
	} finally {
		await signOut(apiUrl, accessToken, fetchImpl);
	}
	if (!isOk(created.status) || typeof created.body.key !== "string") throw new Error(`Could not create an API key (HTTP ${created.status}).`);
	return {
		apiKey: created.body.key,
		...typeof created.body.id === "string" ? { keyId: created.body.id } : {}
	};
}
/**
* 保存した API キーをサーバーで取り消す。better-auth の api-key の削除を、そのキー自身で呼ぶ。
* すでに無効か見つからない 401 と 404 は取り消し済みとして扱う
*/
async function revokeApiKey(auth, fetchImpl) {
	if (!auth.keyId) return "unknown-id";
	try {
		const response = await (fetchImpl ?? fetch)(`${auth.apiUrl}/api/auth/api-key/delete`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
				authorization: `Bearer ${auth.apiKey}`,
				"x-api-key": auth.apiKey
			},
			body: JSON.stringify({ keyId: auth.keyId })
		});
		await response.body?.cancel();
		if (isOk(response.status)) return "revoked";
		if (response.status === 401 || response.status === 404) return "gone";
		return "failed";
	} catch {
		return "failed";
	}
}
//#endregion
//#region src/cli/prepare.ts
const ENTRY_EXTENSIONS = [
	"ts",
	"mts",
	"js",
	"mjs"
];
const DB_SHIM = `// Created by rouar prepare. Stores Flue sessions and submissions in the rouar Postgres database.
export { default } from "@rouar/sdk/db";
`;
async function exists$1(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
/** Flue と同じ順で、ソースのルートを決める。.flue、src、プロジェクトのルートの順に見る */
async function resolveFlueSourceRoot(root) {
	for (const candidate of [join(root, ".flue"), join(root, "src")]) if (await exists$1(candidate)) return candidate;
	return root;
}
async function findEntry(dir, name) {
	for (const extension of ENTRY_EXTENSIONS) {
		const path = join(dir, `${name}.${extension}`);
		if (await exists$1(path)) return path;
	}
}
/**
* ビルドの前に呼ぶ。db.* がなければ、Rouar の Postgres を使う db.ts を書く。
* 何度呼んでも結果は同じになる。
*/
async function prepare(root) {
	const sourceRoot = await resolveFlueSourceRoot(root);
	const shown = relative(root, sourceRoot) || ".";
	const actions = [`source root: ${shown}`];
	const warnings = [];
	if (!await findEntry(sourceRoot, "app")) warnings.push(`no app.{ts,mts,js,mjs} in ${shown}; Flue needs one`);
	const db = await findEntry(sourceRoot, "db");
	if (db) actions.push(`kept ${relative(root, db)}`);
	else {
		const path = join(sourceRoot, "db.ts");
		await writeFile(path, DB_SHIM, { flag: "wx" });
		actions.push(`wrote ${relative(root, path)}`);
	}
	return {
		sourceRoot,
		actions,
		warnings
	};
}
//#endregion
//#region src/cli/sdk-add.ts
/** tarball を置く、リポジトリの直下のディレクトリ */
const SDK_DIR = ".rouar";
/** API が返す tarball の名前の形。パスの区切りや .. を含む名前は受け取らない */
const FILE_NAME = /^rouar-sdk-[0-9A-Za-z][0-9A-Za-z.-]*\.tgz$/;
/** .gitignore で .rouar/ を無視していても、tarball はコミットできるようにする */
const GITIGNORE_SDK_EXCEPTION = "!/.rouar/rouar-sdk-*.tgz";
var SdkAddError = class extends Error {
	name = "SdkAddError";
};
/** API キーが通らなかったことを表す。ログインし直してもらう */
var SdkAuthError = class extends Error {
	name = "SdkAuthError";
};
function sha512(bytes) {
	return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}
/** API の応答を確かめる。名前と版がそろわないもの、大きすぎるものは受け取らない */
function parseRelease(body) {
	const release = body;
	if (typeof release !== "object" || release === null || typeof release.version !== "string" || typeof release.fileName !== "string" || typeof release.integrity !== "string" || typeof release.size !== "number" || !FILE_NAME.test(release.fileName) || release.fileName !== `rouar-sdk-${release.version}.tgz` || !release.integrity.startsWith("sha512-") || !Number.isInteger(release.size) || release.size <= 0 || release.size > 67108864) throw new SdkAddError("The API returned an unexpected SDK release.");
	return {
		version: release.version,
		fileName: release.fileName,
		url: `/api/v1/sdk/${release.fileName}`,
		integrity: release.integrity,
		size: release.size
	};
}
/**
* 中身が API の示した値と合うかを確かめる。
* 版の末尾の `sha<12 桁>` は中身の SHA-256 の先頭なので、それも比べる
*/
function verifyTarball(release, bytes) {
	if (bytes.byteLength !== release.size || sha512(bytes) !== release.integrity) throw new SdkAddError(`The downloaded ${release.fileName} does not match its integrity. Run the command again.`);
	const suffix = /sha([0-9a-f]{12})$/.exec(release.version)?.[1];
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	if (suffix !== void 0 && !sha256.startsWith(suffix)) throw new SdkAddError(`The downloaded ${release.fileName} does not match its version.`);
}
function authFailure(error) {
	if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw new SdkAuthError("The stored API key was rejected. Run `rouar login` again.");
	throw error;
}
/** 最新の版を API に聞き、tarball を取って確かめる */
async function downloadLatestSdk(auth, options = {}) {
	const fetchImpl = options.fetchImpl ?? fetch;
	const release = parseRelease(await apiGet(auth, "/api/v1/sdk/latest", fetchImpl).catch(authFailure));
	const cached = await options.existing?.(release);
	if (cached) try {
		verifyTarball(release, cached);
		return {
			release,
			bytes: cached,
			downloaded: false
		};
	} catch {}
	const response = await fetchImpl(`${auth.apiUrl}${release.url}`, { headers: {
		authorization: `Bearer ${auth.apiKey}`,
		accept: "application/gzip"
	} });
	if (!response.ok) authFailure(new ApiError(response.status, terminalSafe(`${response.status} ${response.statusText}`)));
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > 67108864) throw new SdkAddError("The SDK tarball is too large.");
	const bytes = new Uint8Array(await response.arrayBuffer());
	verifyTarball(release, bytes);
	return {
		release,
		bytes,
		downloaded: true
	};
}
/** パスがシンボリックリンクなら止める。リンクの先にある別のファイルを書き換えないため */
async function refuseSymlink(path) {
	try {
		if ((await lstat(path)).isSymbolicLink()) throw new SdkAddError(`${path} is a symbolic link. rouar does not write through symbolic links; replace it with a regular file or directory.`);
		return true;
	} catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}
}
/** 別名で書いてから置き換える。コミットするファイルなので、ふつうの権限で書く */
async function writeAtomic(path, content) {
	const temporary = join(resolve(path, ".."), `.${randomBytes(6).toString("hex")}.tmp`);
	try {
		await writeFile(temporary, content, {
			mode: 420,
			flag: "wx"
		});
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}
/** 手元の tarball を読む。なければ undefined */
async function readLocalTarball(root, fileName) {
	const path = join(root, SDK_DIR, fileName);
	try {
		if (!(await lstat(path)).isFile()) return void 0;
		return new Uint8Array(await readFile(path));
	} catch {
		return;
	}
}
/** tarball を .rouar/ に置き、ほかの版の tarball を消す。消した名前を返す */
async function storeTarball(root, release, bytes) {
	const dir = join(root, SDK_DIR);
	await refuseSymlink(dir);
	await mkdir(dir, { recursive: true });
	const path = join(dir, release.fileName);
	await refuseSymlink(path);
	await writeAtomic(path, bytes);
	const removed = [];
	for (const entry of await readdir(dir)) if (entry !== release.fileName && FILE_NAME.test(entry)) {
		await rm(join(dir, entry), { force: true });
		removed.push(entry);
	}
	return removed;
}
async function readPackageJson(dir) {
	const path = join(dir, "package.json");
	try {
		if (!(await lstat(path)).isFile()) return void 0;
	} catch {
		return;
	}
	try {
		const parsed = JSON.parse(await readFile(path, "utf8"));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : void 0;
	} catch {
		throw new SdkAddError(`${path} is not valid JSON.`);
	}
}
async function exists(path) {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}
/** package.json の packageManager を先に見て、なければロックファイルで決める。どれもなければ npm */
async function detectPackageManager(root) {
	const manifest = await readPackageJson(root);
	if (typeof manifest?.packageManager === "string") {
		const name = manifest.packageManager.split("@")[0];
		if (name === "pnpm" || name === "npm" || name === "yarn" || name === "bun") return name;
	}
	if (await exists(join(root, "pnpm-lock.yaml"))) return "pnpm";
	if (await exists(join(root, "pnpm-workspace.yaml"))) return "pnpm";
	if (await exists(join(root, "yarn.lock"))) return "yarn";
	if (await exists(join(root, "bun.lock")) || await exists(join(root, "bun.lockb"))) return "bun";
	return "npm";
}
/** pnpm-workspace.yaml の packages の一覧を読む。ブロックの形と [a, b] の形だけを扱う */
function parsePnpmWorkspace(content) {
	const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/, "$2");
	const lines = content.split(/\r?\n/);
	const start = lines.findIndex((line) => /^packages\s*:/.test(line));
	if (start === -1) return [];
	const inline = /^packages\s*:\s*\[(.*)\]\s*$/.exec(lines[start] ?? "");
	if (inline?.[1] !== void 0) return inline[1].split(",").map(unquote).filter((item) => item !== "");
	const patterns = [];
	for (const line of lines.slice(start + 1)) {
		if (/^\s*(#.*)?$/.test(line)) continue;
		const item = /^\s+-\s*(.+?)\s*(?:#.*)?$/.exec(line);
		if (!item?.[1]) break;
		patterns.push(unquote(item[1]));
	}
	return patterns;
}
async function workspacePatterns(root) {
	try {
		const path = join(root, "pnpm-workspace.yaml");
		if ((await lstat(path)).isFile()) return parsePnpmWorkspace(await readFile(path, "utf8"));
	} catch {}
	const workspaces = (await readPackageJson(root))?.workspaces;
	return (Array.isArray(workspaces) ? workspaces : typeof workspaces === "object" && workspaces !== null && Array.isArray(workspaces.packages) ? workspaces.packages : []).filter((item) => typeof item === "string");
}
/** ワークスペースのパッケージのディレクトリを、リポジトリの直下からの POSIX の相対パスで返す。直下は "." */
async function listWorkspacePackages(root) {
	const patterns = await workspacePatterns(root);
	const include = [];
	const ignore = ["**/node_modules/**"];
	for (const raw of patterns) {
		const negated = raw.startsWith("!");
		const pattern = (negated ? raw.slice(1) : raw).replace(/^\.\//, "").replace(/\/+$/, "");
		if (pattern === "" || pattern.split("/").includes("..")) continue;
		(negated ? ignore : include).push(`${pattern}/package.json`);
	}
	const found = include.length ? await fg(include, {
		cwd: root,
		ignore,
		onlyFiles: true,
		followSymbolicLinks: false
	}) : [];
	const dirs = /* @__PURE__ */ new Set(["."]);
	for (const file of found) dirs.add(posix.dirname(file));
	return [...dirs].sort();
}
function allDependencies(manifest) {
	return {
		...manifest.peerDependencies,
		...manifest.optionalDependencies,
		...manifest.devDependencies,
		...manifest.dependencies
	};
}
function isAgent(deps) {
	return "@flue/vite" in deps;
}
/** docs/frontend.md の自動の見つけ方と同じ見分け方。next は受け付けないので選ばない */
function isFrontend(deps) {
	if (isAgent(deps) || "next" in deps) return false;
	if ("nuxt" in deps || "@sveltejs/kit" in deps) return true;
	return "vite" in deps && ("vue" in deps || "react" in deps);
}
/** リポジトリの外を指すパスは受け付けない */
function insideRoot(root, path, name) {
	const relativePath = relative(root, resolve(root, path));
	if (isAbsolute(path) || relativePath.startsWith("..") || isAbsolute(relativePath)) throw new SdkAddError(`${name} in rouar.json must be inside the repository.`);
	return relativePath.split(sep).join("/") || ".";
}
async function readRouarConfig(root) {
	const path = join(root, "rouar.json");
	let content;
	try {
		if (!(await lstat(path)).isFile()) return { frontendDisabled: false };
		content = await readFile(path, "utf8");
	} catch {
		return { frontendDisabled: false };
	}
	let parsed;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new SdkAddError("rouar.json is not valid JSON.");
	}
	const frontend = parsed.frontend;
	return {
		...typeof parsed.agent?.root === "string" ? { agentRoot: insideRoot(root, parsed.agent.root, "agent.root") } : {},
		...typeof frontend === "object" && frontend !== null && typeof frontend.root === "string" ? { frontendRoot: insideRoot(root, frontend.root, "frontend.root") } : {},
		frontendDisabled: frontend === false
	};
}
/**
* @rouar/sdk を足すパッケージを選ぶ。rouar.json で決めた場所を先に使い、なければ自動で見つける。
* すでに @rouar/sdk に依存するパッケージも、版をそろえるために選ぶ
*/
async function findTargetPackages(root) {
	const config = await readRouarConfig(root);
	const targets = /* @__PURE__ */ new Set();
	for (const dir of [config.agentRoot, config.frontendRoot]) {
		if (dir === void 0) continue;
		if (!await readPackageJson(join(root, dir))) throw new SdkAddError(`${dir}/package.json from rouar.json was not found.`);
		targets.add(dir);
	}
	for (const dir of await listWorkspacePackages(root)) {
		const manifest = await readPackageJson(join(root, dir));
		if (!manifest) continue;
		const deps = allDependencies(manifest);
		if ("@rouar/sdk" in deps) targets.add(dir);
		if (config.agentRoot === void 0 && isAgent(deps)) targets.add(dir);
		if (config.frontendRoot === void 0 && !config.frontendDisabled && isFrontend(deps)) targets.add(dir);
	}
	if (targets.size === 0) throw new SdkAddError("No agent package was found. Add @flue/vite to your agent's package.json or set agent.root in rouar.json.");
	return [...targets].sort();
}
/** パッケージから見た tarball の `file:` の指定 */
function fileSpec(root, packageDir, fileName) {
	return `file:${relative(join(root, packageDir), join(root, SDK_DIR, fileName)).split(sep).join("/")}`;
}
function detectIndent(content) {
	return /^([ \t]+)"/m.exec(content)?.[1] ?? 2;
}
const DEPENDENCY_FIELDS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies"
];
/**
* package.json に `"@rouar/sdk": "file:..."` を書く。すでにある欄はそのまま使い、
* なければ dependencies に足す。字下げと末尾の改行は元のファイルに合わせる
*/
async function writeSdkDependency(root, packageDir, spec) {
	const path = join(root, packageDir, "package.json");
	await refuseSymlink(path);
	const content = await readFile(path, "utf8");
	let manifest;
	try {
		manifest = JSON.parse(content);
	} catch {
		throw new SdkAddError(`${path} is not valid JSON.`);
	}
	const field = DEPENDENCY_FIELDS.find((name) => {
		const deps = manifest[name];
		return typeof deps === "object" && deps !== null && "@rouar/sdk" in deps;
	}) ?? "dependencies";
	const deps = { ...manifest[field] ?? {} };
	const previous = deps["@rouar/sdk"];
	if (previous === spec) return "unchanged";
	deps["@rouar/sdk"] = spec;
	manifest[field] = previous === void 0 ? Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))) : deps;
	const newline = content.includes("\r\n") ? "\r\n" : "\n";
	let output = JSON.stringify(manifest, null, detectIndent(content));
	if (newline === "\r\n") output = output.replace(/\n/g, "\r\n");
	if (/\r?\n$/.test(content)) output += newline;
	await writeAtomic(path, output);
	return previous === void 0 ? "added" : "updated";
}
/**
* .gitignore が .rouar/ を丸ごと無視していたら、中身だけを無視する形に直し、tarball を例外にする。
* git はディレクトリを無視すると、その中のファイルを例外にできないため
*/
async function allowTarballInGitignore(root) {
	const path = join(root, ".gitignore");
	if (!await refuseSymlink(path)) return false;
	const content = await readFile(path, "utf8");
	const lines = content.split(/\r?\n/);
	let ignoresDir = false;
	const next = lines.map((line) => {
		const trimmed = line.trim();
		if ([
			".rouar",
			".rouar/",
			"/.rouar",
			"/.rouar/"
		].includes(trimmed)) {
			ignoresDir = true;
			return "/.rouar/*";
		}
		if ([".rouar/*", "/.rouar/*"].includes(trimmed)) ignoresDir = true;
		return line;
	});
	if (!ignoresDir) return false;
	if (!next.some((line) => line.trim() === "!/.rouar/rouar-sdk-*.tgz")) {
		const index = next.findIndex((line) => [".rouar/*", "/.rouar/*"].includes(line.trim()));
		next.splice(index + 1, 0, GITIGNORE_SDK_EXCEPTION);
	}
	const output = next.join(content.includes("\r\n") ? "\r\n" : "\n");
	if (output === content) return false;
	await writeAtomic(path, output);
	return true;
}
function installCommand(packageManager) {
	return `${packageManager} install`;
}
/** 親へたどって .git のあるディレクトリを探す。なければ start をそのまま使う */
async function findRepositoryRoot(start) {
	let dir = resolve(start);
	for (;;) {
		if (await exists(join(dir, ".git"))) return dir;
		const parent = resolve(dir, "..");
		if (parent === dir) return resolve(start);
		dir = parent;
	}
}
/** rouar sdk add の本体。tarball を取り、.rouar/ に置き、各パッケージに file: の依存を書く */
async function sdkAdd(auth, root, options = {}) {
	const dirs = await findTargetPackages(root);
	const { release, bytes, downloaded } = await downloadLatestSdk(auth, {
		...options.fetchImpl ? { fetchImpl: options.fetchImpl } : {},
		existing: (r) => readLocalTarball(root, r.fileName)
	});
	const removed = await storeTarball(root, release, bytes);
	const packages = [];
	for (const dir of dirs) {
		const spec = fileSpec(root, dir, release.fileName);
		packages.push({
			dir,
			spec,
			change: await writeSdkDependency(root, dir, spec)
		});
	}
	return {
		release,
		downloaded,
		tarballPath: posix.join(SDK_DIR, release.fileName),
		removed,
		packages,
		gitignoreUpdated: await allowTarballInGitignore(root),
		packageManager: await detectPackageManager(root)
	};
}
//#endregion
//#region src/cli.ts
const login = defineCommand({
	meta: {
		name: "login",
		description: "Sign in to rouar and store an API key"
	},
	async run() {
		const apiUrl = normalizeApiUrl(process.env.ROUAR_API_URL || "https://api.rouar.com");
		const { apiKey, keyId } = await deviceLogin({
			apiUrl,
			consoleUrl: resolveConsoleUrl(),
			prompt: ({ userCode, verificationUri }) => {
				console.log(`Open ${verificationUri} and confirm the code ${userCode}.`);
				console.log("Waiting for approval...");
			}
		});
		const path = await saveAuth({
			apiUrl,
			apiKey,
			...keyId ? { keyId } : {}
		});
		console.log(`Logged in to ${apiUrl}. Saved the API key to ${path}.`);
	}
});
const logout = defineCommand({
	meta: {
		name: "logout",
		description: "Revoke and remove the stored API key"
	},
	async run() {
		const auth = await readAuth().catch(() => void 0);
		if (auth) {
			let apiUrl;
			try {
				apiUrl = normalizeApiUrl(auth.apiUrl);
			} catch {
				apiUrl = void 0;
			}
			const result = apiUrl ? await revokeApiKey({
				...auth,
				apiUrl
			}) : "failed";
			if (result === "unknown-id" || result === "failed") console.warn("Could not revoke the API key on the server. Revoke it in the rouar console.");
		}
		const removed = await removeAuth();
		console.log(removed ? "Logged out." : "Not logged in.");
	}
});
const link = defineCommand({
	meta: {
		name: "link",
		description: "Link this directory to a rouar project"
	},
	args: { project: {
		type: "string",
		description: "Project id or slug"
	} },
	async run({ args }) {
		const cwd = process.cwd();
		const project = selectProject(await listProjects(await requireAuth()), args.project, await gitOriginFullName(cwd));
		const { gitignoreUpdated } = await writeLink(cwd, project.id);
		console.log(`Linked to ${terminalSafe(project.name)} (${terminalSafe(project.slug)}). Wrote ${LINK_FILE}.`);
		if (gitignoreUpdated) console.log("Added .rouar/ to .gitignore.");
	}
});
const envPull = defineCommand({
	meta: {
		name: "pull",
		description: "Write the project's environment variables to a .env file"
	},
	args: {
		environment: {
			type: "enum",
			options: [...PULLABLE_ENVIRONMENTS],
			default: "development",
			description: "Environment to read. Only development can be pulled; preview and production values stay on rouar"
		},
		file: {
			type: "string",
			default: ".env",
			description: "File to write"
		},
		project: {
			type: "string",
			description: "Project id or slug. Defaults to the linked project"
		},
		yes: {
			type: "boolean",
			default: false,
			description: "Overwrite the file if it differs"
		}
	},
	async run({ args }) {
		const cwd = process.cwd();
		const auth = await requireAuth();
		const projectId = await resolveProjectId(auth, args.project, cwd);
		const query = new URLSearchParams({ environment: args.environment });
		const { variables } = await apiGet(auth, `/api/v1/projects/${encodeURIComponent(projectId)}/env?${query}`);
		const { content, skipped } = formatEnvFile(variables);
		const path = resolve(cwd, args.file);
		try {
			const result = await writeEnvFile(path, content, args.yes);
			console.log(`${result === "unchanged" ? "Already up to date" : result === "created" ? "Created" : "Updated"} ${args.file} (${variables.length - skipped.length} variables).`);
		} catch (error) {
			if (error instanceof EnvFileConflictError) {
				console.error(error.message);
				process.exitCode = 1;
				return;
			}
			throw error;
		}
		for (const key of skipped) console.warn(`Skipped ${terminalSafe(key)}: it cannot be written to a .env file.`);
	}
});
const env = defineCommand({
	meta: {
		name: "env",
		description: "Manage environment variables"
	},
	subCommands: { pull: envPull }
});
const prepareCommand = defineCommand({
	meta: {
		name: "prepare",
		description: "Prepare a Flue project for a rouar build"
	},
	args: { cwd: {
		type: "string",
		default: ".",
		description: "Project root"
	} },
	async run({ args }) {
		const result = await prepare(resolve(process.cwd(), args.cwd));
		for (const action of result.actions) console.log(`rouar prepare: ${action}`);
		for (const warning of result.warnings) console.warn(`rouar prepare: warning: ${warning}`);
	}
});
const sdkAddCommand = defineCommand({
	meta: {
		name: "add",
		description: "Download the @rouar/sdk tarball into .rouar/ and add it to your agent and frontend packages"
	},
	args: { cwd: {
		type: "string",
		default: ".",
		description: "A directory inside the repository"
	} },
	async run({ args }) {
		try {
			const result = await sdkAdd(await requireAuth(), await findRepositoryRoot(resolve(process.cwd(), args.cwd)));
			console.log(`${result.downloaded ? "Downloaded" : "Already have"} @rouar/sdk ${terminalSafe(result.release.version)} at ${terminalSafe(result.tarballPath)}.`);
			for (const name of result.removed) console.log(`Removed the old ${terminalSafe(name)}.`);
			for (const { dir, spec, change } of result.packages) console.log(`${dir}/package.json: ${change === "unchanged" ? "already uses" : change === "added" ? "added" : "updated to"} "@rouar/sdk": "${terminalSafe(spec)}"`);
			if (result.gitignoreUpdated) console.log("Updated .gitignore so the tarball in .rouar/ can be committed.");
			console.log(`Run \`${installCommand(result.packageManager)}\`, then commit ${terminalSafe(result.tarballPath)} with your package.json changes so collaborators can install without an API key.`);
		} catch (error) {
			if (error instanceof NotLoggedInError || error instanceof SdkAuthError || error instanceof SdkAddError) {
				console.error(error.message);
				process.exitCode = 1;
				return;
			}
			throw error;
		}
	}
});
const sdk = defineCommand({
	meta: {
		name: "sdk",
		description: "Manage the @rouar/sdk package"
	},
	subCommands: { add: sdkAddCommand }
});
const main = defineCommand({
	meta: {
		name: "rouar",
		description: "Deploy Flue agents on rouar"
	},
	subCommands: {
		login,
		logout,
		link,
		env,
		sdk,
		prepare: prepareCommand
	}
});
await runMain(main);
//#endregion
export {};

//# sourceMappingURL=cli.mjs.map