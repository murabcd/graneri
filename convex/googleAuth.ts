import type { GenericActionCtx } from "convex/server";
import type { DataModel } from "./_generated/dataModel";
import { authComponent, createAuth } from "./auth";
import { createResourceAccess } from "./domain";

export const GOOGLE_CALENDAR_SCOPE =
	"https://www.googleapis.com/auth/calendar.readonly";
export const GOOGLE_DRIVE_SCOPE =
	"https://www.googleapis.com/auth/drive.readonly";

type BetterAuthInstance = ReturnType<typeof createAuth>;

export type GoogleAuthContext = {
	auth: BetterAuthInstance;
	headers: Headers;
};

export type GoogleAccessTokenResult = {
	accessToken: string;
	scopes: string[];
};

const { requireIdentity } = createResourceAccess("Google integrations");

export const parseGoogleScopeList = (scope: string | null | undefined) =>
	scope
		?.split(/[,\s]+/)
		.map((value) => value.trim())
		.filter(Boolean) ?? [];

export const resolveGoogleScopes = (tokens: {
	scope?: string | null;
	scopes?: string[];
}) => {
	if (Array.isArray(tokens.scopes)) {
		return tokens.scopes.filter(Boolean);
	}

	return parseGoogleScopeList(tokens.scope);
};

export const getGoogleAuthContext = async (
	ctx: GenericActionCtx<DataModel>,
): Promise<GoogleAuthContext> => {
	await requireIdentity(ctx);

	return await authComponent.getAuth(createAuth, ctx);
};

export const getGoogleAccessToken = async (
	authContext: GoogleAuthContext,
): Promise<GoogleAccessTokenResult | null> => {
	const { auth, headers } = authContext;

	try {
		const tokens = await auth.api.getAccessToken({
			body: { providerId: "google" },
			headers,
		});

		if (!tokens?.accessToken) {
			return null;
		}

		return {
			accessToken: tokens.accessToken,
			scopes: resolveGoogleScopes(tokens),
		};
	} catch {
		return null;
	}
};

export const refreshGoogleAccessToken = async (
	authContext: GoogleAuthContext,
): Promise<GoogleAccessTokenResult | null> => {
	const { auth, headers } = authContext;

	try {
		const tokens = await auth.api.refreshToken({
			body: { providerId: "google" },
			headers,
		});

		if (!tokens?.accessToken) {
			return null;
		}

		return {
			accessToken: tokens.accessToken,
			scopes: resolveGoogleScopes(tokens),
		};
	} catch {
		return null;
	}
};

export const fetchGoogleJson = async <T>(
	accessToken: string,
	url: URL,
): Promise<T> => {
	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
	});

	if (!response.ok) {
		const responseText = await response.text().catch(() => "");
		const error = new Error(
			`Google request failed with status ${response.status}.${responseText ? ` ${responseText}` : ""}`,
		) as Error & { status?: number };
		error.status = response.status;
		throw error;
	}

	return (await response.json()) as T;
};

export const fetchGoogleJsonWithRetry = async <T>(
	authContext: GoogleAuthContext,
	initialTokens: GoogleAccessTokenResult,
	url: URL,
) => {
	try {
		return await fetchGoogleJson<T>(initialTokens.accessToken, url);
	} catch (error) {
		if (
			!(error instanceof Error) ||
			(error as Error & { status?: number }).status !== 401
		) {
			throw error;
		}

		const refreshedTokens = await refreshGoogleAccessToken(authContext);

		if (!refreshedTokens?.accessToken) {
			throw error;
		}

		return await fetchGoogleJson<T>(refreshedTokens.accessToken, url);
	}
};
