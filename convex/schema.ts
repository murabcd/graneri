import { vWorkflowId } from "@convex-dev/workflow";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { assistantQueuedMessageAcceptanceTableValidator } from "./assistantQueuedMessageAcceptanceModel";
import { assistantQueuedMessageTableValidator } from "./assistantQueuedMessageModel";
import { assistantRunPlanValidator } from "./assistantRunActivityModel";
import { assistantRunEventValidator } from "./assistantRunEventModel";
import {
	assistantRunExecutionValidator,
	assistantRunJobValidator,
} from "./assistantRunJobModel";
import {
	assistantRunProducerValidator,
	assistantRunStatusValidator,
	localCapabilitySessionValidator,
	pendingDecisionValidator,
	reasoningEffortValidator,
	serviceTierValidator,
	stopReasonValidator,
} from "./assistantRunModel";
import { assistantRunSteerInputTableValidator } from "./assistantRunSteerInputModel";
import {
	automationAppSourceProviderValidator,
	automationDeliveryPolicyValidator,
	automationDeliveryStatusValidator,
	automationDestinationValidator,
	automationRunReasonValidator,
	automationRunStatusValidator,
	automationScheduleValidator,
} from "./automationValidators";
import {
	calendarAttendeeResponseStatusValidator,
	calendarEventSnapshotValidator,
} from "./calendarValidators";
import { chatSettingsFields } from "./chatSettingsModel";
import {
	projectColorValidator,
	projectIconValidator,
} from "./projectAppearance";
import { settingsImagePurposeValidator } from "./settingsImageUploadModel";

const transcriptSessionStatusValidator = v.union(
	v.literal("capturing"),
	v.literal("stopping"),
	v.literal("completed"),
	v.literal("failed"),
);

const transcriptRefinementStatusValidator = v.union(
	v.literal("idle"),
	v.literal("running"),
	v.literal("completed"),
	v.literal("failed"),
);

const chatContextCheckpointValidator = v.object({
	summary: v.string(),
	throughCreationTime: v.number(),
	throughMessageId: v.string(),
	updatedAt: v.number(),
});

const chatContextStateBaseValidator = v.object({
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	chatId: v.id("chats"),
	createdAt: v.number(),
	updatedAt: v.number(),
});

const chatContextActivityBaseValidator = {
	activityId: v.string(),
	anchorMessageId: v.string(),
	startedAt: v.number(),
};

const chatContextStateValidator = v.union(
	chatContextStateBaseValidator.extend({
		kind: v.literal("checkpoint"),
		checkpoint: chatContextCheckpointValidator,
	}),
	chatContextStateBaseValidator.extend({
		...chatContextActivityBaseValidator,
		kind: v.literal("running"),
		checkpoint: v.optional(chatContextCheckpointValidator),
	}),
	chatContextStateBaseValidator.extend({
		...chatContextActivityBaseValidator,
		kind: v.literal("completed"),
		checkpoint: chatContextCheckpointValidator,
		completedAt: v.number(),
	}),
);

const appConnectionProviderValidator = v.union(
	v.literal("yandex-tracker"),
	v.literal("yandex-calendar"),
	v.literal("jira"),
	v.literal("jira-mcp"),
	v.literal("posthog"),
	v.literal("notion"),
	v.literal("zoom"),
	v.literal("context7"),
	v.literal("figma"),
	v.literal("linear"),
);

const appConnectionStatusValidator = v.union(
	v.literal("connected"),
	v.literal("disconnected"),
);

const inboxItemProviderValidator = v.union(
	v.literal("jira"),
	v.literal("notes"),
);
const inboxItemKindValidator = v.union(
	v.literal("jira-mention"),
	v.literal("note-comment"),
);

const aiRateLimitOperationValidator = v.union(
	v.literal("chat-turn"),
	v.literal("dictation"),
	v.literal("note-generation"),
	v.literal("realtime-session"),
);

const appConnectionOrgTypeValidator = v.union(
	v.literal("x-org-id"),
	v.literal("x-cloud-org-id"),
);

