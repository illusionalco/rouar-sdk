//#region src/persistence-probe.ts
/**
* @rouar/sdk/db のアダプタと、サーバーエントリの自己停止をつなぐ。
* 両者が別々のモジュールとして読み込まれても同じ値を見るように、globalThis に置く。
*/
const PROBE_KEY = Symbol.for("rouar.sdk.unsettledSubmissionsProbe");
function setUnsettledSubmissionsProbe(probe) {
	globalThis[PROBE_KEY] = probe;
}
function getUnsettledSubmissionsProbe() {
	return globalThis[PROBE_KEY];
}
//#endregion
export { setUnsettledSubmissionsProbe as n, getUnsettledSubmissionsProbe as t };

//# sourceMappingURL=persistence-probe-Bj7JZ0pr.mjs.map