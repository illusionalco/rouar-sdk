import { join, relative, resolve } from "node:path";
import { access, writeFile } from "node:fs/promises";
//#region src/build/prepare.ts
const ENTRY_EXTENSIONS = [
	"ts",
	"mts",
	"js",
	"mjs"
];
const DB_SHIM = `// Created by the rouar build. Stores Flue sessions and submissions in the rouar Postgres database.
export { default } from "@rouar/sdk/db";
`;
async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
/** Flue と同じ順で、ソースのルートを決める。.flue、src、プロジェクトのルートの順に見る */
async function resolveFlueSourceRoot(root) {
	for (const candidate of [join(root, ".flue"), join(root, "src")]) if (await exists(candidate)) return candidate;
	return root;
}
async function findEntry(dir, name) {
	for (const extension of ENTRY_EXTENSIONS) {
		const path = join(dir, `${name}.${extension}`);
		if (await exists(path)) return path;
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
//#region src/prepare.ts
const result = await prepare(resolve(process.cwd(), process.argv[2] ?? "."));
for (const action of result.actions) console.log(`rouar prepare: ${action}`);
for (const warning of result.warnings) console.warn(`rouar prepare: warning: ${warning}`);
//#endregion
export {};

//# sourceMappingURL=prepare.mjs.map