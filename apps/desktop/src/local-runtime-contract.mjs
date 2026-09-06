export const localPythonVersion = "3.13.15";
export const localNodeVersion = "24.18.0";
export const localNodeArchiveHashes = Object.freeze({
	arm64: "e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1",
	x64: "dfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080",
});
export const localPythonRelease = "20260901";
export const localPythonArchives = Object.freeze({
	arm64: {
		target: "aarch64-apple-darwin",
		sha256: "d3904bd6a072246e07aa0bdadee9a14e80521e42a943c0848059feb16a2816dc",
	},
	x64: {
		target: "x86_64-apple-darwin",
		sha256: "f712a9143c8a5d248438ec7921a0b48d548bca4f1337d33c690d28c2d0504137",
	},
});
export const localPythonModules = Object.freeze([
	"numpy",
	"pandas",
	"matplotlib",
	"openpyxl",
	"docx",
	"pptx",
	"PIL",
	"pypdf",
	"reportlab",
]);
