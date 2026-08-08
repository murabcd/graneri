"use node";

import { type Infer, v } from "convex/values";
import { api } from "./_generated/api";
import { action } from "./_generated/server";
import {
	fetchGoogleJsonWithRetry,
	GOOGLE_CALENDAR_SCOPE,
	GOOGLE_DRIVE_SCOPE,
	type GoogleAccessTokenResult,
	type GoogleAuthContext,
	getGoogleAccessToken,
	getGoogleAuthContext,
	refreshGoogleAccessToken,
} from "./googleAuth";

export const GOOGLE_CALENDAR_SOURCE_ID = "app:google-calendar";
export const GOOGLE_DRIVE_SOURCE_ID = "app:google-drive";
const GOOGLE_DRIVE_FILE_EXCERPT_LIMIT = 12000;

const googleToolSourceValidator = v.object({
	id: v.string(),
	title: v.string(),
	preview: v.string(),
	provider: v.union(v.literal("google-calendar"), v.literal("google-drive")),
});

type GoogleToolSource = Infer<typeof googleToolSourceValidator>;

const googleDriveFileValidator = v.object({
	id: v.string(),
	name: v.string(),
	mimeType: v.optional(v.string()),
	modifiedTime: v.optional(v.string()),
	webViewLink: v.optional(v.string()),
	webContentLink: v.optional(v.string()),
	owners: v.array(v.string()),
	excerpt: v.optional(v.string()),
});

const googleDriveToolSourceValidator = v.object({
	type: v.literal("url"),
	url: v.string(),
	title: v.string(),
});

const googleDriveToolResponseValidator = v.object({
	connection: v.string(),
	files: v.array(googleDriveFileValidator),
	sources: v.array(googleDriveToolSourceValidator),
});

type GoogleDriveFileResponse = {
	id?: string;
	name?: string;
	mimeType?: string;
	modifiedTime?: string;
	webViewLink?: string;
	webContentLink?: string;
	owners?: Array<{
		displayName?: string;
		emailAddress?: string;
	}>;
};

type GoogleDriveListResponse = {
	files?: GoogleDriveFileResponse[];
};

const isGoogleDocument = (mimeType: string | undefined) =>
	typeof mimeType === "string" &&
	mimeType.startsWith("application/vnd.google-apps.");

const getGoogleDocumentExportMimeType = (mimeType: string | undefined) => {
	switch (mimeType) {
		case "application/vnd.google-apps.document":
			return "text/plain";
		case "application/vnd.google-apps.presentation":
			return "text/plain";
		case "application/vnd.google-apps.spreadsheet":
			return "text/csv";
		default:
			return null;
	}
};

const isTextLikeMimeType = (mimeType: string | undefined) =>
	typeof mimeType === "string" &&
	(mimeType.startsWith("text/") ||
		mimeType === "application/json" ||
		mimeType === "application/xml" ||
		mimeType === "application/javascript");

const normalizeDriveFile = (
	file: GoogleDriveFileResponse,
	excerpt?: string,
) => {
	if (!file.id || !file.name) {
		return null;
	}

	return {
		id: file.id,
		name: file.name,
		mimeType: file.mimeType,
		modifiedTime: file.modifiedTime,
		webViewLink: file.webViewLink,
		webContentLink: file.webContentLink,
		owners: (file.owners ?? [])
			.map((owner) => owner.displayName ?? owner.emailAddress ?? null)
			.filter((owner): owner is string => Boolean(owner)),
		...(excerpt ? { excerpt } : {}),
	};
};

