import ApplicationServices
import CoreGraphics
import Foundation

private let emitter = LineEventStdoutEmitter(label: "com.graneri.global-dictation-hotkey")
private let logger = LineEventStderrLogger(label: "com.graneri.global-dictation-hotkey")
private let controlFlag = CGEventFlags.maskControl
private let optionFlag = CGEventFlags.maskAlternate
private let mKeyCode: CGKeyCode = 46
private let shortcutLabel = "Control+Option+M"
private var dictationMode = ""
private var isShortcutDown = false

private func hasDictationShortcutModifiers(_ flags: CGEventFlags) -> Bool {
	return flags.contains(controlFlag) && flags.contains(optionFlag)
}

private func emit(_ type: String) {
	emitter.send(event: [
		"type": type,
		"shortcut": shortcutLabel,
	])
}

private let callback: CGEventTapCallBack = { _, type, event, _ in
	let flags = event.flags
	let keyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))

	switch type {
	case .keyDown:
		if keyCode == mKeyCode && hasDictationShortcutModifiers(flags) && !isShortcutDown {
			isShortcutDown = true
			if dictationMode == "toggle" {
				emit("toggle")
			} else {
				emit("start")
			}
			return nil
		}
	case .keyUp:
		if keyCode == mKeyCode && isShortcutDown {
			isShortcutDown = false
			if dictationMode == "hold" {
				emit("stop")
			}
			return nil
		}
	case .flagsChanged:
		if isShortcutDown && !hasDictationShortcutModifiers(flags) {
			isShortcutDown = false
			if dictationMode == "hold" {
				emit("stop")
			}
		}
	default:
		break
	}

	return Unmanaged.passUnretained(event)
}

@main
struct GlobalDictationHotkeyCLI {
	static func main() {
		guard let modeIndex = CommandLine.arguments.firstIndex(of: "--mode"),
			CommandLine.arguments.indices.contains(modeIndex + 1)
		else {
			logger.log("Global dictation hotkey mode is required.")
			exit(EXIT_FAILURE)
		}
		let requestedMode = CommandLine.arguments[modeIndex + 1]
		guard requestedMode == "hold" || requestedMode == "toggle" else {
			logger.log("Global dictation hotkey mode is invalid.")
			exit(EXIT_FAILURE)
		}
		dictationMode = requestedMode
		let eventMask =
			(1 << CGEventType.keyDown.rawValue) |
			(1 << CGEventType.keyUp.rawValue) |
			(1 << CGEventType.flagsChanged.rawValue)

		guard let eventTap = CGEvent.tapCreate(
			tap: .cgSessionEventTap,
			place: .headInsertEventTap,
			options: .defaultTap,
			eventsOfInterest: CGEventMask(eventMask),
			callback: callback,
			userInfo: nil
		) else {
			logger.log("Failed to create global dictation hotkey event tap. Enable Accessibility access for Graneri.")
			emitter.send(event: [
				"type": "error",
				"message": "Enable Accessibility access for Graneri to use global dictation.",
			])
			exit(1)
		}

		let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
		CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
		CGEvent.tapEnable(tap: eventTap, enable: true)
		emitter.send(event: [
			"type": "ready",
			"mode": dictationMode,
			"shortcut": shortcutLabel,
		])
		CFRunLoopRun()
	}
}
