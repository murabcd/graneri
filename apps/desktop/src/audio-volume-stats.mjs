import { getBase64Pcm16AverageAbsVolume } from "./pcm16-volume.mjs";

const defaultLogIntervalMs = 30_000;
const silentVolumeThreshold = 0.001;

const createSourceStats = () => ({
	count: 0,
	maxVolume: 0,
	silentCount: 0,
	sumVolume: 0,
});

export const createAudioVolumeStats = ({
	logIntervalMs = defaultLogIntervalMs,
	now = () => Date.now(),
} = {}) => {
	let microphone = createSourceStats();
	let systemAudio = createSourceStats();
	let lastLogTime = now();

	const updateSource = (stats, volume) => {
		stats.count += 1;
		stats.maxVolume = Math.max(stats.maxVolume, volume);
		stats.sumVolume += volume;
		if (volume < silentVolumeThreshold) {
			stats.silentCount += 1;
		}
	};

	const serializeSource = (stats) => ({
		avgVolume:
			stats.count > 0 ? Math.round((stats.sumVolume / stats.count) * 1000) : 0,
		maxVolume: Math.round(stats.maxVolume * 1000),
		sampleCount: stats.count,
		silentPercent:
			stats.count > 0 ? Math.round((stats.silentCount / stats.count) * 100) : 0,
		silentSampleCount: stats.silentCount,
	});

	const reset = () => {
		microphone = createSourceStats();
		systemAudio = createSourceStats();
		lastLogTime = now();
	};

	const update = ({ microphonePcm16, systemAudioPcm16 }) => {
		if (microphonePcm16) {
			updateSource(microphone, getBase64Pcm16AverageAbsVolume(microphonePcm16));
		}
		if (systemAudioPcm16) {
			updateSource(
				systemAudio,
				getBase64Pcm16AverageAbsVolume(systemAudioPcm16),
			);
		}
	};

	const logIfReady = (log) => {
		const currentTime = now();
		if (currentTime - lastLogTime < logIntervalMs) {
			return false;
		}

		log({
			intervalMs: currentTime - lastLogTime,
			microphone: serializeSource(microphone),
			systemAudio: serializeSource(systemAudio),
		});
		reset();
		return true;
	};

	return {
		logIfReady,
		reset,
		update,
	};
};
