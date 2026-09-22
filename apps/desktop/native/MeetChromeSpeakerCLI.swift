import AppKit
import ApplicationServices
import Dispatch
import Foundation

private struct MeetParticipant: Equatable {
	let name: String?
	let active: Bool
	let isSelf: Bool
}

private struct MeetRoster {
	let participants: [MeetParticipant]
	let blindReason: String?
}

final class MeetChromeSpeakerMonitor: @unchecked Sendable {
	private let emitter: LineEventStdoutEmitter
	private let queue = DispatchQueue(label: "com.graneri.meet-chrome-speaker.monitor")
	private var timer: DispatchSourceTimer?
	private var latchedMeetWindowTitle: String?
	private var latchedSelfName: String?

	init(emitter: LineEventStdoutEmitter) {
		self.emitter = emitter
	}

	func start() {
		queue.sync {
			poll(type: "ready")
			let timer = DispatchSource.makeTimerSource(queue: queue)
			timer.schedule(deadline: .now() + .milliseconds(500), repeating: .milliseconds(500))
			timer.setEventHandler { [weak self] in
				self?.poll(type: "roster-changed")
			}
			timer.resume()
			self.timer = timer
		}
	}

	private func poll(type: String) {
		let isTrusted = AXIsProcessTrusted()
		if !isTrusted {
			latchedMeetWindowTitle = nil
			latchedSelfName = nil
		}
		let roster = isTrusted
			? readFocusedMeetRoster()
			: MeetRoster(participants: [], blindReason: "accessibility-denied")
		var event: [String: Any] = [
			"type": type,
			"timestamp": Int(Date().timeIntervalSince1970 * 1_000),
			"participants": roster.participants.map { participant in
				[
					"name": participant.name as Any? ?? NSNull(),
					"active": participant.active,
					"isSelf": participant.isSelf,
				] as [String: Any]
			},
		]
		if let blindReason = roster.blindReason {
			event["blindReason"] = blindReason
		}
		emitter.send(event: event)
	}

	private func readFocusedMeetRoster() -> MeetRoster {
		guard let chrome = NSRunningApplication.runningApplications(
			withBundleIdentifier: "com.google.Chrome"
		).first(where: { !$0.isTerminated }) else {
			latchedMeetWindowTitle = nil
			latchedSelfName = nil
			return MeetRoster(participants: [], blindReason: "chrome-not-running")
		}

		let application = AXUIElementCreateApplication(chrome.processIdentifier)
		AXUIElementSetMessagingTimeout(application, 0.2)
		guard let window = Self.element(application, attribute: kAXFocusedWindowAttribute),
			Self.string(window, attribute: kAXTitleAttribute)?.hasPrefix("Meet - ") == true else {
			latchedMeetWindowTitle = nil
			latchedSelfName = nil
			return MeetRoster(participants: [], blindReason: "chrome-window-unavailable")
		}
		let windowTitle = Self.string(window, attribute: kAXTitleAttribute)
		if windowTitle != latchedMeetWindowTitle {
			latchedMeetWindowTitle = windowTitle
			latchedSelfName = nil
		}

		guard let webArea = Self.findWebArea(in: window) else {
			return MeetRoster(participants: [], blindReason: "meet-web-area-unavailable")
		}

		var participants: [MeetParticipant] = []
		var pending: [(AXUIElement, Bool)] = [(webArea, false)]
		var visited = 0
		while !pending.isEmpty && visited < 4_000 {
			let (node, insideSelfPreview) = pending.removeLast()
			visited += 1
			let classes = Self.domClasses(node)
			let isSelfPreview = insideSelfPreview || classes.contains("aGWPv")
			if classes.contains("dkjMxf") || (classes.contains("Gt2yUd") && isSelfPreview) {
				participants.append(Self.readParticipant(node, isSelf: isSelfPreview))
				continue
			}
			for child in Self.children(node).reversed() {
				pending.append((child, isSelfPreview))
			}
		}

		guard visited < 4_000 else {
			return MeetRoster(participants: [], blindReason: "meet-tree-too-large")
		}
		guard !participants.isEmpty else {
			return MeetRoster(participants: [], blindReason: "meet-tiles-unavailable")
		}
		let selfParticipants = participants.filter(\.isSelf)
		guard selfParticipants.count <= 1 else {
			return MeetRoster(participants: [], blindReason: "self-tile-ambiguous")
		}
		if let selfParticipant = selfParticipants.first {
			latchedSelfName = participants.contains {
				!$0.isSelf && $0.name == selfParticipant.name
			} ? nil : selfParticipant.name
		} else {
			guard let latchedSelfName else {
				return MeetRoster(participants: [], blindReason: "self-tile-unavailable")
			}
			let matchingIndices = participants.indices.filter { participants[$0].name == latchedSelfName }
			guard matchingIndices.count <= 1 else {
				return MeetRoster(participants: [], blindReason: "self-name-ambiguous")
			}
			if let index = matchingIndices.first {
				let participant = participants[index]
				participants[index] = MeetParticipant(
					name: participant.name,
					active: participant.active,
					isSelf: true
				)
			}
		}
		return MeetRoster(participants: participants, blindReason: nil)
	}

