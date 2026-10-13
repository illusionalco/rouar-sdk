import { z } from "zod";
//#region src/config.ts
/** リポジトリの直下に置く設定のファイルの名前 */
const ROUAR_CONFIG_FILE = "rouar.json";
/** エージェントへ渡すパスの接頭辞の既定 */
const DEFAULT_AGENT_ROUTES = ["/agents"];
/** フロントエンドのフレームワーク。deployments.frontend_framework の enum と同じ値にする */
const FRONTEND_FRAMEWORKS = [
	"nuxt",
	"vue-vite",
	"sveltekit",
	"react-vite"
];
/** 配信の形。deployments.frontend_kind の none 以外と同じ値にする */
const FRONTEND_MODES = ["ssr", "static"];
/** リポジトリの中の相対パス。絶対パスと `..` を断る。外を指すシンボリックリンクはワーカーが実体で確かめる */
const repoPath = z.string().min(1).max(512).refine((value) => !value.startsWith("/") && !value.includes("\\") && !value.includes("\0") && !value.split("/").includes(".."), { message: "Use a relative path inside the repository without `..`" });
/** パスの接頭辞。`/` で始め、`?` と `#` を含めない */
const routePrefix = z.string().max(256).regex(/^\/[^?#\s]*$/, { message: "Start with `/` and do not include `?`, `#`, or spaces" });
const agentSchema = z.strictObject({
	/** Flue のプロジェクトのディレクトリ。リポジトリの直下からの相対パス */
	root: repoPath.optional(),
	/** エージェントへ渡すパスの接頭辞。`app.ts` で mount したパスに合わせる */
	routes: z.array(routePrefix).min(1).max(32).optional()
});
const frontendSchema = z.strictObject({
	/** フロントエンドのディレクトリ。リポジトリの直下からの相対パス */
	root: repoPath.optional(),
	framework: z.enum(FRONTEND_FRAMEWORKS).optional(),
	mode: z.enum(FRONTEND_MODES).optional(),
	/** ビルドのコマンド。フロントエンドのディレクトリで実行する */
	buildCommand: z.string().trim().min(1).max(1024).optional(),
	/** 成果物の場所。フロントエンドのディレクトリからの相対パス */
	outputDir: repoPath.optional()
});
/**
* rouar.json の形。ワーカーはビルドの前にこれで確かめる。
* 利用者のコードを実行せずに読めるよう、TypeScript ではなく JSON にしている
*/
const rouarConfigSchema = z.strictObject({
	/** エディターの補完のための JSON Schema の場所。中身は使わない */
	$schema: z.string().optional(),
	agent: agentSchema.optional(),
	/** `false` にすると、フロントエンドを探さない */
	frontend: z.union([z.literal(false), frontendSchema]).optional()
});
/** rouar.json の JSON Schema。パッケージの rouar.schema.json はこれを書き出したもの */
function rouarConfigJsonSchema() {
	return {
		...z.toJSONSchema(rouarConfigSchema, { io: "input" }),
		title: "rouar.json",
		description: "Configuration for deploying a project on Rouar"
	};
}
/** rouar.json の文字列を読んで確かめる。合わなければ、どの項目が違うかを返す */
function parseRouarConfig(text) {
	let raw;
	try {
		raw = JSON.parse(text);
	} catch {
		return {
			success: false,
			issues: [{
				path: "",
				message: "Not valid JSON"
			}]
		};
	}
	const parsed = rouarConfigSchema.safeParse(raw);
	if (parsed.success) return {
		success: true,
		config: parsed.data
	};
	return {
		success: false,
		issues: flattenIssues(parsed.error.issues, [])
	};
}
/**
* zod の issue を、項目の場所と説明の一覧にする。
* `frontend` のような union は、型が合った方の分岐の issue を開き、どの項目が違うかまで示す
*/
function flattenIssues(issues, prefix) {
	return issues.flatMap((issue) => {
		const where = [...prefix, ...issue.path];
		if (issue.code === "invalid_union") {
			const branch = issue.errors.find((errors) => !errors.every((inner) => inner.code === "invalid_type" && inner.path.length === 0) && !errors.every((inner) => inner.code === "invalid_value" && inner.path.length === 0));
			if (branch) return flattenIssues(branch, where);
		}
		return [{
			path: where.map(String).join("."),
			message: issue.message
		}];
	});
}
//#endregion
export { parseRouarConfig as a, ROUAR_CONFIG_FILE as i, FRONTEND_FRAMEWORKS as n, rouarConfigJsonSchema as o, FRONTEND_MODES as r, rouarConfigSchema as s, DEFAULT_AGENT_ROUTES as t };

//# sourceMappingURL=config-Dx9yx3Hq.mjs.map