/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiAccess from "../aiAccess.js";
import type * as aiAdmissionReservations from "../aiAdmissionReservations.js";
import type * as aiRateLimits from "../aiRateLimits.js";
import type * as appConnectionActions from "../appConnectionActions.js";
import type * as appConnectionProviders from "../appConnectionProviders.js";
import type * as appConnections from "../appConnections.js";
import type * as assistantQueuedMessageStateMachine from "../assistantQueuedMessageStateMachine.js";
import type * as assistantQueuedMessages from "../assistantQueuedMessages.js";
import type * as assistantRunActions from "../assistantRunActions.js";
import type * as assistantRunActivity from "../assistantRunActivity.js";
import type * as assistantRunActivityModel from "../assistantRunActivityModel.js";
import type * as assistantRunAutomationActions from "../assistantRunAutomationActions.js";
import type * as assistantRunBackground from "../assistantRunBackground.js";
import type * as assistantRunBackgroundState from "../assistantRunBackgroundState.js";
import type * as assistantRunCleanup from "../assistantRunCleanup.js";
import type * as assistantRunEventModel from "../assistantRunEventModel.js";
import type * as assistantRunEvents from "../assistantRunEvents.js";
import type * as assistantRunGeneratedImage from "../assistantRunGeneratedImage.js";
import type * as assistantRunJobModel from "../assistantRunJobModel.js";
import type * as assistantRunJobState from "../assistantRunJobState.js";
import type * as assistantRunLifecycle from "../assistantRunLifecycle.js";
import type * as assistantRunModel from "../assistantRunModel.js";
import type * as assistantRunScheduling from "../assistantRunScheduling.js";
import type * as assistantRunStateMachine from "../assistantRunStateMachine.js";
import type * as assistantRunStreamState from "../assistantRunStreamState.js";
import type * as assistantRunToolExecutions from "../assistantRunToolExecutions.js";
import type * as assistantRunUserQuestions from "../assistantRunUserQuestions.js";
import type * as assistantRunWorkflow from "../assistantRunWorkflow.js";
import type * as assistantRunWorkflowManager from "../assistantRunWorkflowManager.js";
import type * as assistantRuns from "../assistantRuns.js";
import type * as auth from "../auth.js";
import type * as automationDeliveryActions from "../automationDeliveryActions.js";
import type * as automationDeliveryScheduling from "../automationDeliveryScheduling.js";
import type * as automationDeliveryWorkflow from "../automationDeliveryWorkflow.js";
import type * as automationDeliveryWorkflowManager from "../automationDeliveryWorkflowManager.js";
import type * as automationLimits from "../automationLimits.js";
import type * as automationRetirement from "../automationRetirement.js";
import type * as automationRunOrchestration from "../automationRunOrchestration.js";
import type * as automationRunStateMachine from "../automationRunStateMachine.js";
import type * as automationRuns from "../automationRuns.js";
import type * as automationSchedule from "../automationSchedule.js";
import type * as automationValidators from "../automationValidators.js";
import type * as automations from "../automations.js";
import type * as calendar from "../calendar.js";
import type * as calendarAttendees from "../calendarAttendees.js";
import type * as calendarDate from "../calendarDate.js";
import type * as calendarNoteRelationships from "../calendarNoteRelationships.js";
import type * as calendarPeopleSync from "../calendarPeopleSync.js";
import type * as calendarPreferences from "../calendarPreferences.js";
import type * as calendarProviderAdapters from "../calendarProviderAdapters.js";
import type * as calendarProviderConcurrency from "../calendarProviderConcurrency.js";
import type * as calendarProviderModule from "../calendarProviderModule.js";
import type * as calendarRecurrence from "../calendarRecurrence.js";
import type * as calendarTimeZone from "../calendarTimeZone.js";
import type * as calendarToolQuery from "../calendarToolQuery.js";
import type * as calendarTypes from "../calendarTypes.js";
import type * as calendarValidators from "../calendarValidators.js";
import type * as chatAttachmentReferences from "../chatAttachmentReferences.js";
import type * as chatAttachments from "../chatAttachments.js";
import type * as chatBranches from "../chatBranches.js";
import type * as chatContextCompactions from "../chatContextCompactions.js";
import type * as chatFormatting from "../chatFormatting.js";
import type * as chatThreads from "../chatThreads.js";
import type * as chatToolCalls from "../chatToolCalls.js";
import type * as chatUnreadState from "../chatUnreadState.js";
import type * as chats from "../chats.js";
import type * as companyDomain from "../companyDomain.js";
import type * as connectedAppRateLimits from "../connectedAppRateLimits.js";
import type * as connectedAppTools from "../connectedAppTools.js";
import type * as crons from "../crons.js";
import type * as dictationActions from "../dictationActions.js";
import type * as dictationHttp from "../dictationHttp.js";
import type * as dictationStorage from "../dictationStorage.js";
import type * as documentSize from "../documentSize.js";
import type * as domain from "../domain.js";
import type * as googleAuth from "../googleAuth.js";
import type * as googleCalendar from "../googleCalendar.js";
import type * as googleCalendarApiTypes from "../googleCalendarApiTypes.js";
import type * as googleCalendarManagement from "../googleCalendarManagement.js";
import type * as googleTools from "../googleTools.js";
import type * as http from "../http.js";
import type * as inboxItems from "../inboxItems.js";
import type * as jiraWebhook from "../jiraWebhook.js";
import type * as mcpOAuth from "../mcpOAuth.js";
import type * as meetingRelationships from "../meetingRelationships.js";
import type * as noteComments from "../noteComments.js";
import type * as noteDocument from "../noteDocument.js";
import type * as noteImageHttp from "../noteImageHttp.js";
import type * as noteImageReferences from "../noteImageReferences.js";
import type * as noteImages from "../noteImages.js";
import type * as notes from "../notes.js";
import type * as notificationPreferences from "../notificationPreferences.js";
import type * as oauthCallbackHtml from "../oauthCallbackHtml.js";
import type * as onboarding from "../onboarding.js";
import type * as people from "../people.js";
import type * as peopleDomain from "../peopleDomain.js";
import type * as projectAppearance from "../projectAppearance.js";
import type * as projectDescriptions from "../projectDescriptions.js";
import type * as projects from "../projects.js";
import type * as recipes from "../recipes.js";
import type * as reorderLimits from "../reorderLimits.js";
import type * as resourceRetirement from "../resourceRetirement.js";
import type * as search from "../search.js";
import type * as serverWorkspaceTools from "../serverWorkspaceTools.js";
import type * as starred from "../starred.js";
import type * as templates from "../templates.js";
import type * as toolApproval from "../toolApproval.js";
import type * as toolApprovals from "../toolApprovals.js";
import type * as transcriptSessions from "../transcriptSessions.js";
import type * as trash from "../trash.js";
import type * as userPreferences from "../userPreferences.js";
import type * as workspaces from "../workspaces.js";
import type * as yandexCalendar from "../yandexCalendar.js";
import type * as yandexCalendarEventAuthority from "../yandexCalendarEventAuthority.js";
import type * as yandexCalendarEventMutation from "../yandexCalendarEventMutation.js";
import type * as yandexCalendarEvents from "../yandexCalendarEvents.js";
import type * as yandexCalendarIcs from "../yandexCalendarIcs.js";
import type * as yandexCalendarIcsWriter from "../yandexCalendarIcsWriter.js";
import type * as yandexCalendarTypes from "../yandexCalendarTypes.js";
import type * as zoomOAuth from "../zoomOAuth.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiAccess: typeof aiAccess;
  aiAdmissionReservations: typeof aiAdmissionReservations;
  aiRateLimits: typeof aiRateLimits;
  appConnectionActions: typeof appConnectionActions;
  appConnectionProviders: typeof appConnectionProviders;
  appConnections: typeof appConnections;
  assistantQueuedMessageStateMachine: typeof assistantQueuedMessageStateMachine;
  assistantQueuedMessages: typeof assistantQueuedMessages;
  assistantRunActions: typeof assistantRunActions;
  assistantRunActivity: typeof assistantRunActivity;
  assistantRunActivityModel: typeof assistantRunActivityModel;
  assistantRunAutomationActions: typeof assistantRunAutomationActions;
  assistantRunBackground: typeof assistantRunBackground;
  assistantRunBackgroundState: typeof assistantRunBackgroundState;
  assistantRunCleanup: typeof assistantRunCleanup;
  assistantRunEventModel: typeof assistantRunEventModel;
  assistantRunEvents: typeof assistantRunEvents;
  assistantRunGeneratedImage: typeof assistantRunGeneratedImage;
  assistantRunJobModel: typeof assistantRunJobModel;
  assistantRunJobState: typeof assistantRunJobState;
  assistantRunLifecycle: typeof assistantRunLifecycle;
  assistantRunModel: typeof assistantRunModel;
  assistantRunScheduling: typeof assistantRunScheduling;
  assistantRunStateMachine: typeof assistantRunStateMachine;
  assistantRunStreamState: typeof assistantRunStreamState;
  assistantRunToolExecutions: typeof assistantRunToolExecutions;
  assistantRunUserQuestions: typeof assistantRunUserQuestions;
  assistantRunWorkflow: typeof assistantRunWorkflow;
  assistantRunWorkflowManager: typeof assistantRunWorkflowManager;
  assistantRuns: typeof assistantRuns;
  auth: typeof auth;
  automationDeliveryActions: typeof automationDeliveryActions;
  automationDeliveryScheduling: typeof automationDeliveryScheduling;
  automationDeliveryWorkflow: typeof automationDeliveryWorkflow;
  automationDeliveryWorkflowManager: typeof automationDeliveryWorkflowManager;
  automationLimits: typeof automationLimits;
  automationRetirement: typeof automationRetirement;
  automationRunOrchestration: typeof automationRunOrchestration;
  automationRunStateMachine: typeof automationRunStateMachine;
  automationRuns: typeof automationRuns;
  automationSchedule: typeof automationSchedule;
  automationValidators: typeof automationValidators;
  automations: typeof automations;
  calendar: typeof calendar;
  calendarAttendees: typeof calendarAttendees;
  calendarDate: typeof calendarDate;
  calendarNoteRelationships: typeof calendarNoteRelationships;
  calendarPeopleSync: typeof calendarPeopleSync;
  calendarPreferences: typeof calendarPreferences;
  calendarProviderAdapters: typeof calendarProviderAdapters;
  calendarProviderConcurrency: typeof calendarProviderConcurrency;
  calendarProviderModule: typeof calendarProviderModule;
  calendarRecurrence: typeof calendarRecurrence;
  calendarTimeZone: typeof calendarTimeZone;
  calendarToolQuery: typeof calendarToolQuery;
  calendarTypes: typeof calendarTypes;
  calendarValidators: typeof calendarValidators;
  chatAttachmentReferences: typeof chatAttachmentReferences;
  chatAttachments: typeof chatAttachments;
  chatBranches: typeof chatBranches;
  chatContextCompactions: typeof chatContextCompactions;
  chatFormatting: typeof chatFormatting;
  chatThreads: typeof chatThreads;
  chatToolCalls: typeof chatToolCalls;
  chatUnreadState: typeof chatUnreadState;
  chats: typeof chats;
  companyDomain: typeof companyDomain;
  connectedAppRateLimits: typeof connectedAppRateLimits;
  connectedAppTools: typeof connectedAppTools;
  crons: typeof crons;
  dictationActions: typeof dictationActions;
  dictationHttp: typeof dictationHttp;
  dictationStorage: typeof dictationStorage;
  documentSize: typeof documentSize;
  domain: typeof domain;
  googleAuth: typeof googleAuth;
  googleCalendar: typeof googleCalendar;
  googleCalendarApiTypes: typeof googleCalendarApiTypes;
  googleCalendarManagement: typeof googleCalendarManagement;
  googleTools: typeof googleTools;
  http: typeof http;
  inboxItems: typeof inboxItems;
  jiraWebhook: typeof jiraWebhook;
  mcpOAuth: typeof mcpOAuth;
  meetingRelationships: typeof meetingRelationships;
  noteComments: typeof noteComments;
  noteDocument: typeof noteDocument;
  noteImageHttp: typeof noteImageHttp;
  noteImageReferences: typeof noteImageReferences;
  noteImages: typeof noteImages;
  notes: typeof notes;
  notificationPreferences: typeof notificationPreferences;
  oauthCallbackHtml: typeof oauthCallbackHtml;
  onboarding: typeof onboarding;
  people: typeof people;
  peopleDomain: typeof peopleDomain;
  projectAppearance: typeof projectAppearance;
  projectDescriptions: typeof projectDescriptions;
  projects: typeof projects;
  recipes: typeof recipes;
  reorderLimits: typeof reorderLimits;
  resourceRetirement: typeof resourceRetirement;
  search: typeof search;
  serverWorkspaceTools: typeof serverWorkspaceTools;
  starred: typeof starred;
  templates: typeof templates;
  toolApproval: typeof toolApproval;
  toolApprovals: typeof toolApprovals;
  transcriptSessions: typeof transcriptSessions;
  trash: typeof trash;
  userPreferences: typeof userPreferences;
  workspaces: typeof workspaces;
  yandexCalendar: typeof yandexCalendar;
  yandexCalendarEventAuthority: typeof yandexCalendarEventAuthority;
  yandexCalendarEventMutation: typeof yandexCalendarEventMutation;
  yandexCalendarEvents: typeof yandexCalendarEvents;
  yandexCalendarIcs: typeof yandexCalendarIcs;
  yandexCalendarIcsWriter: typeof yandexCalendarIcsWriter;
  yandexCalendarTypes: typeof yandexCalendarTypes;
  zoomOAuth: typeof zoomOAuth;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
