import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { localProcessControlSchema } from "./local-process-protocol.mjs";

let child;
let terminationReason;
let deadline;
let outputBytes = 0;
const initializationDeadline = setTimeout(() => process.exit(1), 5_000);

const killProcessGroup = () => {
	if (!child?.pid) return;
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch (error) {
		if (error.code !== "ESRCH") throw error;
	}
};

const terminate = (reason) => {
	terminationReason ??= reason;
	if (child) killProcessGroup();
	else process.exit(1);
};

const send = (event, callback) => {
	if (process.connected) process.send(event, callback);
	else callback?.();
};

process.on("disconnect", () => terminate("cancelled"));
process.once("exit", killProcessGroup);
process.stdout.on("error", () => terminate("cancelled"));
process.stderr.on("error", () => terminate("cancelled"));

process.on("message", (message) => {
	try {
		const control = localProcessControlSchema.parse(message);
		if (control.type === "terminate") {
			terminate("cancelled");
			return;
		}
		if (child) throw new Error("A process supervisor accepts one launch.");
		clearTimeout(initializationDeadline);
		const { setup } = control;
		child = spawn(setup.command, setup.args, {
			cwd: setup.cwd,
			env: setup.env,
			detached: true,
			stdio: ["pipe", "pipe", "pipe"],
		});
		deadline = setTimeout(() => terminate("timed_out"), setup.timeoutMs);
		const limitOutput = () =>
			new Transform({
				transform(chunk, _encoding, callback) {
					const available = Math.max(0, setup.maxOutputBytes - outputBytes);
					outputBytes += chunk.byteLength;
					if (available > 0) this.push(chunk.subarray(0, available));
					if (outputBytes > setup.maxOutputBytes) terminate("output_limit");
					callback();
				},
			});
		const forwarded = [
			pipeline(child.stdout, limitOutput(), process.stdout, { end: false }),
			pipeline(child.stderr, limitOutput(), process.stderr, { end: false }),
		].map((operation) => operation.catch(() => terminate("cancelled")));
		process.stdin.pipe(child.stdin);
		child.stdin.on("error", (error) => {
			if (error.code !== "EPIPE") terminate("failed");
		});
		child.once("spawn", () => send({ type: "started" }));
		child.once("error", (error) => {
			send({ type: "error", message: error.message });
		});
		// A shell exiting must not leave descendants holding its output pipes open.
		child.once("exit", killProcessGroup);
		child.once("close", async (exitCode) => {
			clearTimeout(deadline);
			await Promise.all(forwarded);
			// The app cannot clean up after its own crash; the supervisor owns that case.
			if (!process.connected)
				await rm(setup.scratchPath, { recursive: true, force: true });
			send(
				{
					type: "completed",
					exitCode,
					status:
						terminationReason ?? (exitCode === 0 ? "completed" : "failed"),
				},
				() => process.exit(0),
			);
		});
	} catch (error) {
		killProcessGroup();
		send({ type: "error", message: error.message }, () => process.exit(1));
	}
});
