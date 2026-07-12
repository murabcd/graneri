export type HostedRouteId =
	| "chat"
	| "chatSteer"
	| "chatStop"
	| "chatStream"
	| "enhanceNote"
	| "applyTemplate"
	| "realtimeTranscriptionSession";

export type HostedRouteMethod = "GET" | "POST";
export type HostedRouteProxyBodyMode = "bufferedJson" | "stream";

export type HostedRouteDefinition = Readonly<{
	id: HostedRouteId;
	method: HostedRouteMethod;
	proxyBodyMode: HostedRouteProxyBodyMode;
}>;

export declare const hostedRouteIds: readonly HostedRouteId[];

export declare const getHostedRouteDefinition: (
	routeId: HostedRouteId,
) => HostedRouteDefinition;

export declare const matchHostedRoutePath: (
	pathname: string,
) => HostedRouteDefinition | null;

export declare const buildHostedRoutePath: (
	routeId: Exclude<HostedRouteId, "chatStream">,
) => string;

export declare const buildHostedChatStreamPath: (chatId: string) => string;