const buildDriveSearchQuery = (query: string) => {
	const terms = query
		.trim()
		.replaceAll(/['"]/g, " ")
		.split(/\s+/)
		.map((term) => term.trim())
		.filter(Boolean)
		.slice(0, 6);

	if (terms.length === 0) {
		return "trashed = false";
	}

	return `trashed = false and (${terms
		.map((term) => `(name contains '${term}' or fullText contains '${term}')`)
		.join(" and ")})`;
};

const fetchGoogleText = async ({
	accessToken,
	url,
}: {
	accessToken: string;
	url: URL;
}) => {
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

	return await response.text();
};

const fetchGoogleTextWithRetry = async ({
	authContext,
	initialTokens,
	url,
}: {
	authContext: GoogleAuthContext;
	initialTokens: GoogleAccessTokenResult;
	url: URL;
}) => {
	try {
		return await fetchGoogleText({
			accessToken: initialTokens.accessToken,
			url,
		});
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

		return await fetchGoogleText({
			accessToken: refreshedTokens.accessToken,
			url,
		});
	}
};

const buildDriveSources = (
	files: Array<ReturnType<typeof normalizeDriveFile>>,
) => {
	const seen = new Set<string>();

	return files.flatMap((file) => {
		if (!file?.webViewLink || seen.has(file.webViewLink)) {
			return [];
		}

		seen.add(file.webViewLink);

		return [
			{
				type: "url" as const,
				url: file.webViewLink,
				title: file.name,
			},
		];
	});
};

export const getAvailableGoogleToolSources = ({
	preferences,
	scopes,
}: {
	preferences: {
		showGoogleCalendar: boolean;
		showGoogleDrive: boolean;
	};
	scopes: string[];
}): GoogleToolSource[] => {
	const sources: GoogleToolSource[] = [];

	if (
		preferences.showGoogleCalendar &&
		scopes.includes(GOOGLE_CALENDAR_SCOPE)
	) {
		sources.push({
			id: GOOGLE_CALENDAR_SOURCE_ID,
			title: "Google Calendar",
			preview: "Google account",
			provider: "google-calendar",
		});
	}

	if (preferences.showGoogleDrive && scopes.includes(GOOGLE_DRIVE_SCOPE)) {
		sources.push({
			id: GOOGLE_DRIVE_SOURCE_ID,
			title: "Google Drive",
			preview: "Google account",
			provider: "google-drive",
		});
	}

	return sources;
};

export const listAvailableSources = action({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(googleToolSourceValidator),
	handler: async (ctx, args) => {
		const authContext = await getGoogleAuthContext(ctx);
		const tokens = await getGoogleAccessToken(authContext);

		if (!tokens?.accessToken) {
			return [];
		}

		const preferences: {
			showGoogleCalendar: boolean;
			showGoogleDrive: boolean;
			showYandexCalendar: boolean;
		} = await ctx.runQuery(api.calendarPreferences.get, {
			workspaceId: args.workspaceId,
		});
		return getAvailableGoogleToolSources({
			preferences,
			scopes: tokens.scopes,
		});
	},
});

export const searchGoogleDriveFiles = async ({
	authContext,
	query,
	limit,
}: {
	authContext: GoogleAuthContext;
	query: string;
	limit?: number;
}) => {
	const tokens = await getGoogleAccessToken(authContext);

	if (!tokens?.accessToken || !tokens.scopes.includes(GOOGLE_DRIVE_SCOPE)) {
		return {
			connection: "Google Drive",
			files: [],
			sources: [],
		};
	}

	const url = new URL("https://www.googleapis.com/drive/v3/files");
	url.searchParams.set("includeItemsFromAllDrives", "true");
	url.searchParams.set("supportsAllDrives", "true");
	url.searchParams.set(
		"fields",
		"files(id,name,mimeType,modifiedTime,webViewLink,webContentLink,owners(displayName,emailAddress))",
	);
	url.searchParams.set("orderBy", "modifiedTime desc");
	url.searchParams.set(
		"pageSize",
		String(Math.max(1, Math.min(limit ?? 5, 10))),
	);
	url.searchParams.set("q", buildDriveSearchQuery(query));

	const response = await fetchGoogleJsonWithRetry<GoogleDriveListResponse>(
		authContext,
		tokens,
		url,
	);
	const files = (response.files ?? [])
		.map((file) => normalizeDriveFile(file))
		.filter((file): file is NonNullable<typeof file> => Boolean(file));

	return {
		connection: "Google Drive",
		files,
		sources: buildDriveSources(files),
	};
};

export const searchGoogleDriveFilesForTool = action({
	args: {
		query: v.string(),
		limit: v.optional(v.number()),
	},
	returns: googleDriveToolResponseValidator,
	handler: async (ctx, args) => {
		return await searchGoogleDriveFiles({
			authContext: await getGoogleAuthContext(ctx),
			query: args.query,
			limit: args.limit,
		});
	},
});

export const getGoogleDriveFile = async ({
	authContext,
	fileId,
}: {
	authContext: GoogleAuthContext;
	fileId: string;
}) => {
	const tokens = await getGoogleAccessToken(authContext);

	if (!tokens?.accessToken || !tokens.scopes.includes(GOOGLE_DRIVE_SCOPE)) {
		return {
			connection: "Google Drive",
			files: [],
			sources: [],
		};
	}

	const metadataUrl = new URL(
		`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
	);
	metadataUrl.searchParams.set(
		"fields",
		"id,name,mimeType,modifiedTime,webViewLink,webContentLink,owners(displayName,emailAddress)",
	);
	metadataUrl.searchParams.set("supportsAllDrives", "true");
	const file = await fetchGoogleJsonWithRetry<GoogleDriveFileResponse>(
		authContext,
		tokens,
		metadataUrl,
	);

	let excerpt: string | undefined;

	if (isGoogleDocument(file.mimeType)) {
		const exportMimeType = getGoogleDocumentExportMimeType(file.mimeType);

		if (exportMimeType) {
			const exportUrl = new URL(
				`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export`,
			);
			exportUrl.searchParams.set("mimeType", exportMimeType);
			excerpt = (
				await fetchGoogleTextWithRetry({
					authContext,
					initialTokens: tokens,
					url: exportUrl,
				})
			)
				.trim()
				.slice(0, GOOGLE_DRIVE_FILE_EXCERPT_LIMIT);
		}
	} else if (isTextLikeMimeType(file.mimeType)) {
		const mediaUrl = new URL(
			`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
		);
		mediaUrl.searchParams.set("alt", "media");
		mediaUrl.searchParams.set("supportsAllDrives", "true");
		excerpt = (
			await fetchGoogleTextWithRetry({
				authContext,
				initialTokens: tokens,
				url: mediaUrl,
			})
		)
			.trim()
			.slice(0, GOOGLE_DRIVE_FILE_EXCERPT_LIMIT);
	}

	const normalizedFile = normalizeDriveFile(file, excerpt);

	return {
		connection: "Google Drive",
		files: normalizedFile ? [normalizedFile] : [],
		sources: normalizedFile ? buildDriveSources([normalizedFile]) : [],
	};
};

export const getGoogleDriveFileForTool = action({
	args: {
		fileId: v.string(),
	},
	returns: googleDriveToolResponseValidator,
	handler: async (ctx, args) => {
		return await getGoogleDriveFile({
			authContext: await getGoogleAuthContext(ctx),
			fileId: args.fileId,
		});
	},
});