export default defineSchema({
	userPreferences: defineTable({
		ownerTokenIdentifier: v.string(),
		transcriptionLanguage: v.union(v.string(), v.null()),
		jobTitle: v.union(v.string(), v.null()),
		companyName: v.union(v.string(), v.null()),
		fontSmoothing: v.boolean(),
		reduceMotion: v.union(
			v.literal("system"),
			v.literal("on"),
			v.literal("off"),
		),
		translucentSidebar: v.boolean(),
		followUpBehavior: v.union(v.literal("queue"), v.literal("steer")),
		sendShortcut: v.union(v.literal("enter"), v.literal("command-enter")),
		avatarStorageId: v.optional(v.id("_storage")),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"]),
	settingsImageUploads: defineTable({
		ownerTokenIdentifier: v.string(),
		purpose: settingsImagePurposeValidator,
		storageId: v.id("_storage"),
		createdAt: v.number(),
	}).index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"]),
	chatPreferences: defineTable({
		ownerTokenIdentifier: v.string(),
		...chatSettingsFields,
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"]),
	notificationPreferences: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		notifyForScheduledMeetings: v.boolean(),
		notifyForAutoDetectedMeetings: v.boolean(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_ownerTokenIdentifier_and_workspaceId", [
			"ownerTokenIdentifier",
			"workspaceId",
		])
		.index("by_ownerTokenIdentifier_and_updatedAt", [
			"ownerTokenIdentifier",
			"updatedAt",
		]),
	calendarPreferences: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		showGoogleCalendar: v.boolean(),
		showGoogleDrive: v.optional(v.boolean()),
		showYandexCalendar: v.boolean(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_ownerTokenIdentifier_and_workspaceId", [
			"ownerTokenIdentifier",
			"workspaceId",
		])
		.index("by_ownerTokenIdentifier_and_updatedAt", [
			"ownerTokenIdentifier",
			"updatedAt",
		]),
	onboardingStates: defineTable({
		ownerTokenIdentifier: v.string(),
		hasSeenWelcomeCelebration: v.boolean(),
		hasCompletedDesktopPermissions: v.boolean(),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"]),
	templates: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		slug: v.string(),
		name: v.string(),
		meetingContext: v.string(),
		sections: v.array(
			v.object({
				id: v.string(),
				title: v.string(),
				prompt: v.string(),
			}),
		),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"createdAt",
		])
		.index("by_ownerTokenIdentifier_and_createdAt", [
			"ownerTokenIdentifier",
			"createdAt",
		])
		.index("by_ownerTokenIdentifier_and_slug", [
			"ownerTokenIdentifier",
			"slug",
		]),
	recipes: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		slug: v.string(),
		name: v.string(),
		prompt: v.string(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"createdAt",
		])
		.index("by_ownerTokenIdentifier_and_createdAt", [
			"ownerTokenIdentifier",
			"createdAt",
		]),
	workspaces: defineTable({
		ownerTokenIdentifier: v.string(),
		name: v.string(),
		normalizedName: v.string(),
		iconStorageId: v.optional(v.id("_storage")),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_ownerTokenIdentifier_and_createdAt", [
			"ownerTokenIdentifier",
			"createdAt",
		])
		.index("by_updatedAt", ["updatedAt"])
		.index("by_ownerTokenIdentifier_and_normalizedName", [
			"ownerTokenIdentifier",
			"normalizedName",
		]),
	projects: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		name: v.string(),
		description: v.string(),
		normalizedName: v.string(),
		icon: projectIconValidator,
		color: projectColorValidator,
		isStarred: v.optional(v.boolean()),
		sortOrder: v.number(),
		starredSortOrder: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_owner_ws_sortOrder", [
			"ownerTokenIdentifier",
			"workspaceId",
			"sortOrder",
		])
		.index("by_owner_ws_normalizedName", [
			"ownerTokenIdentifier",
			"workspaceId",
			"normalizedName",
		])
		.index("by_owner_ws_createdAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"createdAt",
		])
		.index("by_owner_ws_updatedAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"updatedAt",
		])
		.index("by_owner_workspace_starred_starredOrder", [
			"ownerTokenIdentifier",
			"workspaceId",
			"isStarred",
			"starredSortOrder",
		]),
	notes: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		projectId: v.optional(v.id("projects")),
		calendarEvent: v.optional(calendarEventSnapshotValidator),
		authorName: v.optional(v.string()),
		isStarred: v.optional(v.boolean()),
		starredSortOrder: v.number(),
		title: v.string(),
		templateSlug: v.optional(v.string()),
		visibility: v.union(v.literal("private"), v.literal("public")),
		shareId: v.optional(v.string()),
		sharedAt: v.optional(v.number()),
		isArchived: v.boolean(),
		archivedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_ownerTokenIdentifier_and_workspaceId_and_updatedAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"updatedAt",
		])
		.index("by_owner_ws_arch_upd", [
			"ownerTokenIdentifier",
			"workspaceId",
			"isArchived",
			"updatedAt",
		])
		.index("by_owner_ws_archived_archivedAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"isArchived",
			"archivedAt",
		])
		.index("by_ownerTokenIdentifier_and_updatedAt", [
			"ownerTokenIdentifier",
			"updatedAt",
		])
		.index("by_owner_ws_calendarEventKey_archived", [
			"ownerTokenIdentifier",
			"workspaceId",
			"calendarEvent.key",
			"isArchived",
		])
		.index("by_owner_ws_project_arch_upd", [
			"ownerTokenIdentifier",
			"workspaceId",
			"projectId",
			"isArchived",
			"updatedAt",
		])
		.index("by_owner_workspace_archived_starred_starredOrder", [
			"ownerTokenIdentifier",
			"workspaceId",
			"isArchived",
			"isStarred",
			"starredSortOrder",
		])
		.index("by_ownerTokenIdentifier_and_isArchived_and_updatedAt", [
			"ownerTokenIdentifier",
			"isArchived",
			"updatedAt",
		])
		.searchIndex("search_title", {
			searchField: "title",
			filterFields: [
				"ownerTokenIdentifier",
				"workspaceId",
				"projectId",
				"isArchived",
			],
		})
		.index("by_owner_visibility_archived_updatedAt", [
			"ownerTokenIdentifier",
			"visibility",
			"isArchived",
			"updatedAt",
		])
		.index("by_shareId", ["shareId"]),
	noteDocuments: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		projectId: v.optional(v.id("projects")),
		isArchived: v.boolean(),
		content: v.string(),
		searchableText: v.string(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_noteId", ["noteId"])
		.searchIndex("search_text", {
			searchField: "searchableText",
			filterFields: [
				"ownerTokenIdentifier",
				"workspaceId",
				"projectId",
				"isArchived",
			],
		}),
	people: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		email: v.string(),
		displayName: v.optional(v.string()),
		searchText: v.string(),
		calendarDiscoveredAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_ownerTokenIdentifier_and_workspaceId_and_email", [
			"ownerTokenIdentifier",
			"workspaceId",
			"email",
		])
		.searchIndex("search_people", {
			searchField: "searchText",
			filterFields: ["ownerTokenIdentifier", "workspaceId"],
		}),
	companies: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		domain: v.string(),
		displayName: v.string(),
		searchText: v.string(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_ownerTokenIdentifier_and_workspaceId_and_domain", [
			"ownerTokenIdentifier",
			"workspaceId",
			"domain",
		])
		.searchIndex("search_companies", {
			searchField: "searchText",
			filterFields: ["ownerTokenIdentifier", "workspaceId"],
		}),
	noteAttendees: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		personId: v.optional(v.id("people")),
		companyId: v.optional(v.id("companies")),
		email: v.string(),
		displayName: v.optional(v.string()),
		responseStatus: calendarAttendeeResponseStatusValidator,
		isOrganizer: v.boolean(),
		isSelf: v.boolean(),
		eventStartAt: v.string(),
		noteIsArchived: v.boolean(),
		createdAt: v.number(),
	})
		.index("by_owner_ws_note", [
			"ownerTokenIdentifier",
			"workspaceId",
			"noteId",
		])
		.index("by_owner_ws_person_arch_start", [
			"ownerTokenIdentifier",
			"workspaceId",
			"personId",
			"noteIsArchived",
			"eventStartAt",
		]),
	noteCompanies: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		companyId: v.id("companies"),
		eventStartAt: v.string(),
		noteIsArchived: v.boolean(),
		createdAt: v.number(),
	})
		.index("by_owner_ws_note", [
			"ownerTokenIdentifier",
			"workspaceId",
			"noteId",
		])
		.index("by_owner_ws_company_arch_start", [
			"ownerTokenIdentifier",
			"workspaceId",
			"companyId",
			"noteIsArchived",
			"eventStartAt",
		]),
	noteRevisions: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		authorName: v.string(),
		title: v.string(),
		content: v.string(),
		searchableText: v.string(),
		createdAt: v.number(),
	})
		.index("by_owner_ws_note_createdAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"noteId",
			"createdAt",
		])
		.index("by_ownerTokenIdentifier_and_noteId", [
			"ownerTokenIdentifier",
			"noteId",
		]),
	noteImages: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		storageId: v.id("_storage"),
		fileName: v.string(),
		contentType: v.string(),
		size: v.number(),
		createdAt: v.number(),
	}).index("by_ownerTokenIdentifier_and_noteId", [
		"ownerTokenIdentifier",
		"noteId",
	]),
	noteImageReferences: defineTable({
		noteId: v.id("notes"),
		revisionId: v.union(v.id("noteRevisions"), v.null()),
		noteImageId: v.id("noteImages"),
	})
		.index("by_noteId_and_revisionId", ["noteId", "revisionId"])
		.index("by_noteImageId", ["noteImageId"]),
	noteAttachmentReferences: defineTable({
		noteId: v.id("notes"),
		storageId: v.id("_storage"),
		filename: v.string(),
		mediaType: v.string(),
		sizeBytes: v.number(),
		createdAt: v.number(),
	})
		.index("by_noteId", ["noteId"])
		.index("by_storageId", ["storageId"]),
	noteAttachmentDocumentReferences: defineTable({
		noteId: v.id("notes"),
		revisionId: v.union(v.id("noteRevisions"), v.null()),
		noteAttachmentId: v.id("noteAttachmentReferences"),
	})
		.index("by_noteId_and_revisionId", ["noteId", "revisionId"])
		.index("by_noteAttachmentId", ["noteAttachmentId"]),
	noteCommentThreads: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		createdByName: v.string(),
		excerpt: v.string(),
		isResolved: v.boolean(),
		isRead: v.boolean(),
		isMutedReplies: v.optional(v.boolean()),
		readAt: v.optional(v.number()),
		resolvedAt: v.optional(v.number()),
		resolvedByName: v.optional(v.string()),
		commentCount: v.number(),
		replyAuthorNames: v.array(v.string()),
		latestCommentPreview: v.string(),
		latestCommentIsReply: v.boolean(),
		createdAt: v.number(),
		updatedAt: v.number(),
		lastCommentAt: v.number(),
	})
		.index("by_owner_ws_note_updatedAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"noteId",
			"updatedAt",
		])
		.index("by_owner_ws_note_resolved_updatedAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"noteId",
			"isResolved",
			"updatedAt",
		])
		.index("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"createdAt",
		])
		.index("by_ownerTokenIdentifier_and_createdAt", [
			"ownerTokenIdentifier",
			"createdAt",
		]),
	noteComments: defineTable({
		threadId: v.id("noteCommentThreads"),
		parentCommentId: v.optional(v.id("noteComments")),
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
		authorName: v.string(),
		body: v.string(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_threadId_and_createdAt", ["threadId", "createdAt"])
		.index("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"createdAt",
		])
		.index("by_ownerTokenIdentifier_and_createdAt", [
			"ownerTokenIdentifier",
			"createdAt",
		]),
	chats: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		projectId: v.union(v.id("projects"), v.null()),
		authorName: v.optional(v.string()),
		chatId: v.string(),
		noteId: v.optional(v.id("notes")),
		forkedFromChatId: v.optional(v.string()),
		forkedFromMessageId: v.optional(v.string()),
		historyOmittedBefore: v.optional(v.boolean()),
		isStarred: v.optional(v.boolean()),
		starredSortOrder: v.number(),
		title: v.string(),
		preview: v.string(),
		...chatSettingsFields,
		unreadAssistantCompletedAt: v.optional(v.number()),
		isArchived: v.boolean(),
		archivedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
		lastMessageAt: v.number(),
	})
		.index("by_ownerTokenIdentifier_and_workspaceId_and_updatedAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"updatedAt",
		])
		.index("by_owner_ws_chat_arch_upd", [
			"ownerTokenIdentifier",
			"workspaceId",
			"isArchived",
			"updatedAt",
		])
		.index("by_owner_ws_archived_archivedAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"isArchived",
			"archivedAt",
		])
		.index("by_owner_ws_note_chat_arch_upd", [
			"ownerTokenIdentifier",
			"workspaceId",
			"noteId",
			"isArchived",
			"updatedAt",
		])
		.index("by_owner_ws_project_arch_upd", [
			"ownerTokenIdentifier",
			"workspaceId",
			"projectId",
			"isArchived",
			"updatedAt",
		])
		.index("by_owner_workspace_archived_starred_starredOrder", [
			"ownerTokenIdentifier",
			"workspaceId",
			"isArchived",
			"isStarred",
			"starredSortOrder",
		])
		.index("by_ownerTokenIdentifier_and_workspaceId_and_chatId", [
			"ownerTokenIdentifier",
			"workspaceId",
			"chatId",
		])
		.index("by_ownerTokenIdentifier_and_workspaceId_and_noteId_and_chatId", [
			"ownerTokenIdentifier",
			"workspaceId",
			"noteId",
			"chatId",
		])
		.index("by_ownerTokenIdentifier_and_updatedAt", [
			"ownerTokenIdentifier",
			"updatedAt",
		])
		.index("by_ownerTokenIdentifier_and_isArchived_and_updatedAt", [
			"ownerTokenIdentifier",
			"isArchived",
			"updatedAt",
		])
		.index("by_ownerTokenIdentifier_and_noteId_and_isArchived_and_updatedAt", [
			"ownerTokenIdentifier",
			"noteId",
			"isArchived",
			"updatedAt",
		])
		.index("by_ownerTokenIdentifier_and_chatId", [
			"ownerTokenIdentifier",
			"chatId",
		])
		.index("by_ownerTokenIdentifier_and_noteId_and_chatId", [
			"ownerTokenIdentifier",
			"noteId",
			"chatId",
		])
		.searchIndex("search_title", {
			searchField: "title",
			filterFields: ["ownerTokenIdentifier", "workspaceId", "isArchived"],
		})
		.searchIndex("search_preview", {
			searchField: "preview",
			filterFields: ["ownerTokenIdentifier", "workspaceId", "isArchived"],
		}),
	chatMessages: defineTable({
		chatId: v.id("chats"),
		ownerTokenIdentifier: v.string(),
		messageId: v.string(),
		role: v.union(v.literal("user"), v.literal("assistant")),
		partsJson: v.string(),
		metadataJson: v.optional(v.string()),
		text: v.string(),
		createdAt: v.number(),
	})
		.index("by_chatId", ["chatId"])
		.index("by_chatId_and_createdAt", ["chatId", "createdAt"])
		.index("by_chatId_and_messageId", ["chatId", "messageId"]),
	chatAttachmentReferences: defineTable({
		chatId: v.id("chats"),
		messageId: v.string(),
		storageId: v.id("_storage"),
		filename: v.string(),
		mediaType: v.string(),
		sizeBytes: v.number(),
	})
		.index("by_chatId_and_messageId", ["chatId", "messageId"])
		.index("by_storageId", ["storageId"]),
	artifactJobs: defineTable({
		ownerTokenIdentifier: v.string(),
		chatId: v.id("chats"),
		runId: v.optional(v.id("assistantRuns")),
		idempotencyKey: v.string(),
		requestHash: v.string(),
		operationJson: v.string(),
		callbackToken: v.string(),
		status: v.union(
			v.literal("processing"),
			v.literal("completed"),
			v.literal("failed"),
		),
		errorText: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_owner_chat_idempotency", [
			"ownerTokenIdentifier",
			"chatId",
			"idempotencyKey",
		])
		.index("by_runId", ["runId"]),
	artifactJobOutputs: defineTable({
		jobId: v.id("artifactJobs"),
		storageId: v.id("_storage"),
		filename: v.string(),
		mediaType: v.string(),
		sha256: v.string(),
		sizeBytes: v.number(),
		claimed: v.boolean(),
		createdAt: v.number(),
	})
		.index("by_jobId", ["jobId"])
		.index("by_storageId", ["storageId"]),
	chatBranches: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		chatId: v.id("chats"),
		forkedFromMessageId: v.string(),
		retainedThroughMessageId: v.optional(v.string()),
		messageCount: v.number(),
		preview: v.string(),
		createdAt: v.number(),
	}).index("by_chatId_and_createdAt", ["chatId", "createdAt"]),
	chatBranchMessages: defineTable({
		branchId: v.id("chatBranches"),
		chatId: v.id("chats"),
		ownerTokenIdentifier: v.string(),
		sequence: v.number(),
		messageId: v.string(),
		role: v.union(v.literal("user"), v.literal("assistant")),
		partsJson: v.string(),
		metadataJson: v.optional(v.string()),
		text: v.string(),
		createdAt: v.number(),
	})
		.index("by_chatId", ["chatId"])
		.index("by_branchId_and_sequence", ["branchId", "sequence"]),
	chatContextStates: defineTable(chatContextStateValidator).index("by_chatId", [
		"chatId",
	]),
	assistantRuns: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		chatId: v.id("chats"),
		assistantMessageId: v.string(),
		producer: assistantRunProducerValidator,
		localCapabilitySession: v.union(localCapabilitySessionValidator, v.null()),
		status: assistantRunStatusValidator,
		model: v.string(),
		reasoningEffort: v.optional(reasoningEffortValidator),
		serviceTier: serviceTierValidator,
		phase: v.optional(v.string()),
		pendingDecision: v.optional(pendingDecisionValidator),
		stopReason: v.optional(stopReasonValidator),
		errorText: v.optional(v.string()),
		startedAt: v.number(),
		updatedAt: v.number(),
		finishedAt: v.optional(v.number()),
	})
		.index("by_chatId", ["chatId"])
		.index("by_chatId_and_status", ["chatId", "status"])
		.index("by_workspaceId_and_chatId", ["workspaceId", "chatId"])
		.index("by_workspaceId_and_status", ["workspaceId", "status"])
		.index("by_status_and_updatedAt", ["status", "updatedAt"])
		.index("by_assistantMessageId", ["assistantMessageId"]),
	assistantRunEvents: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		chatId: v.id("chats"),
		runId: v.id("assistantRuns"),
		eventIndex: v.number(),
		event: assistantRunEventValidator,
		createdAt: v.number(),
	}).index("by_runId_and_eventIndex", ["runId", "eventIndex"]),
	assistantRunActivities: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		chatId: v.id("chats"),
		runId: v.id("assistantRuns"),
		plan: assistantRunPlanValidator,
		updatedAt: v.number(),
	}).index("by_runId", ["runId"]),
	assistantRunJobs: defineTable({
		ownerTokenIdentifier: v.string(),
		runId: v.id("assistantRuns"),
		authorName: v.string(),
		googleAuthUserId: v.union(v.string(), v.null()),
		job: assistantRunJobValidator,
		execution: assistantRunExecutionValidator,
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_runId", ["runId"]),
	assistantRunToolExecutions: defineTable({
		runId: v.id("assistantRuns"),
		assistantMessageId: v.string(),
		stepIndex: v.number(),
		ordinal: v.number(),
		toolCallId: v.string(),
		toolName: v.string(),
		inputJson: v.string(),
		status: v.union(
			v.literal("executing"),
			v.literal("completed"),
			v.literal("failed"),
		),
		outputJson: v.optional(v.string()),
		errorText: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_runId", ["runId"])
		.index("by_runId_and_message_and_step_and_ordinal", [
			"runId",
			"assistantMessageId",
			"stepIndex",
			"ordinal",
		]),
	assistantQueuedMessages: defineTable(assistantQueuedMessageTableValidator)
		.index("by_runId_and_status", ["runId", "status"])
		.index("by_runId_and_status_and_createdAt", [
			"runId",
			"status",
			"createdAt",
		])
		.index("by_chatId_and_status", ["chatId", "status"])
		.index("by_chatId_and_status_and_createdAt", [
			"chatId",
			"status",
			"createdAt",
		])
		.index("by_chatId_and_createdAt", ["chatId", "createdAt"]),
	assistantQueuedMessageAcceptances: defineTable(
		assistantQueuedMessageAcceptanceTableValidator,
	)
		.index("by_queuedMessageId_and_claimVersion", [
			"queuedMessageId",
			"claimVersion",
		])
		.index("by_chatId", ["chatId"]),
	assistantRunSteerInputs: defineTable(assistantRunSteerInputTableValidator)
		.index("by_runId_and_assistantMessageId_and_createdAt", [
			"runId",
			"assistantMessageId",
			"createdAt",
		])
		.index("by_chatId", ["chatId"]),
	chatActiveStreams: defineTable({
		runId: v.id("assistantRuns"),
		chatId: v.id("chats"),
		assistantMessageId: v.string(),
		text: v.string(),
		partsJson: v.string(),
		updatedAt: v.number(),
	})
		.index("by_runId", ["runId"])
		.index("by_chatId", ["chatId"]),
	chatToolCalls: defineTable({
		runId: v.id("assistantRuns"),
		chatId: v.id("chats"),
		toolCallId: v.string(),
		toolName: v.string(),
		status: v.union(
			v.literal("pending"),
			v.literal("completed"),
			v.literal("failed"),
			v.literal("denied"),
		),
		inputJson: v.optional(v.string()),
		outputJson: v.optional(v.string()),
		errorText: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_runId_and_toolCallId", ["runId", "toolCallId"])
		.index("by_runId", ["runId"])
		.index("by_chatId", ["chatId"]),
	automations: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		projectId: v.union(v.id("projects"), v.null()),
		authorName: v.optional(v.string()),
		title: v.string(),
		prompt: v.string(),
		model: v.string(),
		reasoningEffort: reasoningEffortValidator,
		serviceTier: serviceTierValidator,
		webSearchEnabled: v.boolean(),
		appsEnabled: v.optional(v.boolean()),
		appSources: v.optional(
			v.array(
				v.object({
					id: v.string(),
					label: v.string(),
					provider: automationAppSourceProviderValidator,
				}),
			),
		),
		schedule: automationScheduleValidator,
		targetKind: v.union(v.literal("notes"), v.literal("workspace")),
		targetNoteIds: v.optional(v.array(v.id("notes"))),
		targetLabel: v.string(),
		destination: automationDestinationValidator,
		deliveryPolicy: automationDeliveryPolicyValidator,
		stopCondition: v.optional(v.string()),
		lastObservedResult: v.optional(v.string()),
		chatId: v.string(),
		isPaused: v.boolean(),
		isCompleted: v.boolean(),
		nextRunAt: v.optional(v.number()),
		lastRunAt: v.optional(v.number()),
		activeRunId: v.optional(v.id("automationRuns")),
		scheduledFunctionId: v.optional(v.id("_scheduled_functions")),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"createdAt",
		])
		.index("by_ownerTokenIdentifier_and_workspaceId_and_updatedAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"updatedAt",
		])
		.index("by_owner_workspace_project_updatedAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"projectId",
			"updatedAt",
		])
		.index("by_isPaused_and_nextRunAt", ["isPaused", "nextRunAt"])
		.index("by_owner_workspace_paused_nextRunAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"isPaused",
			"nextRunAt",
		])
		.index("by_ownerTokenIdentifier_and_workspaceId_and_chatId", [
			"ownerTokenIdentifier",
			"workspaceId",
			"chatId",
		]),
	automationRuns: defineTable({
		automationId: v.id("automations"),
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		scheduledFor: v.number(),
		reason: automationRunReasonValidator,
		status: automationRunStatusValidator,
		error: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		userMessageId: v.optional(v.string()),
		assistantMessageId: v.optional(v.string()),
		assistantRunId: v.optional(v.id("assistantRuns")),
		deliveryWorkflowId: v.optional(vWorkflowId),
		resultText: v.optional(v.string()),
		resultSummary: v.optional(v.string()),
		deliveryStatus: v.optional(automationDeliveryStatusValidator),
		isUnread: v.boolean(),
		notificationSentAt: v.optional(v.number()),
		notificationLeaseToken: v.optional(v.string()),
		readAt: v.optional(v.number()),
		archivedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_automationId_and_scheduledFor", ["automationId", "scheduledFor"])
		.index("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"createdAt",
		])
		.index("by_owner_workspace_unread_reason_notify_lease_archived_created", [
			"ownerTokenIdentifier",
			"workspaceId",
			"isUnread",
			"reason",
			"notificationSentAt",
			"notificationLeaseToken",
			"archivedAt",
			"createdAt",
		])
		.index("by_assistantRunId", ["assistantRunId"])
		.index("by_status_and_startedAt", ["status", "startedAt"]),
	appConnections: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		provider: appConnectionProviderValidator,
		status: appConnectionStatusValidator,
		displayName: v.string(),
		orgType: v.optional(appConnectionOrgTypeValidator),
		orgId: v.optional(v.string()),
		token: v.optional(v.string()),
		email: v.optional(v.string()),
		accountId: v.optional(v.string()),
		password: v.optional(v.string()),
		baseUrl: v.optional(v.string()),
		envJson: v.optional(v.string()),
		oauthRefreshToken: v.optional(v.string()),
		oauthClientSecret: v.optional(v.string()),
		tokenExpiresAt: v.optional(v.number()),
		webhookSecret: v.optional(v.string()),
		serverAddress: v.optional(v.string()),
		calendarHomePath: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_ownerTokenIdentifier_and_updatedAt", [
			"ownerTokenIdentifier",
			"updatedAt",
		])
		.index("by_ownerTokenIdentifier_and_workspaceId_and_updatedAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"updatedAt",
		])
		.index("by_ownerTokenIdentifier_and_workspaceId_and_provider", [
			"ownerTokenIdentifier",
			"workspaceId",
			"provider",
		])
		.index("by_ownerTokenIdentifier_and_workspaceId_and_status_and_updatedAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"status",
			"updatedAt",
		]),
	mcpOAuthStates: defineTable({
		provider: v.union(
			v.literal("figma"),
			v.literal("jira-mcp"),
			v.literal("linear"),
			v.literal("notion"),
			v.literal("posthog"),
			v.literal("zoom"),
		),
		state: v.string(),
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		displayName: v.string(),
		baseUrl: v.string(),
		envJson: v.optional(v.string()),
		oauthClientId: v.string(),
		oauthClientSecret: v.optional(v.string()),
		oauthTokenEndpoint: v.optional(v.string()),
		codeVerifier: v.optional(v.string()),
		expiresAt: v.number(),
		createdAt: v.number(),
	})
		.index("by_state", ["state"])
		.index("by_ownerTokenIdentifier_and_workspaceId", [
			"ownerTokenIdentifier",
			"workspaceId",
		])
		.index("by_expiresAt", ["expiresAt"]),
	appConnectionActivities: defineTable({
		connectionId: v.id("appConnections"),
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		lastWebhookReceivedAt: v.optional(v.number()),
		lastMentionSyncAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_connectionId", ["connectionId"]),
	inboxItems: defineTable({
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		provider: inboxItemProviderValidator,
		kind: inboxItemKindValidator,
		externalId: v.string(),
		issueKey: v.string(),
		issueSummary: v.optional(v.string()),
		title: v.string(),
		preview: v.string(),
		url: v.string(),
		actorDisplayName: v.optional(v.string()),
		actorAvatarUrl: v.optional(v.string()),
		occurredAt: v.number(),
		isRead: v.boolean(),
		readAt: v.optional(v.number()),
		isArchived: v.boolean(),
		archivedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_owner_ws_arch_occurredAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"isArchived",
			"occurredAt",
		])
		.index("by_owner_ws_arch_read_occurredAt", [
			"ownerTokenIdentifier",
			"workspaceId",
			"isArchived",
			"isRead",
			"occurredAt",
		])
		.index("by_owner_ws_provider_externalId", [
			"ownerTokenIdentifier",
			"workspaceId",
			"provider",
			"externalId",
		])
		.index("by_owner_upd", ["ownerTokenIdentifier", "updatedAt"])
		.index("by_owner_ws_upd", [
			"ownerTokenIdentifier",
			"workspaceId",
			"updatedAt",
		]),
	aiRateLimits: defineTable({
		lastRefillAt: v.number(),
		operation: aiRateLimitOperationValidator,
		ownerTokenIdentifier: v.string(),
		tokens: v.number(),
	}).index("by_ownerTokenIdentifier_and_operation", [
		"ownerTokenIdentifier",
		"operation",
	]),
	aiAdmissionReservations: defineTable({
		ownerTokenIdentifier: v.string(),
		operation: v.literal("chat-turn"),
		createdAt: v.number(),
		expiresAt: v.number(),
	})
		.index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"])
		.index("by_expiresAt", ["expiresAt"]),
	transcriptSessions: defineTable({
		ownerTokenIdentifier: v.string(),
		noteId: v.id("notes"),
		transcriptionLanguage: v.union(v.string(), v.null()),
		startedAt: v.number(),
		createdAt: v.number(),
	})
		.index("by_ownerTokenIdentifier_and_noteId_and_startedAt", [
			"ownerTokenIdentifier",
			"noteId",
			"startedAt",
		])
		.index("by_ownerTokenIdentifier_and_startedAt", [
			"ownerTokenIdentifier",
			"startedAt",
		]),
	transcriptDocuments: defineTable({
		sessionId: v.id("transcriptSessions"),
		ownerTokenIdentifier: v.string(),
		noteId: v.id("notes"),
		text: v.string(),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_sessionId", ["sessionId"]),
	transcriptSessionStates: defineTable({
		sessionId: v.id("transcriptSessions"),
		ownerTokenIdentifier: v.string(),
		noteId: v.id("notes"),
		status: transcriptSessionStatusValidator,
		refinementStatus: transcriptRefinementStatusValidator,
		refinementError: v.optional(v.string()),
		systemAudioSourceMode: v.optional(
			v.union(
				v.literal("desktop-native"),
				v.literal("display-media"),
				v.literal("unsupported"),
			),
		),
		endedAt: v.optional(v.number()),
		generatedNoteAt: v.optional(v.number()),
		utteranceCount: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
		lastRefinedAt: v.optional(v.number()),
	}).index("by_sessionId", ["sessionId"]),
	transcriptUtterances: defineTable({
		sessionId: v.id("transcriptSessions"),
		ownerTokenIdentifier: v.string(),
		noteId: v.id("notes"),
		utteranceId: v.string(),
		speaker: v.union(v.literal("you"), v.literal("them")),
		source: v.union(v.literal("live"), v.literal("refined")),
		text: v.string(),
		startedAt: v.number(),
		endedAt: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_sessionId_and_startedAt", ["sessionId", "startedAt"])
		.index("by_sessionId_and_utteranceId", ["sessionId", "utteranceId"])
		.index("by_ownerTokenIdentifier_and_noteId_and_startedAt", [
			"ownerTokenIdentifier",
			"noteId",
			"startedAt",
		]),
});
