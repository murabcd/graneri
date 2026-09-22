import AppKit
import CoreGraphics
import Foundation

private struct SystemSettingsWindow: Equatable {
	let x: Int
	let y: Int
	let width: Int
	let height: Int

	var eventFields: [String: Any] {
		["x": x, "y": y, "width": width, "height": height]
	}
}

@main
enum SystemSettingsWindowCLI {
	static func main() {
		setbuf(stdout, nil)

		let emitter = LineEventStdoutEmitter(label: "com.graneri.system-settings-window")
		var lastWindow: SystemSettingsWindow?

		func publish(type: String) {
			let window = findFrontmostSystemSettingsWindow()
			guard type == "ready" || window != lastWindow else { return }
			lastWindow = window

			var event: [String: Any] = ["type": type, "active": window != nil]
			if let window {
				event.merge(window.eventFields) { _, new in new }
			}
			emitter.send(event: event)
		}

		publish(type: "ready")
		Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in
			Task { @MainActor in
				publish(type: "window-changed")
			}
		}
		RunLoop.main.run()
	}

	private static func findFrontmostSystemSettingsWindow() -> SystemSettingsWindow? {
		guard let application = NSWorkspace.shared.frontmostApplication,
			application.bundleIdentifier == "com.apple.systempreferences",
			let windows = CGWindowListCopyWindowInfo(
				[.optionOnScreenOnly, .excludeDesktopElements],
				kCGNullWindowID
			) as? [[String: Any]]
		else {
			return nil
		}

		for window in windows {
			guard window[kCGWindowOwnerPID as String] as? Int == Int(application.processIdentifier),
				window[kCGWindowLayer as String] as? Int == 0,
				let bounds = window[kCGWindowBounds as String] as? NSDictionary,
				let frame = CGRect(dictionaryRepresentation: bounds)
			else {
				continue
			}

			let width = Int(frame.width.rounded())
			let height = Int(frame.height.rounded())
			guard width >= 300, height >= 300 else { continue }

			return SystemSettingsWindow(
				x: Int(frame.minX.rounded()),
				y: Int(frame.minY.rounded()),
				width: width,
				height: height
			)
		}

		return nil
	}
}
