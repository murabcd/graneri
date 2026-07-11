import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopContentSecurityPolicy } from "../src/desktop-content-security-policy.mjs";

test("desktop CSP permits only configured and required connection origins", () => {
	const policy = createDesktopContentSecurityPolicy({
		convexSiteUrl: "https://graneri.convex.site/path",
		convexUrl: "https://graneri.convex.cloud/",
		siteUrl: "https://graneri.vercel.app/",
	});

	assert.match(policy, /connect-src 'self'/u);
	assert.match(policy, /https:\/\/graneri\.convex\.cloud/u);
	assert.match(policy, /wss:\/\/graneri\.convex\.cloud/u);
	assert.match(policy, /https:\/\/graneri\.convex\.site/u);
	assert.match(policy, /https:\/\/graneri\.vercel\.app/u);
	assert.match(policy, /https:\/\/api\.openai\.com/u);
	assert.match(policy, /wss:\/\/api\.openai\.com/u);
	assert.match(policy, /https:\/\/avatar\.vercel\.sh/u);
	assert.doesNotMatch(policy, /img-src[^;]*\shttps:\s/u);
	assert.doesNotMatch(policy, /unsafe-eval/u);
	assert.match(policy, /object-src 'none'/u);
});

test("desktop CSP rejects invalid runtime URLs", () => {
	assert.throws(
		() =>
			createDesktopContentSecurityPolicy({
				convexSiteUrl: "not a URL",
				convexUrl: "https://graneri.convex.cloud",
				siteUrl: "https://graneri.vercel.app",
			}),
		/Invalid desktop runtime URL/u,
	);
});

test("desktop CSP rejects non-network runtime protocols", () => {
	assert.throws(
		() =>
			createDesktopContentSecurityPolicy({
				convexSiteUrl: "file:///tmp/graneri",
				convexUrl: "https://graneri.convex.cloud",
				siteUrl: "https://graneri.vercel.app",
			}),
		/Unsupported desktop runtime URL protocol/u,
	);
});
