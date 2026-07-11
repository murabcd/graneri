import { proxyHostedAiRequest } from "./local-server-hosted-proxy.mjs";

export const handleRealtimeTranscriptionSessionRequest = async (
	request,
	response,
) => {
	await proxyHostedAiRequest({
		path: "/api/realtime-transcription-session",
		request,
		response,
	});
};
