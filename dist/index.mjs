import { n as agentFetch, r as allowBrowserAgents } from "./access-C8tGVOdd.mjs";
import { n as registerRouarProvider, t as ROUAR_PROVIDER_ID } from "./providers-CCvWwUe4.mjs";
import { useSandbox } from "@flue/runtime";
import { createHash } from "node:crypto";
//#region src/vm/use-vm.ts
/** Label that holds the Flue instance id. */
const INSTANCE_LABEL = "rouar_instance";
/** Label that holds the rouar environment id, so production and previews use separate VMs. */
const ENVIRONMENT_LABEL = "rouar_environment";
/** Label that holds the rouar project id, so a VM is never picked up by another project. */
const PROJECT_LABEL = "rouar_project";
/** Default lifetime: stop after 15 idle minutes, archive after 1 day, and delete 7 days after stopping. */
const DEFAULT_CREATE_PARAMS = {
	autoStopInterval: 15,
	autoArchiveInterval: 1440,
	autoDeleteInterval: 10080
};
const DEAD_STATES = /* @__PURE__ */ new Set([
	"destroyed",
	"destroying",
	"error",
	"build_failed"
]);
const STOPPED_STATES = /* @__PURE__ */ new Set([
	"stopped",
	"archived",
	"paused"
]);
/** 接頭辞の id- を付けても 63 文字に収まる id */
const RAW_ID = /^[A-Za-z0-9._-]{1,60}$/;
/**
* Turns an instance id into a label value: `id-<id>` when the id can be used as is,
* or `sha256-<hex>` when it has unsupported characters or is too long.
* The prefixes keep the two forms from colliding.
*/
function instanceLabelValue(id) {
	if (RAW_ID.test(id)) return `id-${id}`;
	return `sha256-${createHash("sha256").update(id, "utf8").digest("hex").slice(0, 56)}`;
}
let sharedClient;
async function defaultClient() {
	const apiKey = process.env.ROUAR_TOKEN;
	const apiUrl = process.env.ROUAR_VM_URL;
	if (!apiKey || !apiUrl) throw new Error("[rouar] useVM() needs ROUAR_TOKEN and ROUAR_VM_URL. They are set on rouar deployments; for local runs pass `client` to useVM().");
	const key = `${apiUrl}\n${apiKey}`;
	if (sharedClient?.key !== key) sharedClient = {
		key,
		client: import("./esm-C5Jyi9Du.mjs").then(({ Daytona }) => new Daytona({
			apiKey,
			apiUrl,
			useDeprecatedPolling: true
		}))
	};
	return sharedClient.client;
}
/** Finds the VM for the instance by its labels, creating it if needed and starting it if stopped. */
async function findOrCreateSandbox(client, instanceId, options = {}, env = process.env) {
	const labels = { [INSTANCE_LABEL]: instanceLabelValue(instanceId) };
	if (env.ROUAR_ENVIRONMENT_ID) labels[ENVIRONMENT_LABEL] = env.ROUAR_ENVIRONMENT_ID;
	if (env.ROUAR_PROJECT_ID) labels[PROJECT_LABEL] = env.ROUAR_PROJECT_ID;
	const timeout = options.timeoutSeconds ?? 120;
	for await (const sandbox of client.list({ labels })) {
		const state = sandbox.state ?? "";
		if (DEAD_STATES.has(state)) continue;
		if (STOPPED_STATES.has(state)) await sandbox.start(timeout);
		return sandbox;
	}
	const create = options.create ?? {};
	return client.create({
		...DEFAULT_CREATE_PARAMS,
		...create,
		labels: {
			...create.labels,
			...labels
		}
	}, { timeout });
}
/** 同じインスタンスで同時に作らないように、作っている途中の Promise を共有する */
const pending = /* @__PURE__ */ new Map();
/** The sandbox factory behind `useVM()`. Use it when you need a Flue `SandboxFactory` outside a hook. */
function rouarVM(options = {}) {
	return { async createSandbox({ id }) {
		const client = options.client ?? await defaultClient();
		let sandboxPromise = pending.get(id);
		if (!sandboxPromise) {
			sandboxPromise = findOrCreateSandbox(client, id, options);
			pending.set(id, sandboxPromise);
			sandboxPromise.finally(() => pending.delete(id)).catch(() => void 0);
		}
		const sandbox = await sandboxPromise;
		const { daytona } = await import("./vm-adapter-B-8Frz4c.mjs");
		return daytona(sandbox).createSandbox({ id });
	} };
}
/**
* Attaches a rouar VM to the agent. Call it in the agent body or in a hook called from it.
* Each Flue instance gets one VM, and later runs of the same instance reuse it.
* It cannot be combined with `useSandbox()` in the same agent.
*/
function useVM(options = {}) {
	useSandbox(rouarVM(options), options.cwd ? { cwd: options.cwd } : {});
}
//#endregion
export { DEFAULT_CREATE_PARAMS, ENVIRONMENT_LABEL, INSTANCE_LABEL, PROJECT_LABEL, ROUAR_PROVIDER_ID, agentFetch, allowBrowserAgents, registerRouarProvider, rouarVM, useVM };

//# sourceMappingURL=index.mjs.map