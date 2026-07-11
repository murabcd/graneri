const toOrigin = (value) => {
	if (typeof value !== "string" || value.trim().length === 0) {
		return null;
	}

	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`Invalid desktop runtime URL: ${value}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(
			`Unsupported desktop runtime URL protocol: ${url.protocol}`,
		);
	}
	return url.origin;
};

const toWebSocketOrigin = (origin) => {
	const url = new URL(origin);
	if (url.protocol === "https:") {
		url.protocol = "wss:";
		return url.origin;
	}
	if (url.protocol === "http:") {
		url.protocol = "ws:";
		return url.origin;
	}
	return null;
};

const unique = (values) => [...new Set(values.filter(Boolean))];

export const createDesktopContentSecurityPolicy = ({
	convexSiteUrl,
	convexUrl,
	siteUrl,
}) => {
	const configuredOrigins = unique(
		[convexUrl, convexSiteUrl, siteUrl].map(toOrigin),
	);
	const websocketOrigins = unique(configuredOrigins.map(toWebSocketOrigin));
	const connectSources = unique([
		"'self'",
		"http://127.0.0.1:*",
		"ws://127.0.0.1:*",
		...configuredOrigins,
		...websocketOrigins,
		"https://api.github.com",
		"https://api.openai.com",
		"wss://api.openai.com",
	]);
	const imageSources = unique([
		"'self'",
		"data:",
		"blob:",
		...configuredOrigins,
		"https://avatar.vercel.sh",
		"https://*.githubusercontent.com",
		"https://*.googleusercontent.com",
	]);

	return [
		"default-src 'self'",
		"base-uri 'none'",
		`connect-src ${connectSources.join(" ")}`,
		"font-src 'self' data:",
		"frame-ancestors 'none'",
		`img-src ${imageSources.join(" ")}`,
		"media-src 'self' blob:",
		"object-src 'none'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"worker-src 'self' blob:",
	].join("; ");
};
