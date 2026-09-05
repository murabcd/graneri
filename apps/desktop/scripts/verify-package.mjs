import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	getExpectedConvexDeployment,
	getForbiddenConvexDeployments,
	loadSelectedEnvFile,
} from "../../../scripts/release-contract.mjs";
import { desktopPackageContract } from "./desktop-package-contract.mjs";
import { verifyPackagedResources } from "./package-verification.mjs";
import { verifyPackagedRuntimeExecutables } from "./packaged-runtime-verification.mjs";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(packageRoot, "../..");
const packagedAppAsarPath = resolve(
	packageRoot,
	desktopPackageContract.packagedResourcesAsarPath,
);
loadSelectedEnvFile({
	envFileName:
		process.env.GRANERI_ENV_MODE?.trim() === "local" ? ".env.local" : ".env",
	repoRoot,
});

const expectedDeployment = getExpectedConvexDeployment();
const expectedSiteUrl =
	process.env.GRANERI_HOSTED_SITE_URL?.trim() ||
	process.env.SITE_URL?.trim() ||
	"";
if (!expectedDeployment) {
	throw new Error(
		"Expected Convex deployment is not configured. Set GRANERI_EXPECTED_CONVEX_DEPLOYMENT, GRANERI_HOSTED_CONVEX_URL, VITE_CONVEX_URL, or CONVEX_URL before verifying a package.",
	);
}

if (!expectedSiteUrl) {
	throw new Error(
		"Expected hosted site URL is not configured. Set GRANERI_HOSTED_SITE_URL or SITE_URL before verifying a package.",
	);
}

if (new URL(expectedSiteUrl).hostname.endsWith(".convex.site")) {
	throw new Error(
		"Expected hosted site URL must be the hosted web app origin, not a Convex site URL.",
	);
}

const forbiddenDeployments = getForbiddenConvexDeployments({
	expectedDeployment,
});

const { runtimeFileCount } = verifyPackagedResources({
	packagedAppAsarPath,
	expectedDeployment,
	expectedSiteUrl,
	forbiddenDeployments,
	forbiddenOpenAIApiKey: process.env.OPENAI_API_KEY?.trim(),
});
const { nativeAudioSelfTestResult, runtimeSmokeTests } =
	await verifyPackagedRuntimeExecutables({ packagedAppAsarPath });

console.log(
	[
		"Desktop package verification passed.",
		`Runtime files checked: ${runtimeFileCount}`,
		`Packaged runtime smoke tests: ${runtimeSmokeTests.join(", ")}`,
		`Expected Convex deployment: ${expectedDeployment}`,
		`Expected hosted site URL: ${expectedSiteUrl}`,
		"Server-side OpenAI credential: not embedded",
		`Combined audio echo reduction self-test: ${nativeAudioSelfTestResult.echoReductionRatio}`,
	].join("\n"),
);
