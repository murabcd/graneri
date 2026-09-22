const accessibilityPermissionStatusEvent = "accessibility-permission-status";
const defaultTimeoutMs = 5_000;

const readAccessibilityPermission = ({
	forkUtilityProcess,
	timeoutMs,
	workerPath,
}) =>
	new Promise((resolve, reject) => {
		const child = forkUtilityProcess(workerPath, [], {
			serviceName: "accessibility-permission",
		});
		let settled = false;

		const settle = (callback, value) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			callback(value);
		};

		const timeout = setTimeout(() => {
			child.kill();
			settle(
				reject,
				new Error("Timed out checking macOS Accessibility permission."),
			);
		}, timeoutMs);

		child.once("message", (message) => {
			if (
				message?.event !== accessibilityPermissionStatusEvent ||
				typeof message.trusted !== "boolean"
			) {
				settle(
					reject,
					new Error("Accessibility permission helper returned invalid data."),
				);
				return;
			}
			settle(resolve, message.trusted);
		});
		child.once("error", (error) => {
			settle(reject, error);
		});
		child.once("exit", (code) => {
			if (!settled) {
				settle(
					reject,
					new Error(
						`Accessibility permission helper exited before responding (code ${code ?? "unknown"}).`,
					),
				);
			}
		});
	});

export const createMacOSAccessibilityPermission = ({
	forkUtilityProcess,
	timeoutMs = defaultTimeoutMs,
	workerPath,
}) => {
	let cached = false;
	let pendingCheck = null;

	const check = () => {
		pendingCheck ??= readAccessibilityPermission({
			forkUtilityProcess,
			timeoutMs,
			workerPath,
		})
			.then((trusted) => {
				cached = trusted;
				return trusted;
			})
			.finally(() => {
				pendingCheck = null;
			});
		return pendingCheck;
	};

	return {
		check,
		getCached: () => cached,
	};
};
