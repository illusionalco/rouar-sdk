import { n as setUnsettledSubmissionsProbe } from "./persistence-probe-Bj7JZ0pr.mjs";
import pg from "pg";
import { postgres } from "@flue/postgres";
//#region src/db.ts
function createRunner(options) {
	let pool;
	const getPool = () => {
		if (pool) return pool;
		const connectionString = options.connectionString ?? process.env.DATABASE_URL;
		if (!connectionString) throw new Error("[rouar] DATABASE_URL is not set. Run `rouar env pull` for local development.");
		pool = new pg.Pool({
			connectionString,
			...options.pool
		});
		return pool;
	};
	return {
		query: async (text, params) => (await getPool().query(text, params)).rows,
		transaction: async (fn) => {
			const client = await getPool().connect();
			try {
				await client.query("BEGIN");
				const result = await fn({ query: async (text, params) => (await client.query(text, params)).rows });
				await client.query("COMMIT");
				return result;
			} catch (error) {
				await client.query("ROLLBACK").catch(() => void 0);
				throw error;
			} finally {
				client.release();
			}
		},
		close: async () => {
			const current = pool;
			pool = void 0;
			await current?.end();
		}
	};
}
/**
* Creates the Flue Postgres persistence adapter backed by the rouar database.
* Once connected, the server entry can ask whether any submissions are still unsettled.
*/
function rouarPersistence(options = {}) {
	const adapter = postgres(createRunner(options));
	return {
		...adapter.migrate ? { migrate: () => adapter.migrate?.() } : {},
		async connect() {
			const stores = await adapter.connect();
			setUnsettledSubmissionsProbe(() => stores.submissionStore.hasUnsettledSubmissions());
			return stores;
		},
		async close() {
			setUnsettledSubmissionsProbe(void 0);
			await adapter.close?.();
		}
	};
}
/** Default adapter, used from `db.ts` as `export { default } from "@rouar/sdk/db"`. */
const persistence = rouarPersistence();
//#endregion
export { persistence as default, rouarPersistence };

//# sourceMappingURL=db.mjs.map