	private static func readParticipant(_ tile: AXUIElement, isSelf: Bool) -> MeetParticipant {
		var pending = [tile]
		var names = Set<String>()
		var active = false
		var visited = 0
		while let node = pending.popLast(), visited < 300 {
			visited += 1
			let classes = domClasses(node)
			active = active || classes.contains("kssMZb")
			if string(node, attribute: kAXRoleAttribute) == "AXStaticText",
				let name = string(node, attribute: kAXValueAttribute)?.trimmingCharacters(
					in: .whitespacesAndNewlines
				), !name.isEmpty, name.count <= 120, name != "You" {
				names.insert(name)
			}
			pending.append(contentsOf: children(node))
		}
		return MeetParticipant(name: names.count == 1 ? names.first : nil, active: active, isSelf: isSelf)
	}

	private static func findWebArea(in window: AXUIElement) -> AXUIElement? {
		var pending = [window]
		var visited = 0
		while let node = pending.popLast(), visited < 100 {
			visited += 1
			if string(node, attribute: kAXRoleAttribute) == "AXWebArea" {
				return node
			}
			pending.append(contentsOf: children(node))
		}
		return nil
	}

	private static func children(
		_ node: AXUIElement,
		attribute: String = kAXChildrenAttribute
	) -> [AXUIElement] {
		var value: CFTypeRef?
		guard AXUIElementCopyAttributeValue(node, attribute as CFString, &value) == .success else {
			return []
		}
		return value as? [AXUIElement] ?? []
	}

	private static func element(_ node: AXUIElement, attribute: String) -> AXUIElement? {
		var value: CFTypeRef?
		guard AXUIElementCopyAttributeValue(node, attribute as CFString, &value) == .success,
			let value,
			CFGetTypeID(value) == AXUIElementGetTypeID() else {
			return nil
		}
		return (value as! AXUIElement)
	}

	private static func string(_ node: AXUIElement, attribute: String) -> String? {
		var value: CFTypeRef?
		guard AXUIElementCopyAttributeValue(node, attribute as CFString, &value) == .success else {
			return nil
		}
		return value as? String
	}

	private static func domClasses(_ node: AXUIElement) -> Set<String> {
		var value: CFTypeRef?
		guard AXUIElementCopyAttributeValue(node, "AXDOMClassList" as CFString, &value) == .success else {
			return []
		}
		if let classes = value as? [String] {
			return Set(classes)
		}
		if let classes = value as? String {
			return Set(classes.split(separator: " ").map(String.init))
		}
		return []
	}
}

@main
enum MeetChromeSpeakerCLI {
	static func main() {
		setbuf(stdout, nil)
		let monitor = MeetChromeSpeakerMonitor(
			emitter: LineEventStdoutEmitter(label: "com.graneri.meet-chrome-speaker")
		)
		monitor.start()
		signal(SIGINT) { _ in exit(EXIT_SUCCESS) }
		signal(SIGTERM) { _ in exit(EXIT_SUCCESS) }
		RunLoop.main.run()
	}
}
