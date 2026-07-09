import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export const createGlobalDictationHotkeyMonitor = ({
	helperPath,
	mode,
	onEvent,
	onExit,
	onLog,
	spawnImpl = spawn,
} = {}) => {
	if (!helperPath) {
		return null;
	}
	if (mode !== "hold" && mode !== "toggle") {
		throw new Error("Global dictation hotkey mode must be hold or toggle.");
	}

	const child = spawnImpl(helperPath, ["--mode", mode], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	const lineReader = createInterface({
		input: child.stdout,
		crlfDelay: Infinity,
	});
	let isClosed = false;

	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk) => {
		const message = String(chunk).trim();
		if (message) {
			onLog?.(message);
		}
	});
	lineReader.on("line", (line) => {
		try {
			onEvent?.(JSON.parse(line));
		} catch (error) {
			onLog?.(`failed to parse hotkey event: ${error?.message ?? error}`);
		}
	});
	child.on("exit", (code, signal) => {
		if (isClosed) {
			return;
		}

		isClosed = true;
		lineReader.close();
		onExit?.({ code, signal });
	});
	child.on("error", (error) => {
		if (isClosed) {
			return;
		}

		isClosed = true;
		lineReader.close();
		onLog?.(`hotkey helper process error: ${error?.message ?? error}`);
		onExit?.({ code: null, signal: null });
	});

	return {
		close: () => {
			if (isClosed) {
				return;
			}

			isClosed = true;
			lineReader.close();
			child.kill("SIGTERM");
		},
	};
};
