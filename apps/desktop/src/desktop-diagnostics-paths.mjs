import { join } from "node:path";

export const createDesktopDiagnosticsPaths = ({ userDataPath }) => {
	const troubleshootingLogsPath = join(userDataPath, "troubleshooting-logs");

	return Object.freeze({
		appLogPath: join(troubleshootingLogsPath, "graneri.log"),
		tracesPath: join(userDataPath, "traces"),
		troubleshootingLogsPath,
	});
};
