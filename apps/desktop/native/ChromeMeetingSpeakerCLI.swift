import AppKit
import ApplicationServices
import Dispatch
import Foundation

private struct MeetingParticipant: Equatable {
	let name: String?
	let active: Bool
	let isSelf: Bool
}

private struct MeetingRoster {
	let participants: [MeetingParticipant]
	let scope: String?
	let blindReason: String?
}

private enum MeetingProvider {
	case googleMeet
	case yandexTelemost
}

private struct MeetingPage {
	let webArea: AXUIElement
	let scope: String
	let provider: MeetingProvider
}

final class ChromeMeetingSpeakerMonitor: @unchecked Sendable {
	private let emitter: LineEventStdoutEmitter
	private let queue = DispatchQueue(label: "com.graneri.chrome-meeting-speaker.monitor")
	private var timer: DispatchSourceTimer?
	private var selectedScope: String?
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
			selectedScope = nil
			latchedSelfName = nil
		}
		let roster = isTrusted
			? readSelectedMeetingRoster()
			: MeetingRoster(participants: [], scope: nil, blindReason: "accessibility-denied")
		var event: [String: Any] = [
			"type": type,
			"timestamp": Int(Date().timeIntervalSince1970 * 1_000),
			"scope": roster.scope as Any? ?? NSNull(),
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

	private func readSelectedMeetingRoster() -> MeetingRoster {
		let chromeApps = NSRunningApplication.runningApplications(
			withBundleIdentifier: "com.google.Chrome"
		).filter { !$0.isTerminated }
		guard !chromeApps.isEmpty else {
			selectedScope = nil
			latchedSelfName = nil
			return MeetingRoster(participants: [], scope: nil, blindReason: "chrome-not-running")
		}
		let pages = chromeApps.flatMap { chrome -> [MeetingPage] in
			let application = AXUIElementCreateApplication(chrome.processIdentifier)
			AXUIElementSetMessagingTimeout(application, 0.2)
			return Self.children(application, attribute: kAXWindowsAttribute).flatMap { window in
				guard let title = Self.string(window, attribute: kAXTitleAttribute),
					title.hasPrefix("Meet - ") || title.contains("Яндекс Телемост") ||
						title.contains("Yandex Telemost") else {
					return [MeetingPage]()
				}
				return Self.meetingPages(in: window)
			}
		}
		guard pages.count == 1, let page = pages.first else {
			selectedScope = nil
			latchedSelfName = nil
			return MeetingRoster(
				participants: [],
				scope: nil,
				blindReason: pages.isEmpty ? "chrome-meeting-unavailable" : "chrome-meeting-ambiguous"
			)
		}
		if page.scope != selectedScope {
			selectedScope = page.scope
			latchedSelfName = nil
		}
		switch page.provider {
		case .googleMeet:
			return readMeetRoster(in: page)
		case .yandexTelemost:
			return Self.readTelemostRoster(in: page)
		}
	}

	private func readMeetRoster(in page: MeetingPage) -> MeetingRoster {
		var participants: [MeetingParticipant] = []
		var pending: [(AXUIElement, Bool)] = [(page.webArea, false)]
		var visited = 0
		while !pending.isEmpty && visited < 4_000 {
			let (node, insideSelfPreview) = pending.removeLast()
			visited += 1
			let classes = Self.domClasses(node)
			let isSelfPreview = insideSelfPreview || classes.contains("aGWPv")
			if classes.contains("dkjMxf") || (classes.contains("Gt2yUd") && isSelfPreview) {
				participants.append(Self.readMeetParticipant(node, isSelf: isSelfPreview))
				continue
			}
			for child in Self.children(node).reversed() {
				pending.append((child, isSelfPreview))
			}
		}

		guard visited < 4_000 else {
			return MeetingRoster(participants: [], scope: page.scope, blindReason: "meet-tree-too-large")
		}
		guard !participants.isEmpty else {
			return MeetingRoster(participants: [], scope: page.scope, blindReason: "meet-tiles-unavailable")
		}
		let selfParticipants = participants.filter(\.isSelf)
		guard selfParticipants.count <= 1 else {
			return MeetingRoster(participants: [], scope: page.scope, blindReason: "self-tile-ambiguous")
		}
		if let selfParticipant = selfParticipants.first {
			latchedSelfName = participants.contains {
				!$0.isSelf && $0.name == selfParticipant.name
			} ? nil : selfParticipant.name
		} else {
			guard let latchedSelfName else {
				return MeetingRoster(participants: [], scope: page.scope, blindReason: "self-tile-unavailable")
			}
			let matchingIndices = participants.indices.filter { participants[$0].name == latchedSelfName }
			guard matchingIndices.count <= 1 else {
				return MeetingRoster(participants: [], scope: page.scope, blindReason: "self-name-ambiguous")
			}
			if let index = matchingIndices.first {
				let participant = participants[index]
				participants[index] = MeetingParticipant(
					name: participant.name,
					active: participant.active,
					isSelf: true
				)
			}
		}
		return MeetingRoster(participants: participants, scope: page.scope, blindReason: nil)
	}

	private static func readMeetParticipant(_ tile: AXUIElement, isSelf: Bool) -> MeetingParticipant {
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
		return MeetingParticipant(name: names.count == 1 ? names.first : nil, active: active, isSelf: isSelf)
	}

	private static func readTelemostRoster(in page: MeetingPage) -> MeetingRoster {
		var pending = [page.webArea]
		var renderer: AXUIElement?
		var visited = 0
		while let node = pending.popLast(), visited < 3_000 {
			visited += 1
			if domClasses(node).contains("GoloomParticipantsRenderer") {
				renderer = node
				break
			}
			pending.append(contentsOf: children(node).reversed())
		}
		guard let renderer else {
			return MeetingRoster(participants: [], scope: page.scope, blindReason: "telemost-tiles-unavailable")
		}
		var participants: [MeetingParticipant] = []
		var tiles: [(AXUIElement, Bool)] = [(renderer, false)]
		visited = 0
		while let (node, insideSelfTile) = tiles.popLast(), visited < 4_000 {
			visited += 1
			let classes = domClasses(node)
			let isSelf = insideSelfTile || classes.contains { $0.hasPrefix("selfView_") }
			if classes.contains(where: { $0.hasPrefix("rootTeleMessenger_") }) {
				participants.append(readTelemostParticipant(node, isSelf: isSelf))
				continue
			}
			for child in children(node).reversed() {
				tiles.append((child, isSelf))
			}
		}
		guard visited < 4_000, !participants.isEmpty, participants.count <= 200 else {
			return MeetingRoster(participants: [], scope: page.scope, blindReason: "telemost-tiles-unavailable")
		}
		guard participants.filter(\.isSelf).count == 1 else {
			return MeetingRoster(participants: [], scope: page.scope, blindReason: "self-tile-ambiguous")
		}
		return MeetingRoster(participants: participants, scope: page.scope, blindReason: nil)
	}

	private static func readTelemostParticipant(_ tile: AXUIElement, isSelf: Bool) -> MeetingParticipant {
		let active = domClasses(tile).contains { $0.hasPrefix("rootStroke_") }
		var names = Set<String>()
		var pending: [(AXUIElement, Bool)] = [(tile, false)]
		var visited = 0
		while let (node, insideName) = pending.popLast(), visited < 300 {
			visited += 1
			let isName = insideName || domClasses(node).contains { $0.hasPrefix("TextName_") }
			if isName, string(node, attribute: kAXRoleAttribute) == "AXStaticText",
				let name = string(node, attribute: kAXValueAttribute)?.trimmingCharacters(
					in: .whitespacesAndNewlines
				), !name.isEmpty, name.count <= 120 {
				names.insert(name)
			}
			for child in children(node).reversed() {
				pending.append((child, isName))
			}
		}
		return MeetingParticipant(name: visited < 300 && names.count == 1 ? names.first : nil,
			active: active, isSelf: isSelf)
	}

	private static func meetingPages(in window: AXUIElement) -> [MeetingPage] {
		var pending = [window]
		var pages: [MeetingPage] = []
		var visited = 0
		while let node = pending.popLast(), visited < 400 {
			visited += 1
			if string(node, attribute: kAXRoleAttribute) == "AXWebArea",
				let url = url(node, attribute: "AXURL"),
				let host = url.host?.lowercased() {
				let path = url.pathComponents
				if host == "meet.google.com", path.count >= 2,
					let code = path.last, code.count <= 100 {
					pages.append(MeetingPage(webArea: node, scope: "google-meet:\(code)", provider: .googleMeet))
				} else if (host == "telemost.yandex.ru" || host == "telemost.360.yandex.ru"),
					path.count == 3, path[1] == "private-join", path[2].count <= 100 {
					pages.append(MeetingPage(webArea: node, scope: "yandex-telemost:\(path[2])",
						provider: .yandexTelemost))
				}
			}
			pending.append(contentsOf: children(node).reversed())
		}
		return pages
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

	private static func string(_ node: AXUIElement, attribute: String) -> String? {
		var value: CFTypeRef?
		guard AXUIElementCopyAttributeValue(node, attribute as CFString, &value) == .success else {
			return nil
		}
		return value as? String
	}

	private static func url(_ node: AXUIElement, attribute: String) -> URL? {
		var value: CFTypeRef?
		guard AXUIElementCopyAttributeValue(node, attribute as CFString, &value) == .success else {
			return nil
		}
		if let url = value as? URL {
			return url
		}
		if let raw = value as? String {
			return URL(string: raw)
		}
		return nil
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
enum ChromeMeetingSpeakerCLI {
	static func main() {
		setbuf(stdout, nil)
		let monitor = ChromeMeetingSpeakerMonitor(
			emitter: LineEventStdoutEmitter(label: "com.graneri.chrome-meeting-speaker")
		)
		monitor.start()
		signal(SIGINT) { _ in exit(EXIT_SUCCESS) }
		signal(SIGTERM) { _ in exit(EXIT_SUCCESS) }
		RunLoop.main.run()
	}
}
