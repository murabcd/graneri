export const rendererSessionPartition = "graneri-renderer";

export const createRendererWebPreferences = ({ preloadPath }) => ({
	preload: preloadPath,
	partition: rendererSessionPartition,
	contextIsolation: true,
	nodeIntegration: false,
	sandbox: false,
});
