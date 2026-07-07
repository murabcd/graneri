import { desktopPackageContract } from "./scripts/desktop-package-contract.mjs";

const trimConfigValue = (value) =>
	typeof value === "string" ? value.trim() : "";

const resolveMacSigningIdentity = ({ env, isProductionBuild }) => {
	if (!isProductionBuild) {
		return "-";
	}

	return trimConfigValue(env.GRANERI_MAC_SIGNING_IDENTITY) || undefined;
};

export const createElectronBuilderConfig = ({ env = process.env } = {}) => {
	const isProductionBuild =
		trimConfigValue(env.GRANERI_ENV_MODE) === "production";
	const defaultAppId = isProductionBuild
		? "com.graneri.desktop"
		: "dev.graneri.desktop";
	const githubOwner = trimConfigValue(env.VITE_GITHUB_OWNER);
	const githubRepo = trimConfigValue(env.VITE_GITHUB_REPO);

	const publish =
		githubOwner && githubRepo
			? [
					{
						provider: "github",
						owner: githubOwner,
						repo: githubRepo,
						releaseType: "release",
					},
				]
			: undefined;

	return {
		appId: trimConfigValue(env.GRANERI_DESKTOP_APP_ID) || defaultAppId,
		productName: trimConfigValue(env.GRANERI_DESKTOP_PRODUCT_NAME) || "Graneri",
		directories: {
			app: desktopPackageContract.appDirectory,
			buildResources: "build",
			output: "release",
		},
		files: desktopPackageContract.builderFiles,
		forceCodeSigning: isProductionBuild,
		asarUnpack: desktopPackageContract.asarUnpack,
		mac: {
			target: ["dmg", "zip"],
			category: "public.app-category.productivity",
			icon: "build/icon.icns",
			identity: resolveMacSigningIdentity({ env, isProductionBuild }),
			hardenedRuntime: true,
			gatekeeperAssess: false,
			notarize: isProductionBuild,
			extendInfo: {
				NSMicrophoneUsageDescription:
					"During your meetings, Graneri transcribes your microphone.",
				NSAudioCaptureUsageDescription:
					"During your meetings, Graneri transcribes your system audio output.",
			},
			entitlements: "build/entitlements.mac.plist",
			entitlementsInherit: "build/entitlements.mac.plist",
		},
		publish,
	};
};

export default createElectronBuilderConfig();
