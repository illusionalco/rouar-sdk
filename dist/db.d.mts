import pg from "pg";
import { PersistenceAdapter } from "@flue/runtime/adapter";
//#region src/db.d.ts
export type RouarPersistenceOptions = {
  /** Connection string. Defaults to `DATABASE_URL`. */
  connectionString?: string;
  /** Extra options passed to the `pg` pool. */
  pool?: Omit<pg.PoolConfig, "connectionString">;
};
/**
 * Creates the Flue Postgres persistence adapter backed by the rouar database.
 * Once connected, the server entry can ask whether any submissions are still unsettled.
 */
export declare function rouarPersistence(options?: RouarPersistenceOptions): PersistenceAdapter;
/** Default adapter, used from `db.ts` as `export { default } from "@rouar/sdk/db"`. */
declare const persistence: PersistenceAdapter;
//#endregion
export { persistence as default };
//# sourceMappingURL=db.d.mts.map