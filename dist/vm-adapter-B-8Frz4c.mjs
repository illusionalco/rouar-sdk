import { J as DaytonaNotFoundError } from "./esm-CwTcPei7.mjs";
import { SandboxDiedError, SandboxOperationUnsupportedError, sandboxFromDriver } from "@flue/runtime";
//#region src/vm/vm-adapter.ts
/** How often the death detector reads sandbox state while a call is pending. */
const STATE_POLL_MS = 5e3;
/** How long a state probe may go unanswered before the sandbox is presumed dead. */
const PROBE_SILENCE_MS = 1e4;
/**
* Sandbox states that mean the sandbox is authoritatively gone. Everything
* else — transitional states (`starting`, `stopping`, `destroying`, …),
* `unknown`, `archived`, `paused`, a missing value, and any state added in
* future SDK versions — counts as alive, so a legitimately slow command on
* a healthy sandbox is never interrupted.
*/
const DEAD_STATES = /* @__PURE__ */ new Set([
	"destroyed",
	"stopped",
	"error",
	"build_failed"
]);
/**
* Await a Daytona SDK call while watching for sandbox death. The Daytona SDK
* routes control-plane and toolbox requests through one HTTP client whose
* request timeout is 24 hours — effectively unbounded — so a call that is in
* flight when the sandbox dies can hang an agent for hours. While the call
* is pending, this polls `sandbox.refreshData()` (one control-plane GET) and
* rejects with {@link SandboxDiedError} once `sandbox.state` reports a dead
* state; a probe that itself goes unanswered for the silence bound means the
* control plane is unreachable too, and the sandbox is presumed dead with it.
*
* There is deliberately no deadline: any state outside {@link DEAD_STATES}
* counts as alive, and a rejecting probe is an answer, not death — a
* transient control-plane error must not kill a healthy command. The one
* exception is `DaytonaNotFoundError`: the control plane no longer knows the
* sandbox, which the SDK itself maps to `destroyed`.
*
* Liveness only: this never races the caller's abort signal. Caller-facing
* cancellation is owned one layer up, by `sandboxFromDriver`'s `exec`
* abort race — it rejects promptly on abort and consumes this promise's
* eventual settlement once the caller has already been released.
*/
function raceSandboxDeath(sandbox, operation, call) {
	return new Promise((resolve, reject) => {
		let settled = false;
		let pollTimer;
		let silenceTimer;
		const settle = (complete) => {
			if (settled) return;
			settled = true;
			clearTimeout(pollTimer);
			clearTimeout(silenceTimer);
			complete();
		};
		const probe = () => {
			silenceTimer = setTimeout(() => {
				settle(() => reject(new SandboxDiedError({
					operation,
					reason: "probe_silent"
				})));
			}, PROBE_SILENCE_MS);
			sandbox.refreshData().then(() => {
				if (settled) return;
				clearTimeout(silenceTimer);
				const state = sandbox.state;
				if (state !== void 0 && DEAD_STATES.has(state)) settle(() => reject(new SandboxDiedError({
					operation,
					reason: "stopped"
				})));
				else pollTimer = setTimeout(probe, STATE_POLL_MS);
			}, (error) => {
				if (settled) return;
				clearTimeout(silenceTimer);
				if (error instanceof DaytonaNotFoundError) settle(() => reject(new SandboxDiedError({
					operation,
					reason: "stopped"
				})));
				else pollTimer = setTimeout(probe, STATE_POLL_MS);
			});
		};
		pollTimer = setTimeout(probe, STATE_POLL_MS);
		call.then((value) => settle(() => resolve(value)), (error) => settle(() => reject(error)));
	});
}
/**
* Implements SandboxDriver by wrapping Daytona's TypeScript SDK. Every SDK call
* goes through the death detector so a call that is in flight when the
* sandbox dies settles instead of hanging.
*/
var DaytonaSandboxDriver = class {
	sandbox;
	constructor(sandbox) {
		this.sandbox = sandbox;
	}
	guarded(operation, call) {
		return raceSandboxDeath(this.sandbox, operation, call);
	}
	async readFile(path) {
		return (await this.guarded("readFile", this.sandbox.fs.downloadFile(path))).toString("utf-8");
	}
	async readFileBuffer(path) {
		const buffer = await this.guarded("readFile", this.sandbox.fs.downloadFile(path));
		return new Uint8Array(buffer);
	}
	async writeFile(path, content) {
		const buffer = typeof content === "string" ? Buffer.from(content, "utf-8") : Buffer.from(content);
		await this.guarded("writeFile", this.sandbox.fs.uploadFile(buffer, path));
	}
	async stat(path) {
		const info = await this.guarded("stat", this.sandbox.fs.getFileDetails(path));
		return {
			isFile: !info.isDir,
			isDirectory: info.isDir,
			size: info.size,
			mtime: new Date(info.modTime)
		};
	}
	async readdir(path) {
		return (await this.guarded("readdir", this.sandbox.fs.listFiles(path))).map((e) => e.name).filter((name) => !!name);
	}
	async exists(path) {
		try {
			await this.guarded("exists", this.sandbox.fs.getFileDetails(path));
			return true;
		} catch (error) {
			if (error instanceof SandboxDiedError) throw error;
			return false;
		}
	}
	async mkdir(path, options) {
		if (options?.recursive) {
			await this.exec(`mkdir -p '${path.replace(/'/g, "'\\''")}'`);
			return;
		}
		await this.guarded("mkdir", this.sandbox.fs.createFolder(path, "755"));
	}
	async rm(path, options) {
		if (options?.force) throw new SandboxOperationUnsupportedError({
			operation: "rm",
			provider: "rouar VM",
			options: ["force"]
		});
		await this.guarded("rm", this.sandbox.fs.deleteFile(path, options?.recursive));
	}
	async exec(command, options) {
		const response = await this.guarded("exec", this.sandbox.process.executeCommand(command, options?.cwd, options?.env, typeof options?.timeoutMs === "number" ? Math.ceil(options.timeoutMs / 1e3) : void 0));
		return {
			stdout: response.result ?? "",
			stderr: "",
			exitCode: response.exitCode ?? 0
		};
	}
};
/**
* Create a Flue sandbox factory from an initialized Daytona sandbox.
* The user owns the sandbox lifecycle; Flue wraps it into a Sandbox
* for agent use.
*/
function daytona(sandbox) {
	return { async createSandbox() {
		const sandboxCwd = await raceSandboxDeath(sandbox, "getWorkDir", sandbox.getWorkDir()) ?? "/home/daytona";
		const driver = new DaytonaSandboxDriver(sandbox);
		return sandboxFromDriver(driver, sandboxCwd);
	} };
}
//#endregion
export { daytona };

//# sourceMappingURL=vm-adapter-B-8Frz4c.mjs.map