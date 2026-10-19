// The R2 page controller: drives the login -> character select -> docked
// station panel flow and feeds every outcome into the client-state store as
// events ("how to add a page", docs/bridge-wire-contract.md). The Svelte view
// is a pure reader of the store; this module owns all fetch/decode logic so
// it stays framework-agnostic and unit-testable under node:test.

import { getCharacterSelectionData } from "../bridge/characterSelection.ts";
import { setSessionToken } from "./sessionToken.ts";
import { pageFetch } from "./pageFetch.ts";
import {
  getStationGuests,
  getStationItemBits,
  getStructureGuests,
} from "../bridge/stationPanel.ts";
import { decodeCapacity, decodeContainer, decodeInventoryRows, decodeInventoryRowsChecked } from "../bridge/inventoryShip.ts";
import { decodeShipBays, decodeShipBaysChecked } from "../bridge/shipBays.ts";
import { FREIGHT_BAYS, planLootTransfers, splitNeverFits } from "../bridge/bayRouting.ts";
import { holdFreeM3 } from "../bridge/holdFit.ts";
import { dispatchSupportCollectionAction } from "./supportCollectionFlow.ts";
import { compressItemInSpace } from "../bridge/compressionWrites.ts";
import { NO_ROOM_CODE } from "../nav/refusalLedger.ts";
import { confirmControlledDronesHome, controlledFlightSettled } from "../nav/controlledDroneStop.ts";
import { runFleetParking, parkingScript, type FleetParkingPolicy } from "../nav/fleetParking.ts";
import { iceHoldFraction, iceMiningType, scriptMinesScannerSites, siteMiningFitRefusal, scriptScannerSites } from "../nav/miningSite.ts";
import { fittedTravelPropulsion, travelPropulsionActivation } from "../nav/travelAssist.ts";
import { ensureSiteLogisticsBookmark } from "../nav/siteLogisticsBookmark.ts";
import { readRecoveryDrones, recoverLostDroneFlight, type DroneRecoveryState } from "../nav/lostDroneRecovery.ts";
import { createSignal, readonlySignal, type ReadableSignal } from "../store/signals.ts";
import { buildSlots, decodeChargeFits, decodeResources, decodeShipAttributes, planFittingApply, slotFlagOf } from "../bridge/fitting.ts";
import { deriveShipStats } from "../bridge/shipStats.ts";
import {
  decodeBlueprints,
  decodeDefinition,
  decodeFacilities,
  decodeJobs,
  decodeSlotUsage,
  industryRefusalMessage,
} from "../bridge/industry.ts";
import { decodeInventionTerms, type DecryptorTerms } from "../bridge/industryInvention.ts";
import { decodeIndustryMaterials } from "../bridge/industryMaterials.ts";
import { cancelIndustryJob as cancelIndustryJobCall, deliverIndustryJob as deliverIndustryJobCall, type JobAsked } from "../bridge/industryWrites.ts";
import {
  decodeEscrow,
  decodeOrderBook,
  decodeOwnOrders,
  decodePriceHistory,
  decodeTransactions,
  joinPriceHistory,
  marketRefusalMessage,
  toAmountString,
} from "../bridge/market.ts";
import {
  inflateMailBody,
  MAIL_BODIES_KEPT,
  type MailBody,
  mailLabelOf,
  mailLabelsOf,
  mailingListKeyAndName,
  mailingListOf,
  mailingListsAfterNotice,
  mailingListsOf,
  MAILING_LIST_MEMBER_WRITES,
  type MailingListMember,
  type MailingListMemberAction,
  mailingListMembersOf,
  type MailingListSettings,
  mailingListSettingsOf,
  MAIL_STATUS_AUTOMATED,
  MAIL_SORT_KEYS,
  type MailSortKey,
  type WelcomeMail,
  welcomeMailOf,
  ownerMatchesOf,
  type OwnerMatch,
  mailboxAfterNotice,
  mailboxAfterSending,
  mailboxAllRead,
  mailboxAllRestored,
  mailboxAllTrashed,
  mailboxListRead,
  mailboxListTrashed,
  mailboxLabelAssigned,
  mailboxLabelDropped,
  mailboxLabelRemoved,
  mailboxTrashEmptied,
  mailboxDeleted,
  mailboxMarkedUnread,
  mailboxRestored,
  mailboxTrashed,
  mailboxAfterSync,
  mailboxMarkedRead,
  mailboxWithHeaders,
  mailRefusalMessage,
  syncMailArguments,
  unreadMailCount,
  isAllianceOwner,
  isNpcOwner,
  type DecodedMailbox,
} from "../bridge/mail.ts";
import { addressBookOf, agentFoldersOf, contactLabelsOf, createdLabelOf, labelBitsSent, onlineStatesOf, type AgentFolders, type ContactLabel, type ContactWrite, type NamedAddressBook } from "../bridge/contacts.ts";
import { sendMail as sendMailCall, type MailToSend } from "../bridge/mailWrites.ts";
import { mailMarkupOfTyped } from "../bridge/mailMarkup.ts";
import { reprocess as reprocessCall } from "../bridge/reprocessWrites.ts";
import {
  activityReadError,
  calendarEventsOfMonths,
  decodeActivityCalendar,
  decodeActivityNotifications,
} from "../bridge/activity.ts";
import {
  contractRefusalMessage,
  decodeContractDetail,
  decodeContractList,
  decodeContractSearch,
  decodeContractSummary,
} from "../bridge/contracts.ts";
import { decodeAssetItems } from "../bridge/personalAssets.ts";
import { failsTheReading, failureCode } from "../bridge/ask.ts";
import { decodeSkillHistory, decodeSkills } from "../bridge/boundSkills.ts";
import { skillHistoryLines } from "../bridge/skillHistoryPanel.ts";
import { SKILL_NOTIFICATION_ROWS, skillNotificationsOf, type SkillNotification } from "../bridge/skillNotifications.ts";
import { employmentHistoryOf } from "../bridge/employmentHistory.ts";
import { filetimeOf } from "../bridge/journalWords.ts";
import { readAssetStationItems, readAssetStations, type AssetStationItemsRead, type AssetStationsRead } from "../bridge/assetReads.ts";
import {
  AGENT_BUTTON,
  decodeBriefing,
  decodeConversation,
  decodeJournal,
  decodeAgentRecord,
  decodeMissionChange,
  objectivesShown,
  openingAction,
  windowOnMissionChange,
  type MissionChange,
} from "../bridge/agents.ts";
import { sessionChangeNames, sessionChangeValue, wholeDigits } from "../bridge/sessionChange.ts";
import { createPushLedger } from "../bridge/pushOnce.ts";
import { standingsAfter } from "../bridge/standingChanges.ts";
import { decodeMissionTimes } from "../bridge/missionTime.ts";
import { decodeObjectives } from "../bridge/missionObjectives.ts";
import { decodeClientMission, pageObjectives, pageOnMissionChange, type ClientMission } from "../bridge/missionPage.ts";
import {
  decodeCashBalance,
  decodeCharStandings,
  decodeLpBalances,
} from "../bridge/rewards.ts";
import {
  decodeCashBalance as decodeWalletCash,
  decodeCorpDivisions,
  decodeEntryTypeLabels as decodeWalletEntryTypeLabels,
  decodeTransactions as decodeWalletTransactions,
  normalizeDivisionNames,
} from "../bridge/wallet.ts";
import { createWalletReads } from "../bridge/walletReads.ts";
import { readStandings, standingComposition, standingHistory } from "../bridge/standingsReads.ts";
import { createSkillTypeFacts, readSkillSheet } from "../bridge/skillReads.ts";
import { createCharacterSheetReads } from "../bridge/characterSheetReads.ts";
import { readJournal } from "../bridge/journalReads.ts";
import { applyFreePoints, pauseTraining, saveQueue, type QueuePlace } from "../bridge/skillWrites.ts";
import { createTrainingSlots } from "../bridge/trainingSlots.ts";
import { setSafetyLevel as setSafetyLevelCall } from "../bridge/crimewatchWrites.ts";
import { acceptContract as acceptContractCall } from "../bridge/contractWrites.ts";
import { removeLaunch } from "../bridge/launchWrites.ts";
import { readClientStates } from "../bridge/crimewatchReads.ts";
import { readCloneGrade } from "../bridge/cloneGradeReads.ts";
import { decodeClientStates } from "../bridge/boundCrimewatch.ts";
import {
  classifyStandingKind,
  decodeStandingCompositions,
  decodeStandingTransactions,
} from "../bridge/standings.ts";
import {
  decodeCharacterDescription,
  decodeCharacterIdentity,
  decodeCloneSummary,
  decodeHomeStationID,
} from "../bridge/characterSheet.ts";
import { decodeFlightStatus } from "../bridge/flight.ts";
import { decodeSpaceSnapshot, decodeTargetIDs, isSceneBlind } from "../bridge/space.ts";
import {
  decodeMiningHolds,
  decodeReprocessingQuotes,
  decodeSurveyResults,
  decodeTaxRate,
} from "../bridge/mining.ts";
import {
  decodeDroneBay,
  decodeDroneEngageOutcome,
  decodeDroneLimits,
  decodeDroneOrderRefusals,
  decodeDronesInSpace,
} from "../bridge/drones.ts";
import { decodeSkillSheet, skillQueueRefusal } from "../bridge/skills.ts";
import { decodeColonyReport } from "../bridge/planets.ts";
import { filetimeToUnixMs } from "../bridge/activity.ts";
import { extractorReroute, factoryInputTypeIDs, type ExtractorReroute } from "../bridge/colonyRoutes.ts";
import { decodeRecipeBook } from "../bridge/piRecipes.ts";
import { repairTargets, type RepairQuoteRow } from "../bridge/repairQuotes.ts";
import { quoteRepairs, repairItemsAtShop, repairQuoted } from "../bridge/repairShop.ts";
import { createSpacePoller, targetsReadIsDue, type SpacePoller } from "./spacePoll.ts";
import type { RequestPriority } from "./transport.ts";
import type { CorpOfficesResult, DronesResult, FlightStepResult } from "./api.ts";
import { BridgeCallError } from "../bridge/callMethod.ts";
import { argumentsOf, createBotPresses, decodeQuestion, dialogOfKey, wordsLabels, wordsNameRefs, type ClientWording } from "../bridge/questions.ts";
import { classifyDistributionAgentConversation, selectDistributionAgent } from "../nav/distributionAgentSelection.ts";
import { refusalWords as sayRefusalWords } from "../bridge/refusals.ts";
import { isListValue, readDictEntry, readDictPairs, type JsonValue } from "../bridge/wire.ts";
import { decodeNotifications, notificationRows, type Notification } from "../bridge/notifications.ts";
import { isCommunicationType } from "../bridge/contactNotifications.ts";
import { decodeNotificationFormats, type NotificationFormats } from "../bridge/notificationFormats.ts";
/** notificationconst.groupContacts: the contacts' notifications' group. */
const CONTACTS_NOTIFICATION_GROUP = 9;
/** const.ownerSystem, which a notification's sender of -1 is (neocom/notifications.py 176 to 177). */
const OWNER_SYSTEM = 1;
import { itemChangeTouchesDroneBay } from "../bridge/droneBayNotices.ts";
import * as api from "./api.ts";
import type { ClientStore } from "../store/clientStore.ts";
import type {
  ActivityRead,
  AgentAction,
  AgentConversation,
  MissionPageState,
  QuestionAnswer,
  ChatChannel,
  ContractDetail,
  DestinationMatch,
  DroneInSpace,
  DroneBayStack,
  DroneOrderReport,
  FittingSlot,
  FleetAction,
  FlightStatus,
  InventoryItemRow,
  InventoryPlace,
  MiningHold,
  ShipBay,
  SlotFamily,
  SpaceSnapshot,
  SpaceVector,
  StationOfficeQuote,
  StationStatic,
} from "../store/types.ts";
import {
  decodeChatChannel,
  decodeChatChannelName,
  decodeMessageEntry,
} from "../bridge/chat.ts";
import { itemHasActivationCycle } from "../bridge/boundDogma.ts";
import { combatFit, weaponHasCycle } from "../nav/combatFit.ts";
import type { CombatWeapons } from "../nav/combatWeapons.ts";
import {
  RAT_RESONANCE_ATTRIBUTE_IDS,
  WEAPON_CYCLE_ATTRIBUTE_IDS,
  ratResonancesFromAttributes,
  weaponCycleFromAttributes,
  type RatResonances,
  type WeaponCycleFacts,
} from "../nav/companionAmmo.ts";
import { CHARGE_ATTRIBUTE_IDS, chargeFactsFromAttributes, type ChargeFacts } from "../nav/ammoReach.ts";
import { RAT_COMBAT_ATTRIBUTE_IDS, ratCombatFromAttributes, type RatCombatFacts } from "../nav/combatPosition.ts";
import { issueCombatReload } from "../nav/combatReloadIssue.ts";
import { requireModuleOutcome, moduleSettlementNote } from "../nav/moduleOutcome.ts";
import { combatUtilityFit, type CombatUtilities } from "../nav/combatUtilities.ts";
import { AUTOMATIC_UTILITY_FAMILIES } from "../nav/combatUtilityPolicy.ts";
import { issueCombatUtility, issueUtilityReload } from "../nav/combatUtilityIssue.ts";
import { nameKey, resolvedName, type NameKind, type NameRef } from "../store/names.ts";
import {
  companionFitWarnings,
  requestForFit,
  type CompanionFitFacts,
} from "../bots/companionFitCheck.ts";
import { voteTankLayer } from "../bots/tankLayer.ts";
import type { BotLogDraft, BotLogSink } from "../nav/botLog.ts";
import { createBotLogBuffer } from "./botLogBuffer.ts";
import {
  routeAlong,
  type SystemGraph,
} from "../nav/routeSolver.ts";
import { systemGraphOnce } from "../nav/systemGraphKept.ts";
import { autopilotDistances, autopilotJumpCounts, autopilotMap, autopilotPath, type AutopilotRouteType } from "../nav/autopilotRoute.ts";
import {
  autopilotSettingsFrom,
  loadAutopilotSettings,
  saveAutopilotSettings,
  withAvoidSystemsClicked,
  withPenalty,
  withRouteType,
  type SettingsStorage,
  type StoredAutopilotSettings,
} from "../nav/autopilotSettings.ts";
// R30 slice A — reading the already-cached gate graph as "what is on this grid
// and where does it go", so a stargate row can offer a jump.
import { buildGateLinks, type GateLink } from "../space/gateLinks.ts";
import { CRIMEWATCH_NOTICES, CRIMEWATCH_SESSION_NAMES } from "../space/crimewatch.ts";
import type { SafetyLevel } from "../space/crimewatch.ts";
import { CLONE_GRADE_NOTICE, cloneGradeOf } from "../bridge/cloneGrade.ts";
import type { AgentFinderRow, HoldItem } from "../store/types.ts";
import {
  MENU_WARP_RANGE_M,
  createAutopilot,
  type AutopilotController,
  type AutopilotDeps,
  type RoutePlan,
} from "../nav/autopilotLoop.ts";
import {
  createMiningBot,
  destinationHold,
  holdsEmpty,
  holdShouldHaul,
  lowestHealth,
  type MiningBotController,
  type MiningBotDeps,
  type MiningPlan,
} from "../nav/miningBotLoop.ts";
import { canMyShipOrderDrone, hostileRows, isTargetedByPlayer } from "../space/overview.ts";
// R43 — one declaration of which bots exist, what each needs before it can
// start, and who is allowed to hold the ship.
import {
  MINING_BOT_REQUIREMENTS,
  MISSION_BOT_REQUIREMENTS,
  createShipClaim,
  evaluateRequirements,
  type MiningBotReads,
  type MissionBotReads,
} from "../nav/botRegistry.ts";
// The companion's own rows: it is not a bot and no longer declares itself in
// the bot catalogue. See nav/fleetCompanionRequirements.ts.
import {
  FLEET_COMPANION_REQUIREMENTS,
  type FleetCompanionReads,
} from "../nav/fleetCompanionRequirements.ts";
import {
  createFleetCompanion,
  type FleetCompanionController,
  type FleetCompanionDeps,
  type CompanionHitPoints,
  type FleetCompanionObservation,
  type CompanionSetup,
  type FleetCompanionRequest,
  type CompanionAbandonmentRecord,
  type CompanionCargoCharge,
  type CompanionLoadedCharge,
  type CompanionPropulsionModule,
  type CompanionTankLayer,
} from "../nav/fleetCompanionLoop.ts";
import {
  DRONE_SIZING_ATTRIBUTE_IDS,
  droneFactsFromAttributes,
  type DroneFacts,
} from "../nav/droneSizing.ts";
import { highSlotMiningModules, isDockableKind, ungroupedHighSlotModules } from "../space/rowActions.ts";
import {
  DEFAULT_MAX_JUMPS,
  createMissionBot,
  type MissionBotController,
  type MissionBotDeps,
  type MissionPlan,
} from "../nav/missionBotLoop.ts";
// Player Bot Builder runner — the fourth decide-loop, composing the SAME calls
// the mining/mission bots fire, driven by the player's blocks.
import {
  createScriptRunner,
  type ScriptRunnerController,
  type ScriptRunnerDeps,
} from "../nav/scriptRunner.ts";
import {
  createCapabilityCache,
  describeFitting,
  type CapabilityScope,
} from "../nav/scriptCapabilities.ts";
import { deriveMiningSupportCapabilities, type MiningSupportCapabilities } from "../nav/miningSupportCapabilities.ts";
import { deriveMiningSupportServices, type MiningSupportServiceSnapshot } from "../nav/miningSupportServices.ts";
import { observedSupportAnchorServices, supportServiceEnvelope, type MiningSupportAnchor, type MiningSupportAnchorRead,
  type SupportRequirements } from "../nav/miningSupportAnchor.ts";
import { decideMiningSupport, observeMiningSupportOrders } from "../nav/miningSupportController.ts";
import { settleHostedMiningSupport, settleParkingMiningModules } from "./supportStopFlow.ts";
import { hostedSupportMotionSettled, retireHostedSelfLock } from "./hostedRecoveryCustody.ts";
import { latchSupportEmergency, supportHandoff } from "./supportHandoff.ts";
import { decideSupportPositioning, freshSupportPositionMemory, type SupportPositionMemory, type SupportPositionPolicy,
  type SupportPositionFeedback, type SupportPositionResult } from "../nav/miningSupportPositioning.ts";
import { decideSupportSelfMining, freshSupportSelfMiningMemory, fittedSupportMiningPlan, supportSelfMiningDiagnostic, type SupportSelfMiningMemory, type SupportSelfMiningFeedback,
  type SupportSelfMiningResult, type SupportSelfMiningDiagnostic } from "../nav/miningSupportSelfMining.ts";
import { decideSupportTractor, freshSupportTractorMemory, type SupportTractorMemory, type SupportTractorFeedback, type SupportTractorResult } from "../nav/miningSupportTractor.ts";
import { decideSupportCollection, freshSupportCollectionMemory, recordSupportCollectionReceipt, type SupportCollectionMemory, type SupportCollectionPolicy,
  type SupportCollectionResult, type SupportCollectionInput } from "../nav/miningSupportCollection.ts";
import { SUPPORT_FLEET_READ_MAX_AGE_MS, decideMiningSupportFleet, freshMiningSupportFleetMemory, miningSupportFleetDiagnostic, type MiningSupportFleetCallDiagnostic, type MiningSupportFleetDiagnostic, type MiningSupportFleetFeedback, type MiningSupportFleetObservation, type MiningSupportFleetResult, type SupportFleetJoinAuthority } from "../nav/miningSupportFleet.ts";
import { SCRIPT_MACROS, resolveStationRef, scriptTravelHome } from "../nav/scriptMacros.ts";
import {
  EMPTY_SURVEY_MEMORY,
  decideSurveyScan,
  forgetSurvey,
  rememberNoScannerUpgrade,
  rememberSurveyFailure,
  rememberSurveyScan,
  surveyForShip,
  surveyedSnapshot,
  type SurveyMemory,
} from "../nav/surveyScan.ts";
import type { DryBelt, ScriptObservation, MiningOperationAssignment } from "../nav/scriptConditions.ts";
import {
  THREAT_ATTRIBUTE_IDS,
  threatFromAttributes,
  type RatThreat,
} from "../nav/ratThreat.ts";
import { droneRoleForGroup, splitDroneRoles, type DroneRole, type DroneRoleIDs } from "../nav/droneRoles.ts";
import type { MiningDroneState } from "../nav/miningDroneFlight.ts";
import { droneStackSizes, wholeStackLaunch } from "../nav/droneLaunch.ts";
import {
  DRONE_RANGE_BONUS_ATTRIBUTE_ID,
  DRONE_RANGE_SKILL_TYPE_IDS,
  droneControlRangeFromSkills,
  resolveDroneControlRangeM,
  type DroneRangeSkillReading,
} from "../nav/droneControlRange.ts";
import { readScanFullState } from "../bridge/scanFullState.ts";
import { applyFitting, destroyRig as destroyRigCall, fitModule as fitModuleCall, unfitModule as unfitModuleCall } from "../bridge/fitModule.ts";
import { exportToCustomsOffice } from "../bridge/customsWrites.ts";
import { BAY_FLAGS, hasSomethingToStack, mergeStacks as mergeStacksCall, moveItems as moveItemsCall, officeAt, stackAll as stackAllCall, trashItems as trashItemsCall, type MovePlace } from "../bridge/inventoryWrites.ts";
import {
  cancelOrder as cancelOrderCall,
  modifyOrder as modifyOrderCall,
  placeBuyOrder as placeBuyOrderCall,
  placeSellOrder as placeSellOrderCall,
} from "../bridge/marketOrderWrites.ts";
import { doAgentAction, removeOfferFromJournal } from "../bridge/agentWrites.ts";
import { createScannerWrites, type ScannerShip } from "../bridge/scannerWrites.ts";
import { surfaceDistanceMeters } from "../space/overview.ts";
import { scannerStateFromRead } from "../scanner/scannerCenter.ts";
import { siteKind } from "../scanner/siteKind.ts";
import { decodeFittings } from "../bridge/fittings.ts";
import { decodeCorpFittings, refitLibrary, type SourcedFitting } from "../bridge/sharedFittings.ts";
import { readMyActiveBookmarks } from "../bridge/bookmarkReads.ts";
import { classifySalvageModules } from "../nav/salvageModules.ts";
import { addToKnownFolders, moveBookmarks as moveBookmarksCall, readFoldersWithAdminAccess, updateKnownFolderState } from "../bridge/bookmarkFolders.ts";
import { agentsAtStation, readAgentsTable } from "../bridge/agentReads.ts";
import { readCorporationMemberIDs } from "../bridge/corpMemberReads.ts";
import {
  authoritativeFleetMemberCharacterIDs,
  fleetCommanderCharacterIDs,
  fleetCommanderWhereabouts,
  decodeFleetCenter,
  decodeFleetInviteAnswerNotification,
  decodeFleetInviteNotification,
  fleetInviteAnswerWords,
  memberWhereabouts,
  type FleetInviteAnswer,
  type FleetPendingInvite,
} from "../bridge/fleetCenter.ts";
import { canBroadcastInFleet, canTagInFleet } from "../bridge/fleetCommand.ts";
import type { FleetCenterSnapshot } from "../bridge/fleetCenter.ts";
import { decodeAvailableFleetAds, decodeMyFleetFinderAdvert } from "../bridge/fleetAds.ts";
import { readAvailableFleetAds, readFleetFinder as readFleetFinderCalls } from "../bridge/fleetFinderReads.ts";
import { readMyLaunches } from "../bridge/launchReads.ts";
import { readCharacterFittings, readCorporationFittings } from "../bridge/fittingReads.ts";
import type { FleetFinderRead } from "../nav/fleetJoinWatch.ts";
import { acceptFleetInvite as acceptFleetInviteCall, applyToJoinFleet as applyToJoinFleetCall, createFleetBroadcasts, declineFleetInvite as declineFleetInviteCall, formFleet as formFleetCall, inviteToFleet as inviteToFleetCall, leaveFleet as leaveFleetCall, tagFleetTarget, type FleetApplyOutcome } from "../bridge/fleetWrites.ts";
import { BOOKMARK_EXPIRY, bookmarkLocation as bookmarkLocationCall } from "../bridge/bookmarkWrites.ts";
import { giveMoney as giveMoneyCall } from "../bridge/giveMoney.ts";
import { REDEEM_NOTICE, decodeRedeemTokens, type RedeemOutcome, type RedeemToken } from "../bridge/redeem.ts";
import { readRedeemTokens } from "../bridge/redeemReads.ts";
import { claimRedeemTokens } from "../bridge/redeemWrites.ts";
import { LOGIN_CAMPAIGN_NOTICE, campaignAfterClaim, decodeLoginCampaign, type LoginClaim } from "../bridge/loginRewards.ts";
import { readLoginCampaign, readSeasonalCampaign } from "../bridge/loginRewardReads.ts";
import { claimLoginReward as claimLoginRewardCall, claimSeasonalReward as claimSeasonalRewardCall } from "../bridge/loginRewardWrites.ts";
import { REMOTE_MESSAGE, decodeRemoteMessage, serverMessageText, type ServerMessage } from "../bridge/serverMessages.ts";
import { lockTarget as lockTargetCall, unlockTarget as unlockTargetCall } from "../bridge/targetWrites.ts";
import {
  decodeLaunched,
  engageWithDrones,
  launchDrones as launchDronesCall,
  mineWithDrones as mineWithDronesCall,
  reconnectToDrones as reconnectToDronesCall,
  returnDronesToBay,
  salvageWithDrones,
  scoopDrones as scoopDronesCall,
} from "../bridge/boundEntityWrites.ts";
import { alignTo as alignToCall, approach as approachCall, autopilotWarp as autopilotWarpCall, warpToFleetMember as warpToFleetMemberCall, warpToItem as warpToItemCall, goToPoint, keepAtRange as keepAtRangeCall, orbit as orbitCall, stopShip as stopShipCall, warpToBookmark as warpToBookmarkCall, warpToLaunch as warpToLaunchCall, warpToMissionLocation as warpToMissionLocationCall, warpToScanResult as warpToScanResultCall, type FlightNow, type SitesReadIn } from "../bridge/movementWrites.ts";
import { dock as dockCall, dockAtStructure as dockAtStructureCall, isStation, jump as jumpCall, undock as undockCall } from "../bridge/placeChanges.ts";
import { boardCorvette as boardCorvetteCall, boardShip as boardShipCall, jettison as jettisonCall, leaveShip as leaveShipCall, type JettisonOutcome } from "../bridge/shipWrites.ts";
import { activityIDOf, createJobReckoner, type JobReckoner, type JobReckoning } from "../bridge/industryJobReckoning.ts";
import { connectJob, decodeFacilityPlaces, disconnectJob, installJob, jobDump, jobPlaces, monitoredAs, type Monitored } from "../bridge/industryMonitor.ts";
import { NO_OPTIONAL_MATERIAL } from "../bridge/industryReckonings.mjs";
import { giveUpOffice, quoteOffice, rentOffice, type DockedIn } from "../bridge/officeWrites.ts";
import { runSlashCommand } from "../bridge/gmWrites.ts";
import { launchCommodities as launchCommoditiesCall, rerouteExtractorRoutes, type NewRoute } from "../bridge/planetWrites.ts";
import { restartExtractor as restartExtractorAsTheClient } from "../bridge/extractorRestart.ts";
import { activateModule as activateModuleCall, createDefaultEffects, createModuleRepairs, createOverloadEffects, createWeaponGrouping, deactivateModule as deactivateModuleCall, loadAmmo as loadAmmoCall, repairWaitMs, setModuleOnline as setModuleOnlineCall, setOverload as setOverloadCall, unloadAmmo as unloadAmmoCall, type ModuleActionResult, type ModuleDeps } from "../bridge/dogmaWrites.ts";
import { keptByType, keptTypeAttributes, keptWhereKnown } from "../bridge/keptTypeFacts.ts";
import { moduleActivation, type ModuleActivation } from "../nav/moduleActivation.ts";
import type { AmmoPlace, AmmoSession } from "../bridge/dogmaWrites.ts";
import type { DogmaItemInfo } from "../bridge/boundDogma.ts";
import {
  FLEET_BROADCAST_SCOPE_ALL,
  FLEET_BROADCAST_TTL_MS,
  decodeFleetBroadcastNotification,
  decodeFleetStateChangeNotification,
  isFleetBroadcastFresh,
} from "../bridge/fleetBroadcasts.ts";
import {
  decodeJamNotification,
  isJamLive,
  scrammedByWarpScrambler,
  tacklersHolding,
} from "../bridge/jamNotifications.ts";
import { decodeTargetNotification } from "../bridge/targetNotifications.ts";
import {
  decodeChargeLoadNotification,
  decodeChargeQuantityChanges,
} from "../bridge/reloadNotifications.ts";
import type { BotScript, WorldRef } from "../bots/botScript.ts";
import { decodeScriptValue } from "../bots/scriptCodec.ts";
import { expandSubBots, hasSubBots, type BotResolution, type SubBotReference } from "../bots/subBots.ts";

/**
 * What the player asked the mission bot to do (goal R36).
 *
 * `maxJumps` and `maxMissions` are the PLAYER's limits and are the whole reason
 * the bot is safe to walk away from: the courier dropoff is the corp's
 * lowest-`solarSystemID` station, so routes are long by construction and can
 * cross lowsec. The bot refuses an offer that exceeds them rather than
 * committing an unattended ship to a trip nobody sanctioned.
 */
export interface MissionBotRequest {
  readonly agentID: number;
  readonly agentName: string | null;
  readonly agentStationID: number;
  readonly agentStationName: string | null;
  /** Refuse any job whose delivery is further than this. */
  readonly maxJumps: number;
  /** Stop after this many completed jobs; 0 keeps going until stopped. */
  readonly maxMissions: number;
}

export { DEFAULT_MAX_JUMPS };

/**
 * What the player asked the mining bot to do (goal R26).
 *
 * `miningModuleIDs` is the player's OWN pick from the ship's online modules,
 * by name. The browser does not decide which of your modules is a mining
 * laser: it would have to guess, and a wrong guess fires a turret at a rock.
 */
export interface MiningBotRequest {
  readonly beltID: number;
  readonly beltName: string | null;
  readonly stationID: number;
  readonly stationName: string | null;
  readonly miningModuleIDs: readonly number[];
  /** Remaining fraction (0-1) of any health layer that ends the run. */
  readonly healthFloor: number;
  readonly useDrones: boolean;
}

export interface AppFlowOptions {
  readonly hostedStartup?: import("../bots/startup.ts").StartupCheckpoint;
  /** Volatile hosted MCC ore custody; this never changes process restart policy. */
  readonly hostedOreJettisonRecovery?: boolean;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  /**
   * R10 — injectable EventSource factory for the live event channel. Defaults
   * to the browser's own EventSource; tests supply a fake.
   */
  readonly eventSource?: (url: string) => api.EventSourceLike;
  /**
   * How this client asks its user an OK / Cancel question of its own (the
   * warning before undocking with contraband). Defaults to the browser's
   * confirm; with no browser nobody is asked and the answer is Cancel.
   */
  readonly confirm?: (message: string) => boolean | Promise<boolean>;
  /**
   * Where the autopilot's settings are kept, by character (nav/autopilotSettings.ts). The browser's own
   * storage unless given; null keeps them only as long as the flow lasts.
   */
  readonly storage?: SettingsStorage | null;
  /**
   * R107 multibox — when true, this flow carries its OWN session token on every
   * call (via `callOptions.token`) instead of the per-tab global in
   * sessionToken.ts, so several flows can be live in ONE browser tab without
   * their calls colliding on the shared token/cookie. The login handler captures
   * the token onto the call options; logout clears it. Default false keeps the
   * single-session path (main.ts, every existing test) byte-for-byte unchanged.
   */
  readonly perSessionToken?: boolean;
  /**
   * Server bot host — a session token this flow starts out holding, so a
   * headless flow whose owner ALREADY authenticated (the bot-start route runs
   * under requireAuth) can skip `login()` entirely instead of round-tripping a
   * password the server would have to accept. Only read in per-session mode:
   * a shared-global flow has no per-flow token to seed.
   */
  readonly initialSessionToken?: string | null;
  /**
   * Multibox — whether this flow may hold a live push (SSE) connection.
   * Default true keeps the single-session path unchanged; roster sessions
   * start false and the App enables exactly one (the active pilot), because
   * each open EventSource occupies one of the browser's ~6 per-origin
   * connections for its whole life. See AppFlow.setLivePush.
   */
  readonly livePush?: boolean;
  /** Browser-selected pilots must settle a nearby lost flight before automation. */
  readonly browserPilotRecovery?: boolean;
  /**
   * How long the agent's window waits before asking again when the BFF says the pilot is busy with a
   * write (AGENT_TALK_AGAIN_WAIT_MS). Tests shorten it.
   */
  readonly agentTalkAgainWaitMs?: number;
  /**
   * How long a scoop waits for its drones to be read as out of space no more (SCOOP_LEAVE_WAIT_MS). Tests
   * shorten it.
   */
  readonly scoopLeaveWaitMs?: number;
  /**
   * How long after a read of a fleet whose composition lacks a member the fleet is read again
   * (FLEET_COMPOSITION_REREAD_MS). Tests shorten it.
   */
  readonly fleetCompositionRereadMs?: number;
  /** Hosted MCC assignment; an absent or different authority blocks target work. */
  readonly miningOperationID?: string | null;
  /**
   * Character IDs THIS HOST is flying with a bot of its own — the fleet
   * companion's supervision gate (decision 5) subtracts them from the fleet
   * roster, and whatever is left is a human.
   *
   * ⚠ IT HAS TO BE INJECTED, BECAUSE NOTHING ON THE SERVER CAN ANSWER IT. A
   * human's pilot and a companion's pilot both reach the BFF as an ordinary
   * held bridge session; `isCharacterHeld` cannot tell them apart, and neither
   * can the fleet roster. Only the process doing the driving knows.
   *
   * What each host supplies, and why it is the right answer there:
   *
   *   • The BFF's bot host passes its live claim map, which is exact — every
   *     headless companion is in it by construction.
   *   • `App.svelte` passes the pilots its own multibox roster is flying with a
   *     bot, which is what "this tab is driving it" means in a browser.
   *
   * Omitted, the flow falls back to this session alone (see
   * `makeFleetCompanionDeps`). Whatever comes back is UNIONED with the BFF's
   * own running-bot list, never used instead of it.
   */
  readonly botDrivenCharacterIDs?: () => readonly number[] | null;
}

/**
 * What the panel asks for when it places an order. `side` decides which retail
 * call is used, and they are NOT symmetric: buying names a TYPE, selling names
 * a specific STACK (`itemID`), because the sell handler moves that stack into
 * escrow.
 */
export interface MarketOrderRequest {
  readonly side: "buy" | "sell";
  readonly typeID: number;
  readonly price: number;
  readonly quantity: number;
  readonly durationDays: number;
  /** Required for a sell: the stack being handed over. */
  readonly itemID?: number;
}

/**
 * How a `startRoute` attempt ended. Every failure is ALSO written to the
 * travel slice (`travel/plan-error`) for the Travel panel; the return value
 * exists for callers that are not the Travel panel — the mission bot's
 * `startTravel` dep throws on `started: false`, because a bot that believes a
 * flight is running when the plan never reached the autopilot spins "Flying
 * to…" forever with the real reason hidden in a panel nobody is watching.
 * `cause` carries the underlying thrown error when there was one, so the
 * loops' transport-transient classification reads the real code.
 */
export type RouteStartOutcome =
  | { readonly started: true }
  | { readonly started: false; readonly reason: string; readonly cause?: unknown };

/**
 * What one "take everything" actually did, for a surface that has to say so.
 *
 * ⚠ COUNTS, NOT A BOOLEAN. Three outcomes a player must be able to tell apart:
 * the thing was EMPTY (`stacks: 0`, nothing attempted and nothing wrong), it all
 * went aboard (`moved === planned`), and SOME of it went aboard while the rest
 * stayed in the can because no bay had room for it (`moved < planned`). A
 * boolean collapses the last two into a lie in one direction or the other.
 *
 * `planned` counts TRANSFERS, not stacks — the router merges every stack bound
 * for the same bay into one call — so it is only ever compared with `moved`,
 * never reported to a player as a number of things.
 */
export interface LootOutcome {
  /** Stacks in the container when it was opened. Zero means it was empty. */
  readonly stacks: number;
  /** Transfers the router planned across this hull's bays. */
  readonly planned: number;
  /** How many of those the server accepted. */
  readonly moved: number;
}

export interface SupportSelfMiningRequest {
  readonly previous: SupportSelfMiningMemory;
  readonly plan: MiningPlan;
  readonly enabled: boolean;
  readonly useFittedMiningModules?: boolean;
  readonly stopRequested?: boolean;
  readonly feedback?: SupportSelfMiningFeedback;
}
export interface SupportWorkTickResult {
  readonly decision: SupportPositionResult;
  readonly feedback: SupportPositionFeedback | null;
  readonly selfMining?: { readonly decision: SupportSelfMiningResult; readonly feedback: SupportSelfMiningFeedback | null;
    readonly diagnostic: SupportSelfMiningDiagnostic };
  readonly tractor?: { readonly decision: SupportTractorResult; readonly feedback: SupportTractorFeedback | null };
  readonly collection?: SupportCollectionResult;
}
export interface SupportWorkDiagnostics {
  readonly atMs: number;
  readonly position: { readonly state: string; readonly reason: string | null; readonly action: string | null;
    readonly recipientIssue?: SupportPositionResult["recipientIssue"] };
  readonly selfMining: SupportSelfMiningDiagnostic;
  readonly tractor: { readonly claimID: number | null; readonly order: string | null; readonly fault: string | null };
  readonly collection: { readonly state: string | null; readonly pending: boolean; readonly fault: string | null };
}
export interface SupportCollectionRequest { readonly previous: SupportCollectionMemory; readonly policy: SupportCollectionPolicy;
  /** Verified FULL, with no mutation pending: yield this exact lease to ordinary logistics. */
  readonly handoffContainerID?: number }
export interface SupportTractorRequest {
  readonly previous: SupportTractorMemory; readonly runID: string;
  readonly eligibleContainerIDs: readonly number[]; readonly allowedOwnerIDs: readonly number[];
  readonly enabled: boolean; readonly stopRequested?: boolean;
  readonly retainSettledClaim?: boolean; readonly collectedContainerID?: number;
  readonly feedback?: SupportTractorFeedback;
}
/**
 * What an ammunition write turned out to do, judged against the re-read:
 * `changed` the fit shows it, `reloading` the server queued it (in space) and
 * announced so, `unchanged` it accepted the call and nothing moved, `refused`
 * it said no in its own words. The last two also land in `actionError`.
 */
export type AmmoOutcome = "changed" | "reloading" | "unchanged" | "refused";

export interface AppFlow {
  readonly droneRecovery: ReadableSignal<DroneRecoveryState>;
  retryDroneRecovery(): Promise<void>;
  requireAutomationReady(): void;
  /** Boot health ping — sets the health slice online/offline (gates the login). */
  checkHealth(): Promise<void>;
  /** Who-cares login, then the typed reference call to fill the character list. */
  login(username: string, password: string): Promise<void>;
  /**
   * R107 multibox — the session token THIS flow authenticates as, for the
   * character bar and verification. Non-null between login and logout in
   * per-session mode; null otherwise (single-session flows keep the token in the
   * per-tab global, not here).
   */
  sessionToken(): string | null;
  /**
   * The request options owned by THIS flow (base URL, injected fetch and its
   * per-session token). Components that call api.ts directly must use this
   * instead of reconstructing only the token and silently dropping the rest.
   */
  requestOptions(): api.ApiOptions;
  /**
   * Create a character on the signed-in account, then re-read the roster so the
   * select screen shows it. Runs with NO character online — that is the state
   * this exists for.
   */
  createCharacter(request: api.CreateCharacterRequest): Promise<api.CreateCharacterResult>;
  /** Select a character onto the persistent session, then run the docked reads. */
  selectCharacter(characterID: number): Promise<void>;
  /** Refresh the docked station-panel reads on the live session. */
  refreshStationPanel(): Promise<void>;
  /** Load the Inventory & Ship panel (station hangar + active-ship cargo). */
  loadInventory(): Promise<void>;
  /** Stack all loose stacks in the hangar or active-ship cargo, then refresh. */
  stackContainer(target: "hangar" | "cargo"): Promise<void>;
  /** Board a hangar ship (it becomes active), then refresh. */
  boardShip(shipID: number): Promise<void>;
  /**
   * Board the corvette while docked (the station-services "Board my Corvette"):
   * the server spawns/repairs/starter-fits one as needed, then refresh. `sure`
   * asks the pilot, as the client does before a hull that is no capsule is
   * left; on a no nothing is asked of the server.
   */
  boardCorvette(sure: () => boolean | Promise<boolean>): Promise<void>;
  /**
   * Leave the active ship while docked — the character ends up in their
   * capsule, the ship stays in the hangar — then refresh.
   */
  leaveShip(): Promise<void>;
  /**
   * Ask the station's repair shop what damage it finds on the active hull and
   * everything fitted to it. Null when there is no hull to quote (no active
   * ship yet); an empty list is the shop saying nothing is damaged.
   */
  quoteShipRepair(): Promise<readonly RepairQuoteRow[] | null>;
  /**
   * Pay the station to repair exactly what this quote lists — the rows the
   * caller was just shown, never a broader "everything" — at the quote's cost.
   */
  repairShip(quotes: readonly RepairQuoteRow[]): Promise<void>;
  // --- R14 inventory depth ---
  /** Tick or untick a row for a bulk move / trash. */
  toggleSelection(itemID: number): void;
  /** Drop every tick (e.g. after acting, or on leaving a place). */
  clearSelection(): void;
  /** Open a container and read its contents; null closes it. */
  openContainer(containerID: number | null): Promise<void>;
  /** Goal R40 — expand a ship in the Ships card and read its bays; null closes it. */
  openShipBays(shipID: number | null): Promise<void>;
  /** Project the latest loaded fit/dogma/bay observations; performs no IO or actions. */
  readMiningSupportCapabilities(): MiningSupportCapabilities;
  /** Enrich capabilities with the latest successful space service observation; no IO or actions. */
  readMiningSupportServices(): MiningSupportServiceSnapshot;
  readMiningSupportWork(): SupportWorkDiagnostics | null;
  readMiningSupportFleetDiagnostic(): MiningSupportFleetDiagnostic | null;
  /** Explicit normal-flow publication seam for the pure support controller's observation. */
  publishMiningSupportAnchor(observation: MiningSupportServiceSnapshot): Promise<MiningSupportAnchor>;
  readMiningSupportFleet(sessionEpoch: string, join?: SupportFleetJoinAuthority): MiningSupportFleetObservation | null;
  readMiningOperationAssignment(): Promise<MiningOperationAssignment | null>;
  publishReconciledMiningSupportAnchor(fleetResult: MiningSupportFleetResult, observation: MiningSupportServiceSnapshot): Promise<MiningSupportAnchor>;
  /** Fresh own-fleet BFF read; callers retain receipt times rather than a hidden cache. */
  readMiningSupportAnchors(): Promise<MiningSupportAnchorRead>;
  /** Explicit one-tick adapter. Caller owns one run-local memory and cadence. */
  tickMiningSupportPositioning(previous: SupportPositionMemory, request: {
    readonly sessionEpoch: string; readonly intendedCharacterIDs: readonly number[];
    readonly requirements: SupportRequirements; readonly policy: SupportPositionPolicy;
    readonly feedback?: SupportPositionFeedback;
    readonly selfMining?: SupportSelfMiningRequest;
    readonly tractor?: SupportTractorRequest;
    readonly collection?: SupportCollectionRequest;
    readonly stopRequested?: boolean; readonly stopAll?: boolean;
  }): Promise<SupportWorkTickResult>;
  /**
   * Move items between two places. A single item with a `qty` is a SPLIT; more
   * than one item is a single batch move. Reports what ACTUALLY applied.
   */
  transferItems(
    itemIDs: readonly number[],
    from: InventoryPlace,
    to: InventoryPlace,
    qty?: number | null,
  ): Promise<void>;
  /** Re-merge one stack into another of the same type. */
  mergeStacks(
    sourceItemID: number,
    destinationItemID: number,
    place: InventoryPlace,
  ): Promise<void>;
  /** DESTROY items. The caller must have confirmed first — this is irreversible. */
  trashItems(itemIDs: readonly number[], place: InventoryPlace): Promise<void>;
  /** Read the corporation hangar at the docked station. */
  loadCorpHangar(): Promise<void>;
  /** The lobby's offices where the pilot is docked, listed when the player asks for them. */
  loadStationOffices(): Promise<void>;
  /** What an office here costs the pilot's corporation, asked as the rent button is pressed. */
  quoteStationOffice(): Promise<StationOfficeQuote>;
  /** Rent an office here at the price the player was shown, as the station said it. The server's notice lists the offices again. */
  rentStationOffice(quote: StationOfficeQuote): Promise<void>;
  /** Give up the corporation's office here. The server's notice lists the offices again. */
  giveUpStationOffice(): Promise<void>;
  /**
   * Set the ship's safety level (crimewatchSvc.SetSafetyLevel). Once the server has taken it, it is the level the
   * page shows, with nothing read after, as the client keeps the level it set. A refusal is thrown, and the
   * level shown is left as it was.
   */
  setSafetyLevel(level: SafetyLevel): Promise<void>;
  /**
   * WHERE the corporation has offices, and what its divisions are called —
   * answered for every station at once, from wherever the ship is. The Bot
   * Builder asks this while a script is being WRITTEN, about a station the ship
   * may never have docked at, so it returns its answer instead of applying it
   * to the store: nothing on screen shows it, one picker uses it.
   */
  loadCorpOffices(): Promise<CorpOfficesResult>;
  /** Show a different corporation hangar division. */
  selectCorpDivision(division: number): void;
  /** Load the Fitting panel (the active ship's slots + resource readings). */
  loadFitting(): Promise<void>;
  /**
   * Load the bound-dogma snapshot (active ship + fitted modules with their
   * SERVER-effective attributes), so a clicked module can show its effective
   * stats. Refreshed automatically alongside loadFitting; exposed for a manual
   * refresh too.
   */
  loadDogma(): Promise<void>;
  /**
   * Fit a module from the station hangar or the ship's cargo. `slot` picks a
   * specific slot by family + index, or "auto" to let the SERVER choose one.
   */
  fitModule(
    itemID: number,
    source: "hangar" | "cargo",
    slot: { readonly family: SlotFamily; readonly index: number } | "auto",
  ): Promise<void>;
  /** Unfit a module, as the client's Unfit does: to the hangar docked, and to the ship's own hold in space. */
  unfitModule(itemID: number): Promise<void>;
  /** Bring a fitted module online, or take it offline. */
  setModuleOnline(itemID: number, online: boolean): Promise<void>;
  /**
   * Load charges into modules, then re-read the fit so the panel shows what the
   * SERVER put in them. Compatibility is the server's call — an incompatible
   * charge comes back as its own refusal, not as a control the panel hid.
   */
  loadAmmo(
    moduleIDs: readonly number[],
    chargeItemIDs: readonly number[],
    source: AmmoPlace,
  ): Promise<AmmoOutcome>;
  /** Empty modules of their charges into cargo or the station hangar. */
  unloadAmmo(moduleIDs: readonly number[], destination: AmmoPlace): Promise<AmmoOutcome>;
  /**
   * DESTROY a fitted rig. Rigs cannot be unfitted, so this is irreversible —
   * the panel confirms before calling it and the BFF confirms again.
   */
  destroyRig(itemID: number): Promise<void>;
  /**
   * Load the Industry panel: the player's blueprints, their jobs, their used
   * job slots, and the facilities their region offers. Also fetches the static
   * recipes for the blueprint types it saw, and the names for everything.
   */
  loadIndustry(): Promise<void>;
  /**
   * What the player HAS of each material an install would consume, read from
   * the SERVER, and the time the job will take where that was reckoned. Feeds
   * the confirm step so the decision is informed.
   */
  previewIndustryJob(request: api.IndustryJobRequest): Promise<api.IndustryPreviewResult>;
  /** Every decryptor and what it does to an invention (static data). */
  loadDecryptors(): Promise<readonly DecryptorTerms[]>;
  /**
   * INSTALL a job. Spends materials and charges an installation fee, so the
   * panel confirms before calling it and the BFF confirms again.
   */
  installIndustryJob(request: api.IndustryJobRequest): Promise<void>;
  /**
   * The Industry window closed. The game's own client then lets go the monitor of the job the window had, and so
   * does the page. Best effort: where it could not be sent, nothing is said.
   */
  industryWindowClosed(): Promise<void>;
  /** The window's job put away while the window stays ("Never mind"): nothing is sent, and the next job is made anew. */
  industryJobLetGo(): Promise<void>;
  /** DELIVER a finished job (the retail CompleteJob). */
  deliverIndustryJob(jobID: number): Promise<void>;
  /**
   * CANCEL a job. Returns the blueprint but NOT the materials or the fee, so
   * this is confirmed twice as well.
   */
  cancelIndustryJob(jobID: number): Promise<void>;
  /**
   * Load the Market panel: an item's order book (when one is chosen), the
   * player's own orders, their closed-order history, their trades, their
   * escrow, their price history and their ISK — plus every NAME those need.
   */
  loadMarket(typeID: number | null): Promise<void>;
  /**
   * Search tradable items by NAME — how the player picks what to look at.
   * Static reference data, so it answers even when the market daemon does not.
   */
  findMarketTypes(q: string): Promise<readonly api.MarketTypeMatch[]>;
  /**
   * List the ore families the bot editor's ore picker can offer. Static
   * reference data, so it answers even before a character is selected.
   */
  listOreFamilies(): Promise<readonly api.OreFamily[]>;
  /**
   * R83 — BROWSE the market tree. Static reference data, so both of these work
   * even when the market daemon itself is not answering: a player can find out
   * what EXISTS before asking what it costs.
   */
  loadMarketGroups(parentGroupID: number): Promise<readonly api.MarketGroupNode[]>;
  loadMarketGroupTypes(
    marketGroupID: number,
  ): Promise<{ readonly types: readonly api.MarketTypeMatch[]; readonly total: number; readonly capped: boolean }>;
  /**
   * PLACE A BUY ORDER. Sets ISK aside immediately and charges a broker's fee,
   * so the panel confirms before calling it and the BFF confirms again. What
   * the server ACTUALLY charged lands in the store as `lastOutcome`.
   */
  placeMarketOrder(request: MarketOrderRequest): Promise<void>;
  /** CANCEL an order. Returns what it held; the fee already paid is not. */
  cancelMarketOrder(orderID: string): Promise<void>;
  /** CHANGE an order's price. Charges a fee and moves a buy order's escrow. */
  modifyMarketOrder(orderID: string, price: number): Promise<void>;
  /**
   * Refresh the read-only Activity Center: recent notificationMgr reads,
   * current-month calendar data and the existing mailbox unread count.
   */
  loadActivity(): Promise<void>;
  /** Refresh current-system scan sites and the probes' state. */
  loadScanner(): Promise<void>;
  /** Launch every probe EveJS currently says is safe to launch. */
  launchScannerProbes(): Promise<void>;
  /** Analyze using EveJS's current authoritative probe geometry. */
  analyzeScannerSignatures(): Promise<void>;
  /** Recover the current held session's active probes. */
  recoverScannerProbes(): Promise<void>;
  /** Reconnect the session character's lost probes, then refresh scanner state. */
  reconnectScannerProbes(): Promise<void>;
  /** Refresh authoritative membership, hierarchy, MOTD and join-request reads. */
  loadFleet(): Promise<void>;
  /** Form a fleet, then re-read membership before settling. */
  formFleet(): Promise<void>;
  /** Invite one character by ID, then re-read the authoritative fleet. */
  inviteFleetMember(characterID: number, assertCurrent?: () => void, expectedFleetID?: number): Promise<void>;
  /**
   * An owner's menu's Form Fleet With (menusvc.py 637 to 638; fleetSvc.Invite, 351 to 363): a fleet formed where the
   * pilot is in none, then the character invited; the pilot's own character is invited to nothing.
   */
  formFleetWith(characterID: number): Promise<void>;
  /**
   * Accept a fleet invitation, then re-read membership before settling.
   *
   * With no argument this accepts the pending OnFleetInvite observed for this
   * live session — the Fleet Center's own button.
   *
   * ⚠ PASS THE `fleetID` WHEN YOU ALREADY KNOW IT, which is what an apply's
   * caller does. Reading it off `pendingInvite` couples the accept to a
   * notification having arrived AND been decoded into the slice, which is a
   * race on the tick right after an apply; the server only checks that the
   * caller has an invite whose fleetID matches, so passing the id straight
   * through is both sufficient and more robust.
   * See docs/join-advertised-fleet-handoff.md.
   */
  acceptFleetInvite(fleetID?: number): Promise<void>;
  /**
   * Turn a fleet invitation down. With no argument, the pending OnFleetInvite observed for this live session: the
   * Fleet Center's own button. The invitation is the window's no longer whatever the call said, and nothing of
   * the fleet is read after, as the client reads nothing.
   */
  declineFleetInvite(fleetID?: number): Promise<void>;
  /** Leave the current fleet, then re-read membership before settling. */
  leaveFleet(): Promise<void>;
  /**
   * The fleet finder, for a pilot that has been told which fleet to join: the
   * adverts open to this session, and the name of the fleet it is already in.
   *
   * ⚠ NEITHER ARM IS FATAL AND NEITHER IS FAKED. A listing that could not be
   * read comes back `null`, which is not the same as an EMPTY listing ("nobody
   * is advertising") — a watcher must wait on the first and may act on the
   * second. `ownFleetName` is null both when this pilot is in no fleet and when
   * the fleet it is in is not advertised; the caller already knows which of
   * those it is from its own membership read.
   *
   * `inAFleet` is that knowledge, where the caller has it: for a pilot known
   * to be in no fleet (`false`) the fleet's own advert is not asked for, as
   * the client does not ask it (bridge/fleetFinderReads.ts).
   */
  readFleetFinder(inAFleet?: boolean | null): Promise<FleetFinderRead>;
  /**
   * APPLY to an advertised fleet, and return WHICH HALF of the round trip the
   * server took.
   *
   * ⚠ AN APPLY DOES NOT JOIN YOU, and this deliberately does not pretend
   * otherwise by running the membership re-read every other fleet write does.
   * On an open advert the server mints an INVITE and notifies this session;
   * membership happens only when the client accepts it. The returned outcome is
   * the server's own answer about which happened and the caller MUST act on it.
   * Throws what the call threw: the caller is a watcher that retries.
   */
  applyToJoinFleet(fleetID: number): Promise<FleetApplyOutcome>;
  /**
   * Sends the pilot's ship toward a point measured for that ship in that system, by the client's own call. An
   * order taken, never an arrival; refused where the pilot's flight is now another ship's or another system's.
   */
  flyToPoint(position: SpaceVector, shipID: number, solarSystemID: number): Promise<void>;
  /**
   * An extractor's programme installed again on a colony, as the client installs one: the planet asked what it
   * will yield, and one change that takes the extractor's routes off, installs it and makes the routes anew.
   */
  restartExtractor(planetID: number, pinID: number, resourceTypeID: number, headRadius: number): Promise<void>;
  /** An extractor's routes removed and made anew, in one change of a colony's network. */
  rerouteExtractor(planetID: number, removeRouteIDs: readonly number[], create: readonly NewRoute[]): Promise<void>;
  /** What a colony's command centre holds, launched into orbit: the quantities by type. It costs export tax. */
  launchCommodities(planetID: number, commandPinID: number, commodities: Readonly<Record<number, number>>): Promise<void>;
  /**
   * Load the Mail panel: the mailbox, synced once for the character as the client's mail service syncs it
   * (TrySyncMail), and the NAME of everyone who sent or received a message. Once synced it asks nothing.
   */
  loadMail(): Promise<void>;
  /** Check for new mail: the mailbox synced again, with the lowest and highest messages it holds. */
  refreshMail(): Promise<void>;
  /**
   * Open one message: mailMgr.GetBody's zlib-DEFLATED buffer, inflated by the page. `markRead` asks the server to
   * mark it read, as the client asks for a message not yet read.
   */
  openMail(messageID: number, markRead: boolean): Promise<void>;
  /**
   * A message's body for a reply's or a forward's quote, as the client's GetReplyMessage reads it (the mail
   * service's GetBody, which marks a message not read read): its markup, or null where it was not read (why is the
   * mail's action error).
   */
  quotedMailBody(messageID: number): Promise<string | null>;
  /** The pilot's own mail labels, asked once as the mail window first draws its folders (mailSvc.GetLabels), and kept. */
  loadMailLabels(): Promise<void>;
  /** The mailing lists joined, asked once as the mail window first draws its lists group (GetJoinedLists), and kept. */
  loadMailingLists(): Promise<void>;
  /** Join a mailing list by its name, as the mail window's Join does: its number, or null where it was not joined. */
  joinMailingList(name: string): Promise<number | null>;
  /** Make a mailing list by a name, as the mail window's Create does: its number, or null where it was not made. */
  createMailingList(name: string): Promise<number | null>;
  /** Leave a mailing list, as its menu's Leave does. */
  leaveMailingList(listID: number): Promise<void>;
  /** Delete a mailing list of the pilot's own, as its menu's Delete does. */
  deleteMailingList(listID: number): Promise<void>;
  /** A mailing list by its name as the client's lists service names it (GetDisplayName): asked of the server where not known; null for none. */
  nameMailingList(listID: number): Promise<string | null>;
  /** A mailing list's settings, asked as its management window asks them: null where it answered none. */
  readMailingListSettings(listID: number): Promise<MailingListSettings | null>;
  /** A mailing list's members and their places, asked as its management window's Members tab asks them. */
  readMailingListMembers(listID: number): Promise<readonly MailingListMember[]>;
  /** Members of a mailing list made members, muted or operators, or kicked, as the Members tab's Apply does: true where it was taken. */
  setMailingListMembers(listID: number, memberIDs: readonly number[], action: MailingListMemberAction): Promise<boolean>;
  /** A mailing list's subscription access and default member role set, as the Access tab's Apply does: true where it was taken. */
  setMailingListDefaults(listID: number, defaultAccess: number, defaultMemberAccess: number): Promise<boolean>;
  /** A character, corporation or alliance let into or kept out of a mailing list, as the Access tab's Allow and Block do: true where it was taken. */
  setMailingListAccess(listID: number, ownerID: number, access: number): Promise<boolean>;
  /** One let in or kept out taken off a mailing list's access, as the Access tab's Remove Selected does: true where it was taken. */
  clearMailingListAccess(listID: number, ownerID: number): Promise<boolean>;
  /** The owners that are no NPC's whose names begin with the text, as the client's owner search asks for them. */
  lookupPlayerOwners(text: string): Promise<readonly OwnerMatch[]>;
  /** A mailing list's welcome mail, asked as the Welcome Mail tab asks it: null where it has none. */
  readMailingListWelcome(listID: number): Promise<WelcomeMail | null>;
  /** A mailing list's welcome mail saved, and sent to every member where `toAll`, as the tab's Save does: true where it was taken. */
  saveMailingListWelcome(listID: number, title: string, body: string, toAll: boolean): Promise<boolean>;
  /** A mailing list's welcome mail cleared, as the tab's Save does with nothing written: true where it was taken. */
  clearMailingListWelcome(listID: number): Promise<boolean>;
  /** Whether the tab's "send to all" box is ticked for a list, as it was last left on this machine. */
  welcomeToAll(listID: number): boolean;
  /** The tab's "send to all" box kept for a list, on this machine. */
  keepWelcomeToAll(listID: number, checked: boolean): void;
  /** The mail list's sort as last left on this machine: Received, reversed, where none was. */
  mailSort(): { readonly by: MailSortKey; readonly reversed: boolean };
  /** The mail list's sort kept, on this machine. */
  keepMailSort(by: MailSortKey, reversed: boolean): void;
  /** An owner search window's Search By as last chosen on this machine: Partial Terms, where none was. */
  ownersSearchBy(): number;
  /** An owner search window's Search By kept, on this machine. */
  keepOwnersSearchBy(matchBy: number): void;
  /** The pilot's contacts that are characters and not NPCs, named, in the address book's order (charMgr.GetContactList). */
  mailContacts(): Promise<readonly api.CharacterMatch[]>;
  /** The pilot's contacts and blocked owners, each named, as the Contacts window shows them (charMgr.GetContactList). */
  addressBook(): Promise<NamedAddressBook>;
  /** The client's online status service primed, where it is not: the watched contacts' online state in the store. */
  primeContactsOnline(): Promise<void>;
  /** A contact added, or edited where `edit` (charMgr.AddContact, EditContact); fails with the server's words. */
  addOrEditContact(contact: ContactWrite, edit: boolean): Promise<void>;
  /** Contacts taken away (charMgr.DeleteContacts); fails with the server's words. */
  deleteContacts(contactIDs: readonly number[]): Promise<void>;
  /** Owners blocked (charMgr.BlockOwners); fails with the server's words. */
  blockOwners(ownerIDs: readonly number[]): Promise<void>;
  /** Owners no longer blocked (charMgr.UnblockOwners); fails with the server's words. */
  unblockOwners(ownerIDs: readonly number[]): Promise<void>;
  /** Several contacts given one standing (charMgr.EditContactsRelationshipID); fails with the server's words. */
  editContactsRelationship(contactIDs: readonly number[], relationshipID: number): Promise<void>;
  /** A contact label made (charMgr.CreateLabel), answered its bit; fails with the server's words. */
  createContactLabel(name: string): Promise<bigint | null>;
  /** A contact label renamed (charMgr.EditLabel); fails with the server's words. */
  renameContactLabel(labelID: bigint, name: string): Promise<void>;
  /** A contact label deleted (charMgr.DeleteLabel), and the labels asked again, as the client asks them; null where they could not be read. */
  deleteContactLabel(labelID: bigint): Promise<readonly ContactLabel[] | null>;
  /** A label's bits, or a sum of them, given to contacts or taken off them (charMgr.AssignLabels, RemoveLabels); fails with the server's words. */
  labelContacts(contactIDs: readonly number[], bits: bigint, give: boolean): Promise<void>;
  /** The Contacts window's last group viewed by the pilot online, kept on this machine; none where none was. */
  contactsLastSelected(): number | string | null;
  /** The Contacts window's group viewed kept for the pilot online, on this machine. */
  keepContactsLastSelected(groupID: number | string): void;
  /** The Agents tab's folders kept for the pilot online on this machine; "All Agents" open and no folder, where none were. */
  agentFolders(): AgentFolders;
  /** The Agents tab's folders kept for the pilot online, on this machine. */
  keepAgentFolders(folders: AgentFolders): void;
  /** The Search tab's Search Type and Search By kept for the pilot online on this machine; Any and Partial Terms where none were. */
  contactsSearchSettings(): { readonly searchType: number; readonly searchBy: number };
  /** The Search tab's Search Type and Search By kept for the pilot online, on this machine. */
  keepContactsSearchSettings(settings: { readonly searchType: number; readonly searchBy: number }): void;
  /** Owners found by the search service's Query, by result type, each named and sorted by name; fails with the server's words. */
  searchOwners(text: string, resultTypes: readonly number[], matchBy: number): Promise<ReadonlyMap<number, readonly { readonly id: number; readonly name: string }[]>>;
  /** An agent added to the address book (charMgr.AddContact with the agent alone); fails with the server's words. */
  addAgentToAddressBook(agentID: number): Promise<void>;
  /** The contacts' notifications (notificationMgr.GetByGroupID(9)), those of a communication's type, their senders named. */
  contactNotifications(): Promise<readonly Notification[]>;
  /** Notifications deleted (notificationMgr.DeleteNotifications); fails with the server's words. */
  deleteNotifications(notificationIDs: readonly number[]): Promise<void>;
  /**
   * The notification window's group's notifications (notificationMgr.GetByGroupID), or for its Unread group the
   * unread ones (GetUnprocessed); those of a communication's type, their senders named.
   */
  notificationsOfGroup(groupID: number, unread: boolean): Promise<readonly Notification[]>;
  /** Notifications marked read (notificationMgr.MarkAsProcessed, a list); fails with the server's words. */
  markNotificationsRead(notificationIDs: readonly number[]): Promise<void>;
  /** A group's notifications marked read (notificationMgr.MarkGroupAsProcessed); fails with the server's words. */
  markNotificationGroupRead(groupID: number): Promise<void>;
  /** Every notification marked read (notificationMgr.MarkAllAsProcessed); fails with the server's words. */
  markAllNotificationsRead(): Promise<void>;
  /** A group's notifications deleted (notificationMgr.DeleteGroupNotifications); fails with the server's words. */
  deleteNotificationGroup(groupID: number): Promise<void>;
  /** Every notification deleted (notificationMgr.DeleteAllNotifications); fails with the server's words. */
  deleteAllNotifications(): Promise<void>;
  /** The notification window's group last shown on this machine; none where none was. */
  notificationGroupShown(): number | null;
  /** The notification window's group shown kept, on this machine. */
  keepNotificationGroupShown(groupID: number): void;
  /** Whether a dialog's Yes is kept ("do not ask again"), on this machine. */
  dialogYesKept(dialog: string): boolean;
  /** A dialog's Yes kept, so it is not asked again, on this machine. */
  keepDialogYes(dialog: string): void;
  /** How the client words each kind of notification, as its own code answers; null where it cannot be read. Asked once. */
  notificationFormats(): Promise<NotificationFormats | null>;
  /** The People & Places window's tab last chosen on this machine; none where none was. */
  addressBookTab(): string | null;
  /** The People & Places window's tab chosen kept, on this machine. */
  keepAddressBookTab(tab: string): void;
  /** The Contacts window's "Online only" as last left on this machine: off, where it never was. */
  onlineBuddyOnly(): boolean;
  /** The Contacts window's "Online only" kept, on this machine. */
  keepOnlineBuddyOnly(checked: boolean): void;
  /** Mark messages read, or not read, as the mail window's Mark as Read and Mark as Unread do. */
  markMail(messageIDs: readonly number[], read: boolean): Promise<void>;
  /** Move messages to the trash, as the mail window's Trash does. */
  trashMail(messageIDs: readonly number[]): Promise<void>;
  /** Bring trashed messages back, as the mail window's Restore does. */
  restoreMail(messageIDs: readonly number[]): Promise<void>;
  /** Delete trashed messages, as the mail window's Delete does. */
  deleteMail(messageIDs: readonly number[]): Promise<void>;
  /** Mark all mails, or a folder's (its label), read, as the mail window's Mark All as Read does. */
  readAllMail(labelID: number | null): Promise<void>;
  /** Trash all mails, or a folder's (its label), as the mail window's Trash All does. */
  trashAllMail(labelID: number | null): Promise<void>;
  /** Mark the mails to a mailing list read, as the list's Mark All as Read does. */
  readListMail(listID: number): Promise<void>;
  /** Trash the mails to a mailing list, as the list's Trash All does. */
  trashListMail(listID: number): Promise<void>;
  /** Bring every trashed mail back, as the trash's Restore All does. */
  restoreAllMail(): Promise<void>;
  /** Delete every trashed mail, as the trash's Empty Trash does. */
  emptyMailTrash(): Promise<void>;
  /** Make a mail label of the pilot's own, as the labels window's Create does: its bit, or null where it was not made. */
  createMailLabel(name: string): Promise<number | null>;
  /** Rename a label of the pilot's own, as the labels window's Rename does. */
  renameMailLabel(labelID: number, name: string): Promise<void>;
  /** Delete a label of the pilot's own, as the labels window's Delete does once it is asked to be sure of. */
  deleteMailLabel(labelID: number): Promise<void>;
  /** Give messages a label, as a message's Assign Label does: how many were given it (0, nothing asked, where all had it). */
  assignMailLabel(messageIDs: readonly number[], labelID: number): Promise<number>;
  /** Take a label off messages, as a message's Remove Label does: how many it was taken off. */
  removeMailLabel(messageIDs: readonly number[], labelID: number): Promise<number>;
  /** Close the open message without touching the server. */
  closeMail(): void;
  /**
   * Find someone to write to, by NAME. Static reference data; the id it
   * carries is never shown to the player (R7d).
   */
  findCharacters(q: string): Promise<readonly api.CharacterMatch[]>;
  /** Pilots found as the client's searchOld.Search finds them (the search service's QuickQuery), each named. */
  searchCharacters(text: string, matchBy: number): Promise<readonly api.CharacterMatch[]>;
  /**
   * The pilot's own corporation and its name, as the compose window reads them (session.corpid;
   * cfg.eveowners.Get(session.corpid).ownerName); null where the page holds no corporation for the pilot, or its
   * name is not known.
   */
  ownCorporation(): Promise<{ readonly corporationID: number; readonly name: string } | null>;
  /**
   * The pilot's own alliance and its name, as the compose window reads them (session.allianceid;
   * cfg.eveowners.Get(session.allianceid).ownerName); null where the session is in none, the transport does not
   * say it, or its name is not known.
   */
  ownAlliance(): Promise<{ readonly allianceID: number; readonly name: string } | null>;
  /**
   * SEND a message. Not a costly or destructive write, so no confirm gate —
   * but an empty recipient list is refused, because the SERVER will not refuse
   * it and mail addressed to nobody would look sent.
   */
  sendMail(request: MailToSend): Promise<void>;
  /**
   * Load the Contracts panel: the public courier browse, the player's own
   * contracts (waiting / taken on / expired), the summary counts, and every
   * NAME those need. READS ONLY — every contract mutator is refused at the
   * gateway.
   *
   * ⚠ An empty public browse is EXPECTED: EveJS has no contract generator, so
   * there is nothing to find until a player creates one.
   */
  loadContracts(page: number): Promise<void>;
  /** Open one contract in full: its items and its route endpoints, by name. */
  openContract(contractID: number): Promise<void>;
  /** Close the open contract without touching the server. */
  closeContract(): void;
  /**
   * TAKE ON a contract. Moves ISK and items and CANNOT be undone — the panel
   * asks before calling this, and the BFF refuses the call outright without an
   * explicit confirmation.
   *
   * Reloads the panel afterwards rather than patching the lists by hand: an
   * accepted contract leaves "waiting for you", joins "taken on", and changes
   * every count in the summary, and only the server knows all of that.
   */
  acceptContract(contractID: number): Promise<void>;
  /**
   * Load the Personal Assets panel: every station holding this character's
   * items, and every NAME those need. READS ONLY — the bound global-assets
   * object implements no write at all.
   *
   * ⚠ The station list is the SERVER's aggregation, not ours. Do not walk
   * containers in the browser to rebuild it.
   */
  loadPersonalAssets(): Promise<void>;
  /**
   * Expand one asset location and read what is there; null collapses it and
   * touches no server. A read that fails is recorded against that station
   * alone and never thrown.
   */
  openAssetStation(stationID: number | null): Promise<void>;
  /**
   * Set course for an asset location. Wraps `startRoute` — it builds no
   * navigation of its own.
   */
  setDestinationToAssetStation(stationID: number): Promise<void>;
  /** Load the docked station's agent roster (agentMgr.GetAgents). */
  loadAgents(): Promise<void>;
  /** Open a conversation with an agent (bound DoAction(None)). */
  openConversation(agentID: number): Promise<void>;
  /**
   * Take a conversation action (DoAction on the bound agent): request / accept /
   * decline. Accepting a courier refreshes the briefing + journal; declining
   * clears the briefing and refreshes the journal.
   */
  chooseAction(agentID: number, action: AgentAction): Promise<void>;
  /**
   * Answer a question the SERVER asked (`store.live.questions`): the retail
   * client's Yes/No window, its radio-button box or its number box. The server
   * is waiting on it; a No or a Cancel leaves things as they were.
   */
  answerQuestion(questionID: string, answer: QuestionAnswer): Promise<void>;
  /** Load the accepted-courier briefing (bound reads on the agent). */
  loadBriefing(agentID: number): Promise<void>;
  /** Load the mission journal (agentMgr.GetMyJournalDetails). */
  loadJournal(): Promise<void>;
  /** The journal's "Remove Offer" for an agent's offered mission. */
  removeOffer(agentID: number): Promise<void>;
  /**
   * The journal's "Read Details": the mission that agent has with the pilot, as the client's job board
   * shows it. Lands in `store.agents.missionPage`. Nothing happens for an agent with no mission in the
   * journal.
   */
  openMissionDetails(agentID: number): Promise<void>;
  /** Close the mission's page. */
  closeMissionDetails(): void;
  /**
   * Load the accepted courier's package from the station hangar into the active
   * ship. Both the briefing's cargo TYPE and its QUANTITY are needed: the type
   * alone does not identify the package, because courier cargo is ordinary
   * goods the player may already hold. Goes through the verifying
   * /api/bridge/inventory/transfer and raises if nothing actually moved.
   */
  loadPackageIntoShip(cargoTypeID: number, cargoQuantity: number): Promise<void>;
  /**
   * Set the browser autopilot to the mission dropoff (a station): reuses the
   * R5b route solver + decide-loop via startRoute(dropoffStationID).
   */
  setAutopilotToDropoff(dropoffStationID: number): Promise<void>;
  /**
   * R6 — the post-completion reward readout (Step 12): wallet / LP / standings.
   * The journal (the fourth Step-12 read) refreshes via loadJournal.
   */
  loadRewards(): Promise<void>;
  /**
   * R50 — the Wallet + Corp Wallet tabs: the personal ISK balance and the
   * corporation division balances, in one pull. Both tabs call this on mount.
   */
  /** `fresh`: asked of the server again, as the window's own Refresh asks; otherwise from what is kept (bridge/walletReads.ts). */
  loadWallet(how?: { readonly fresh?: boolean }): Promise<void>;
  /** The pilot's own ISK as the client keeps it (walletSvc.py wealth); null where it could not be read. */
  pilotWealth(): Promise<number | null>;
  /** Give Money's OK (transferMoneyWnd.py Confirm, 138 to 152): the pilot's ISK given to a character. Fails as the call fails. */
  giveMoney(toID: number, amount: number, reason: string): Promise<void>;
  /** Redeem Items (redeemsvc.py): what the account may redeem, read again of what the pilot's transport keeps. */
  loadRedeemTokens(): Promise<void>;
  /** The pilot's home station, where Redeem to Home Station delivers (homestation/client/service.py 67); null where it cannot be read. */
  redeemHomeStation(): Promise<number | null>;
  /**
   * Redeem Items' Redeem to Current Station or Redeem to Home Station (redeemItemsContainer.py redeem, 343 to 356): the
   * tokens for the pilot, and then what is left read again. Fails as the call fails.
   */
  redeemTokens(tokens: readonly RedeemToken[], useHomeStation: boolean): Promise<RedeemOutcome>;
  /** Daily Login Rewards (loginCampaignService.py): the account's campaign, read again. */
  loadLoginRewards(): Promise<void>;
  /**
   * The window's Claim (loginCampaignService.py claim_reward, 196 to 212): the day's reward, into the account's redeem
   * queue. Fails where the server gave nothing (already claimed today), and the campaign is read again.
   */
  claimLoginReward(): Promise<LoginClaim>;
  /**
   * The seasonal tab's Claim (seasonalLoginCampaignService.py claim_reward, 80 to 88): the day's rewards, into the
   * account's redeem queue; the campaign is read again after. Fails where the server gave nothing.
   */
  claimSeasonalReward(): Promise<void>;
  /**
   * R55 — the Standings page: the character's own standings and the
   * corporation's, in one pull, with every entity id resolved to a name.
   */
  loadStandings(): Promise<void>;
  /**
   * R55 — load one entity's drill-down: a char row's standing history or a corp
   * row's per-member composition. `scope` says which section the row is in.
   */
  loadStandingDetail(fromID: number, scope: "char" | "corp"): Promise<void>;
  /** R55 — close the open standings drill-down. */
  closeStandingDetail(): void;
  /**
   * R56 — the Character Sheet page: who the character is (name / security / corp
   * / alliance), the bio, the home station and the clone's implants, in one pull,
   * with every entity id resolved to a name (R7d). Called on the panel's mount.
   */
  loadCharacterSheet(): Promise<void>;
  /**
   * The Character Sheet's skill history, as the client's History panel asks for it (bridge/skillHistoryPanel.ts):
   * the skill handler's history and the pilot's skills, made into the panel's lines.
   */
  loadSkillHistory(): Promise<void>;
  /**
   * The Character Sheet's employment history, as the client's History panel's employment tab asks for it
   * (bridge/employmentHistory.ts): the corporation service's record of the pilot's corporations and transfers.
   */
  loadEmploymentHistory(): Promise<void>;
  /** Refresh the flight status (location + ship movement state). */
  loadFlightStatus(): Promise<void>;
  /** Undock from the station (the session enters space). */
  undock(): Promise<void>;
  /**
   * Warp to a chosen gate/celestial through the bound park. `minRange` null is
   * the autopilot warp; a number warps to that distance from the target (R13).
   */
  warpTo(destinationID: number, minRange?: number | null): Promise<void>;
  /**
   * R11 — approach an object at full speed (the same atomic move the autopilot
   * uses to close the last gap to a gate). Offered on every overview row.
   * R13 — the range is retail's: 50 m from the menu, 0 from the autopilot.
   */
  approach(destinationID: number, range?: number | null): Promise<void>;
  /** R13 — hold a set distance from a target (CmdFollowBall at that range). */
  keepAtRange(targetID: number, range?: number | null): Promise<void>;
  /** R13 — circle a target at a set distance (CmdOrbit). */
  orbit(targetID: number, range?: number | null): Promise<void>;
  /** R13 — point the ship at a target and hold that heading (CmdAlignTo). */
  alignTo(targetID: number): Promise<void>;
  /**
   * R13 — cut the engines (CmdStop). As in retail, this also switches the
   * autopilot off: stopping the ship must not leave something still flying it.
   */
  stopShip(): Promise<void>;
  /** R11 — read what is currently around the ship (and the ship's condition). */
  loadSpaceSnapshot(): Promise<void>;
  /**
   * R11/R30 — CLAIM and RELEASE the ~1s space feed. Reference-counted, not a
   * switch: every panel that shows live space data claims on mount and releases
   * on unmount, and the feed keeps running until the LAST viewer lets go.
   *
   * It was a plain on/off flag with a single caller (the Overview panel), which
   * meant switching to any other tab unmounted that panel and froze the whole
   * cockpit — snapshot, locks, gauges, distances, hostiles. The count is what
   * lets a player set a destination on Travel without the ship they are flying
   * going still behind them.
   *
   * Claiming is not the same as polling: the feed still stops when the ship is
   * docked or the browser tab is hidden, and resumes on its own when either of
   * those goes away. Callers must pair every claim with exactly one release.
   */
  startSpacePolling(): void;
  stopSpacePolling(): void;
  // --- R23 slice A: the GENERIC in-space action layer --------------------
  // Deliberately free of any notion of mining or combat. A target is a target;
  // a module is a module; the effect name is an OPTIONAL argument (omit it and
  // the server resolves the module's own default activation effect from its
  // typeID — the browser never guesses which effect a module runs). A later
  // combat goal reuses all five of these unchanged.
  /** R23 — read the locked-target list (the only authority on what is locked). */
  loadTargets(): Promise<void>;
  /** R23 — lock a ball. Acquisition takes time; the lock is not instant. */
  lockTarget(targetID: number): Promise<void>;
  /** R23 — release ONE lock (or abandon one still being acquired). */
  unlockTarget(targetID: number): Promise<void>;
  /** R23 — switch a module on. `repeat` is -1 continuous (default) or 0 single-cycle. */
  activateModule(
    itemID: number,
    opts?: { effect?: string; typeID?: number; targetID?: number | null; repeat?: -1 | 0 },
  ): Promise<void>;
  /** R23 — switch a module off. */
  deactivateModule(itemID: number, opts?: { effect?: string; typeID?: number }): Promise<void>;
  /**
   * Start or stop overloading a module. ⚠ Overloading damages it — the server
   * refuses an offline or burnt-out module, and a pilot without Thermodynamics,
   * in its own words. A module with no overload effect is not asked of it.
   */
  setModuleOverload(itemID: number, overloaded: boolean): Promise<void>;
  /**
   * Repair a damaged module with nanite paste — the complement to overloading,
   * without which a burnt-out module could never be brought back.
   */
  repairModule(itemID: number): Promise<void>;
  /** Bank every weapon into groups, or break every bank. */
  setWeaponBanks(linked: boolean): Promise<void>;
  // --- R23 slice B: the mining loop --------------------------------------
  // Built ON TOP of the generic layer above, not into it. There is no "start
  // mining" method: mining a rock is lockTarget + activateModule with a mining
  // laser. The browser never simulates a cycle or predicts a yield.
  /** R23 — read the ship's ore / gas / ice holds (falling back to cargo). */
  loadMiningHolds(): Promise<void>;
  /** The Mining window's own read: the holds, and the hangar too where the pilot is docked (its ore can be refined there). */
  loadMiningWindow(): Promise<void>;
  /** R23 — run the survey scanner; the panel merges the results into the overview. */
  runSurveyScan(): Promise<void>;
  /** R23 — ask the station refinery what these stacks yield, and its ISK tax. */
  loadReprocessingQuote(itemIDs: readonly number[]): Promise<void>;
  /** R23 — move mined ore into the station hangar (docked only). */
  unloadMiningHolds(itemIDs: readonly number[]): Promise<void>;
  /**
   * R23 — ⚠ CONSUMES the stacks and CHARGES the station's ISK tax. The panel
   * confirms first (showing the quote and the tax) and the BFF confirms again.
   */
  reprocessItems(itemIDs: readonly number[]): Promise<void>;
  /**
   * ⚠ JETTISON — dumps these stacks into space as a container ANYONE can take.
   *
   * It is destructive in the way that matters most to a miner: the ore is not
   * gone, it is on the grid and no longer yours in any practical sense. The
   * panel confirms first and the BFF route is confirm-gated as well.
   *
   * ⚠ AND IT IS JUDGED BY THE HOLD, NOT BY THE ANSWER. The call answers without
   * saying which stacks left, so this re-reads the holds and reports a silent
   * decline when nothing actually moved — never a phantom success.
   */
  jettisonItems(itemIDs: readonly number[]): Promise<void>;
  /**
   * ⚠ THE INVERSE OF JETTISON — empty a wreck or a can ON THE GRID into this
   * hull, each stack going to the bay that wants it (ore to the ore hold, gas to
   * the gas hold, the rest to cargo) exactly as the loot BOTS route it.
   *
   * Reports what it did rather than throwing on a partial move: what fits
   * nowhere stays in the container, which is not a failure. It throws when the
   * server refused everything, and when the hull has room for none of it.
   */
  lootContainer(containerID: number): Promise<LootOutcome>;
  /**
   * ⚠ COMPRESS ONE ORE STACK against a mining support ship on the grid — your
   * own hull or a fleet-mate's, running an Industrial Core plus a compression
   * module. `space/compression.ts` decides which hulls qualify.
   *
   * ⚠ THE SERVER REFUSES WITH ONE SILENCE. A missing facility, an out-of-range
   * one, a foreign item and an ore with no compressed form are all the same
   * `compressed: false`. So a refusal re-reads the hold and says it was refused
   * — it never names a cause it does not have.
   */
  compressOre(itemID: number, facilityID: number): Promise<void>;
  /**
   * The compressed forms of these types as the static data has them: a type's own, or null where it has none. A
   * type the data could not speak of is absent, and is not to be offered as compressible.
   */
  compressedTypesOf(typeIDs: readonly number[]): Promise<ReadonlyMap<number, number | null>>;
  // --- R25 slice A: drones -------------------------------------------------
  //
  // ⚠ NOT ONE of these four server calls can be trusted on its return value.
  // The launch handler answers 200 with an EMPTY DICT when it refuses, and the
  // three in-space orders answer an empty dict on SUCCESS. So every method here
  // lands what the BFF re-read out of the space snapshot afterwards, and a
  // refusal surfaces as a silent-decline rather than as a phantom success.

  /** R25 — the bay, the drones in space, and the server's launch limits. */
  loadDrones(): Promise<void>;
  /**
   * R25 — launch from the bay.
   *
   * ⚠ THIS IS THE DEFENCE. An idle combat drone auto-engages whatever shoots
   * the ship it came from (the server's own behaviour, on by default), so a
   * miner who launches is defended with no further clicks. `engageDrones` is
   * for CHOOSING a victim, not for being protected.
   */
  launchDrones(itemIDs: readonly number[]): Promise<void>;
  /** R25 — set drones on a target. */
  engageDrones(droneIDs: readonly number[], targetID: number): Promise<void>;
  /** R25 — put mining drones on a rock. */
  mineWithDrones(droneIDs: readonly number[], targetID: number): Promise<void>;
  /**
   * Send salvage drones to a wreck, or to any wreck they may where `targetID`
   * is null. The page's own call (bridge/boundEntityWrites.ts), as a client's
   * drones window makes it.
   */
  salvageDrones(droneIDs: readonly number[], targetID: number | null): Promise<void>;
  /** R25 — bring drones home (the runtime scoops them itself inside 2500 m). */
  recallDrones(droneIDs: readonly number[]): Promise<void>;
  /**
   * Take control of drones this ship owns but does not fly — the recovery path
   * for an orphaned drone, which Recall and Engage cannot reach.
   */
  reconnectDrones(droneIDs: readonly number[]): Promise<void>;
  /** Scoop drones straight into the bay; needs no control, only range. */
  scoopDrones(droneIDs: readonly number[]): Promise<void>;
  /**
   * ⚠⚠ DEV-ONLY. Run one of this world's chat commands and return the server's
   * own reply. Reaches ~150 commands including destructive ones; the reply
   * carries "Command failed: …" for a refusal rather than throwing.
   *
   * Afterwards the panels that could have changed are re-read, because a GM
   * command mutates the world behind every open panel at once.
   */
  runGmCommand(command: string): Promise<string>;
  // --- R28: skills ---------------------------------------------------------
  //
  // ⚠ A queue save answers with the RE-READ sheet, never with its own return
  // value: skillMgr.SaveNewQueue returns null on success, so believing the call
  // would mean believing nothing at all.

  /** R28 — the character sheet, the queue, and the server's clock. */
  loadSkills(): Promise<void>;
  /**
   * R28 — save the WHOLE queue. Adding, removing and reordering are all this
   * one call, exactly as the server models it, and so is starting a paused
   * queue again: the queue saved as it stands. `[]` empties it.
   *
   * `context` is the skill the player was acting on; it is used only to word a
   * refusal ("Gunnery needs another skill first"), because the server's refusal
   * codes do not carry a name.
   */
  saveSkillQueue(
    entries: readonly { readonly typeID: number; readonly toLevel: number }[],
    label: string,
    context?: string,
    /** True for the start button, which starts the queue whatever else is so; a change of the queue says nothing. */
    start?: boolean,
  ): Promise<void>;
  /**
   * Pause training as the retail client does: the skill in training stops and
   * the queue is kept. What lands in the store is the sheet re-read after it.
   */
  pauseSkillTraining(): Promise<void>;
  /**
   * Spend unallocated skill points into one skill. What was actually spent is
   * read from the server's new free-SP total, never from what was asked for.
   */
  applyFreeSkillPoints(skillTypeID: number, points: number): Promise<void>;
  // --- R41: planetary colonies ---------------------------------------------
  //
  // READ ONLY, and deliberately so. The write path the emulator exposes
  // (restart the expired extractors) changes what a colony is DOING, and this
  // slice ships the ability to look before it ships the ability to act.

  /** R41 — every colony this character owns, and what is on each planet. */
  loadPlanets(): Promise<void>;
  /** R41 — open one colony, or close the open one with null. View state. */
  selectColony(planetID: number | null): void;
  /**
   * Jump through an NPC stargate (fromGate -> toGate) — ONE `CmdStargateJump`,
   * no closing in. Out of jump range the server refuses; for a Jump that closes
   * the distance itself, use `jumpThrough`.
   */
  jump(fromGateID: number, toGateID: number): Promise<void>;
  /**
   * JUMP, the way Dock means it: close the distance and then jump. Runs the
   * same browser decide-loop as `dockAt` over a ONE-hop plan through this gate,
   * so it warps, approaches and jumps in whatever order the measurement calls
   * for, and arrival is the next system read back from FLIGHT STATUS.
   */
  jumpThrough(link: GateLink): Promise<void>;
  /**
   * R30 slice A — the stargates in `systemID` and where each one leads.
   *
   * NO new server surface: this is a read of the SAME client-side route graph
   * the R5b autopilot already fetches once and caches (`loadRouteGraph`), served
   * as static reference data. It exists so a gate row in the overview can say
   * which system is on the other side and jump through it, instead of pushing a
   * flying player to another tab to type two raw gate IDs by hand.
   *
   * Throws if the graph cannot be read; the caller states that honestly rather
   * than rendering gates it silently cannot route.
   */
  nearbyGates(systemID: number): Promise<readonly GateLink[]>;
  /**
   * Dock at the destination station — ONE `CmdDock`, no closing in. Out of
   * range the server starts an approach and refuses, and the caller has to
   * re-issue; for a Dock that closes the distance itself, use `dockAt`.
   */
  dock(stationID: number): Promise<void>;
  /**
   * R24 slice B — DOCK, the way retail's menu means it: close the distance and
   * then dock. Runs the same browser decide-loop the travel autopilot runs (one
   * loop, not two) over a zero-hop plan whose destination is this station, so
   * it warps, approaches and docks in whatever order the measurement calls for,
   * reports which phase it is in, and stops with the server's own reason if it
   * cannot get there. Arrival is confirmed from FLIGHT STATUS, never from the
   * Dock call's 200.
   */
  dockAt(stationID: number): Promise<void>;
  /**
   * R6a — find agents from the static reference table (default courier),
   * annotate each with jumps from the current system (a single client-side
   * BFS), and sort nearest-first. Surfaces a failure through the finder slice
   * rather than throwing.
   */
  findAgents(filters?: { kind?: string; level?: number | null; limit?: number }): Promise<void>;
  /**
   * R6a — set the browser autopilot to a found agent's station (reuses the R5b
   * route solver + decide-loop via startRoute), and record the target agent so
   * the player knows who they're flying to.
   */
  setDestinationToAgent(agentID: number): Promise<void>;
  /**
   * R5b — start the browser autopilot to a destination (station or system ID):
   * solve the route client-side, then run the decide-loop. Surfaces a plan
   * error (unreachable / unknown) through the travel slice rather than throwing.
   */
  startRoute(destinationID: number): Promise<RouteStartOutcome>;
  /**
   * R7a — search the static map by name (systems + stations) so a player can set
   * a destination without knowing EVE IDs. Returns the matches annotated with
   * jumps from the current system (best-effort). A too-short query returns []
   * without a request; a read failure throws (the caller surfaces it).
   */
  searchDestinations(
    query: string,
    kind?: "system" | "station" | "dockable" | null,
  ): Promise<DestinationMatch[]>;
  // --- R26: the mining bot -----------------------------------------------
  //
  // A SECOND browser decide-loop, built from the same parts as the autopilot
  // and never running alongside it (starting the bot aborts the autopilot).
  // Closing the tab is closing the client: the loop stops, the ship finishes
  // its last server-side command, and sits.
  /**
   * Start the mining bot on a belt, hauling to a station, running the
   * equipment the PLAYER picked. Surfaces a start problem through the bot
   * slice rather than throwing.
   */
  /**
   * Start the fleet companion — a pilot that takes its orders from the fleet.
   *
   * ⚠ IT TAKES A `CompanionSetup`, NOT A REQUEST, and the difference is the
   * whole of what a caller has to provide. A setup is the six things that
   * cannot be read off a ship; the eight module lists that complete a
   * `FleetCompanionRequest` are filled in HERE, from the hull this pilot is
   * actually sitting in, before the loop sees anything.
   */
  startFleetCompanion(
    setup: CompanionSetup,
    resuming?: CompanionAbandonmentRecord | null,
  ): Promise<void>;
  pauseFleetCompanion(): void;
  resumeFleetCompanion(): void;
  stopFleetCompanion(): void;
  startMiningBot(request: MiningBotRequest): Promise<void>;
  /** Pause the bot (it stops issuing; the ship finishes its last move). */
  pauseMiningBot(): void;
  /** Resume a paused bot from where it stopped. */
  resumeMiningBot(): void;
  /** Stop the bot (it stops and never calls the bridge again). */
  stopMiningBot(): void;
  // --- R36: the distribution-mission bot ---------------------------------
  // A THIRD browser decide-loop. Unlike the mining bot it does not fly the ship
  // itself: it hands destinations to the SAME autopilot the Travel panel drives,
  // so there is one flight ladder with one set of bounds.
  /** Start the mission bot on an agent (requesting, gating, hauling, delivering). */
  startMissionBot(request: MissionBotRequest): Promise<void>;
  /** Pause it (it stops issuing; the ship finishes its last move). */
  pauseMissionBot(): void;
  /** Resume a paused mission bot from where it left off. */
  resumeMissionBot(): void;
  /** Stop it (it stops, stops the autopilot, and never calls the bridge again). */
  stopMissionBot(): void;
  // --- Player Bot Builder runner (the fourth decide-loop) ----------------
  /** Start a player-built script; the live readout is pushed to `store.customBot`. */
  startCustomBot(doc: BotScript, sourceScriptID?: string | null): Promise<void>;
  /** Pause it (it stops issuing; the ship finishes its last move). */
  pauseCustomBot(): void;
  /** Resume a paused script from where it stopped. */
  resumeCustomBot(): void;
  /** Stop it (it stops and never calls the bridge again). */
  stopCustomBot(): void;
  /** Hosted manual/deadline Stop: settle issued work and confirm the controlled
   * flight is empty before the host may dock or release this session. */
  prepareHostedBotStop(kind: "script" | "companion", deadlineMs: number): Promise<void>;
  prepareCustomBotParking(): Promise<void>;
  suspendHostedSession(): Promise<void>;
  verifyHostedSessionRecovery(shipID: number): Promise<void>;
  resumeHostedSession(): void;
  parkCustomBot(policy: FleetParkingPolicy, deadlineMs: number): Promise<void>;
  /** Cancel Farmer's deadline home run and settle its last issued action. */
  cancelHostedHome(kind: "script" | "companion"): Promise<void>;
  /**
   * End it DOCKED: the running script flies home and pauses on arrival with
   * `reason`. False when no script is running to send (see
   * ScriptRunnerController.headHome).
   */
  headCustomBotHome(reason: string): boolean;
  /** The character's and its corp's saved fittings, with hull names (for the Bot Builder's fitting picker). */
  listSavedFittings(): Promise<readonly (import("../bridge/sharedFittings.ts").SourcedFitting & { readonly shipName: string | null })[]>;
  /** The character's saved bookmarks (for the Bot Builder's saved-spot picker). */
  listBookmarks(): Promise<readonly { bookmarkID: number; name: string }[]>;
  /** The bookmark folders the character knows or administers (for the Bot Builder's folder picker). */
  listBookmarkFolders(): Promise<readonly { folderID: number; name: string }[]>;
  /**
   * Manual escape hatch: stop every loop, recall drones, and dock at the nearest
   * station on grid. Always available while a bot runs — the operator's override.
   */
  panicRecallAndDock(shouldAbort?: () => boolean): Promise<void>;
  /** Pause the autopilot loop (it stops issuing; the ship finishes its last move). */
  pauseRoute(): void;
  /** Resume a paused autopilot loop from where it stopped. */
  resumeRoute(): void;
  /** Abort the autopilot loop (it stops and never calls the bridge again). */
  abortRoute(): void;
  /**
   * R7 — read a chat channel's member roster + recent backlog (Local or Corp)
   * and push it to the store. The panel polls this while open (READ is a backlog
   * poll). A lost session unwinds to offline; any other failure surfaces through
   * the chat slice.
   */
  loadChat(channel: ChatChannel): Promise<void>;
  /** R7 — send a message to a chat channel, then refresh its backlog. */
  sendChatMessage(channel: ChatChannel, message: string): Promise<void>;
  /** R7 — switch the active chat tab (Local <-> Corp). */
  setChatChannel(channel: ChatChannel): void;
  /**
   * R7c — request display names for a set of `{kind, id}` refs (names-everywhere).
   * Fire-and-forget: unresolved refs are batched into one /api/names round-trip,
   * cached (including a definitive "unknown" so they never refetch), and pushed
   * into the store's `names` slice for pure-reader components. Already-cached or
   * in-flight refs are skipped; a transient failure is not cached (it can retry).
   * Never throws and never blocks interaction (the UI shows the ID until the name
   * lands).
   */
  requestNames(refs: readonly NameRef[]): void;
  /**
   * Ask for the retail client's own text for these localisation labels, or
   * for messages by number ("#" and the number), to land in `store.words`
   * under the same keys. Batched and remembered like names: each is asked
   * for once. Never throws. When the BFF has no client to read, each is null
   * and nothing more is asked.
   */
  requestWords(labels: readonly string[]): void;
  /**
   * Ask a mission's agent for the mission's keywords, to land in
   * `store.agents.missionKeywords` under "<agentID>:<contentID>". Asked once
   * for each mission, as the client does, for as long as the store keeps the
   * answer (selecting a pilot empties it). Never throws.
   */
  requestMissionKeywords(agentID: number, contentID: number): void;
  /**
   * Ask what the client's agents service knows of an agent (its level, division, corporation and
   * faction), to land in `store.agents.agentRecords` under its ID. Asked once for each agent, for as long
   * as the store keeps the answer. Never throws.
   */
  requestAgentRecord(agentID: number): void;
  /**
   * Ask the server which solar system an agent is in (agentMgr.GetSolarSystemOfAgent), to land in
   * `store.agents.agentSolarSystems` under the agent's ID. Asked once for each agent, as the client's
   * agents service does, for as long as the store keeps the answer. Never throws.
   */
  requestAgentSolarSystem(agentID: number): void;
  /**
   * Ask for the security of these solar systems, to land in `store.names.systemSecurity` under their IDs.
   * Batched and remembered like names: each is asked for once. Never throws.
   */
  requestSystemSecurity(systemIDs: readonly number[]): void;
  /**
   * Work out how many jumps the autopilot's route has from one solar system to others, to land in
   * `store.names.autopilotJumps` under "<from>:<to>". The client works this out itself, from its own map
   * (nav/autopilotRoute.ts); so does this, from the map the route solver uses, which is read once. A pair
   * the store holds is not worked out again. Never throws.
   */
  requestAutopilotJumps(fromSystemID: number, toSystemIDs: readonly number[]): void;
  /** The autopilot's settings as the pilot has set them: only what has been set is there (nav/autopilotSettings.ts). */
  autopilotSettings(): StoredAutopilotSettings;
  /**
   * Change one of the autopilot's settings, as the client's route panel does: kept for this character, and
   * what was worked out with the old settings forgotten. Each answers the settings as they now are. A route
   * already being flown is not plotted again.
   */
  setAutopilotRouteType(routeType: AutopilotRouteType): StoredAutopilotSettings;
  setAutopilotPenalty(penalty: number): StoredAutopilotSettings;
  clickAutopilotAvoidSystems(): StoredAutopilotSettings;
  /**
   * Multibox — open or close this pilot's live push channel (SSE). Browsers
   * allow only ~6 concurrent HTTP/1.1 connections per origin, and every open
   * EventSource holds one for its whole life, so a tab full of pilots each
   * holding a stream starves the pool and the NEXT pilot's login/select hangs
   * forever in the browser's request queue. The roster owner (App.svelte)
   * keeps push on for the ACTIVE pilot only. A pilot without push still works:
   * every bridge response carries its notification drain and the panels poll;
   * only live chat/notification push waits until the pilot is active again.
   * Enabling while the character is online (re-)opens the stream immediately.
   */
  setLivePush(enabled: boolean): void;
  /** R92 multibox — mark this flow as the pilot on screen (or not). */
  setForeground(active: boolean): void;
  /** Release the persistent session (character offline), back to the select list. */
  releaseSession(): Promise<void>;
  logout(): Promise<void>;
}

/**
 * True when the session the BFF held can no longer act — the character is not
 * online on it. Two codes mean this, and both must unwind the same way (stop the
 * stream, flip the slice offline, so App prunes the pilot rather than leaving a
 * cockpit whose every read fails):
 *   • SESSION_NOT_FOUND — the held bridge session is gone (TTL / restart).
 *   • NO_LIVE_SESSION   — the session is held but its character was taken over
 *     by another client (retail takeover) or released, so the gateway reports no
 *     character online. This is exactly what a multibox re-select does to a
 *     character being flown elsewhere, so R107 must treat it as a lost session
 *     or the yanked pilot lingers as a zombie cockpit.
 */
export function isSessionLost(error: unknown): boolean {
  return (
    error instanceof BridgeCallError &&
    (error.code === "SESSION_NOT_FOUND" || error.code === "NO_LIVE_SESSION")
  );
}

/**
 * The RAW reason a read or a mutation failed — the server's own words, or its
 * code when it gave none.
 *
 * ⚠ THIS IS NOT PLAYER-FACING. It is the machine-readable text: what the
 * autopilot and the mining bot classify on, and what `describeRefusal` keys off.
 * Anything that ends up on screen must go through `errorWords`/`refusalWords`
 * (R31) — a bare `CALL_FAILED` or `101,UI/Menusvc/MenuHints/...` is jargon, and
 * R9a does not have an exception for error paths.
 */
function throwIfRequestRetired(error: unknown): void {
  if (error instanceof BridgeCallError && error.code === "SESSION_REQUEST_RETIRED") throw error;
}

function readErrorReason(error: unknown): string {
  throwIfRequestRetired(error);
  if (error instanceof BridgeCallError) {
    return error.code;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * The RAW reason a mutation was refused, keeping the SERVER's own words.
 *
 * readErrorReason() reduces a typed refusal to its code, which is right for the
 * classification paths. It is WRONG for anything a player reads: a corp hangar
 * refusal is the invbroker handler's own sentence ("You do not have the
 * required roles") and a fitting refusal is dogma's ("You do not have enough
 * CPU to online that module."), and throwing those away to show `CALL_REFUSED`
 * loses the only useful half. The code is kept as a prefix so the
 * machine-readable part is not lost either; `describeRefusal` looks past it.
 *
 * ⚠ STILL NOT PLAYER-FACING. Everything on screen goes through errorWords().
 */
function readRefusalReason(error: unknown): string {
  // A previous pilot's completion is cancellation, never a refusal to publish
  // into the current pilot's panel. Keep it out of all error reducers too.
  throwIfRequestRetired(error);
  if (error instanceof BridgeCallError) {
    const detail = error.message.trim();
    return detail === "" || detail === error.code ? error.code : `${error.code}: ${detail}`;
  }
  return readErrorReason(error);
}

/**
 * R31 — THE SINGLE TRANSLATION SEAM. Any failure, in words a player reads.
 *
 * Every player-facing message in this file goes through here or through
 * flightRefusalWords(). The raw text is logged rather than shown, so it stays
 * recoverable for diagnosis without being in the player's face, and a refusal
 * this client has never seen still reads as a sentence instead of a code.
 */
function errorWords(error: unknown): string {
  return sayRefusal(readRefusalReason(error));
}

/** Turn a raw refusal into a sentence, keeping the raw recoverable (R31). */
// invGroups 1025, Planetary Customs Offices — the group a customs office is, in
// both its flavours (the synthesized InterBus office every planet carries and an
// anchored POCO). The GROUP says what a structure is for; its name and its
// position do not.
const CUSTOMS_OFFICE_GROUP_ID = 1025;
const sayRefusal = sayRefusalWords;

/**
 * The lane priority a pilot's calls carry, given whether it is on screen.
 *
 * ⚠ UNDEFINED, NOT "read", FOR THE FOREGROUND. Absent lets app/api.ts apply its
 * own default, and — more importantly — lets a call that names its own priority
 * still win: the space poll passes "poll" whether or not its pilot is on screen,
 * because a poll is background work even for the pilot you are looking at.
 */
/**
 * Whether a high-slot module's GROUP name makes it a weapon a bot fires at a
 * target: "Projectile Weapon", "Hybrid Weapon", "Energy Weapon", "Missile
 * Launcher …" — the game's own turret/launcher groups.
 *
 * Not every launcher is a weapon: the SDE also files "Scan Probe Launcher",
 * "Survey Probe Launcher", "Interdiction Sphere Launcher" and "Festival
 * Launcher" under that word. Fired at a rat they launch probes, drop a warp
 * bubble, or throw snowballs, so they are excluded.
 */
export function isWeaponModuleGroup(group: string): boolean {
  return (
    /weapon|launcher|turret/i.test(group) &&
    !/probe launcher|interdiction sphere launcher|festival launcher/i.test(group)
  );
}

export function foregroundCallPriority(active: boolean): RequestPriority | undefined {
  return active ? undefined : "poll";
}

/**
 * What each ship TYPE does to a ship it fights, classified once and kept for
 * the life of the tab (docs/drone-boat-block-spec.md §6).
 *
 * ⚠ PERMANENT, AND THAT IS THE DIFFERENCE FROM A NAME CACHE. `resolveNames`
 * expires because a character or a corporation can be renamed under us; TYPE
 * DOGMA IS STATIC REFERENCE DATA and cannot change while the client is running,
 * so a type is fetched exactly ONCE per session however many hundred times its
 * hull is seen on a grid. There is no TTL here on purpose, and adding one would
 * buy nothing but round trips.
 *
 * ⚠ MODULE-LEVEL, SO EVERY PILOT ON THIS TAB SHARES IT. Four companions in one
 * anomaly are looking at the same rats, and "what does a Dire Pithi Arrogator
 * do" has one answer for all of them. Nothing in it is per-character, per-fit or
 * per-session — it is the SDE, read through a route that takes no session.
 *
 * ⚠ A FAILED FETCH LEAVES THE TYPE OUT OF THE MAP RATHER THAN PUTTING A GUESS
 * IN IT. A permanent cache poisoned with `UNKNOWN_THREAT` for a type whose read
 * merely stumbled would classify a tackle frigate as harmless for the rest of
 * the session, with nothing anywhere able to tell that apart from a rat that
 * really is harmless. An EMPTY attribute object is a different thing and IS
 * cached: it is the static tables answering "this type carries none of those
 * six attributes", which is a real reading and not a failure.
 */
const ratThreatByTypeID = new Map<number, RatThreat>();

/**
 * Each rat type's signature radius (dogma 552), filled by the SAME fetch as
 * `ratThreatByTypeID` and cached under the same rule: only what the route
 * answered for. A type the static tables gave no 552 for is simply absent,
 * which the kill order sorts after every known size.
 */
const ratSignatureByTypeID = new Map<number, number>();
const ATTR_SIGNATURE_RADIUS = 552;

/**
 * Each rat type's full shield, armour and hull (263, 265, 9), riding the same
 * fetch, so the drone rung can tell a nearly dead ship from a fresh one when it
 * prices a size switch.
 */
const ratHitPointsByTypeID = new Map<number, CompanionHitPoints>();
/**
 * What each hostile type fights with and how it moves -- missile or turret,
 * optimal, falloff, attack range, orbit range, speed -- for the `flight auto`
 * positioning rung. Filled by the same fetch and under the same rules as the
 * three caches above: static type dogma, permanent, one round trip per new type.
 */
const ratCombatByTypeID = new Map<number, RatCombatFacts>();
/** Each rat type's resonances by layer, for ammo by target. Same fetch, same rules. */
const ratResonancesByTypeID = new Map<number, RatResonances>();
const ATTR_SHIELD_CAPACITY = 263;
const ATTR_ARMOR_HP = 265;
const ATTR_HULL_HP = 9;

/**
 * Each combat drone type's sizing facts, or null for a type whose dogma came
 * back without the essentials (never invented; see `droneFactsFromAttributes`).
 * Permanent for the session, like the rat caches: type dogma is static.
 */
const droneFactsByTypeID = new Map<number, DroneFacts | null>();

/**
 * Metres of drone control range each drone-range SKILL buys per level, off that
 * skill type's own dogma attribute 459 (`droneRangeBonus`).
 *
 * ⚠ MODULE-LEVEL AND PERMANENT, FOR EXACTLY THE REASONS `ratThreatByTypeID`
 * ABOVE IS. This is the SDE, read through /api/types/dogma, which takes no
 * bridge session and cannot vary by player: what Drone Avionics is worth per
 * level has one answer for every pilot on this tab and cannot change while the
 * client is running. Two skills, one round trip, once per session, shared.
 *
 * ⚠ `null` IS A CACHED ANSWER AND MEANS "THE TABLES CARRY NO 459 FOR THIS SKILL",
 * WHICH IS NOT ZERO. A skill with no readable per-level bonus makes the whole
 * sum unanswerable the moment it is trained (nav/droneControlRange.ts), and that
 * is deliberate: quietly treating the missing bonus as 0 would shorten the leash
 * and walk the ship back toward the scram that killed one. A typeID the response
 * OMITTED entirely is a different thing — the read never arrived — and is left
 * out of this map so the next ask tries again.
 */
const droneRangeBonusByTypeID = new Map<number, number | null>();

/** godma.ProcessSessionChange (1156): the session's names at whose change godma primes itself again, and ends the repairs it began. */
const GODMA_SESSION_NAMES: ReadonlySet<string> = new Set(["stationid", "solarsystemid", "shipid", "charid", "structureid"]);
/** dogma attributes: a module's hit points, and the hit points a character mends in a minute with nanite paste. */
const ATTRIBUTE_HP = 9;
const ATTRIBUTE_MODULE_REPAIR_RATE = 1267;
/** How long a scoop waits for its drones to go out of space, and how often it looks: the launch's own two (src/server.js). */
const SCOOP_LEAVE_WAIT_MS = 3000;
const SCOOP_LEAVE_STEP_MS = 250;
/** How long a launch's new drones are waited for in the drones' read, and how often it is made again. */
const LAUNCH_ARRIVAL_WAIT_MS = 3000;
const LAUNCH_ARRIVAL_STEP_MS = 250;
/** One of an item's attributes as godma was primed with it, where it is a number. */
function dogmaNumber(item: DogmaItemInfo | null, attributeID: number): number | null {
  const value = item?.attributes.find((attribute) => attribute.attributeID === attributeID)?.value;
  return typeof value === "number" ? value : null;
}

export function createAppFlow(store: ClientStore, options: AppFlowOptions = {}): AppFlow {
  let sessionCloseGeneration = 0;
  let requestGeneration = 0;
  let sessionClosing = false;
  // An OK / Cancel question of this client's own. With no browser there is
  // nobody to ask, and the answer is Cancel.
  const askUser = async (message: string): Promise<boolean> => {
    if (options.confirm) {
      return (await options.confirm(message)) === true;
    }
    return typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm(message) : false;
  };
  // R107 — in per-session mode the `token` key is present (starting null) so
  // every api.ts / callMethod.ts call authenticates with THIS flow's token and
  // never the per-tab global; the login handler fills it in and logout clears
  // it. In single-session mode the key is absent, so the same call sites fall
  // back to the global exactly as before. `callOptions` is passed by reference
  // to every call site below, so mutating `.token` here is seen by later calls.
  const callOptions: {
    baseUrl?: string;
    fetch?: typeof fetch;
    eventSource?: (url: string) => api.EventSourceLike;
    token?: string | null;
    priority?: RequestPriority;
    captureNotificationSink?: api.ApiOptions["captureNotificationSink"];
    captureRequestGuard?: api.ApiOptions["captureRequestGuard"];
  } = {
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    ...(options.eventSource !== undefined ? { eventSource: options.eventSource } : {}),
    ...(options.perSessionToken ? { token: options.initialSessionToken ?? null } : {}),
    captureRequestGuard: () => {
      const generation = requestGeneration;
      const token = callOptions.token;
      return () => {
        if (generation !== requestGeneration || token !== callOptions.token)
          throw new BridgeCallError("SESSION_REQUEST_RETIRED", "This request belongs to a retired pilot session.", 0);
      };
    },
    captureNotificationSink: () => {
      const characterID = store.station.get().online?.characterID ?? null;
      const token = callOptions.token, pilotGeneration = recoveryGeneration, runnerGeneration = customBotGeneration;
      return notifications => {
        if (characterID !== null && store.station.get().online?.characterID === characterID && token === callOptions.token &&
            pilotGeneration === recoveryGeneration && runnerGeneration === customBotGeneration)
          applyDrainedNotifications(notifications);
      };
    },
  };

  // What the page asks of the server for itself, in place of a route (the plan's Phase 6b): one call at a time,
  // by the generic call, as this pilot.
  // The server's clock as the page has it: how far ahead of the browser's the last of this pilot's answers said it
  // was. A retail client's own clock is kept set by its connection; the page is told with its answers. Null until
  // one has said: then the browser's own is all there is. (It is the server's clock, whichever pilot's answer
  // said it: it is not forgotten when another pilot is chosen. Through the web gateway it is the BFF's own.)
  let serverClockAheadMs: number | null = null;
  const bridgeAsk = api.bridgeAsk(callOptions, (serverNowMs) => {
    serverClockAheadMs = serverNowMs - Date.now();
  });
  const serverNow = (): number => Date.now() + (serverClockAheadMs ?? 0);
  // A write the page makes for its pilot, the same way, with its meaning it said (api.bridgeDo).
  const bridgeDo = api.bridgeDo(callOptions, (serverNowMs) => {
    serverClockAheadMs = serverNowMs - Date.now();
  });
  // The same write under a caller's own fence. The shared lane may hold a call back: the fence is run at the
  // dispatch itself, before a hosted fetch can be taken by a newer generation of its caller.
  const fencedDo = (assertCurrent: () => void) => api.bridgeDo({ ...callOptions, fetch: (input, init) => {
    assertCurrent(); return (callOptions.fetch ?? pageFetch())(input, init);
  } }, (serverNowMs) => {
    serverClockAheadMs = serverNowMs - Date.now();
  });
  /** The pilot's own character, as the page has it. Null with none chosen. */
  const onlineCharacterID = (): number | null => store.station.get().online?.characterID ?? null;
  // The pilot's broadcasts to its fleet, with the wait the client keeps between them (bridge/fleetWrites.ts).
  const fleetBroadcasts = createFleetBroadcasts(bridgeDo);
  // What a module type's overload effect is: the client's own static data, asked of the BFF's copy once for a type.
  const overloadEffects = createOverloadEffects((typeIDs) => api.loadOverloadEffects(typeIDs, callOptions));
  const defaultEffects = createDefaultEffects((typeIDs) => api.loadDefaultEffects(typeIDs, callOptions));
  // What else the static data says of a type, asked of the BFF's copy once for a type and kept
  // (bridge/keptTypeFacts.ts): a module type's base cycle time, the combat classifier's facts of a type, and a
  // type's attributes by number. (The askers further down that keep what they are told themselves ask the reads.)
  const baseCycleTimesOfTypes = keptByType((typeIDs: readonly number[]) => api.loadBaseCycleTimes(typeIDs, callOptions).then((answered) => answered.baseCycleMs));
  // (That read leaves out a type the tables do not know: once it has answered, that is what is known of the type.)
  const combatUtilityOfTypes = keptWhereKnown((typeIDs: readonly number[]) => api.combatUtilityTypes(typeIDs, callOptions));
  const attributesOfTypes = keptTypeAttributes((typeIDs, attributeIDs) => api.fetchTypeDogma(typeIDs, attributeIDs, callOptions));
  // Whether a module type can be switched on at all, by the server's own test (nav/moduleActivation.ts): asked
  // once for a type, and copied here as it arrives so the module classifiers, which are synchronous, can read it.
  const activationOfTypes = keptByType((typeIDs: readonly number[]) => api.loadTypeActivation(typeIDs, callOptions));
  const typeActivatable = new Map<number, boolean | null>();
  async function readTypeActivation(typeIDs: readonly number[]): Promise<void> {
    try {
      for (const [typeID, answer] of Object.entries(await activationOfTypes(typeIDs))) typeActivatable.set(Number(typeID), answer);
    } catch { /* Not read is not known: `fittedModuleActivation` falls back, and never excludes on it. */ }
  }
  /** The one test every list of modules to switch on is gated by: only "passive" excludes. */
  function fittedModuleActivation(module: { readonly typeID: number; readonly itemID: number }): ModuleActivation {
    return moduleActivation({
      typeActivatable: typeActivatable.get(module.typeID),
      itemCycles: itemHasActivationCycle(store.fitting.get().dogma, module.itemID),
    });
  }
  // The repairs begun (bridge/dogmaWrites.ts): each is ended by the page when its time is up, as a client ends
  // its own, and the ship is read again then, which is when the module is mended.
  // The scanner's four orders, as the client's scan service makes them (bridge/scannerWrites.ts).
  const scannerWrites = createScannerWrites(bridgeDo);
  const moduleRepairs = createModuleRepairs(bridgeDo, { ended: () => { void loadSpaceSnapshot().catch(() => {}); } });
  // The ship's weapons linked and unlinked all at once, with the wait the client's button keeps between two of a kind.
  const weaponGrouping = createWeaponGrouping(bridgeDo);
  /**
   * What the session says of the pilot, for a call that names its ship and where it is: the ship it is flying (the
   * fitting's, or the one read in space where no fitting is), the pilot, and where it is docked
   * (session.structureid or session.stationid), which is nowhere in space.
   */
  function ammoSession(): AmmoSession {
    const shipID = store.fitting.get().activeShipID ?? store.space.get().snapshot?.shipID ?? null;
    const online = store.station.get().online;
    if (shipID === null || !online) throw new Error("Which ship this is is not known yet.");
    return { shipID, characterID: online.characterID, dockedAt: dockedNow() };
  }
  /**
   * Where the pilot is docked (session.structureid or session.stationid), and nowhere in space, as the flight
   * read has it. The online pilot's own station is where it was chosen or last docked, and is not cleared by an
   * undocking: it is gone by only where no flight has been read.
   */
  function dockedNow(): number | null {
    const flight = store.flight.get().status;
    if (flight) return flight.docked ? (flight.structureID ?? flight.stationID ?? null) : null;
    const online = store.station.get().online;
    return online ? (online.structureID ?? online.stationID ?? null) : null;
  }
  /** Where an order is placed: the station or structure the pilot is docked in, as the routes placed it. */
  function marketPlaceNow(): number {
    const dockedAt = dockedNow();
    if (dockedAt === null) throw new Error("Orders are placed at the station you are docked in.");
    return dockedAt;
  }
  /** The broker's fee rate the Market window shows for a place: the market read's, where it was read there. */
  function feeRateShownAt(placeID: number): number | null {
    const market = store.get().market;
    return (market.structureID ?? market.stationID) === placeID ? market.brokersFeeRate : null;
  }
  /** The modules fitted to the ship now, each by its own number with a name for its slot: the page's own read of the fitting. */
  async function fittedNow(): Promise<ReadonlyMap<number, string>> {
    const reads = await api.loadFitting(callOptions);
    const fitted = new Map<number, string>();
    for (const slot of buildSlots(reads.slots, reads.shipInfo, reads.online)) {
      if (slot.module) fitted.set(slot.module.itemID, `${slot.family}:${slot.index}`);
    }
    return fitted;
  }
  /** Charges put into modules from the ship's own hold or the hangar, by the client's own call (bridge/dogmaWrites.ts). */
  const loadAmmoFrom = async (moduleIDs: readonly number[], chargeItemIDs: readonly number[], source: AmmoPlace): Promise<void> =>
    loadAmmoCall(bridgeDo, ammoSession(), moduleIDs, chargeItemIDs, source);
  // What a client knows of a skill's type without asking the server, asked of the static data once and kept.
  const skillTypeFacts = createSkillTypeFacts({
    // (A type's name is the static data's, and is answered or is none: only a structure's can be left unanswered.)
    names: async (items) => (await api.resolveNames(items, callOptions)).names,
    typeAttributes: (typeIDs, attributeIDs) => api.fetchTypeDogma(typeIDs, attributeIDs, callOptions),
  });
  // The page's own reckoner of industry jobs (bridge/industryJobReckoning.ts), one for each pilot: what the client's
  // services keep for a session (the region's facilities, the price table, the clone grade) is that pilot's.
  let jobReckoning: { readonly characterID: number; readonly reckoner: JobReckoner } | null = null;
  // A type's group and category are the game's data, the same for every pilot: kept once read.
  const industryTypeFactsKept = new Map<number, { typeID: number; groupID: JsonValue | undefined; categoryID: JsonValue | undefined } | null>();
  function jobReckonerFor(characterID: number): JobReckoner {
    if (jobReckoning?.characterID !== characterID) {
      jobReckoning = {
        characterID,
        reckoner: createJobReckoner({
          ask: bridgeAsk,
          characterID,
          definitions: (typeIDs) => api.loadIndustryDefinitions(typeIDs, callOptions),
          typeFacts: async (typeID) => {
            if (industryTypeFactsKept.has(typeID)) return industryTypeFactsKept.get(typeID) ?? null;
            const closure = await api.getIndustryRecipeClosure([typeID], callOptions);
            const types = closure !== null && typeof closure === "object" && !Array.isArray(closure) ? (closure as Record<string, JsonValue>).types : null;
            const type = types !== null && typeof types === "object" && !Array.isArray(types) ? (types as Record<string, JsonValue>)[String(typeID)] : null;
            const facts = type === null || type === undefined || typeof type !== "object" || Array.isArray(type)
              ? null
              : { typeID, groupID: (type as Record<string, JsonValue>).groupID, categoryID: (type as Record<string, JsonValue>).categoryID };
            industryTypeFactsKept.set(typeID, facts);
            return facts;
          },
          typeAttributes: (typeIDs, attributeIDs) => api.fetchTypeDogma(typeIDs, attributeIDs, callOptions),
          security: (ids) => api.loadSystemSecurity(ids, callOptions),
        }),
      };
    }
    return jobReckoning.reckoner;
  }
  /**
   * A job as the page reckons it itself, for the pilot online; null where there is no pilot, or the reckoning failed
   * (a lost session is no reckoning, and is passed on). Its materials whole, as the job's dump has them: an
   * invention's empty optional place among them.
   */
  async function reckonedHere(request: api.IndustryJobRequest): Promise<JobReckoning | null> {
    const characterID = store.station.get().online?.characterID ?? null;
    if (characterID === null) return null;
    try {
      const reckoned = await jobReckonerFor(characterID).reckon({
        activity: request.activity,
        blueprintTypeID: request.blueprintTypeID,
        facilityID: request.facilityID,
        runs: request.runs,
        ...(request.licensedRuns === undefined ? {} : { licensedRuns: request.licensedRuns }),
        ...(request.productTypeID === undefined ? {} : { productTypeID: request.productTypeID }),
        ...(request.decryptorTypeID === undefined ? {} : { decryptorTypeID: request.decryptorTypeID }),
        timeEfficiency: request.timeEfficiency ?? null,
        materialEfficiency: request.materialEfficiency ?? null,
      });
      return reckoned;
    } catch (error) {
      if (isSessionLost(error)) throw error;
      return null;
    }
  }
  // The Industry window's job as the client's industry service keeps it (bridge/industryMonitor.ts): the job
  // monitored, by what it was made as and the place it takes from, its pilot, and what its monitor answered; or that
  // the window's job was installed, the window then having the server's job, which is not the one monitored.
  let industryWindowJob: {
    readonly characterID: number;
    readonly monitoredAs: string;
    readonly blueprintItemID: number;
    readonly monitored: Monitored;
  } | "installed" | null = null;
  /**
   * The window's job as the client makes it before it sends it, for the pilot online: reckoned by the page, its runs
   * held to the most it can have so that no job of more is sent (job.py 395), its places the facility's for the
   * pilot (GetFacilityLocations, kept a minute by the client), and its dump (industry.Job.dump(), job.py 624 to 640).
   */
  async function windowsJob(request: api.IndustryJobRequest): Promise<{
    readonly characterID: number;
    readonly own: JobReckoning | null;
    readonly dump: Record<string, JsonValue>;
  }> {
    const online = store.station.get().online;
    if (!online) throw new Error("No pilot is online.");
    const own = await reckonedHere(request);
    if (own !== null && own.mostRuns !== null && request.runs > Math.max(own.mostRuns, 1)) {
      const most = Math.max(own.mostRuns, 1);
      throw Object.assign(new Error(request.activity === "copying"
        ? `One job copying this blueprint here makes at most ${most} ${most === 1 ? "copy" : "copies"}.`
        : `One job ${request.activity === "invention" ? "inventing from" : "researching"} this blueprint here has at most ${most} ${most === 1 ? "run" : "runs"}.`), { code: "INVALID_RUNS" });
    }
    const places = jobPlaces(decodeFacilityPlaces(await bridgeAsk("facilityManager", "GetFacilityLocations", [request.facilityID, online.characterID])));
    const dump = jobDump({
      blueprintItemID: request.blueprintItemID,
      blueprintTypeID: request.blueprintTypeID,
      activityID: activityIDOf(request.activity),
      facilityID: request.facilityID,
      characterID: online.characterID,
      corporationID: online.corporationID ?? 0,
      solarSystemID: online.solarSystemID ?? 0,
      runs: request.runs,
      licensedRuns: own?.licensedRuns ?? request.licensedRuns ?? 1,
      cost: own?.cost ?? null,
      tax: own?.tax ?? null,
      time: own?.timeSeconds ?? null,
      materials: own?.materials ?? null,
      input: places.input,
      output: places.output,
      productTypeID: request.productTypeID ?? null,
    });
    return { characterID: online.characterID, own, dump };
  }
  /**
   * The ship boarded by the page's own call (bridge/shipWrites.ts: menuFunctions.Board), naming what the client names
   * beside it, the ship the pilot is in or the station where it is in none, as the pilot's flight says now.
   */
  async function boardShipNow(shipID: number): Promise<void> {
    const now = decodeFlightStatus((await api.getFlightStatus(callOptions)).flight);
    await boardShipCall(bridgeDo, shipID, now.shipID ?? now.stationID ?? null);
  }
  // The Character Sheet's reads, asked call by call as the client's windows ask them (bridge/characterSheetReads.ts).
  const characterSheetReads = createCharacterSheetReads(bridgeAsk, (typeIDs, attributeIDs) => api.fetchTypeDogma(typeIDs, attributeIDs, callOptions));
  // The wallet's reads, asked call by call as the client's wallet and account services ask them
  // (bridge/walletReads.ts), with what those services keep kept for this pilot.
  const walletReads = createWalletReads(bridgeAsk);
  // Whether every training slot of the account is used, as the client's queue service reckons and keeps it
  // (bridge/trainingSlots.ts): what says whether a change of the queue may start it.
  const trainingSlots = createTrainingSlots(bridgeAsk);

  let pilotRecoveryEnabled = options.browserPilotRecovery === true;
  const recoverySignal = createSignal<DroneRecoveryState>({ phase: pilotRecoveryEnabled ? "checking" : "ready", reason: null });
  let recoveryGeneration = 0;
  let recoveryTask: Promise<void> | null = null;
  const recoveryIDs = new Set<number>();
  const confirmedRecoveryIDs = new Set<number>();
  let recoveryCheckID: string | null = null;

  function requireAutomationReady(): void {
    if (sessionClosing) throw new Error("This pilot session is being released.");
    if (pilotRecoveryEnabled && recoverySignal.get().phase !== "ready") {
      throw new Error(recoverySignal.get().reason ?? "Drone recovery is still checking this pilot. Wait or retry recovery.");
    }
  }

  function retryDroneRecovery(): Promise<void> {
    if (!pilotRecoveryEnabled || recoverySignal.get().phase === "ready") return Promise.resolve();
    if (recoveryTask !== null) return recoveryTask;
    const generation = recoveryGeneration;
    const current = () => {
      if (generation !== recoveryGeneration) throw new Error("This pilot session changed during drone recovery.");
    };
    const task = (async () => {
      try {
        await recoverLostDroneFlight({
          inSpace: async () => {
            current();
            const raw = (await api.getFlightStatus(callOptions)).flight;
            current();
            if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
            const row = raw as Record<string, JsonValue>;
            return row.inSpace === true ? true : row.docked === true ? false : null;
          },
          read: async () => { current(); const raw = await api.getDrones(callOptions); current(); return readRecoveryDrones(raw.inSpace); },
          reconnect: async ids => { current(); await reconnectToDronesCall(bridgeDo, ids); current(); },
          recall: async ids => { current(); await returnDronesToBay(bridgeDo, ids); current(); },
          sleep: async ms => { await new Promise(resolve => setTimeout(resolve, ms)); current(); },
          pendingIDs: recoveryIDs,
          confirmedIDs: confirmedRecoveryIDs,
          report: state => { if (generation === recoveryGeneration && state.phase !== "ready") recoverySignal.set(state); },
        });
        current();
        if (recoveryCheckID === null) throw new Error("The selected pilot's recovery check could not be identified.");
        await api.markDroneRecoveryReady(recoveryCheckID, callOptions);
        current();
        recoverySignal.set({ phase: "ready", reason: null });
      } catch (error) {
        if (generation === recoveryGeneration) recoverySignal.set({ phase: "blocked",
          reason: error instanceof Error ? error.message : "Lost-drone recovery could not be confirmed." });
      }
    })();
    recoveryTask = task.finally(() => { if (generation === recoveryGeneration) recoveryTask = null; });
    return recoveryTask;
  }

  // R6b — the docked station the station-scoped panels are currently synced to,
  // and a guard so an in-flight relocate is not re-entered. Set on select and
  // updated whenever a flight-status snapshot reveals the character docked at a
  // different station (autopilot arrival / manual dock); see observeFlightStatus.
  let syncedStationID: number | null = null;
  let relocating = false;

  // --- R10 live event channel ---------------------------------------------
  // One SSE subscription per online character, opened when select succeeds and
  // closed when the character goes offline. It feeds the store the session
  // notifications the page used to discard and the chat messages the Chat panel
  // used to poll for. Liveness only: every bridge response still carries its
  // notification drain, so a channel that never opens costs latency, not data.
  let liveStream: api.BridgeEventSubscription | null = null;

  // Agents whose buttons one of this page's own bots is pressing right now.
  // The server's "are you sure" about such a press is answered Yes without
  // being shown (applyLiveFrame).
  const botPresses = createBotPresses();

  function applyLiveFrame(frame: unknown): void {
    if (typeof frame !== "object" || frame === null) {
      return;
    }
    const record = frame as Record<string, JsonValue>;

    // BFF-originated status frame (the gateway socket connected / dropped).
    if (record.source === "evejs-web-bff" && record.type === "stream-status") {
      const state = record.state;
      store.apply({
        type: "live/status",
        status:
          state === "live" || state === "connecting" || state === "degraded" || state === "ended"
            ? state
            : "idle",
      });
      return;
    }
    if (record.source !== "evejs-web-gateway") {
      return;
    }

    const cursor = (record.cursor ?? {}) as Record<string, JsonValue>;
    const epoch = typeof cursor.epoch === "string" ? cursor.epoch : null;
    const sequence = typeof cursor.sequence === "number" ? cursor.sequence : 0;

    // The gateway could not replay from our cursor: what we hold may have gaps,
    // so re-read the active chat channel rather than pretend the backlog is
    // continuous.
    if (record.type === "snapshot") {
      store.apply({ type: "live/resynchronize", epoch, sequence });
      if (record.reason === "cursor_not_replayable") {
        void loadChat(store.chat.get().activeChannel);
      }
      return;
    }
    if (record.type !== "event") {
      return;
    }

    const event = (record.event ?? {}) as Record<string, JsonValue>;
    if (event.kind === "chat") {
      const channel = event.channel === "corp" ? "corp" : "local";
      const message = decodeMessageEntry(event.entry);
      if (message) {
        store.apply({ type: "chat/message", channel, message });
      }
      return;
    }
    // The server has asked the player something and is waiting (game-port
    // pilots; web/src/bridge/questions.ts).
    if (event.kind === "question") {
      const question = decodeQuestion(event.question);
      if (!question) {
        return;
      }
      // A button one of this page's own bots pressed is not put to the user:
      // the bot pressed it, and meant it.
      if (botPresses.answers(question)) {
        void api.answerClientQuestion(question.id, true, callOptions).catch(() => {});
        return;
      }
      store.apply({ type: "live/question", question, epoch, sequence });
      return;
    }
    if (event.kind === "question-closed") {
      if (typeof event.id === "string") {
        store.apply({ type: "live/question-closed", id: event.id, epoch, sequence });
      }
      return;
    }
    if (event.kind === "notification") {
      const notification = (event.notification ?? {}) as Record<string, JsonValue>;
      const method = typeof notification.method === "string" ? notification.method : null;
      const args = Array.isArray(notification.args) ? (notification.args as unknown[]) : [];
      const receivedAtMs = Date.now();
      // The stream's own record of what came on it, and where it has read to, whether or not the push is news.
      store.apply({
        type: "live/notification",
        epoch,
        sequence,
        notification: {
          kind: typeof notification.kind === "string" ? notification.kind : "unknown",
          service: typeof notification.service === "string" ? notification.service : null,
          method,
          receivedAtMs,
          args,
        },
      });
      // An answer may have brought this push already (bridge/pushOnce.ts).
      if (pushesTaken.take(record.cursor)) {
        applyPushedNotification(method, args, receivedAtMs);
      }
    }
  }

  // Which of the server's pushes have been acted on. The client hears each once; this page can hear one on
  // the stream and again with an answer.
  const pushesTaken = createPushLedger();

  // --- R24 slices C + D: acting on what the push channel carries -------------
  //
  // R10 built this channel and the page only ever used it for LIVENESS. Two of
  // the notifications on it turn out to carry things the browser cannot get any
  // other way, and both were VERIFIED end to end against the gateway (see
  // `server/tests/webGatewaySessionEvents.test.js`, "R24:" — both arrive, with
  // their payloads intact, on the same `sendNotification` capture stub R10
  // proved):
  //
  //   OnGodmaShipEffect  a module cycle started or stopped, carrying the
  //                      EFFECTIVE cycle duration (runtime.js:13012). No
  //                      allowlisted call returns effective per-module
  //                      attributes, so this event is the only source there is.
  //   OnItemsChanged     something in the player's items changed. Mining emits
  //                      it per stack granted (`syncMinedOreChangesToSession`,
  //                      miningRuntime.js:994-999).
  //
  // The two are handled DIFFERENTLY on purpose. The cycle event is used for its
  // payload, because the payload is the whole point. The items event is used as
  // a TRIGGER only: it says something moved, and the ore hold is then RE-READ
  // from the ship. Deriving the hold from a stream of deltas would mean the
  // page's arithmetic and the ship's contents drifting apart the first time a
  // frame is missed — and this channel is explicitly allowed to drop and
  // resynchronise. The authority on what is in the hold is the hold.
  const fleetSnapshotNotifications = new Set([
    "OnFleetJoin",
    "OnFleetLeave",
    "OnFleetDisbanded",
    "OnFleetMemberChanged",
    "OnFleetMove",
    "OnFleetWingAdded",
    "OnFleetWingDeleted",
    "OnFleetWingNameChanged",
    "OnFleetSquadAdded",
    "OnFleetSquadDeleted",
    "OnFleetSquadNameChanged",
    "OnFleetMotdChanged",
    "OnFleetOptionsChanged",
    "OnFleetJoinRequest",
    "OnFleetJoinRejected",
  ]);
  const scannerSnapshotNotifications = new Set([
    "OnNewProbe",
    "OnRemoveProbe",
    "OnProbesIdle",
    "OnProbeStateChanged",
    "OnProbeStateUpdated",
    "OnProbeRangeUpdated",
    "OnProbePositionsUpdated",
    "OnReconnectToProbesAvailable",
    "OnScannerDisconnected",
    "OnSystemScanStarted",
    "OnSystemScanStopped",
    "OnSystemScanDone",
  ]);

  /** Trusted response drains and the live stream share one dispatcher.
   * api.ts captures pilot/session ownership before the request; its sink
   * discards late drains from a retired generation. The gateway drain is
   * destructive, so HTTP fallback cannot rely on a later stream replay. */
  function applyDrainedNotifications(notifications: readonly JsonValue[]): void {
    if (notifications.length === 0) {
      return;
    }
    const receivedAtMs = Date.now();
    for (const entry of notifications) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const row = entry as Record<string, JsonValue>;
      const method = typeof row.method === "string" ? row.method : null;
      if (method === null) {
        continue;
      }
      // The stream may have brought this push already (bridge/pushOnce.ts).
      if (!pushesTaken.take(row.cursor)) {
        continue;
      }
      applyPushedNotification(method, Array.isArray(row.args) ? row.args : [], receivedAtMs);
    }
  }

  function applyPushedNotification(
    method: string | null,
    args: readonly unknown[],
    receivedAtMs: number,
    insideMultiEvent = false,
  ): void {
    // ⚠ `"__MultiEvent"` UNWRAP — THIS IS A REAL FIX, NOT DEFENSIVE CODE. The
    // server has exactly one call site for it (`notifyFleetMultiEvent`,
    // fleetRuntime.js:786), and it fires ONLY when more than one
    // `OnFleetMemberChanged` lands in the same tick, wrapping them as
    // `method: "__MultiEvent"`. Before this branch existed,
    // `fleetSnapshotNotifications.has("__MultiEvent")` always missed, so the
    // WHOLE BATCH was silently dropped — no `scheduleFleetRefresh`, and the
    // roster went stale with nobody the wiser. The payload is a bare array of
    // `[name, args]` pairs (mirrors how `OnFleetBroadcast`'s payload array
    // becomes `args` verbatim — see fleetBroadcasts.ts's wire-contract
    // comment), so each pair is re-dispatched through this same function.
    //
    // ⚠ ONE LEVEL ONLY, REFUSED RATHER THAN BOUNDED. The server's only call
    // site never wraps its own wrapper — nesting cannot happen legitimately —
    // so a nested `__MultiEvent` is corrupt or hostile data, not a deeper
    // batch to drain. Refusing it outright is simpler than a recursion counter
    // and loses nothing a real payload would ever need.
    if (method === "__MultiEvent") {
      if (insideMultiEvent) {
        return;
      }
      for (const pair of args) {
        if (!Array.isArray(pair)) {
          continue;
        }
        const [innerMethod, innerArgs] = pair as [unknown, unknown];
        applyPushedNotification(
          typeof innerMethod === "string" ? innerMethod : null,
          Array.isArray(innerArgs) ? innerArgs : [],
          receivedAtMs,
          true,
        );
      }
      return;
    }
    const fleetInvite = decodeFleetInviteNotification(method, args, receivedAtMs);
    if (fleetInvite !== null) {
      // fleetSvc.OnFleetInvite (1179): from a session in a fleet the client turns the invitation down at once,
      // and asks its pilot nothing. The page goes by what it has read of its pilot's fleet.
      if (store.fleet.get().availability === "ready") {
        turnDownUnasked(fleetInvite.fleetID);
        return;
      }
      store.apply({ type: "fleet/pending-invite", invite: fleetInvite });
      if (fleetInvite.inviterID !== null) {
        requestNames([{ kind: "character", id: fleetInvite.inviterID }]);
      }
      void autoAcceptCorpFleetInvite(fleetInvite);
      return;
    }
    // fleetSvc.OnFleetJoinReject (1217): the inviter is told that its invitation was turned down, and why where
    // the server says. The client says so to its pilot and asks nothing; so does the page, in its own words.
    const fleetInviteAnswer = decodeFleetInviteAnswerNotification(method, args);
    if (fleetInviteAnswer !== null) {
      void tellOfInviteAnswer(fleetInviteAnswer);
      return;
    }
    // The two fleet pushes that carry their own payload rather than merely
    // invalidating a read. ⚠ NEITHER NAME GOES IN `fleetSnapshotNotifications`
    // below: that set is invalidation-only — its members carry nothing usable
    // and exist only to trigger a re-read — while these two ARE the payload,
    // so a re-read would neither produce nor invalidate them.
    const fleetBroadcast = decodeFleetBroadcastNotification(method, args, receivedAtMs);
    if (fleetBroadcast !== null) {
      store.apply({ type: "fleet/broadcast", broadcast: fleetBroadcast });
      wakeFleetCompanion();
      return;
    }
    const fleetTargetTags = decodeFleetStateChangeNotification(method, args);
    if (fleetTargetTags !== null) {
      store.apply({ type: "fleet/target-tags", tags: fleetTargetTags });
      wakeFleetCompanion();
      return;
    }
    // `OnTarget` — this ship's own lock landing, dropping, or being wiped.
    //
    // ⚠ NOT AN INVALIDATION, AND SO NOT IN THE SETS BELOW. It carries the id
    // whose lock changed, and the fold is what makes a completed lock usable in
    // the same instant instead of on the next tick's `GetTargets`. The poll is
    // untouched and still overwrites this; see `targetNotifications.ts`.
    const targetEvent = decodeTargetNotification(method, args);
    if (targetEvent !== null) {
      store.apply({ type: "targeting/lock-event", event: targetEvent });
      // ⚠ ONLY A LANDED LOCK WAKES THE COMPANION. A `lost` or a `clear` gives
      // its ladder nothing new to issue -- the rung that would re-lock is going
      // to re-read the grid on its own beat anyway -- whereas an `add` is the
      // exact fact rung 6 and rung 7 are both blocked on. Waking on all three
      // would spend the burst floor on events that cannot produce an action.
      if (targetEvent.kind === "locked") {
        wakeFleetCompanion();
      }
      return;
    }
    // Fleet-companion phase 7 — `OnJamStart` / `OnJamEnd`, the ONLY read
    // anywhere that says who is holding this ship down. Like the two fleet
    // pushes above and unlike the invalidation sets below, these ARE the
    // payload: there is no route to re-read them from, and a dropped one is a
    // tackler the tag rung never learns about.
    const jam = decodeJamNotification(method, args, receivedAtMs);
    if (jam !== null) {
      store.apply({ type: "space/jam", event: jam });
      // A jam STARTING is rung 4's whole trigger: something has this pilot held
      // down and the fleet has not been told. An END has nothing to issue.
      if (jam.active) {
        wakeFleetCompanion();
      }
      return;
    }
    const missionChange = decodeMissionChange(method, args);
    if (missionChange !== null) {
      onMissionChange(missionChange);
      return;
    }
    // The mailing lists service's notices (mailingListsSvc.py 144 to 180): the lists kept changed as it changes them.
    const listsNow = store.mail.get().lists;
    if (method !== null && listsNow !== null) {
      const listsAfter = mailingListsAfterNotice(listsNow, method, args as readonly JsonValue[], store.station.get().online?.characterID ?? 0);
      if (listsAfter !== null) {
        store.apply({ type: "mail/lists", lists: listsAfter });
        return;
      }
    }
    // mailSvc.OnLabelsCreatedByExternal (1208 to 1211): a label made elsewhere is added to those kept.
    if (method === "OnLabelsCreatedByExternal") {
      const kept = store.mail.get().labels;
      const label = mailLabelOf((args as readonly JsonValue[])[0]);
      if (kept !== null && label !== null && !kept.some((each) => each.labelID === label.labelID)) {
        store.apply({ type: "mail/labels", labels: [...kept, label] });
      }
      return;
    }
    // mailSvc's notices (1119 to 1195): what the mailbox holds is kept right from them, asking nothing; after a mail
    // brought back from deletion it is synced again. A mailbox not yet synced takes them in at its sync.
    const mailNow = store.mail.get();
    if (method !== null && mailNow.loaded) {
      const after = mailboxAfterNotice(mailNow, method, args as readonly JsonValue[], store.station.get().online?.characterID ?? 0);
      if (after === "sync") {
        void refreshMail().catch(() => {});
        return;
      }
      if (after !== null) {
        mailboxLoaded(after);
        if (method === "OnMailSent") {
          void nameListSenders().catch(() => {});
        }
        return;
      }
    }
    // walletSvc.OnAccountChange and accountsvc.OnAccountChange (accountKey, ownerID, balance): the server's word
    // that an account changed, and what is in it now. The pilot's ISK is that from then on with nothing asked,
    // the transactions kept are out of date, and a wallet that has been read is drawn again: from what is
    // kept, asking only for what is not.
    if (method === "OnAccountChange") {
      const online = store.station.get().online;
      walletReads.accountChanged(args[0], args[1], (args[2] ?? null) as JsonValue, {
        characterID: online?.characterID ?? null,
        corporationID: online?.corporationID ?? null,
      });
      if (store.wallet.get().loaded) {
        void loadWallet().catch(() => {});
      }
      return;
    }
    // skillQueueSvc.OnMultipleCharactersTrainingUpdated (841): what was reckoned of the account's training
    // slots is let go, and reckoned again when a change of the queue next wants it.
    if (method === "OnMultipleCharactersTrainingUpdated") {
      trainingSlots.forget();
    }
    // bco_corporations.OnCorporationChanged: the corporation's own row is not what was kept.
    if (method === "OnCorporationChanged") {
      walletReads.corporationChanged();
    }
    // standingsvc keeps the pilot's standings as the server changes them (OnStandingSet, OnStandingsModified),
    // from what the notification itself says and without reading again. So does this, once they have been
    // read at all: before that there is nothing to change, and the read will bring what the server has.
    if (method === "OnStandingSet" || method === "OnStandingsModified") {
      const held = store.standings.get().char;
      if (held !== null) {
        const after = standingsAfter(held, method, args, store.station.get().online?.characterID ?? null);
        if (after !== held) {
          store.apply({ type: "standings/char", char: after });
        }
      }
      return;
    }
    // redeem.OnRedeemingQueueUpdated (redeemsvc.py 162 to 169): what the account may redeem has changed, and is read
    // again.
    if (method === REDEEM_NOTICE) {
      void loadRedeemTokens().catch(() => {});
      return;
    }
    // loginCampaignService.OnCampaignEnrollmentChanged (84 to 88): the account's campaign is another, and is read again.
    if (method === LOGIN_CAMPAIGN_NOTICE) {
      void loadLoginRewards().catch(() => {});
      return;
    }
    // gameui.OnRemoteMessage (347 to 356): the server tells the player something, as a dialog of the client's, and the
    // page says it on the notice board, in the client's words where it has them.
    if (method === REMOTE_MESSAGE) {
      const message = decodeRemoteMessage(args);
      if (message !== null) void sayServerMessage(message).catch(() => {});
      return;
    }
    // clone_grade_svc.OnSubscriptionChangedServer(new_state): what the notice says is the grade from then on,
    // with nothing asked. A notice that says neither grade leaves what was had.
    if (method === CLONE_GRADE_NOTICE) {
      const cloneGrade = cloneGradeOf(args[0]);
      if (cloneGrade !== null) {
        store.apply({ type: "character/clone-grade", cloneGrade });
      }
      return;
    }
    const sessionNames = sessionChangeNames(method, args);
    contactLoggedOnOrOff(method, args);
    // The client's session takes the new corporation, alliance and roles as the change says them; so does the
    // page's pilot, for what goes by them (the compose window's ValidateCorpOrAlliance and its offers).
    if (sessionNames?.some((name) => name === "corpid" || name === "allianceid" || name === "corprole")) {
      const ownerOf = (value: unknown): number | null => {
        const id = Number(wholeDigits(value) ?? Number.NaN);
        return Number.isSafeInteger(id) && id > 0 ? id : null;
      };
      store.apply({
        type: "character/session-changed",
        ...(sessionNames.includes("corpid") ? { corporationID: ownerOf(sessionChangeValue(method, args, "corpid")) } : {}),
        ...(sessionNames.includes("allianceid") ? { allianceID: ownerOf(sessionChangeValue(method, args, "allianceid")) } : {}),
        ...(sessionNames.includes("corprole") ? { corpRole: wholeDigits(sessionChangeValue(method, args, "corprole")) } : {}),
      });
    }
    // godma.ProcessSessionChange (1156, 1199): another station, system, ship, character or structure, and godma
    // ends every repair it began. So does the page.
    if (sessionNames?.some((name) => GODMA_SESSION_NAMES.has(name))) {
      void moduleRepairs.endAll();
    }
    // crimewatchSvc.ProcessSessionChange and OnSessionChanged: another place, or another system or ship, and
    // the client asks crimewatch its states again. So does the page, of the BFF.
    if (sessionNames?.some((name) => CRIMEWATCH_SESSION_NAMES.has(name)) || (method !== null && CRIMEWATCH_NOTICES.has(method))) {
      void loadCrimewatch().catch(() => {});
    }
    // The job board marks every mission out of date when the pilot's ship or station changes
    // (AgentMissionsJobProvider.OnSessionChanged), and a page on show reads its mission again.
    if (sessionNames?.includes("shipid") || sessionNames?.includes("stationid")) {
      readOpenMissionPageAgain();
    }
    // agentDialogueWindow.OnSessionChanged: another station, or none, and the window talks to its agent
    // again, since what an agent will do depends on where the pilot is.
    if (sessionNames?.includes("stationid")) {
      talkToOpenAgentAgain();
      return;
    }
    if (method === "OnCharNowInStation" || method === "OnCharNoLongerInStation") {
      // station/base.py: the client's own list of guests changes at each. The
      // page takes it as word that the list changed, and reads the list again.
      void getStationGuests(callOptions)
        .then((guests) => store.apply({ type: "station/guests", guests }))
        .catch(() => {});
      return;
    }
    if (method === "OnCharacterEnteredStructure" || method === "OnCharacterLeftStructure") {
      // structureGuests.py 36 and 40: the client's own guests change at each. The page takes it as word that
      // they changed and reads them again, once they have been read at all: the pilot's transport answers
      // from what it keeps, changed as the notice said.
      const structureID = store.station.get().online?.structureID;
      if (structureID && store.station.get().guests.length > 0) {
        void getStructureGuests(structureID, callOptions)
          .then((guests) => {
            if (guests !== null && store.station.get().online?.structureID === structureID) {
              store.apply({ type: "station/guests", guests });
            }
          })
          .catch(() => {});
      }
      return;
    }
    if (method === "OnOfficeRentalChange") {
      // officeManager.py and invWindow.py: the client's inventory window draws
      // its tree again where the corporation is the session's. The page reads
      // the corporation's hangar again where it has it open.
      if (args[0] === store.station.get().online?.corporationID && store.get().inventory.corp.loaded) {
        void loadCorpHangar().catch(() => {});
      }
      // dockedUI/offices.py: the lobby's offices are listed again, whoever's
      // the office is, once they have been listed at all.
      if (store.station.get().offices !== null && !listingStationOffices) {
        void loadStationOffices().catch(() => {});
      }
      return;
    }
    if (method !== null && fleetSnapshotNotifications.has(method)) {
      // The notification is an invalidation, never the roster authority. A
      // coalesced, single-flight bound read below replaces the full snapshot.
      scheduleFleetRefresh();
      return;
    }
    if (method !== null && scannerSnapshotNotifications.has(method)) {
      scheduleScannerRefresh();
      return;
    }
    if (method === "OnGodmaShipEffect") {
      applyCycleNotification(args);
      // ⚠ THE SAFETY NET UNDER THE ROUND COUNTS. A repeating weapon sends one
      // start and one stop, not a frame per shot, so the counts ride on the
      // quantity pushes below. When a gun that holds charges STOPS — it ran
      // dry, or the pilot switched it off — one re-read squares the rack with
      // the server, in case a push was dropped. Once per firing stint, not
      // per shot.
      const moduleID = Number(args[0]) || 0;
      if (
        Number(args[3]) !== 1 &&
        store.fitting.get().slots.some((slot) => slot.module?.itemID === moduleID && slot.module.charge !== null)
      ) {
        scheduleReloadRefresh(0);
      }
      return;
    }
    if (method === "OnModuleAttributeChanges") {
      const changes = decodeChargeQuantityChanges(method, args);
      if (changes.length > 0) {
        store.apply({ type: "fitting/charge-quantity", changes });
      }
      return;
    }
    const chargeLoad = decodeChargeLoadNotification(method, args);
    if (chargeLoad !== null) {
      store.apply({ type: "fitting/reload-started", ...chargeLoad, atMs: receivedAtMs });
      scheduleReloadRefresh(chargeLoad.durationMs);
      return;
    }
    if (method === "OnIndustryMaterials") {
      // industrySvc.OnIndustryMaterials (324 to 327): what a monitored job's place has. It is kept for the window
      // whose job's monitor it names (bridge/industryMaterials.ts); what is no such notice is let go.
      const said = decodeIndustryMaterials(args);
      if (said !== null) {
        store.apply({ type: "industry/materials-said", ...said });
      }
      return;
    }
    if (method === "OnItemsChanged") {
      // Coalesced: mining grants ore stack by stack, so a busy cycle can push
      // several of these at once and one re-read answers all of them.
      scheduleHoldRefresh();
      // The drone bay is an inventory like any other, and this frame is the
      // only word we get when something OUTSIDE this client changes it — a
      // drone destroyed in space, a bot loading the bay, the game's own client
      // on the same character. Without it the Drones window's one read per
      // session was the whole of its knowledge.
      scheduleDroneRefresh();
      return;
    }
    if (method === "OnItemChange") {
      // ONE item's move comes by this name, and several by the one above: the
      // server sends this one unless a batch is asked for. A drone landing in
      // its bay is one item, and with only the name above heard the window went
      // on reading "Coming home" for a drone the server had in the bay.
      //
      // Which moves, the client's drones window says (dronesWindow.OnItemChange,
      // 254 to 260; bridge/droneBayNotices.ts): the ones into or out of this
      // ship's drone bay. A charge loaded or ore come aboard is not one.
      //
      // ⚠ THE DRONES ONLY. Their re-read is gated on the window having been
      // read; the holds' is not, and what one item's move does to a hold has
      // not been measured.
      if (itemChangeTouchesDroneBay(args, droneBayShipID)) {
        scheduleDroneRefresh();
      }
      return;
    }
    if (method === "OnDamageMessage") {
      applyDamageNotification(args);
    }
  }

  // `OnDamageMessage` (R29). One shot. The payload is a BARE marshaled dict —
  // not a util.KeyVal — and the fields used here were read off the live wire:
  //
  //   attackType  "me" for a shot WE fired; "otherPlayerWeapons" for one fired
  //               at us. This is the ONLY honest direction signal, and it is
  //               read rather than inferred from the ids.
  //   source      the shooter's itemID; `target` the thing hit.
  //   weapon      the weapon's typeID, for naming.
  //   damage      what this shot did. ZERO IS REAL — it is a clean miss, and it
  //               is kept rather than dropped, because "it shot and missed" is
  //               information the player wants.
  //   hitQuality  the server's own band. Passed through unnamed; this server
  //               does not publish the wording, so none is invented.
  //
  // Both directions were measured: a rat shooting an idle ship produced 16 of
  // these with our ship as target, and our two turrets produced their own with
  // attackType "me". The payload is used for its CONTENT, like the cycle event
  // above and unlike the items event — but a health re-read is still scheduled,
  // because the log is a lossy tail and the bars must come from the snapshot.
  function applyDamageNotification(args: readonly unknown[]): void {
    const payload = args[0];
    const attackType = readDictEntry(payload, "attackType");
    const rawAmount = readDictEntry(payload, "damage");
    const amountValue =
      rawAmount && typeof rawAmount === "object" && "value" in (rawAmount as Record<string, unknown>)
        ? Number((rawAmount as Record<string, unknown>).value)
        : Number(rawAmount);
    if (!Number.isFinite(amountValue)) {
      return;
    }
    const dealt = attackType === "me";
    const other = dealt ? readDictEntry(payload, "target") : readDictEntry(payload, "source");
    const otherPartyID = Number(other) > 0 ? Number(other) : null;
    const weapon = Number(readDictEntry(payload, "weapon"));
    const quality = Number(readDictEntry(payload, "hitQuality"));
    store.apply({
      type: "targeting/damage",
      direction: dealt ? "dealt" : "taken",
      otherPartyID,
      weaponTypeID: weapon > 0 ? weapon : null,
      amount: amountValue,
      quality: Number.isFinite(quality) ? quality : null,
      atMs: Date.now(),
    });
    // The bars are read, never derived from these frames.
    scheduleSpaceRefresh();
  }

  // `OnGodmaShipEffect` args, positionally (godmaMultiEvent.js:44-78, and
  // runtime.js:13012 which sends the same ten):
  //   [0] moduleID  [1] effectID  [2] when      [3] isStart  [4] shouldStart
  //   [5] environment [6] startedAt [7] duration [8] repeat  [9] error
  //
  // `duration` is -1 when the effect has none (an instant or passive effect),
  // and the wire form can be a marshalled real (`{type:"real", value}`) rather
  // than a bare number. Anything we cannot read as a positive number of
  // milliseconds is reported as "no duration", never as zero.
  function applyCycleNotification(args: readonly unknown[]): void {
    const moduleID = Number(args[0]) || 0;
    if (!(moduleID > 0)) {
      return;
    }
    const raw = args[7];
    const numeric =
      raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>)
        ? Number((raw as Record<string, unknown>).value)
        : Number(raw);
    const durationMs = Number.isFinite(numeric) && numeric > 0 ? numeric : null;
    const running = Number(args[3]) === 1;
    const repeat = args[8];
    store.apply({
      type: "targeting/cycle",
      moduleID,
      durationMs,
      running,
      repeating: repeat === true || Number(repeat) > 0,
      observedAtMs: Date.now(),
    });
  }

  // Mining grants ore stack by stack, so one cycle can push several
  // OnItemsChanged frames back to back. Coalesce them into one re-read.
  const HOLD_REFRESH_COALESCE_MS = 150;
  let holdRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Re-read the fit once a queued reload has landed, so the rack's counts show
   * what is in the guns rather than what was there before (and, with 0, once a
   * gun stops firing). One timer: a later request only ever pushes it later,
   * and one read answers them all.
   */
  let reloadRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let reloadRefreshAtMs = 0;
  function scheduleReloadRefresh(durationMs: number): void {
    // A beat past the window, so the read lands after the server's own pump.
    const dueAtMs = Date.now() + durationMs + 750;
    if (reloadRefreshTimer !== null) {
      if (dueAtMs <= reloadRefreshAtMs) {
        return;
      }
      clearTimeout(reloadRefreshTimer);
    }
    reloadRefreshAtMs = dueAtMs;
    reloadRefreshTimer = setTimeout(() => {
      reloadRefreshTimer = null;
      void loadFitting().catch(() => {});
    }, dueAtMs - Date.now());
    if (typeof reloadRefreshTimer === "object" && "unref" in reloadRefreshTimer) {
      (reloadRefreshTimer as { unref(): void }).unref();
    }
  }

  function scheduleHoldRefresh(): void {
    if (holdRefreshTimer !== null) {
      return;
    }
    holdRefreshTimer = setTimeout(() => {
      holdRefreshTimer = null;
      // Best-effort: a failed refresh leaves the last good reading on screen
      // with its own error, exactly as the panel's poll does.
      void loadMiningHolds().catch(() => {});
    }, HOLD_REFRESH_COALESCE_MS);
    if (typeof holdRefreshTimer === "object" && "unref" in holdRefreshTimer) {
      (holdRefreshTimer as { unref(): void }).unref();
    }
  }

  /**
   * The drone bay's half of the same frame, coalesced harder and paid for only
   * where it is read.
   *
   * ⚠ IT IS GATED ON `loaded`, WHICH IS THE WHOLE COST CONTROL. One drones read
   * is three calls on the BFF (the bay, the ship's attributes, the space
   * snapshot), and `OnItemsChanged` also fires on every ore grant of every
   * mining cycle. A session that never opened the Drones window must not pay
   * that per cycle — and one that did opened it precisely to watch this.
   *
   * It coalesces at the space refresh's beat rather than the hold's: the bay
   * needs to be RIGHT, not to redraw once per stack.
   */
  const DRONE_REFRESH_COALESCE_MS = 400;
  let droneRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** The ship whose bay the drones were last read for: the one an item's move is judged against. */
  let droneBayShipID: number | null = null;
  function scheduleDroneRefresh(): void {
    if (droneRefreshTimer !== null || !store.get().drones.loaded) {
      return;
    }
    droneRefreshTimer = setTimeout(() => {
      droneRefreshTimer = null;
      // Best-effort, like both refreshes around it: a failed read leaves the
      // last good bay on screen rather than emptying it, which is the one thing
      // this panel may never do by accident.
      void loadDrones().catch(() => {});
    }, DRONE_REFRESH_COALESCE_MS);
    if (typeof droneRefreshTimer === "object" && "unref" in droneRefreshTimer) {
      (droneRefreshTimer as { unref(): void }).unref();
    }
  }

  // A fight pushes a shot per weapon per cycle, from both sides at once. R29
  // measured 16 incoming frames from ONE frigate in a single engagement, so
  // these coalesce harder than the hold does: the health bars only need to be
  // right, not to redraw once per bullet.
  const SPACE_REFRESH_COALESCE_MS = 400;
  let spaceRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSpaceRefresh(): void {
    if (spaceRefreshTimer !== null) {
      return;
    }
    spaceRefreshTimer = setTimeout(() => {
      spaceRefreshTimer = null;
      // Best-effort, like the hold refresh: a failed read leaves the last good
      // snapshot on screen rather than blanking the bars mid-fight.
      void loadSpaceSnapshot().catch(() => {});
    }, SPACE_REFRESH_COALESCE_MS);
    if (typeof spaceRefreshTimer === "object" && "unref" in spaceRefreshTimer) {
      (spaceRefreshTimer as { unref(): void }).unref();
    }
  }

  // Multibox — gate on the live push channel (see AppFlow.setLivePush): while
  // false this flow opens NO EventSource, so a background pilot never holds one
  // of the browser's ~6 per-origin connections.
  let livePushEnabled = options.livePush ?? true;

  function startLiveStream(): void {
    stopLiveStream();
    if (!livePushEnabled) {
      return; // status stays idle; reads still carry their notification drains
    }
    store.apply({ type: "live/status", status: "connecting" });
    liveStream = api.subscribeBridgeEvents(
      {
        onFrame: applyLiveFrame,
        onOpen: () => store.apply({ type: "live/status", status: "live" }),
        // EventSource reconnects on its own; the store just records that the
        // page is back on its polls until frames resume.
        onError: () => store.apply({ type: "live/status", status: "degraded" }),
      },
      callOptions,
    );
  }

  function stopLiveStream(): void {
    if (liveStream) {
      liveStream.close();
      liveStream = null;
    }
    store.apply({ type: "live/cleared" });
  }

  async function refreshStationPanel(): Promise<void> {
    const assertCurrent = callOptions.captureRequestGuard?.();
    const structureID = store.station.get().online?.structureID;
    if (structureID) {
      try {
        const serviceIDs = await api.readAccessibleStructureServices(structureID, callOptions);
        if (store.station.get().online?.structureID === structureID) {
          store.apply({ type: "station/structure-services", serviceIDs });
          store.apply({ type: "station/read-error", message: null });
        }
      } catch (error) {
        if (isSessionLost(error)) {
          stopLiveStream();
          store.apply({ type: "character/offline" });
          throw error;
        }
        if (store.station.get().online?.structureID === structureID) {
          store.apply({ type: "station/structure-services", serviceIDs: null });
          store.apply({ type: "station/read-error", message: `Structure services are unreadable: ${errorWords(error)}` });
        }
      }
      // dockedUI/guests.py (98 to 101): the lobby's guests panel asks for the structure's guests as it comes
      // up. A read of its own: one that fails says so where the services' has said nothing, and leaves the
      // services and the guests as they were. Through a connection that does not carry it there are none to
      // show, and nothing is said.
      try {
        const guests = await getStructureGuests(structureID, callOptions);
        if (guests !== null && store.station.get().online?.structureID === structureID) {
          store.apply({ type: "station/guests", guests });
        }
      } catch (error) {
        if (isSessionLost(error)) {
          stopLiveStream();
          store.apply({ type: "character/offline" });
          throw error;
        }
        if (store.station.get().online?.structureID === structureID && store.station.get().readError === null) {
          store.apply({ type: "station/read-error", message: `GetGuests: ${errorWords(error)}` });
        }
      }
      return;
    }
    // Retail issues these when the docked UI loads; the page issues them after
    // select succeeds (push forwarding is a later goal, G6). The two reads
    // are INDEPENDENT: a slow or failed one must never blank the other.
    // And because selectCharacter calls this after the view has already
    // switched to the panel, a failure is reported through the store (visible
    // in the panel) rather than thrown into an unmounted caller — except a
    // lost session, which must unwind the flow back to the character list.
    //
    // (The map's stations, map.GetStationInfo, are not asked here since 2026-10-14. The client asks them once in a
    // session, as its station service sets up in a station (station/base.py 185, ui.GetStation; uisvc.py 244 to 248
    // keeps the table), and the game port's transport asks them so as a character is chosen in a station
    // (src/gamePort/pilots.js, lobbyRead). The page read only whether the answer was the cached envelope, and nothing
    // showed it.)
    const labels = ["GetStationItemBits", "GetGuests"] as const;
    const [bits, guests] = await Promise.allSettled([
      getStationItemBits(callOptions),
      getStationGuests(callOptions),
    ]);
    assertCurrent?.();

    if (bits.status === "fulfilled") {
      store.apply({ type: "station/bits", bits: bits.value });
    }
    if (guests.status === "fulfilled") {
      store.apply({ type: "station/guests", guests: guests.value });
    }
    const failures = [bits, guests]
      .map((result, index) => ({ result, label: labels[index] }))
      .filter((entry) => entry.result.status === "rejected") as ReadonlyArray<{
      result: PromiseRejectedResult;
      label: string;
    }>;

    // A lost live session can't be recovered by any read: flip offline and
    // unwind so the view falls back to the character list.
    const lost = failures.find((entry) => isSessionLost(entry.result.reason));
    if (lost) {
      stopLiveStream();
        store.apply({ type: "character/offline" });
      throw lost.result.reason;
    }

    // Otherwise keep whatever succeeded and surface the rest (null clears a
    // stale error after a clean refresh). Never throw here.
    store.apply({
      type: "station/read-error",
      message: failures.length
        ? failures
            .map((entry) => `${entry.label}: ${errorWords(entry.result.reason)}`)
            .join("; ")
        : null,
    });
  }

  // Every fitting the refit block may apply: the pilot's own, then the session
  // corp's. The personal read decides success; a corp read that fails leaves
  // the personal library standing on its own.
  //
  // The page's own calls (bridge/fittingReads.ts), one for each owner, as the
  // client's fitting service asks: the pilot and its corporation are the
  // session's, as the page has them. With no corporation known the pilot's own
  // are read alone: that read refuses by itself, with nothing asked.
  async function loadRefitLibrary(): Promise<readonly SourcedFitting[]> {
    const online = store.station.get().online;
    const [personal, corporation] = await Promise.all([
      readCharacterFittings(bridgeAsk, online?.characterID ?? 0).then(decodeFittings),
      readCorporationFittings(bridgeAsk, online?.corporationID ?? 0).then(decodeCorpFittings).catch(() => []),
    ]);
    return refitLibrary(personal, corporation);
  }

  // Load the Inventory & Ship panel. The two containers are decoded
  // independently (their own error is preserved) so one failed read never
  // blanks the other — R2's Promise.allSettled rule, applied here on the BFF's
  // already-settled per-container results. A lost session unwinds to select.
  async function loadInventory(): Promise<void> {
    let panel: Awaited<ReturnType<typeof api.loadInventory>>;
    try {
      panel = await api.loadInventory(callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        // The live session ended out from under the inventory tab: unwind to
        // the character list like refreshStationPanel/runMutation, so the page
        // doesn't stay mounted with stale rows on a dead session.
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
    store.apply({
      type: "inventory/loaded",
      stationID: panel.stationID,
      structureID: panel.structureID,
      activeShipID: panel.activeShipID,
      hangar: decodeContainer(panel.hangar.list, panel.hangar.capacity, panel.hangar.error, panel.volumes),
      cargo: decodeContainer(panel.cargo.list, panel.cargo.capacity, panel.cargo.error, panel.volumes),
    });
  }

  // Run a mutation, then refresh the panel. A lost session is rethrown to
  // unwind the flow; any other failure is surfaced through the store (the page
  // stays put and shows the reason) rather than thrown into the UI handler.
  // An action that answers `false` did nothing (the pilot said no): nothing is said, and nothing is read again.
  async function runMutation(action: () => Promise<void | boolean>): Promise<void> {
    try {
      if ((await action()) === false) {
        return;
      }
      store.apply({ type: "inventory/action-error", message: null });
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "inventory/action-error", message: errorWords(error) });
      return;
    }
    await loadInventory();
  }

  // --- R14 Inventory depth + corporation hangars ---------------------------

  // R14's readRefusalReason and its rendered half now live at module scope as
  // readRefusalReason/errorWords — R31 made "keep the handler's own sentence"
  // the rule for EVERY panel rather than a special case for corp hangars, so
  // there is one seam instead of two that could drift apart.

  // Turn a transfer result into one honest sentence. A split is judged by the
  // source stack shrinking (it mints a NEW stack at the destination, so the
  // requested itemID never appears there), and a decline with no reason is
  // reported AS a decline with no reason.
  function describeTransfer(
    result: { applied: boolean; moved: readonly number[]; declined: readonly number[] },
    requested: number,
    qty: number | null,
  ): string {
    if (result.applied && qty !== null) {
      return `Split ${qty} off the stack.`;
    }
    if (result.applied && result.declined.length === 0) {
      return `Moved ${result.moved.length} of ${requested}.`;
    }
    if (result.applied) {
      return `Moved ${result.moved.length} of ${requested}; the server declined the rest without giving a reason.`;
    }
    return "The server did not move anything, and gave no reason.";
  }

  /**
   * The rows the panel holds of a place, as its last read had them: the hangar, the ship's hold, a bay of the ship
   * the pilot is in where that ship is the one open, and the container open. Null where the panel holds none.
   */
  function rowsAt(place: InventoryPlace): readonly InventoryItemRow[] | null {
    const inventory = store.get().inventory;
    switch (place.kind) {
      case "hangar":
        return inventory.hangar.rows;
      case "cargo":
        return inventory.cargo.rows;
      case "container":
        return inventory.container && inventory.container.itemID === place.itemID ? inventory.container.rows : null;
      case "shipBay": {
        const ship = inventory.openShip;
        if (!ship || ship.itemID !== inventory.activeShipID) return null;
        return ship.bays.find((bay) => bay.key === place.bay)?.items ?? null;
      }
      case "corp":
        return inventory.corp.loaded ? inventory.corp.divisions.find((each) => each.division === place.division)?.rows ?? null : null;
      default:
        return null;
    }
  }
  /**
   * The place a trash names, as the client names it (invCache.GetStationIDOfItem): the station or structure for what
   * lies in its hangar, the office's station for a corporation's, and otherwise the ship or the container it lies in.
   */
  function trashedFrom(place: InventoryPlace): number {
    if (place.kind !== "corp") return inventoryAt(place).liesIn;
    const dockedAt = dockedNow();
    if (dockedAt === null) throw new Error("The corporation's hangar is at hand only while docked.");
    return dockedAt;
  }
  /**
   * The inventory a place is (`of` for the page's own call on it) and where what it holds lies: the hangar of where
   * the pilot is docked, the ship the pilot is in for its hold and its bays, a container's own.
   */
  function inventoryAt(place: InventoryPlace): { readonly inventory: number | "hangar"; readonly liesIn: number } {
    if (place.kind === "hangar") {
      const dockedAt = dockedNow();
      if (dockedAt === null) throw new Error("The hangar is at hand only while docked.");
      return { inventory: "hangar", liesIn: dockedAt };
    }
    if (place.kind === "container") return { inventory: place.itemID, liesIn: place.itemID };
    if (place.kind === "cargo" || place.kind === "shipBay") {
      const shipID = store.get().inventory.activeShipID;
      if (shipID === null) throw new Error("Which ship this is is not known yet.");
      return { inventory: shipID, liesIn: shipID };
    }
    throw new Error("That place's inventory is not the page's to name.");
  }
  /**
   * inventoryAt, and the corporation's hangar besides: its inventory is the office's where the pilot is docked, and
   * what lies in it lies in the office (bridge/inventoryWrites.ts, officeAt), asked of the office manager's read.
   */
  async function inventoryOfPlace(place: InventoryPlace): Promise<{ readonly inventory: number | "hangar"; readonly liesIn: number }> {
    if (place.kind !== "corp") return inventoryAt(place);
    const dockedAt = dockedNow();
    if (dockedAt === null) throw new Error("The corporation's hangar is at hand only while docked.");
    const officeID = await officeAt(bridgeAsk, dockedAt);
    if (officeID === null) throw new Error("Your corporation has no office at this station.");
    return { inventory: officeID, liesIn: officeID };
  }

  /**
   * Stack All of the hangar or the ship's hold, by the client's own call on its inventory (bridge/inventoryWrites.ts),
   * and only where the panel's rows of it have two stacks of a type, as the client asks nothing otherwise.
   */
  async function stackPlaceNow(target: "hangar" | "cargo"): Promise<void> {
    const inventory = store.get().inventory;
    if (!hasSomethingToStack(target === "hangar" ? inventory.hangar.rows : inventory.cargo.rows)) return;
    await stackAllCall(bridgeDo, inventoryAt({ kind: target }).inventory, target);
  }

  // Reload whatever places are currently on screen. A mutation can touch the
  // hangar, the open container and a corp division at once (a move out of a
  // container into a division touches all three), so after any action every
  // open view is re-read rather than guessing which one changed.
  async function refreshOpenPlaces(): Promise<void> {
    const current = store.get().inventory;
    await loadInventory();
    if (current.container) {
      await openContainer(current.container.itemID);
    }
    if (current.corp.loaded) {
      await loadCorpHangar();
    }
    // A move out of a ship bay (R51) changes what that bay holds, so the open
    // ship's bays are re-read too — otherwise the ore just moved out would keep
    // showing in the hold until the next manual refresh.
    if (current.openShip) {
      await openShipBays(current.openShip.itemID);
    }
    // The DRONE BAY is one of those bays, and it has its own window. Dragging
    // drones into it from the hangar showed them in Inventory & Ship instantly
    // and left the Drones window reading "Nothing in the drone bay" — the same
    // stale-hold bug one panel over, and worse, because that window is where a
    // pilot goes to LAUNCH what they just loaded.
    //
    // Gated on `loaded`: a session that never opened the window pays nothing,
    // exactly as the container and corp-hangar re-reads above are gated.
    if (store.get().drones.loaded) {
      await loadDrones().catch(() => {});
    }
  }

  /**
   * Re-read everything scoped to WHICH HULL YOU ARE FLYING (goal R87).
   *
   * ⚠ THE BUG THIS FIXES. Boarding a ship went through `runMutation`, which
   * reloads the hangar and the cargo — so `activeShipID` updated and the item
   * lists were right. But two things are keyed to the hull itself and neither
   * was touched:
   *
   *   • `openShip`, the bays the Ship Inventory tab draws. It is opened once, in
   *     the panel's `onMount`, and the `inventory/loaded` reducer deliberately
   *     preserves it across a reload — so after boarding it kept showing the
   *     bays of the ship you had just STEPPED OUT OF, with its ore and its
   *     capacities, indefinitely.
   *   • The fitting slice — slots, resources, stats, dogma. An open Fitting
   *     window kept the previous hull's modules.
   *
   * Both are stale in the worst way: they look live, they are labelled with the
   * right panel, and nothing about them says they are describing a different
   * ship.
   *
   * ⚠ THIS IS THE REFILL, NOT THE GUARANTEE. R88 moved the invalidation into the
   * store, where the hull change is OBSERVED (see `inventory/loaded`): the fit
   * and the bays card are dropped there, so no caller can leave stale hull state
   * on screen by forgetting to call this. What this adds is promptness — the
   * panels refill on the same beat as the board instead of sitting empty until
   * something else asks. Deleting it degrades the experience; deleting the store
   * half reintroduces the bug.
   */
  /**
   * Quote the ACTIVE HULL and everything fitted to it at the station's repair
   * shop (goal R2 station services; the `repair-ship` bot block asks the same
   * question). The shop itself decides what counts as damaged — the browser
   * never judges a hitpoint total — and only the ids we named can come back.
   *
   * Null means the shop was NOT asked because there is no hull to quote yet;
   * an empty list is the shop's own "nothing is damaged". The fit is loaded
   * first when the fitting slice is still empty, so a quote raised from the
   * station panel covers the modules and not just the hull.
   */
  async function quoteShipRepair(): Promise<readonly RepairQuoteRow[] | null> {
    if (store.get().fitting.slots.length === 0) {
      // Best-effort: a fitting read that fails costs the modules from the
      // quote, never the hull's own repair.
      await loadFitting().catch(() => {});
    }
    const state = store.get();
    const shipID = state.inventory.activeShipID;
    const fitted = state.fitting.slots
      .filter((slot) => slot.module !== null)
      .map((slot) => slot.module!.itemID);
    const targets = [...(shipID !== null ? [shipID] : []), ...fitted];
    if (targets.length === 0) {
      return null;
    }
    // The page's own call of the shop (bridge/repairShop.ts).
    return quoteRepairs(bridgeAsk, targets);
  }

  async function refreshActiveShipViews(): Promise<void> {
    // Read the hull AFTER the mutation's own reload, so this is the ship the
    // server ended up putting us in — never the one we asked for. A refused
    // board leaves it unchanged and this simply re-reads what is already there.
    const activeShipID = store.get().inventory.activeShipID;
    // `null` closes the bays card, which is right for leaving a ship entirely.
    await openShipBays(activeShipID).catch(() => {});
    // The fit belongs to the hull. Fire-and-forget: a fitting read that fails
    // must cost the player their module list, never the board that succeeded.
    await loadFitting().catch(() => {});
    // And the hull is the pilot's flight's too: the lobby's corvette button goes by the group of the ship the
    // session is in now (corvetteButton.py), and nothing else reads the flight again while docked. A read that
    // fails costs that and nothing else.
    await loadFlightStatus().catch(() => {});
  }

  // Run a mutation and report what the SERVER says actually happened. The BFF
  // re-reads after every call because invbroker declines silently, so `applied`
  // here is a real observation, not an echo of the request.
  async function runInventoryAction(
    action: () => Promise<{ applied: boolean; declinedSilently: boolean; message: string }>,
  ): Promise<void> {
    store.apply({ type: "inventory/outcome", outcome: null });
    let outcome: { applied: boolean; declinedSilently: boolean; message: string };
    try {
      outcome = await action();
      store.apply({ type: "inventory/action-error", message: null });
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      // A typed refusal carries the HANDLER's own reason; it is surfaced
      // verbatim rather than reworded.
      store.apply({ type: "inventory/action-error", message: errorWords(error) });
      return;
    }
    store.apply({ type: "inventory/outcome", outcome });
    store.apply({ type: "inventory/selection", itemIDs: [] });
    await refreshOpenPlaces();
  }

  async function openContainer(containerID: number | null): Promise<void> {
    if (containerID === null) {
      store.apply({ type: "inventory/container", container: null });
      return;
    }
    // Carry the container's own typeID so the panel can name it; it is a row in
    // whichever place the player opened it from.
    const current = store.get().inventory;
    const owningRow =
      current.hangar.rows.find((row) => row.itemID === containerID) ??
      current.cargo.rows.find((row) => row.itemID === containerID) ??
      null;
    // What the container is, for the bridge to work its capacity out by: its row's type, or the type it was
    // opened with if it is the one open already (its row may have moved since). Never another container's.
    const knownTypeID = owningRow
      ? owningRow.typeID
      : current.container && current.container.itemID === containerID ? current.container.typeID : 0;
    let reads: Awaited<ReturnType<typeof api.openContainer>>;
    try {
      reads = await api.openContainer(containerID, callOptions, knownTypeID);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "inventory/container",
        container: {
          itemID: containerID,
          typeID: owningRow ? owningRow.typeID : 0,
          rows: [],
          capacity: null,
          error: errorWords(error),
        },
      });
      return;
    }
    store.apply({
      type: "inventory/container",
      container: {
        itemID: containerID,
        typeID: owningRow
          ? owningRow.typeID
          : (store.get().inventory.container?.typeID ?? 0),
        rows: decodeInventoryRows(reads.list),
        capacity: reads.capacity === null ? null : decodeCapacity(reads.capacity),
        error: null,
      },
    });
  }

  /**
   * Open a ship in the Ships card and read its bays (goal R40). `null` closes
   * the card.
   *
   * The open and the read are two steps on purpose: the card shows "looking at
   * this ship…" the moment it is clicked, instead of a hull that appears to
   * have no bays until the read lands. An empty bay list and a bay list that
   * has not arrived yet are different pictures.
   */
  async function openShipBays(shipID: number | null): Promise<void> {
    if (shipID === null) {
      store.apply({ type: "inventory/ship-open", itemID: null, typeID: 0 });
      return;
    }
    // The ship's own typeID, so the card can NAME the hull. It is a row in
    // whichever place the player clicked it from.
    const current = store.get().inventory;
    const owningRow =
      current.hangar.rows.find((row) => row.itemID === shipID) ??
      current.cargo.rows.find((row) => row.itemID === shipID) ??
      null;
    store.apply({
      type: "inventory/ship-open",
      itemID: shipID,
      typeID: owningRow ? owningRow.typeID : (current.openShip?.typeID ?? 0),
    });
    let result: Awaited<ReturnType<typeof api.getShipBays>>;
    try {
      result = await api.getShipBays(shipID, callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      // The whole read failed, so NOTHING is known about this hull's bays —
      // which is not the same as a hull with no bays. The card says so.
      store.apply({
        type: "inventory/ship-bays",
        itemID: shipID,
        bays: [],
        error: errorWords(error),
      });
      return;
    }
    store.apply({
      type: "inventory/ship-bays",
      itemID: shipID,
      bays: decodeShipBays(result.bays),
      error: null,
    });
  }

  async function loadCorpOffices(): Promise<CorpOfficesResult> {
    try {
      return await api.loadCorpOffices(callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      // A failed read is "we could not check", and the picker says so. It is
      // NOT "there is no office": a corporation hangar quietly disappearing
      // from the builder because one read timed out would look like the
      // feature breaking.
      return { stationIDs: [], divisions: [], error: errorWords(error) };
    }
  }

  // crimewatchSvc: the pilot's combat timers and its ship's safety level. The
  // client's service has them from the choosing of the character on, and
  // changes them at the server's notices; the page reads them at the choosing
  // and again at each notice and each change of place or ship. A read that
  // answers for a pilot no longer online here is not shown, and one that fails
  // leaves what was shown.
  //
  // The read is the service's own call, made by the page (bridge/crimewatchReads.ts).
  // An answer with no states in it is an error: nothing is shown of a read that
  // said nothing. Beside the states goes how far the server's clock is ahead of
  // the browser's, which that answer has just said.
  async function loadCrimewatch(): Promise<void> {
    const characterID = store.station.get().online?.characterID ?? null;
    const answered = await readClientStates(bridgeAsk);
    if (!Array.isArray(answered)) {
      throw new Error("Crimewatch did not say what the pilot's timers are.");
    }
    const crimewatch = { states: decodeClientStates(answered), clockOffsetMs: serverNow() - Date.now() };
    if (store.station.get().online?.characterID === characterID) {
      store.apply({ type: "flight/crimewatch", crimewatch });
    }
  }

  // clone_grade_svc: the client asks the account's clone grade as it logs in,
  // and keeps it. The BFF's transport asked it at the pilot's login; the page
  // reads it once as the pilot comes online, with the service's own call
  // (bridge/cloneGradeReads.ts). A read that fails leaves none, and so does a
  // transport that does not carry the call (the web gateway).
  async function loadCloneGrade(): Promise<void> {
    store.apply({ type: "character/clone-grade", cloneGrade: cloneGradeOf(await readCloneGrade(bridgeAsk)) });
  }

  // crimewatchSvc.SetSafetyLevel: the client sets the level at the server and
  // from then on has it as the level, asking crimewatch nothing. So here: the
  // level set goes into what was last read. With nothing read there is
  // nothing to put it into, and the read on its way says it. A set that
  // answers after the pilot has gone from this page is thrown by the guard
  // every request of a pilot's has (SESSION_REQUEST_RETIRED), so what is
  // changed here is this pilot's.
  async function setSafetyLevel(level: SafetyLevel): Promise<void> {
    // The selector's call, as the client's crimewatch service makes it (bridge/crimewatchWrites.ts).
    await setSafetyLevelCall(bridgeDo, level);
    const crimewatch = store.flight.get().crimewatch;
    if (crimewatch !== null) {
      store.apply({ type: "flight/crimewatch", crimewatch: { ...crimewatch, states: { ...crimewatch.states, safetyLevel: level } } });
    }
  }

  // dockedUI/offices.py: the lobby lists the station's offices when its
  // Offices tab is shown, and again at each office rented or given up. The
  // page lists them when the player asks, and from then on at each notice. A
  // read that answers after the pilot has gone elsewhere is not shown.
  // The server says an office changed twice over, to the station and to the
  // corporation, and the client's panel does not load again while it is
  // loading (offices.py, _load): `listingStationOffices` is that.
  let listingStationOffices = false;
  async function loadStationOffices(): Promise<void> {
    const where = () => store.station.get().online?.stationID ?? store.station.get().online?.structureID ?? null;
    const askedAt = where();
    listingStationOffices = true;
    try {
      const offices = await api.loadStationOffices(callOptions);
      if (where() === askedAt) {
        store.apply({ type: "station/offices", offices });
      }
    } finally {
      listingStationOffices = false;
    }
  }

  // dockedUI/offices.py, _rent_office and _unrent_office: the price asked,
  // the player asked, and the one call sent. Neither lists anything after:
  // the server says the office changed, and that lists them.
  // Each is the page's own call of the office manager of where the pilot is docked, a station or a structure
  // (bridge/officeWrites.ts). What the lobby's buttons go by is the page's listing of the offices; where the
  // pilot is docked is its flight's, read as the press is made, as the routes read it.
  const dockedIn = async (): Promise<DockedIn> => {
    const now = decodeFlightStatus((await api.getFlightStatus(callOptions)).flight);
    return { stationID: now.stationID, structureID: now.structureID };
  };
  // The listing is of where the page has the pilot docked: it is dropped as the pilot docks elsewhere
  // (station/relocated). Where the flight has the pilot docked in another place than that, this place's offices
  // are not listed yet, and the server would rent or give up where the session is, not where the listing was.
  const officesListedAt = (where: DockedIn) => {
    const online = store.station.get().online;
    const listed = online?.structureID ?? online?.stationID ?? null;
    return listed === (where.structureID ?? where.stationID) ? store.station.get().offices : null;
  };
  const quoteStationOffice = async (): Promise<StationOfficeQuote> => {
    const where = await dockedIn();
    return quoteOffice(bridgeAsk, store.station.get().online?.corporationID ?? null, officesListedAt(where), where);
  };
  const rentStationOffice = async (quote: StationOfficeQuote): Promise<void> => {
    const where = await dockedIn();
    return rentOffice(bridgeDo, officesListedAt(where), where, quote.quoted);
  };
  const giveUpStationOffice = async (): Promise<void> => {
    const where = await dockedIn();
    return giveUpOffice(bridgeDo, officesListedAt(where), where);
  };

  async function loadCorpHangar(): Promise<void> {
    let reads: Awaited<ReturnType<typeof api.loadCorpHangar>>;
    try {
      reads = await api.loadCorpHangar(callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "inventory/corp-loaded",
        available: false,
        reason: errorWords(error),
        divisions: [],
      });
      return;
    }
    store.apply({
      type: "inventory/corp-loaded",
      available: reads.available,
      reason: reads.reason,
      divisions: reads.divisions.map((division) => ({
        division: division.division,
        name: division.name,
        // A division the character cannot query answers an EMPTY list, not an
        // error — the server filtered it, and that is the authority.
        rows: division.list === null ? [] : decodeInventoryRows(division.list),
        error: division.error,
      })),
    });
  }

  // --- R12 Ship fitting ----------------------------------------------------

  // Load the Fitting panel. The slot read and the resource read are
  // INDEPENDENT on the BFF, so each keeps its own error and a failed resource
  // read still shows the fit (and vice versa). A lost session unwinds to
  // select, exactly as loadInventory does.
  async function loadFitting(): Promise<void> {
    let reads: Awaited<ReturnType<typeof api.loadFitting>>;
    try {
      reads = await api.loadFitting(callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
    store.apply({
      type: "fitting/loaded",
      activeShipID: reads.activeShipID,
      slots: buildSlots(reads.slots, reads.shipInfo, reads.online),
      chargeFits: decodeChargeFits(reads.chargeFits),
      resources: decodeResources(reads.shipInfo),
      // R21 — the derived statistics come off the SAME ShipGetInfo attribute
      // map as the resource bars. No extra read, and nothing re-simulated:
      // the server already applied the ship's active-module effects before it
      // sent this (see bridge/shipStats.ts for why that matters).
      stats: deriveShipStats(decodeShipAttributes(reads.shipInfo)),
      slotsError: reads.errors.slots || reads.errors.online,
      resourcesError: reads.errors.shipInfo,
    });
    // R24 slice C — seed each fitted module's BASE cycle length from static
    // data, so the panel can say how long a module takes before it has ever
    // been switched on. Best-effort and never blocking: it is reference data,
    // and a module with no figure simply has none rather than a fabricated one.
    void seedBaseCycleTimes(store.fitting.get().slots).catch(() => {});
    // R21 slice B — the per-module EFFECTIVE attributes, refreshed on the same
    // beat as the fit (and after every fitting action, which reloads via this
    // path). Fire-and-forget: loadDogma keeps its own error, so the fit is never
    // held up — or blanked — by a dogma read that stumbles.
    void loadDogma().catch(() => {});
  }

  /**
   * Load the bound-dogma snapshot for the Fitting window: the active ship plus
   * every fitted module, each carrying the SERVER's post-dogma attribute map
   * (skills + hull bonuses + in-space effects already applied). The Fitting
   * panel looks a clicked module up here by itemID to show its effective stats;
   * nothing is recomputed in the browser.
   *
   * Resilient by design. A lost live session unwinds to select exactly like
   * loadFitting; every OTHER failure is recorded on the slice's own error and
   * swallowed, because the dogma read is a companion to the fit, never a gate on
   * it — a fit that loaded must still render even when its module stats do not.
   */
  async function loadDogma(): Promise<void> {
    let decoded: Awaited<ReturnType<typeof api.boundDogma>>;
    try {
      decoded = await api.boundDogma(callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        return;
      }
      store.apply({ type: "dogma/loaded", allInfo: null, error: errorWords(error) });
      return;
    }
    // The snapshot rides on GetAllInfo; carry that read's own error through so a
    // partial refusal is stated rather than shown as an empty ship.
    store.apply({
      type: "dogma/loaded",
      allInfo: decoded.allInfo.value,
      error: decoded.allInfo.error,
    });
  }

  /**
   * R24 slice C — attribute 73 for every fitted module, mapped from TYPE to the
   * individual module's itemID (which is what the cycle events are keyed by, so
   * the two sources land in the same place and the server's figure can displace
   * the base one cleanly).
   */
  async function seedBaseCycleTimes(slots: readonly FittingSlot[]): Promise<void> {
    const typeIDs: number[] = [];
    for (const slot of slots) {
      if (slot.module && slot.module.typeID > 0 && !typeIDs.includes(slot.module.typeID)) {
        typeIDs.push(slot.module.typeID);
      }
    }
    if (typeIDs.length === 0) {
      return;
    }
    const baseCycleMs = await baseCycleTimesOfTypes(typeIDs);
    const cycles: Record<number, number | null> = {};
    for (const slot of slots) {
      if (slot.module) {
        cycles[slot.module.itemID] = baseCycleMs[slot.module.typeID] ?? null;
      }
    }
    store.apply({ type: "targeting/base-cycles", cycles });
  }

  /**
   * Run a fitting action, then reload the panel so it shows SERVER truth.
   *
   * Two refusal shapes have to be handled, and they are not the same thing:
   *  - a THROWN refusal carries the handler's own reason (e.g. "You do not
   *    have enough CPU to online that module.") and is surfaced verbatim;
   *  - a SILENT decline returns success while nothing moved (invbroker's
   *    fit validation does this for a module you lack the skill for). The BFF
   *    re-reads the slots and reports `applied: false`; saying only that the
   *    server declined is honest, where naming a cause would be a guess.
   */
  /**
   * What the named modules are holding, as one comparable string.
   *
   * ⚠ THE ONLY WAY TO KNOW AN AMMO CALL DID ANYTHING. dogmaIM.LoadAmmo returns
   * null whether it loaded or refused, and the BFF therefore answers a flat
   * `applied: true` either way — measured live, loading an XL projectile round
   * into a small autocannon came back 200/applied with an empty notification
   * list and the module untouched. So the RE-READ is the authority, exactly as
   * it is for locking, module activation and drone orders.
   */
  function ammoSignature(moduleIDs: readonly number[]): string {
    const wanted = new Set(moduleIDs);
    return store.fitting
      .get()
      .slots.filter((slot) => slot.module !== null && wanted.has(slot.module.itemID))
      .map((slot) => {
        const charge = slot.module!.charge;
        return charge ? `${slot.module!.itemID}:${charge.typeID}x${charge.quantity}` : "";
      })
      .filter((entry) => entry !== "")
      .sort()
      .join("|");
  }

  /**
   * Run an ammunition write, then prove it against the re-read.
   *
   * `declined` receives the signature before and after; returning true records
   * the silent decline. A genuine refusal still throws and is reported as the
   * server worded it, untouched.
   */
  async function runAmmoAction(
    moduleIDs: readonly number[],
    action: () => Promise<void>,
    declined: (before: string, after: string, reloadAnnounced: boolean) => boolean,
    declineMessage: string,
  ): Promise<AmmoOutcome> {
    const before = ammoSignature(moduleIDs);
    const calledAtMs = Date.now();
    try {
      await action();
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "fitting/action-error", message: errorWords(error) });
      return "refused";
    }
    // The response's own notifications were applied before `action` resolved,
    // so a reload the server queued in space is already recorded here. The
    // server expands a bank to its slaves, so ANY announcement during this
    // call counts, not only one naming the ids that were sent.
    const reloadAnnounced = Object.values(store.fitting.get().reloads).some(
      (reload) => reload.startedAtMs >= calledAtMs,
    );
    await loadFitting();
    const after = ammoSignature(moduleIDs);
    // AFTER the reload: loadFitting clears the action error on success, so a
    // decline recorded before it would be wiped by its own refresh.
    if (declined(before, after, reloadAnnounced)) {
      store.apply({ type: "fitting/action-error", message: declineMessage });
      return "unchanged";
    }
    return before === after && reloadAnnounced ? "reloading" : "changed";
  }

  /**
   * Whether one fitted module is online right now, or null when the fit does
   * not carry it. Used to prove an online/offline toggle actually landed.
   */
  function moduleOnlineState(itemID: number): boolean | null {
    const slot = store.fitting.get().slots.find((entry) => entry.module?.itemID === itemID);
    return slot?.module ? slot.module.online : null;
  }

  async function runFittingAction(
    action: () => Promise<{ readonly applied: boolean } | void>,
  ): Promise<void> {
    let declined = false;
    try {
      const outcome = await action();
      declined = outcome !== undefined && outcome !== null && outcome.applied === false;
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "fitting/action-error", message: errorWords(error) });
      return;
    }
    await loadFitting();
    // loadFitting clears the action error on success, so a silent decline is
    // recorded AFTER the reload or it would be wiped by its own refresh.
    if (declined) {
      store.apply({
        type: "fitting/action-error",
        message: "The server did not apply that change, and gave no reason.",
      });
    }
  }

  // --- R15 Industry --------------------------------------------------------

  /**
   * Load the Industry panel.
   *
   * Two round-trips, and the ORDER matters: the live read has to answer first
   * because it is what names the blueprint types the static recipes are then
   * fetched for. The live read is five INDEPENDENT calls on the BFF, so a
   * player whose region answers no facilities still sees their blueprints and
   * jobs — each read keeps its own error.
   *
   * The recipe fetch is deliberately NOT awaited into the same failure path:
   * it is static reference data, so a failure there costs the install preview
   * its material list but must never blank the panel.
   */
  async function loadIndustry(): Promise<void> {
    let reads: Awaited<ReturnType<typeof api.loadIndustry>>;
    try {
      reads = await api.loadIndustry(callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
    const blueprints = decodeBlueprints(reads.blueprints.result);
    const jobs = decodeJobs(reads.jobs.result);
    const facilities = decodeFacilities(reads.facilities.result);
    store.apply({
      type: "industry/loaded",
      ownerID: reads.ownerID,
      stationID: reads.stationID,
      solarSystemID: reads.solarSystemID,
      blueprints,
      jobs,
      facilities,
      slotsUsed: decodeSlotUsage(reads.jobCounts.result),
      blueprintsError: reads.blueprints.error,
      // The slot counts are part of the jobs picture; a failure there is a
      // jobs-side failure rather than a whole-panel one.
      jobsError: reads.jobs.error || reads.jobCounts.error,
      facilitiesError: reads.facilities.error,
    });

    // Every ID the panel will show, resolved to a NAME (R7d). A blueprint and
    // its product are ordinary types; a facility is a station in a system.
    const refs: NameRef[] = [];
    for (const blueprint of blueprints) {
      refs.push({ kind: "type", id: blueprint.typeID });
    }
    for (const job of jobs) {
      refs.push({ kind: "type", id: job.blueprintTypeID });
      refs.push({ kind: "type", id: job.productTypeID });
      refs.push({ kind: "station", id: job.facilityID });
    }
    for (const facility of facilities) {
      refs.push({ kind: "station", id: facility.facilityID });
      refs.push({ kind: "system", id: facility.solarSystemID });
    }
    requestNames(refs);

    // The static recipes for every blueprint type in view — the blueprints the
    // player holds AND the ones their running jobs are built from (a job's
    // blueprint may be locked away in the job and absent from the list).
    const typeIDs = new Set<number>();
    for (const blueprint of blueprints) {
      typeIDs.add(blueprint.typeID);
    }
    for (const job of jobs) {
      typeIDs.add(job.blueprintTypeID);
    }
    const known = store.get().industry.definitions;
    const wanted = [...typeIDs].filter((typeID) => typeID > 0 && !(typeID in known));
    if (wanted.length === 0) {
      return;
    }
    let raw: Readonly<Record<string, JsonValue>>;
    try {
      raw = await api.loadIndustryDefinitions(wanted, callOptions);
    } catch {
      // Static data only: the panel still lists everything, it just cannot
      // preview what an install would consume until a later load succeeds.
      return;
    }
    const definitions: Record<number, ReturnType<typeof decodeDefinition>> = {};
    // What a job would consume and make is shown by NAME too (R7d): the
    // install preview lists every material, and it read "—" for any the rest
    // of the app had not happened to resolve (seen live: datacores).
    const materialRefs: NameRef[] = [];
    for (const typeID of wanted) {
      // A definitive miss is cached as null so it is never refetched.
      const definition = decodeDefinition(raw[String(typeID)]);
      definitions[typeID] = definition;
      for (const recipe of definition?.recipes ?? []) {
        for (const material of [...recipe.materials, ...recipe.products]) {
          materialRefs.push({ kind: "type", id: material.typeID });
        }
      }
    }
    store.apply({ type: "industry/definitions", definitions });
    requestNames(materialRefs);
  }

  /**
   * The job as the page last read it. A delivery and a stop send the job's own solar system, as the client
   * does from the job's row (industrySvc.py 150, 160), and the page has it from nowhere else: a job that is
   * not among those read is not asked for.
   */
  function jobAsRead(jobID: number): JobAsked {
    const job = store.get().industry.jobs.find((each) => each.jobID === jobID);
    if (!job) {
      throw new Error("That job is not among your jobs as they were last read.");
    }
    return job;
  }

  /**
   * Run an industry mutation, then reload the panel so it shows SERVER truth.
   *
   * The same two refusal shapes R12 and R14 established, and they are not the
   * same thing:
   *  - a THROWN refusal carries the handler's own reason. For deliver and
   *    cancel that is prose ("That industry job is not ready yet."); for
   *    install it is a structured list of the server's OWN error names, which
   *    `industryRefusalMessage` turns into a sentence without inventing a
   *    cause the server did not give.
   *  - a SILENT decline returns success while nothing happened. The BFF
   *    re-reads the job (an install), or the page reads the job the call
   *    answered (a delivery, a stop: bridge/industryWrites.ts), and reports
   *    `applied: false`; saying only that the server declined is honest,
   *    where naming a cause would be a guess.
   */
  async function runIndustryAction(
    action: () => Promise<{ readonly applied: boolean }>,
  ): Promise<void> {
    let declined = false;
    try {
      const outcome = await action();
      declined = outcome.applied === false;
    } catch (error) {
      throwIfRequestRetired(error);
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "industry/action-error",
        message: industryRefusalMessage(error),
      });
      return;
    }
    await loadIndustry();
    // loadIndustry clears the action error on success, so a silent decline is
    // recorded AFTER the reload or it would be wiped by its own refresh.
    if (declined) {
      store.apply({
        type: "industry/action-error",
        message: "The server did not apply that change, and gave no reason.",
      });
    }
  }

  // --- R16 Market ----------------------------------------------------------

  /**
   * Load the Market panel.
   *
   * Seven INDEPENDENT reads on the BFF, so a public order book that fails
   * never hides the player's own orders — and the other way round. The
   * DAEMON-outage case is kept separate from an empty book on purpose: "nobody
   * is trading this" and "the market is not answering" are different facts and
   * the panel says which one happened.
   *
   * Nothing here sorts or filters: that is the client-local `marketQuote`
   * logic, applied at render time in the panel so the player can re-sort
   * without a round-trip — exactly as retail does it.
   */
  async function loadMarket(typeID: number | null): Promise<void> {
    let reads: Awaited<ReturnType<typeof api.loadMarket>>;
    try {
      reads = await api.loadMarket(typeID, callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
    const book = decodeOrderBook(reads.book.result);
    const ownOrders = decodeOwnOrders(reads.ownOrders.result);
    const orderHistory = decodeOwnOrders(reads.orderHistory.result);
    // ⚠ The transaction decoder needs the character's OWN id: a trade row names
    // a buyer and a seller and nothing else, so which side the player was on is
    // derived by comparison, never guessed.
    const transactions = decodeTransactions(
      reads.transactions.result,
      reads.characterID ?? 0,
    );
    store.apply({
      type: "market/loaded",
      typeID: reads.typeID,
      stationID: reads.stationID,
      structureID: reads.structureID,
      solarSystemID: reads.solarSystemID,
      brokersFeeRate: reads.brokersFeeRate,
      sells: book.sells,
      buys: book.buys,
      ownOrders,
      orderHistory,
      transactions,
      escrow: reads.escrow.error ? null : decodeEscrow(reads.escrow.result),
      // marketsvc.GetPriceHistory: the two halves joined, as the client joins them. A read with no old half at
      // all (nothing asked, or an older BFF) is the new half as it came.
      priceHistory: reads.priceHistoryOld.result === null
        ? decodePriceHistory(reads.priceHistory.result)
        : joinPriceHistory(decodePriceHistory(reads.priceHistoryOld.result), decodePriceHistory(reads.priceHistory.result), BigInt(Date.now()) * 10000n + 116444736000000000n),
      cashBalance: toAmountString(reads.cashBalance.result),
      bookError: reads.book.error,
      // The own-orders picture is one thing to the player, so a failure in
      // either half is an own-orders failure.
      ownOrdersError: reads.ownOrders.error || reads.orderHistory.error,
      transactionsError: reads.transactions.error,
      marketUnavailable: reads.marketUnavailable,
    });

    // Every ID the panel will show, resolved to a NAME (R7d). An order is an
    // item (a type) at a station in a system.
    const refs: NameRef[] = [];
    if (reads.typeID) {
      refs.push({ kind: "type", id: reads.typeID });
    }
    for (const row of [...book.sells, ...book.buys]) {
      refs.push({ kind: "station", id: row.stationID });
      refs.push({ kind: "system", id: row.solarSystemID });
    }
    for (const row of [...ownOrders, ...orderHistory]) {
      refs.push({ kind: "type", id: row.typeID });
      refs.push({ kind: "station", id: row.stationID });
      refs.push({ kind: "system", id: row.solarSystemID });
    }
    for (const row of transactions) {
      refs.push({ kind: "type", id: row.typeID });
      refs.push({ kind: "station", id: row.stationID });
    }
    requestNames(refs);
  }

  /**
   * Run a market write, then reload the panel so it shows SERVER truth, and
   * record what ACTUALLY happened to the money.
   *
   * Three outcomes, handled differently on purpose:
   *  - a THROWN refusal carries the handler's own reason (or a named market
   *    error), which `marketRefusalMessage` turns into a sentence without
   *    inventing a cause the server did not give;
   *  - a SILENT decline returns success while nothing moved. The BFF judged
   *    that from its RE-READ (the wallet did not change, or the order is still
   *    there at the old price), and saying only that the server declined is
   *    honest where naming a cause would be a guess;
   *  - success, in which case the amount reported is the WALLET DIFFERENCE the
   *    BFF measured — never the estimate the confirm step showed.
   */
  async function runMarketAction(
    kind: "buy" | "sell" | "cancel" | "modify",
    action: () => Promise<api.MarketChangeResult>,
  ): Promise<void> {
    let outcome: api.MarketChangeResult;
    try {
      outcome = await action();
    } catch (error) {
      throwIfRequestRetired(error);
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "market/action-error", message: marketRefusalMessage(error) });
      return;
    }
    // Reload first: the panel must show the server's own picture of the
    // player's orders and ISK before it says anything about what happened.
    await loadMarket(store.get().market.typeID);
    // loadMarket clears the action error on success, so the verdict is recorded
    // AFTER the reload or its own refresh would wipe it.
    store.apply({
      type: "market/outcome",
      outcome: {
        kind,
        applied: outcome.applied,
        declinedSilently: outcome.declinedSilently,
        charged: outcome.charged,
        balanceAfter: outcome.balanceAfter,
      },
    });
  }

  // --- Activity Center -----------------------------------------------------

  async function loadActivity(): Promise<void> {
    const assertCurrent = callOptions.captureRequestGuard?.();
    store.apply({ type: "activity/loading" });

    const now = new Date();
    // The calendar service's agenda (eveCalendarsvc.py 541 to 566): this month's events and the next's, by the
    // server's clock, which the client asks at the login and keeps by month; and the pilot's own answers to them
    // (250 to 257), which it asks once and keeps. On the game port all three are answered from what the transport
    // keeps, as the service keeps them.
    const thisMonth = [now.getUTCMonth() + 1, now.getUTCFullYear()] as const;
    const nextMonth = thisMonth[0] === 12 ? [1, thisMonth[1] + 1] as const : [thisMonth[0] + 1, thisMonth[1]] as const;
    const [notificationResult, unprocessedResult, thisMonthResult, nextMonthResult, responsesResult, mailResult, skillResult] = await Promise.allSettled([
      // The client's notification service's two reads (notificationSvc.py 93 and 107): all the pilot's
      // notifications, from the first, by its keyword; and the ones not yet read, for the unread count. On the game
      // port both are answered from what the transport keeps, as the service keeps them. GetByGroupID the client
      // asks only of a group opened, which the panel has not.
      bridgeAsk("notificationMgr", "GetAllNotifications", [], { fromID: 0 }),
      bridgeAsk("notificationMgr", "GetUnprocessed", []),
      bridgeAsk("calendarProxy", "GetEventList", [...thisMonth]),
      bridgeAsk("calendarProxy", "GetEventList", [...nextMonth]),
      bridgeAsk("calendarMgr", "GetResponsesForCharacter", []),
      // Reuse the existing mail flow so its own authoritative slice and name
      // resolution stay the one source of truth for unread mail.
      loadMail(),
      readSkillNotifications(),
    ] as const);
    assertCurrent?.();

    // A lost live session invalidates every result, even if another arm won
    // the race and answered first. Unwind exactly like all other panel reads.
    for (const result of [notificationResult, unprocessedResult, thisMonthResult, nextMonthResult, responsesResult, mailResult, skillResult]) {
      if (result.status === "rejected" && isSessionLost(result.reason)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw result.reason;
      }
    }
    // What fails a whole reading, in the page's own calls, fails this one.
    for (const result of [notificationResult, unprocessedResult, thisMonthResult, nextMonthResult, responsesResult, skillResult]) {
      if (result.status === "rejected" && failsTheReading(result.reason)) {
        throw result.reason;
      }
    }
    const skillNotifications: ActivityRead<readonly SkillNotification[]> =
      skillResult.status === "fulfilled"
        ? { status: "ready", value: skillResult.value, error: null }
        : activityReadError<readonly SkillNotification[]>(
            `Skill notifications could not be refreshed. ${errorWords(skillResult.reason)}`,
          );

    // Each read answered, or why it was not, as the decoder takes them: its rows (a CRowset's, as Tranquility answers
    // the notification reads, or a list's items).
    const listOf = (value: JsonValue): JsonValue => [...notificationRows(value)];
    const notificationReads: ReturnType<typeof decodeActivityNotifications> = decodeActivityNotifications({
      all: notificationResult.status === "fulfilled" ? listOf(notificationResult.value) : null,
      unprocessed: unprocessedResult.status === "fulfilled" ? listOf(unprocessedResult.value) : null,
      errors: {
        all: notificationResult.status === "rejected" ? failureCode(notificationResult.reason) : null,
        unprocessed: unprocessedResult.status === "rejected" ? failureCode(unprocessedResult.reason) : null,
      },
    });

    const monthFailed = [thisMonthResult, nextMonthResult].find((result) => result.status === "rejected");
    const calendarReads: ReturnType<typeof decodeActivityCalendar> = decodeActivityCalendar({
      eventList: thisMonthResult.status === "fulfilled" && nextMonthResult.status === "fulfilled"
        ? calendarEventsOfMonths([thisMonthResult.value, nextMonthResult.value])
        : null,
      responsesForCharacter: responsesResult.status === "fulfilled"
        ? (Array.isArray(responsesResult.value) ? { type: "list", items: responsesResult.value } : responsesResult.value)
        : null,
      errors: {
        eventList: monthFailed?.status === "rejected" ? failureCode(monthFailed.reason) : null,
        responsesForCharacter: responsesResult.status === "rejected" ? failureCode(responsesResult.reason) : null,
      },
    }, now.getTime());

    store.apply({
      type: "activity/loaded",
      ...notificationReads,
      ...calendarReads,
      skillNotifications,
      mailError:
        mailResult.status === "rejected"
          ? `Mail could not be refreshed. ${errorWords(mailResult.reason)}`
          : null,
      refreshedAtMs: Date.now(),
    });

    // Resolve every entity the panel can show. Unknown owners still render a
    // safe role word — never their raw game ID.
    const refs: NameRef[] = [];
    if (notificationReads.notifications.status === "ready") {
      for (const notification of notificationReads.notifications.value) {
        if (notification.senderID > 0) refs.push({ kind: "owner", id: notification.senderID });
      }
    }
    if (calendarReads.calendarEvents.status === "ready") {
      for (const event of calendarReads.calendarEvents.value) {
        if (event.ownerID > 0) refs.push({ kind: "owner", id: event.ownerID });
      }
    }
    if (skillNotifications.status === "ready") {
      for (const notification of skillNotifications.value) {
        refs.push({ kind: "type", id: notification.skillTypeID });
      }
    }
    requestNames(refs);
  }

  // The skill history's notifications, as the client's notification center takes them from its provider
  // (bridge/skillNotifications.ts): the skill handler's history, ten rows (on the game port answered with what
  // its transport keeps, as the skill service answers), and the pilot's own skills, whose ranks the levels are
  // reckoned by. The provider's first call, CheckAndSendNotifications, the transport asks at the login.
  async function readSkillNotifications(): Promise<readonly SkillNotification[]> {
    const [history, skills] = await Promise.all([
      bridgeAsk("skillHandler", "GetSkillHistory", [SKILL_NOTIFICATION_ROWS]),
      bridgeAsk("skillHandler", "GetSkills", []),
    ]);
    return skillNotificationsOf(decodeSkillHistory(history), decodeSkills(skills));
  }

  // --- Scanner / Exploration Center ---------------------------------------

  // A flight transition can finish while an older scanner read is still in
  // flight. Only the newest generation may publish, and a scanner that had
  // already been opened is refreshed automatically after a system change.
  let scannerLoadGeneration = 0;
  let scannerRefreshPromise: Promise<void> | null = null;
  let scannerRefreshDirty = false;
  let scannerRefreshScheduled = false;

  function scheduleScannerRefresh(): void {
    if (scannerRefreshPromise !== null) {
      scannerRefreshDirty = true;
      return;
    }
    if (scannerRefreshScheduled) {
      return;
    }
    scannerRefreshScheduled = true;
    queueMicrotask(() => {
      scannerRefreshScheduled = false;
      scannerRefreshPromise = (async () => {
        do {
          scannerRefreshDirty = false;
          await loadScanner();
        } while (scannerRefreshDirty);
      })().finally(() => {
        scannerRefreshPromise = null;
      });
      void scannerRefreshPromise.catch(() => undefined);
    });
  }

  async function loadScanner(): Promise<void> {
    const assertCurrent = callOptions.captureRequestGuard?.();
    const generation = ++scannerLoadGeneration;
    store.apply({ type: "scanner/loading" });
    // (The client's scanner asks nothing of the ballpark's formations, beyonce.GetFormations: michelle asks for
    // those as the ballpark is made (michelle.py 324), and so does the transport. Until 2026-10-10 this read
    // them by a route of their own, for a readout the client's scanner has not got.)
    // The sites are the page's own call of the system's scan manager (bridge/scanFullState.ts). The client hands
    // the answer on with the system its session was in before it asked (sensorSuiteService.py 718), and so does
    // this: the system the pilot's flight says now.
    const systemAsked = store.flight.get().status?.solarSystemID ?? null;
    const [scanResult, operationsResult] = await Promise.allSettled([
      readScanFullState(bridgeAsk),
      api.loadScannerOperations(callOptions),
    ] as const);
    assertCurrent?.();

    for (const result of [scanResult, operationsResult]) {
      if (result.status === "rejected" && isSessionLost(result.reason)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw result.reason;
      }
    }

    let scan = scannerStateFromRead(scanResult.status === "fulfilled" ? scanResult.value : null);
    const operations = operationsResult.status === "fulfilled"
      ? { status: "ready" as const, value: operationsResult.value }
      : {
          status: "unavailable" as const,
          reason: "Probe action state could not be read from the live session.",
        };

    // A newer refresh (normally the one scheduled by a completed jump) owns
    // the slice. Let this older response fall away instead of repainting the
    // previous system after the new request has begun.
    if (generation !== scannerLoadGeneration) {
      return;
    }
    const rawSolarSystemID = scanResult.status === "fulfilled"
      ? systemAsked
      : null;
    const scanSolarSystemID =
      typeof rawSolarSystemID === "number" &&
      Number.isSafeInteger(rawSolarSystemID) &&
      rawSolarSystemID > 0
        ? rawSolarSystemID
        : null;
    const operationsSolarSystemID = operations.status === "ready"
      ? operations.value.solarSystemID
      : null;
    if (
      scanSolarSystemID !== null
      && operationsSolarSystemID !== null
      && scanSolarSystemID !== operationsSolarSystemID
    ) {
      scan = {
        status: "unavailable",
        reason: "The ship changed systems while scanner data was refreshing.",
      };
    }
    const solarSystemID = operationsSolarSystemID ?? scanSolarSystemID;

    store.apply({
      type: "scanner/loaded",
      solarSystemID,
      scan,
      operations,
      refreshedAtMs: Date.now(),
    });

    if (scan.status === "ready") {
      const refs: NameRef[] = [];
      const seen = new Set<number>();
      for (const site of [
        ...scan.value.anomalies,
        ...scan.value.signatures,
        ...scan.value.staticSites,
        ...scan.value.structures,
      ]) {
        for (const field of [site.fields.typeID, site.fields.entryObjectTypeID]) {
          if (typeof field === "number" && Number.isSafeInteger(field) && field > 0 && !seen.has(field)) {
            seen.add(field);
            refs.push({ kind: "type", id: field });
          }
        }
      }
      requestNames(refs);
    }
    if (operations.status === "ready") {
      const refs: NameRef[] = [];
      if (operations.value.launcher?.typeID) {
        refs.push({ kind: "type", id: operations.value.launcher.typeID });
      }
      for (const probe of operations.value.probes) {
        refs.push({ kind: "type", id: probe.typeID });
      }
      requestNames(refs);
    }
  }

  async function runScannerAction(action: () => Promise<void>): Promise<void> {
    let mutationError: unknown = null;
    try {
      await action();
    } catch (error) {
      mutationError = error;
    }
    // A write acknowledgement is not scanner state, and a transport error can
    // be an uncertain outcome. Re-read in both cases before reporting back.
    await loadScanner();
    if (mutationError !== null) {
      throw mutationError;
    }
  }

  // The scanner's four orders are the page's own calls (bridge/scannerWrites.ts): each reads the scanner as the
  // transport keeps it now, refuses as the client's scan service refuses, and makes the client's call with what
  // the read said. Until 2026-10-13 each was a route that did the reading and the calling.

  /** What the scanner's orders ask of the ship: whether it is a capsule, and how far a thing in the pilot's park is from it. */
  function scannerShip(): ScannerShip {
    const snapshot = store.space.get().snapshot;
    const own = snapshot?.entities.find((entity) => entity.isSelf) ?? null;
    return {
      isCapsule: store.flight.get().status?.shipIsCapsule ?? null,
      surfaceDistanceTo(itemID: number): number | null {
        const thing = own === null ? undefined : snapshot?.entities.find((entity) => entity.itemID === itemID);
        return own === null || thing === undefined ? null : surfaceDistanceMeters(own.position, own.radius, thing.position, thing.radius);
      },
    };
  }

  function launchScannerProbes(): Promise<void> {
    return runScannerAction(async () => scannerWrites.launch(await api.loadScannerOperations(callOptions)));
  }

  function analyzeScannerSignatures(): Promise<void> {
    return runScannerAction(async () => scannerWrites.analyze(await api.loadScannerOperations(callOptions)));
  }

  function recoverScannerProbes(): Promise<void> {
    return runScannerAction(async () => scannerWrites.recover(await api.loadScannerOperations(callOptions), scannerShip()));
  }

  function reconnectScannerProbes(): Promise<void> {
    return runScannerAction(async () => scannerWrites.reconnect(await api.loadScannerOperations(callOptions), scannerShip()));
  }

  // --- Fleet Center -------------------------------------------------------

  const fleetNameID = (value: number | string | null): number | null =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;

  // Fleet mutations commonly emit several frames for one change. Bound fleet
  // reads deliberately rebind, so they must not overlap: a dirty bit asks the
  // active read to run one more time, while a microtask coalesces a same-turn
  // notification burst into one initial read.
  let fleetRefreshPromise: Promise<void> | null = null;
  let fleetRefreshDirty = false;
  let fleetRefreshScheduled = false;

  /**
   * fleetSvc.py keeps the composition it was answered for twenty seconds (FLEETCOMPOSITION_CACHE_TIME), so a
   * commander's fleet can be read with a composition older than its roster: a member who has joined or been
   * changed since is not in it, and has no ship or place to show. A beat past the twenty seconds the fleet is read
   * once more, as a user who looked at the composition again would see it. Once for a roster: a composition that
   * still lacks the member is not asked after for ever.
   */
  const FLEET_COMPOSITION_REREAD_MS = 20_500;
  const fleetCompositionRereadMs = options.fleetCompositionRereadMs ?? FLEET_COMPOSITION_REREAD_MS;
  let fleetCompositionTimer: ReturnType<typeof setTimeout> | null = null;
  let fleetCompositionReadFor: string | null = null;

  function rereadForComposition(snapshot: ReturnType<typeof decodeFleetCenter>): void {
    if (fleetCompositionTimer !== null) {
      clearTimeout(fleetCompositionTimer);
      fleetCompositionTimer = null;
    }
    const composition = snapshot.fleet.composition.value;
    const members = snapshot.fleet.initState.value.members;
    // No composition to show (the pilot commands nothing, or is in no fleet) is nothing to wait for.
    const lacking = composition.length > 0 && members.some((member) => !composition.some((entry) => entry.characterID === member.charID));
    const roster = lacking ? members.map((member) => String(member.charID)).join(",") : null;
    if (roster === null || roster === fleetCompositionReadFor) {
      if (roster === null) fleetCompositionReadFor = null;
      return;
    }
    fleetCompositionTimer = setTimeout(() => {
      fleetCompositionTimer = null;
      fleetCompositionReadFor = roster;
      scheduleFleetRefresh();
    }, fleetCompositionRereadMs);
    if (typeof fleetCompositionTimer === "object" && "unref" in fleetCompositionTimer) {
      (fleetCompositionTimer as { unref(): void }).unref();
    }
  }

  function scheduleFleetRefresh(): void {
    if (fleetRefreshPromise !== null) {
      fleetRefreshDirty = true;
      return;
    }
    if (fleetRefreshScheduled) {
      return;
    }
    fleetRefreshScheduled = true;
    queueMicrotask(() => {
      fleetRefreshScheduled = false;
      void loadFleet().catch(() => undefined);
    });
  }

  async function loadFleetSnapshotOnce(): Promise<void> {
    store.apply({ type: "fleet/loading" });
    let snapshot: ReturnType<typeof decodeFleetCenter>;
    let readError: string | null = null;
    try {
      snapshot = decodeFleetCenter(await api.loadBoundFleet(callOptions));
      if (
        snapshot.availability === "ready" &&
        [
          snapshot.fleet.wings,
          snapshot.fleet.motd,
          snapshot.fleet.joinRequests,
          snapshot.fleet.composition,
        ].some((read) => read.error !== null)
      ) {
        readError = "Some fleet details could not be refreshed, but the roster is available.";
      } else if (snapshot.availability === "unavailable") {
        readError = "Fleet membership could not be read just now.";
      }
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      snapshot = decodeFleetCenter(null);
      readError = `Fleet membership could not be read just now. ${errorWords(error)}`;
    }

    // (An invitation kept from before the page knew of a fleet: looked at before the read is applied, which
    // takes it out of the window where the pilot is found in a fleet.)
    const kept = store.fleet.get().pendingInvite;
    store.apply({
      type: "fleet/loaded",
      ...snapshot,
      readError,
      refreshedAtMs: Date.now(),
    });
    // The pilot is found in a fleet, and the invitation kept is another fleet's: the client would have turned it
    // down when it came (fleetSvc.py 1179), and the page does as soon as it knows. The invitation of the fleet
    // the pilot is in was taken, and is nothing to turn down.
    if (snapshot.availability === "ready" && kept !== null && kept.fleetID !== snapshot.fleet.fleetID) {
      turnDownUnasked(kept.fleetID);
    }
    rereadForComposition(snapshot);

    const refs: NameRef[] = [];
    for (const member of snapshot.fleet.initState.value.members) {
      // The ship and place the panel will show: the composition's word for the member (memberWhereabouts).
      const where = memberWhereabouts(member, snapshot.fleet.composition.value);
      const characterID = fleetNameID(member.charID);
      const stationID = fleetNameID(where.stationID);
      const systemID = fleetNameID(where.solarSystemID);
      const shipTypeID = fleetNameID(where.shipTypeID);
      if (characterID !== null) refs.push({ kind: "character", id: characterID });
      if (stationID !== null) refs.push({ kind: "station", id: stationID });
      if (systemID !== null) refs.push({ kind: "system", id: systemID });
      if (shipTypeID !== null) refs.push({ kind: "type", id: shipTypeID });
    }
    for (const request of snapshot.fleet.joinRequests.value) {
      const characterID = fleetNameID(request.charID);
      const corporationID = fleetNameID(request.corpID);
      const allianceID = fleetNameID(request.allianceID);
      const factionID = fleetNameID(request.warFactionID);
      if (characterID !== null) refs.push({ kind: "character", id: characterID });
      if (corporationID !== null) refs.push({ kind: "corporation", id: corporationID });
      if (allianceID !== null) refs.push({ kind: "alliance", id: allianceID });
      if (factionID !== null) refs.push({ kind: "faction", id: factionID });
    }
    requestNames(refs);
  }

  async function drainFleetRefreshes(): Promise<void> {
    try {
      while (fleetRefreshDirty) {
        fleetRefreshDirty = false;
        await loadFleetSnapshotOnce();
      }
    } finally {
      // No callback can interleave between the loop condition and this reset,
      // so a later notification either dirtied the loop or starts a new worker.
      fleetRefreshPromise = null;
    }
  }

  function loadFleet(): Promise<void> {
    if (fleetRefreshPromise !== null) {
      return fleetRefreshPromise;
    }
    fleetRefreshDirty = true;
    fleetRefreshPromise = drainFleetRefreshes();
    return fleetRefreshPromise;
  }

  function fleetActionFailure(action: Exclude<FleetAction, "decline">): string {
    switch (action) {
      case "form":
        return "The new fleet could not be confirmed by the follow-up roster read.";
      case "accept":
        return "Joining the fleet could not be confirmed by the follow-up roster read.";
      case "leave":
        return "Leaving the fleet could not be confirmed by the follow-up membership read.";
      case "invite":
        return "The fleet could not be re-read after the invitation was sent.";
    }
  }

  async function runFleetAction(
    action: Exclude<FleetAction, "decline">,
    mutate: () => Promise<void>,
    expected: "ready" | "not-in-fleet",
  ): Promise<void> {
    store.apply({ type: "fleet/action-started", action });
    let failure: string | null = null;
    try {
      await mutate();
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        store.apply({ type: "fleet/action-finished", error: null });
        throw error;
      }
      failure = `The fleet action was refused. ${errorWords(error)}`;
    }

    try {
      // The write acknowledgement is not treated as world state. Always read
      // the session's own bound fleet again, even after a refusal.
      await loadFleet();
      if (failure === null && store.fleet.get().availability !== expected) {
        failure = fleetActionFailure(action);
      }
    } finally {
      store.apply({ type: "fleet/action-finished", error: failure });
    }
  }

  async function formFleet(): Promise<void> {
    // (The page's own call, bridge/fleetWrites.ts: none from a pilot the Fleet window knows to be in a fleet.)
    await runFleetAction("form", () => formFleetCall(bridgeDo, store.fleet.get().availability === "ready"), "ready");
  }

  async function inviteFleetMember(characterID: number, assertCurrent?: () => void, expectedFleetID?: number): Promise<void> {
    if (!Number.isSafeInteger(characterID) || characterID <= 0) {
      store.apply({ type: "fleet/action-started", action: "invite" });
      store.apply({
        type: "fleet/action-finished",
        error: "Enter a valid character ID before sending an invitation.",
      });
      return;
    }
    await runFleetAction(
      "invite",
      // (The page's own call, bridge/fleetWrites.ts: the invitee alone, and the fleet expected where the caller
      // says one. Under a caller's fence it is asked through fencedDo.)
      () => inviteToFleetCall(assertCurrent ? fencedDo(assertCurrent) : bridgeDo, characterID, onlineCharacterID(), expectedFleetID),
      "ready",
    );
  }

  async function formFleetWith(characterID: number): Promise<void> {
    // fleetSvc.Invite (351 to 363): with no fleet one is formed first, and where none could be, nothing more is
    // asked; the pilot's own character is asked nothing.
    if (store.fleet.get().availability !== "ready") {
      await formFleet();
      if (store.fleet.get().actionError !== null || store.fleet.get().availability !== "ready") return;
    }
    if (characterID === onlineCharacterID()) return;
    await inviteFleetMember(characterID);
  }

  /**
 * Join a fleet a CORP-MATE invited us to, without anybody clicking anything.
 *
 * ⚠ THE MANUAL PATH WAS UNRELIABLE IN A WAY NOBODY COULD SEE. An invitation
 * lives only in the session that received the push -- `pendingInvite` starts
 * null and is only ever set by `OnFleetInvite` -- so a page reload destroys it
 * and the panel then truthfully reports that no invitation has arrived. To an
 * operator that reads as "accepting invites works sometimes". It also sat behind
 * a `window.confirm`, which some embedded browsers suppress outright, failing
 * silently. Neither is fixed by trying again; both are fixed by not needing a
 * human at the moment the push lands.
 *
 * ⚠ CORP-MATES ONLY, AND "COULD NOT TELL" MEANS NO. The inviter is a mate where
 * its number is among the corporation's members as the registry lists them (the
 * page's own read, bridge/corpMemberReads.ts: the client's own test of a member).
 * A list that could not be read leaves the invitation sitting in the panel
 * for a human, which is exactly what used to happen for every invitation. This
 * only ever REMOVES a click, never widens who can put this character in a fleet:
 * an invite from outside the corporation still waits to be accepted by hand.
 *
 * ⚠ AND IT NEVER OVERRIDES A FLEET WE ARE ALREADY IN. `acceptFleetInvite`
 * refuses when the roster already reads ready, so a stray invitation cannot pull
 * a pilot out of the fleet it is flying with.
 */
  async function autoAcceptCorpFleetInvite(invite: FleetPendingInvite): Promise<void> {
    const inviter = invite.inviterID;
    if (inviter === null) {
      return;
    }
    let sameCorp: boolean;
    try {
      sameCorp = (await readCorporationMemberIDs(bridgeAsk)).includes(inviter);
    } catch {
      return;
    }
    if (!sameCorp) {
      return;
    }
    // Still pending? A human may have accepted it in the seconds this read took.
    if (store.fleet.get().pendingInvite?.fleetID !== invite.fleetID) {
      return;
    }
    try {
      await acceptFleetInvite();
    } catch {
      // The panel still shows the invitation; a human can press the button.
    }
  }

  async function acceptFleetInvite(fleetID?: number): Promise<void> {
    // ⚠ AN EXPLICIT ID BEATS THE SLICE, and the caller that has one is the one
    // that just applied. See the declaration for the race this avoids.
    const wanted = fleetID ?? store.fleet.get().pendingInvite?.fleetID ?? null;
    if (wanted === null) {
      store.apply({ type: "fleet/action-started", action: "accept" });
      store.apply({
        type: "fleet/action-finished",
        error: "No pending fleet invitation has arrived for this session.",
      });
      return;
    }
    // (The page's own call, bridge/fleetWrites.ts: none from a pilot the Fleet window knows to be in a fleet.)
    await runFleetAction("accept", () => acceptFleetInviteCall(bridgeDo, wanted, store.fleet.get().availability === "ready"), "ready");
  }

  /**
   * The inviter told that the pilot it invited turned the invitation down (fleetSvc.py 1217). The pilot's name
   * is waited for, so that the sentence is said once and names its pilot; and it is said to the pilot that was
   * told, or to nobody.
   */
  async function tellOfInviteAnswer(answer: FleetInviteAnswer): Promise<void> {
    const told = onlineCharacterID();
    await resolveNamesNow([{ kind: "character", id: answer.characterID }]);
    if (told === null || onlineCharacterID() !== told) {
      return;
    }
    const words = fleetInviteAnswerWords(nameCache.get(nameKey("character", answer.characterID)) ?? null, answer.reason);
    // (Said no longer, and then said: the same answer a second time is said a second time.)
    store.apply({ type: "fleet/invite-answered", words: null });
    store.apply({ type: "fleet/invite-answered", words });
  }

  /**
   * An invitation turned down without the pilot being asked, from within a fleet (fleetSvc.py 1180:
   * RejectInvite(True)). Nothing is shown of it and nothing is said of how it went, as the client says nothing.
   */
  function turnDownUnasked(fleetID: number): void {
    void declineFleetInviteCall(bridgeDo, fleetID, true).catch(() => {});
  }

  async function declineFleetInvite(fleetID?: number): Promise<void> {
    const wanted = fleetID ?? store.fleet.get().pendingInvite?.fleetID ?? null;
    store.apply({ type: "fleet/action-started", action: "decline" });
    if (wanted === null) {
      store.apply({
        type: "fleet/action-finished",
        error: "No pending fleet invitation has arrived for this session.",
      });
      return;
    }
    let failure: string | null = null;
    try {
      // (The page's own call, bridge/fleetWrites.ts: with True from a pilot the Fleet window knows to be in a fleet.)
      await declineFleetInviteCall(bridgeDo, wanted, store.fleet.get().availability === "ready");
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        store.apply({ type: "fleet/action-finished", error: null });
        throw error;
      }
      failure = `The fleet action was refused. ${errorWords(error)}`;
    }
    // The client's own question is gone once it is answered, whatever the call said; and it reads nothing of a
    // fleet after, so nor does the page.
    store.apply({ type: "fleet/invite-settled", fleetID: wanted });
    store.apply({ type: "fleet/action-finished", error: failure });
  }

  async function leaveFleet(): Promise<void> {
    // The page's own call, on the fleet's object (bridge/fleetWrites.ts).
    await runFleetAction("leave", () => leaveFleetCall(bridgeDo), "not-in-fleet");
  }

  async function readFleetFinder(inAFleet: boolean | null = null): Promise<FleetFinderRead> {
    let reads: Awaited<ReturnType<typeof readFleetFinderCalls>>;
    try {
      // The page's own two calls (bridge/fleetFinderReads.ts), each failing by itself.
      reads = await readFleetFinderCalls(bridgeAsk, inAFleet);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      // Not fatal and not faked: a watcher waits for a clean read.
      return { ads: null, ownFleetName: null };
    }
    // ⚠ A LISTING THAT COULD NOT BE READ IS NOT A LISTING OF NOBODY. The route
    // this was answered a failed listing as an empty one, which a watcher
    // takes for "nobody is advertising" and may act on. The two reads are
    // settled apart: one failing does not throw the other away.
    const ads = reads.errors.available !== null
      ? null
      : decodeAvailableFleetAds(reads.available)
        .filter((ad) => ad.fleetID !== null && ad.fleetID > 0)
        .map((ad) => ({
          fleetID: ad.fleetID as number,
          fleetName: ad.fleetName,
          numMembers: ad.numMembers,
        }));
    const own = decodeMyFleetFinderAdvert(reads.own);
    const ownFleetName = own !== null && own.fleetName.trim().length > 0 ? own.fleetName : null;
    return { ads, ownFleetName };
  }

  /**
   * An extractor restarted as the client restarts one (bridge/extractorRestart.ts). The colony it is planned from
   * is the BFF's reading of it now, where a client has its planet's own colony in hand.
   *
   * ⚠ THE RADIUS IS THE UNIT'S OWN, SENT BACK. It sets how long the programme runs, and the server refuses what is
   * not inside the drill area's bounds. The client reinstalls with the unit's own too (RestartExtractors, 862).
   */
  async function restartExtractor(planetID: number, pinID: number, resourceTypeID: number, headRadius: number): Promise<void> {
    if (!Number.isSafeInteger(planetID) || planetID <= 0) {
      throw new Error("A positive planetID is required.");
    }
    const report = decodeColonyReport((await api.getPlanets(callOptions)).planets, Date.now());
    const colony = report.colonies.find((each) => each.planetID === planetID);
    if (colony === undefined) {
      throw new Error("That colony could not be read.");
    }
    await restartExtractorAsTheClient(bridgeAsk, bridgeDo, colony, pinID, resourceTypeID, headRadius);
  }
  /** A command centre's commodities launched by the page's own call on the planet's object (bridge/planetWrites.ts). */
  async function launchCommodities(planetID: number, commandPinID: number, commodities: Readonly<Record<number, number>>): Promise<void> {
    await launchCommoditiesCall(bridgeDo, planetID, commandPinID, commodities);
  }
  /** An extractor's routes made anew by the page's own call on the planet's object (bridge/planetWrites.ts). */
  async function rerouteExtractor(planetID: number, removeRouteIDs: readonly number[], create: readonly NewRoute[]): Promise<void> {
    await rerouteExtractorRoutes(bridgeDo, planetID, removeRouteIDs, create);
  }

  /** The ship sent to a point by the page's own call (bridge/movementWrites.ts), held to where the point was measured. */
  async function flyToPoint(position: SpaceVector, shipID: number, solarSystemID: number): Promise<void> {
    await goToPoint(bridgeDo, async () => decodeFlightStatus((await api.getFlightStatus(callOptions)).flight), position, { shipID, solarSystemID });
  }

  /**
   * The ship aligned to a thing by the page's own call (bridge/movementWrites.ts), for the bots. A refusal is the
   * bot's to see, and what the ship does after, the bot reads for itself.
   */
  async function alignShip(targetID: number): Promise<void> {
    await alignToCall(bridgeDo, async () => decodeFlightStatus((await api.getFlightStatus(callOptions)).flight), targetID);
  }

  /** The pilot's flight as the BFF has it now, for an order to the ship that is only a ship's in space. */
  const readFlightNow = async (): Promise<FlightNow> => decodeFlightStatus((await api.getFlightStatus(callOptions)).flight);

  /**
   * The ship sent to a thing by the page's own call (bridge/movementWrites.ts), for the travel loop and the bots:
   * to stop `range` metres short, at the client's own fifty where none is said (the menu's approach, which is
   * what a bot's is), and as the autopilot's approach (the throttle opened, then a follow with no range) where
   * it is nought (the travel autopilot's alone).
   */
  async function approachShip(targetID: number, range: number | null): Promise<void> {
    await approachCall(bridgeDo, readFlightNow, targetID, range);
  }

  /** A thing kept at range by the page's own call (bridge/movementWrites.ts), for the bots. */
  async function keepShipAtRange(targetID: number, range: number | null): Promise<void> {
    await keepAtRangeCall(bridgeDo, readFlightNow, targetID, range);
  }

  /** A thing orbited by the page's own call (bridge/movementWrites.ts), for the script bots. */
  async function orbitShip(targetID: number, range: number | null): Promise<void> {
    await orbitCall(bridgeDo, readFlightNow, targetID, range);
  }

  /** The scanner's sites as a bot's look last read them, and the system that read was of: what the page has for a sensor suite. */
  let sitesLastRead: SitesReadIn | null = null;

  /**
   * A scan result warped to by the page's own call (bridge/movementWrites.ts), for the script bots: to the site's
   * own number as an item where the look's read has the site, and by its label where it has not. The scanner is
   * read first where no look read it for the system the pilot is in.
   */
  async function warpToSite(label: string): Promise<void> {
    await warpToScanResultCall(bridgeDo, readFlightNow, sitesLastRead, () => readScanFullState(bridgeAsk), label);
  }

  /** A thing warped to as the client's menu warps to one, by the page's own call (bridge/movementWrites.ts), for the mining bot and the script bots. */
  async function warpToThing(targetID: number, range: number): Promise<void> {
    await warpToItemCall(bridgeDo, readFlightNow, targetID, range);
  }

  /** A thing warped to as the client's autopilot warps, by the page's own call (bridge/movementWrites.ts), for the travel autopilot and the fleet companion. */
  async function warpAsTheAutopilot(targetID: number): Promise<void> {
    await autopilotWarpCall(bridgeDo, readFlightNow, targetID);
  }

  /** A fleet member warped to by the page's own call (bridge/movementWrites.ts), by the pilot's number, for the fleet companion. */
  async function warpToMember(characterID: number): Promise<void> {
    await warpToFleetMemberCall(bridgeDo, readFlightNow, characterID);
  }

  /** A bookmark warped to by the page's own call (bridge/movementWrites.ts), for the script bots. */
  async function warpToSpot(bookmarkID: number): Promise<void> {
    await warpToBookmarkCall(bridgeDo, readFlightNow, bookmarkID);
  }

  /** A mission's marked spot warped to by asking its agent, by the page's own call (bridge/movementWrites.ts), for the script bots. */
  async function warpToMissionSpot(agentID: number, locationType: string, locationNumber: number): Promise<void> {
    await warpToMissionLocationCall(bridgeDo, readFlightNow, { agentID, locationType, locationNumber });
  }

  /** A launch warped to by the page's own call (bridge/movementWrites.ts), by the launch's own number, for the script bots. */
  async function warpToLaunchPickup(launchID: number): Promise<void> {
    await warpToLaunchCall(bridgeDo, readFlightNow, launchID);
  }

  /**
   * The ship stopped by the page's own call (bridge/movementWrites.ts), for the bots. The stop alone: what a
   * caller gives up of the page's autopilot before it, the caller gives up.
   */
  async function cutEngines(): Promise<void> {
    await stopShipCall(bridgeDo, readFlightNow);
  }

  /**
   * One order to the ship from the flight panel that the page makes itself, with the pilot's flight read before
   * it, for the order to go by, and after it, for the panel to show: the order's route read both. Where the
   * reading after fails the one before stands, as it did in the route, since the order was taken; a session lost
   * is a session lost.
   */
  /**
   * Docks by the page's own call (bridge/placeChanges.ts), between two reads of the flight: at a station the client's
   * RealDock, the park's CmdDock; at a player structure the structure's own docking service's Dock (since 2026-10-14;
   * until then by the dock route).
   */
  function dockStep(stationID: number): Promise<FlightStepResult> {
    return orderedStep((flightNow) => (isStation(stationID)
      ? dockCall(bridgeDo, flightNow, stationID)
      : dockAtStructureCall(bridgeDo, flightNow, stationID)));
  }

  /**
   * What the page's module calls go by (bridge/dogmaWrites.ts), with the flow's guard captured once before the call, as
   * its route's asker captured it: a module watched to its cycle's end after a stop or a reconnect is the watching of
   * the pilot it began for, and every read is held to it.
   */
  function moduleDeps(options: api.ApiOptions): ModuleDeps {
    const current = options.captureRequestGuard?.() ?? (() => {});
    const scoped: api.ApiOptions = { ...options, captureRequestGuard: () => current };
    return {
      flightNow: async () => decodeFlightStatus((await api.getFlightStatus(scoped)).flight),
      state: (itemID, shipID, cycle) => api.getModuleState(itemID, shipID, cycle, scoped),
      effects: defaultEffects,
      current,
    };
  }

  /** A module switched on by the page's own call: godma's Activate, its default effect named (bridge/dogmaWrites.ts). */
  function switchModuleOn(itemID: number, opts: Parameters<typeof activateModuleCall>[3] = {}, options: api.ApiOptions = callOptions): Promise<ModuleActionResult> {
    return activateModuleCall(bridgeDo, moduleDeps(options), itemID, opts);
  }

  /** A module switched off by the page's own call: godma's Deactivate, its effect named, and watched to its cycle's end. */
  function switchModuleOff(itemID: number, opts: Parameters<typeof deactivateModuleCall>[3] = {}, options: api.ApiOptions = callOptions): Promise<ModuleActionResult> {
    return deactivateModuleCall(bridgeDo, moduleDeps(options), itemID, opts);
  }

  /**
   * Jettisons by the page's own call (bridge/shipWrites.ts, the client's GetShipAccess().Jettison), the flight read
   * first. A hosted bot of a Mining Operation asks the route instead (api.jettisonItems), which finds the can it made
   * and gives it to the operation, and keeps a hosted miner's custody: those are the bot host's to keep.
   */
  async function jettisonNow(itemIDs: readonly number[]): Promise<JettisonOutcome> {
    return jettisonCall(bridgeDo, async () => decodeFlightStatus((await api.getFlightStatus(callOptions)).flight), itemIDs);
  }

  /** Jumps through a stargate by the page's own call (bridge/placeChanges.ts, the client's JumpThroughGate), between two reads of the flight. */
  function jumpStep(fromGateID: number, toGateID = 0): Promise<FlightStepResult> {
    return orderedStep((flightNow) => jumpCall(bridgeDo, flightNow, fromGateID, toGateID));
  }

  async function orderedStep(order: (flightNow: () => Promise<FlightNow>) => Promise<void>): Promise<FlightStepResult> {
    const before = await api.getFlightStatus(callOptions);
    await order(async () => decodeFlightStatus(before.flight));
    try {
      return await api.getFlightStatus(callOptions);
    } catch (error) {
      if (isSessionLost(error)) throw error;
      return before;
    }
  }

  async function applyToJoinFleet(fleetID: number): Promise<FleetApplyOutcome> {
    // ⚠ NO `runFleetAction`, DELIBERATELY. That helper re-reads membership and
    // calls the write a failure when the expected availability did not arrive —
    // and an apply's SUCCESS leaves this pilot out of the fleet, holding an
    // invite. Reporting that as a refused action is how the first version of
    // this round trip lied about itself.
    // The page's own call, and with the invitation to be taken unasked: who applies here has said yes already
    // (a fleet's name typed for the companions, or a bot's block), as the Agency's join window has.
    return applyToJoinFleetCall(bridgeDo, fleetID, true);
  }

  // --- R17 Mail -------------------------------------------------------------

  // mailSvc.TrySyncMail (121 to 131): the mailbox is synced once for the character, and kept from then on by what
  // the server tells of it (the mail notices, applyPushedNotification); a load after that asks nothing.
  async function loadMail(): Promise<void> {
    if (store.mail.get().loaded) {
      return;
    }
    await refreshMail();
  }

  // One sync at a time, as the client's service locks its own (mailSvc.py 135): a second asker waits for it.
  let mailSyncing: Promise<void> | null = null;
  function refreshMail(): Promise<void> {
    mailSyncing ??= syncMail().finally(() => {
      mailSyncing = null;
    });
    return mailSyncing;
  }

  // mailSvc.SyncMail (133 to 233): the mail manager asked with the lowest and highest messages held, or None and
  // 0 for none, by the generic call; its answer worked into what is held; and the headers of any message it gives
  // a status of but whose header is not held asked for (GetMailHeaders, a list of them). A page newly loaded holds
  // none, as a client with no file of headers.
  async function syncMail(): Promise<void> {
    const now = store.mail.get();
    const held: DecodedMailbox = now.loaded ? now : { messages: [], statuses: [] };
    let mailbox: DecodedMailbox;
    try {
      const synced = mailboxAfterSync(held, await bridgeAsk("mailMgr", "SyncMail", syncMailArguments(held.messages)));
      mailbox = synced.toFetch.length > 0
        ? mailboxWithHeaders(synced.mailbox, await bridgeAsk("mailMgr", "GetMailHeaders", [[...synced.toFetch]]))
        : synced.mailbox;
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
    mailboxLoaded(mailbox);
    await nameListSenders();
  }

  /** The mailbox as it is now, in the store, its unread counted as the client counts it, and its people named. */
  function mailboxLoaded(mailbox: DecodedMailbox): void {
    const { messages, statuses } = mailbox;
    store.apply({
      type: "mail/loaded",
      messages,
      statuses,
      unreadCount: unreadMailCount(statuses),
      inboxError: null,
    });

    // Every person the panel will show, resolved to a NAME (R7d): who sent each
    // message, and who each one went to. A corporation/alliance recipient is
    // named too, so a corp-wide message reads as "to <corp>" rather than a
    // number.
    const refs: NameRef[] = [];
    // A list's own mail (its welcome mail) is named by the list, and its sender is asked for by no one (mailSvc.py
    // 189 to 190, 206 to 207).
    const automated = new Set(statuses.filter((status) => (status.statusMask & MAIL_STATUS_AUTOMATED) !== 0).map((status) => status.messageID));
    for (const header of messages) {
      if (!(automated.has(header.messageID) && header.senderID === header.toListID)) {
        refs.push({ kind: "character", id: header.senderID });
      }
      for (const recipientID of header.toCharacterIDs) {
        refs.push({ kind: "character", id: recipientID });
      }
      if (header.toCorpOrAllianceID !== null) {
        // cfg.eveowners names either; the page's names go by the kind, an alliance's by its range.
        refs.push({ kind: isAllianceOwner(header.toCorpOrAllianceID) ? "alliance" : "corporation", id: header.toCorpOrAllianceID });
      }
    }
    requestNames(refs);
  }

  /**
   * Open one message.
   *
   * ⚠ `markRead` makes this a WRITE — it clears the unread bit and pushes
   * OnMailUpdatedByExternal to the character's other sessions. The BFF re-reads
   * the mailbox afterwards, so `markedRead` is what the server actually holds;
   * when that re-read failed it is null and NO claim is made. On a successful
   * mark-read the inbox is reloaded so the unread count and the list row agree.
   */
  // mailSvc.GetBody (493 to 524): a body kept is shown from what is kept, and a message not read is marked read with
  // the server (MarkAsRead); one not kept is asked of the mail manager with whether to mark it read (the panel asks
  // for a message not read), by the generic call, its answer inflated and kept, and the message marked read in what
  // is kept, the server having marked it. The bodies are kept by the pilot's and the message's numbers, thirty at
  // most, the first kept going first; a page newly loaded keeps none, as a client with no file of bodies.
  const mailBodies = new Map<string, MailBody>();
  /** The body, kept or asked, the message marked read where `markRead`; null where it failed (the action error). */
  async function mailBodyRead(messageID: number, markRead: boolean): Promise<MailBody | null> {
    const bodyKey = `${store.station.get().online?.characterID ?? 0}:${messageID}`;
    let body: MailBody;
    try {
      const kept = mailBodies.get(bodyKey);
      if (kept !== undefined) {
        if (markRead) {
          await bridgeDo("mailMgr", "MarkAsRead", [[messageID]]);
        }
        body = kept;
      } else {
        body = await inflateMailBody(await bridgeAsk("mailMgr", "GetBody", [messageID, markRead]));
        if (mailBodies.size >= MAIL_BODIES_KEPT) {
          mailBodies.delete(mailBodies.keys().next().value as string);
        }
        mailBodies.set(bodyKey, body);
      }
    } catch (error) {
      throwIfRequestRetired(error);
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "mail/action-error", message: mailRefusalMessage(error) });
      return null;
    }
    if (markRead) {
      // MarkMessagesAsRead (509 to 519): marked read in what is kept, and nothing more is asked. mail/loaded
      // clears the action error.
      mailboxLoaded(mailboxMarkedRead(store.mail.get(), [messageID]));
    }
    return body;
  }

  // mailingListsSvc.Initialize (40 to 45): the lists joined, asked once as the service starts, which it does as the
  // mail window first draws its lists group (Tranquility's recording of the mail window opened asks it after
  // GetLabels), by the generic call, and kept for the character.
  async function loadMailingLists(): Promise<void> {
    if (store.mail.get().lists !== null) {
      return;
    }
    try {
      const answer = await bridgeAsk("mailingListsMgr", "GetJoinedLists", []);
      store.apply({ type: "mail/lists", lists: mailingListsOf(answer) });
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
  }

  // The mailing lists' writes (mailingListsSvc.py 67 to 88): the manager asked by the generic call, and the lists
  // kept changed as the service changes them. Null, and the refusal said, where it refused.
  async function mailingListWrite(method: string, args: readonly JsonValue[]): Promise<JsonValue | undefined> {
    try {
      return await bridgeDo("mailingListsMgr", method, [...args]);
    } catch (error) {
      throwIfRequestRetired(error);
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "mail/action-error", message: mailRefusalMessage(error) });
      return undefined;
    }
  }

  // JoinMailingList (74 to 78): the list its answer gives kept.
  async function joinMailingList(name: string): Promise<number | null> {
    const answer = await mailingListWrite("Join", [name]);
    const list = answer === undefined ? null : mailingListOf(answer);
    if (list === null) {
      return null;
    }
    store.apply({ type: "mail/lists", lists: [...(store.mail.get().lists ?? []).filter((each) => each.listID !== list.listID), list] });
    return list.listID;
  }

  // CreateMailingList (67 to 72): Create(name, mailingListAllowed, mailingListMemberDefault, 0), and the list kept
  // by its name's key and normalized name, the pilot its owner.
  async function createMailingList(name: string): Promise<number | null> {
    const answer = await mailingListWrite("Create", [name, 1, 1, 0]);
    const listID = Number(answer);
    if (answer === undefined || !Number.isSafeInteger(listID) || listID <= 0) {
      return null;
    }
    const [key, displayName] = mailingListKeyAndName(name);
    const list = { listID, name: key, displayName, isMuted: false, isOperator: false, isOwner: true };
    store.apply({ type: "mail/lists", lists: [...(store.mail.get().lists ?? []).filter((each) => each.listID !== listID), list] });
    return listID;
  }

  // LeaveMaillist (80 to 88): the list let go.
  async function leaveMailingList(listID: number): Promise<void> {
    if ((await mailingListWrite("Leave", [listID])) !== undefined) {
      store.apply({ type: "mail/lists", lists: (store.mail.get().lists ?? []).filter((each) => each.listID !== listID) });
    }
  }

  // DeleteMaillist (90 to 98), the owner's, after the window's DeleteMailingList dialog: the list let go. Its mails
  // stay, as the client's do.
  async function deleteMailingList(listID: number): Promise<void> {
    if ((await mailingListWrite("Delete", [listID])) !== undefined) {
      store.apply({ type: "mail/lists", lists: (store.mail.get().lists ?? []).filter((each) => each.listID !== listID) });
    }
  }

  // The list's management window (evemailingListConfig.py MaillistSetupWindow), an operator's or owner's: its reads
  // asked by the generic call each time the window asks them, as the service asks them (GetSettings 141 to 142,
  // GetMembers 105 to 108, which primes the members' names, as the page asks for them here).
  async function mailingListRead(method: string, listID: number): Promise<JsonValue> {
    try {
      return await bridgeAsk("mailingListsMgr", method, [listID]);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
  }

  // mailingListsSvc.GetDisplayName (55 to 66): a list joined, or one asked before, by its kept name; any other asked
  // of the server (GetInfo) and kept; none, the client's MailingListNoSuchList, said.
  async function mailingListName(listID: number): Promise<string | null> {
    const { lists, externalLists } = store.mail.get();
    const known = (lists ?? []).find((list) => list.listID === listID) ?? externalLists.find((list) => list.listID === listID);
    if (known !== undefined) {
      return known.displayName;
    }
    const answer = await mailingListRead("GetInfo", listID);
    const info = answer === null ? null : mailingListOf(answer);
    if (info === null) {
      const said = store.words.get().templates["dialog:MailingListNoSuchList/body"];
      store.apply({ type: "mail/action-error", message: typeof said === "string" ? said : "That mailing list cannot be found." });
      return null;
    }
    store.apply({ type: "mail/external-list", list: info });
    return info.displayName;
  }

  // A list's own mail is named by the list (mailSvc.py 213 to 217, 1139 to 1140): the lists service started for it
  // (its lists joined asked, mailingListsSvc.py 40 to 45), and a list not joined named by GetDisplayName.
  async function nameListSenders(): Promise<void> {
    const { messages, statuses } = store.mail.get();
    const automated = new Set(statuses.filter((status) => (status.statusMask & MAIL_STATUS_AUTOMATED) !== 0).map((status) => status.messageID));
    const listIDs = [...new Set(messages.filter((header) => automated.has(header.messageID) && header.toListID !== null && header.senderID === header.toListID).map((header) => header.senderID))];
    if (listIDs.length === 0) {
      return;
    }
    await loadMailingLists();
    for (const listID of listIDs) {
      await mailingListName(listID);
    }
  }

  async function readMailingListSettings(listID: number): Promise<MailingListSettings | null> {
    const settings = mailingListSettingsOf(await mailingListRead("GetSettings", listID));
    // UpdateAccessScrollData primes the owners let in or kept out (evemailingListConfig.py 438), and names each and
    // its kind from its row.
    if (settings !== null) {
      requestNames([...settings.access.keys()].flatMap((id) => [{ kind: "owner" as const, id }, { kind: "ownerGroup" as const, id }]));
    }
    return settings;
  }

  async function readMailingListMembers(listID: number): Promise<readonly MailingListMember[]> {
    const members = mailingListMembersOf(await mailingListRead("GetMembers", listID));
    requestNames(members.map((member) => ({ kind: "character", id: member.characterID })));
    return members;
  }

  // The Members tab's Apply (ApplyActionToMembers, 266 to 293): the members chosen, a list, and the list's number
  // (mailingListsSvc.py 100 to 135).
  async function setMailingListMembers(listID: number, memberIDs: readonly number[], action: MailingListMemberAction): Promise<boolean> {
    return (await mailingListWrite(MAILING_LIST_MEMBER_WRITES[action], [listID, [...memberIDs]])) !== undefined;
  }

  // The Access tab's writes (evemailingListConfig.py 302 to 326, 453 to 457; mailingListsSvc.py 110 to 139): Apply's
  // SetDefaultAccess with no cost; Allow's and Block's SetEntitiesAccess with the one entity's access; Remove
  // Selected's ClearEntityAccess, one entity a call.
  async function setMailingListDefaults(listID: number, defaultAccess: number, defaultMemberAccess: number): Promise<boolean> {
    return (await mailingListWrite("SetDefaultAccess", [listID, defaultAccess, defaultMemberAccess, 0])) !== undefined;
  }

  async function setMailingListAccess(listID: number, ownerID: number, access: number): Promise<boolean> {
    return (await mailingListWrite("SetEntitiesAccess", [listID, { [String(ownerID)]: access }])) !== undefined;
  }

  async function clearMailingListAccess(listID: number, ownerID: number): Promise<boolean> {
    return (await mailingListWrite("ClearEntityAccess", [listID, ownerID])) !== undefined;
  }

  // The Welcome Mail tab (evemailingListConfig.py 482 to 507; mailingListsSvc.py 182 to 193): GetWelcomeMail; Save's
  // SendWelcomeMail (the box ticked) or SaveWelcomeMail, the subject and the mail; or ClearWelcomeMail.
  async function readMailingListWelcome(listID: number): Promise<WelcomeMail | null> {
    return welcomeMailOf(await mailingListRead("GetWelcomeMail", listID));
  }

  async function saveMailingListWelcome(listID: number, title: string, body: string, toAll: boolean): Promise<boolean> {
    return (await mailingListWrite(toAll ? "SendWelcomeMail" : "SaveWelcomeMail", [listID, title, body])) !== undefined;
  }

  async function clearMailingListWelcome(listID: number): Promise<boolean> {
    return (await mailingListWrite("ClearWelcomeMail", [listID])) !== undefined;
  }

  // The tab's "send to all" box, as the client keeps it: in the user's settings on its machine, by the list
  // (evemailingListConfig.py 463, 476 to 480: settings.user.ui 'welcomeToAllCB_<listID>'). Kept in this browser, by
  // the list.
  function welcomeToAllKey(listID: number): string {
    return `evejs.mail.welcomeToAllCB_${listID}`;
  }

  function welcomeToAll(listID: number): boolean {
    try {
      return settingsStorage?.getItem(welcomeToAllKey(listID)) === "1";
    } catch {
      return false;
    }
  }

  function keepWelcomeToAll(listID: number, checked: boolean): void {
    try {
      settingsStorage?.setItem(welcomeToAllKey(listID), checked ? "1" : "0");
    } catch {
      // Storage full or refused: the box lasts as long as the page.
    }
  }

  // The mail list's sort, as the client keeps it in the user's settings (evemail.py 205 to 214, SortMail 910 to 917:
  // evemail_sortBy, a header but Labels, else Received; evemail_sortOrder, else True), kept in this browser.
  const MAIL_SORT_KEPT = "evejs.mail.sort";

  function mailSort(): { readonly by: MailSortKey; readonly reversed: boolean } {
    let kept: { by?: unknown; reversed?: unknown } | null = null;
    try {
      kept = JSON.parse(settingsStorage?.getItem(MAIL_SORT_KEPT) ?? "null") as { by?: unknown; reversed?: unknown } | null;
    } catch {
      kept = null;
    }
    const by = kept !== null && MAIL_SORT_KEYS.includes(kept.by as MailSortKey) ? (kept.by as MailSortKey) : "received";
    return { by, reversed: kept !== null && typeof kept.reversed === "boolean" ? kept.reversed : true };
  }

  function keepMailSort(by: MailSortKey, reversed: boolean): void {
    try {
      settingsStorage?.setItem(MAIL_SORT_KEPT, JSON.stringify({ by, reversed }));
    } catch {
      // Storage full or refused: the sort lasts as long as the page.
    }
  }

  // An owner search window's Search By, as the client keeps it in the user's settings (ownerSearch.py 81, 95 to
  // 97: ownersSearchBy, else partial terms), kept in this browser.
  const OWNERS_SEARCH_BY_KEPT = "evejs.search.ownersSearchBy";

  function ownersSearchBy(): number {
    let kept: unknown = null;
    try {
      kept = JSON.parse(settingsStorage?.getItem(OWNERS_SEARCH_BY_KEPT) ?? "null");
    } catch {
      kept = null;
    }
    return typeof kept === "number" && [0, 1, 2, 3].includes(kept) ? kept : 0;
  }

  function keepOwnersSearchBy(matchBy: number): void {
    try {
      settingsStorage?.setItem(OWNERS_SEARCH_BY_KEPT, JSON.stringify(matchBy));
    } catch {
      // Storage full or refused: the choice lasts as long as the page.
    }
  }

  // The Contacts window's last group viewed, as the client keeps it in the character's settings
  // (contactsForm.py 267 to 274, 424: contacts_lastselected), kept in this browser for each character.
  const CONTACTS_LAST_SELECTED_KEPT = "evejs.contacts.lastselected";

  function contactsLastSelected(): number | string | null {
    const characterID = store.station.get().online?.characterID ?? null;
    let kept: unknown = null;
    try {
      kept = characterID === null ? null : JSON.parse(settingsStorage?.getItem(`${CONTACTS_LAST_SELECTED_KEPT}.${characterID}`) ?? "null");
    } catch {
      kept = null;
    }
    return (typeof kept === "number" && Number.isSafeInteger(kept)) || typeof kept === "string" ? kept : null;
  }

  function keepContactsLastSelected(groupID: number | string): void {
    const characterID = store.station.get().online?.characterID ?? null;
    if (characterID === null) {
      return;
    }
    try {
      settingsStorage?.setItem(`${CONTACTS_LAST_SELECTED_KEPT}.${characterID}`, JSON.stringify(groupID));
    } catch {
      // Storage full or refused: the group lasts as long as the page.
    }
  }

  // The Agents tab's folders, as the client's registry keeps them for the character (registry.py 431 to 540:
  // settings.char.ui 'listgroups'), kept in this browser for the pilot online.
  const AGENT_FOLDERS_KEPT = "evejs.contacts.agentgroups";

  function agentFolders(): AgentFolders {
    const characterID = store.station.get().online?.characterID ?? null;
    let kept: unknown = null;
    try {
      kept = characterID === null ? null : JSON.parse(settingsStorage?.getItem(`${AGENT_FOLDERS_KEPT}.${characterID}`) ?? "null");
    } catch {
      kept = null;
    }
    return agentFoldersOf(kept);
  }

  function keepAgentFolders(folders: AgentFolders): void {
    const characterID = store.station.get().online?.characterID ?? null;
    if (characterID === null) {
      return;
    }
    try {
      settingsStorage?.setItem(`${AGENT_FOLDERS_KEPT}.${characterID}`, JSON.stringify(folders));
    } catch {
      // Storage full or refused: the folders last as long as the page.
    }
  }

  // The Search tab's Search Type and Search By, as the client keeps them for the character (addressBookWindow.py
  // 319 to 320: CharSettingEnum contacts_window_search_type, Any by default; contacts_window_search_by, Partial Terms),
  // kept in this browser for the pilot online.
  const CONTACTS_SEARCH_KEPT = "evejs.contacts.search";

  function contactsSearchSettings(): { readonly searchType: number; readonly searchBy: number } {
    const characterID = store.station.get().online?.characterID ?? null;
    let kept: unknown = null;
    try {
      kept = characterID === null ? null : JSON.parse(settingsStorage?.getItem(`${CONTACTS_SEARCH_KEPT}.${characterID}`) ?? "null");
    } catch {
      kept = null;
    }
    const held = typeof kept === "object" && kept !== null ? (kept as { searchType?: unknown; searchBy?: unknown }) : {};
    const inRange = (value: unknown, top: number, fallback: number): number => (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= top ? (value as number) : fallback);
    return { searchType: inRange(held.searchType, 5, 0), searchBy: inRange(held.searchBy, 3, 0) };
  }

  function keepContactsSearchSettings(settings: { readonly searchType: number; readonly searchBy: number }): void {
    const characterID = store.station.get().online?.characterID ?? null;
    if (characterID === null) {
      return;
    }
    try {
      settingsStorage?.setItem(`${CONTACTS_SEARCH_KEPT}.${characterID}`, JSON.stringify(settings));
    } catch {
      // Storage full or refused: the settings last as long as the page.
    }
  }

  // The People & Places window's tab last chosen, as the client's tab group keeps it in the user's settings
  // (addressBookWindow.py 76 to 92: tabgroups 'addressbookpanel', AutoSelect), kept in this browser.
  const ADDRESS_BOOK_TAB_KEPT = "evejs.contacts.addressbookpanel";

  function addressBookTab(): string | null {
    try {
      const kept: unknown = JSON.parse(settingsStorage?.getItem(ADDRESS_BOOK_TAB_KEPT) ?? "null");
      return typeof kept === "string" ? kept : null;
    } catch {
      return null;
    }
  }

  function keepAddressBookTab(tab: string): void {
    try {
      settingsStorage?.setItem(ADDRESS_BOOK_TAB_KEPT, JSON.stringify(tab));
    } catch {
      // Storage full or refused: the tab lasts as long as the page.
    }
  }

  // The Contacts window's "Online only", as the client keeps it in the user's settings (contactsForm.py 136, 523 to
  // 526: onlinebuddyonly), kept in this browser.
  const ONLINE_BUDDY_ONLY_KEPT = "evejs.contacts.onlinebuddyonly";

  function onlineBuddyOnly(): boolean {
    try {
      return JSON.parse(settingsStorage?.getItem(ONLINE_BUDDY_ONLY_KEPT) ?? "false") === true;
    } catch {
      return false;
    }
  }

  function keepOnlineBuddyOnly(checked: boolean): void {
    try {
      settingsStorage?.setItem(ONLINE_BUDDY_ONLY_KEPT, JSON.stringify(checked));
    } catch {
      // Storage full or refused: the choice lasts as long as the page.
    }
  }

  // addressbook.GetContacts (addressbookService.py 193 to 250) for the Contacts window: charMgr.GetContactList() by
  // the generic call, every contact and blocked owner named as the client primes them (cfg.eveowners, 240 to 244).
  async function addressBook(): Promise<NamedAddressBook> {
    let answer: JsonValue;
    try {
      answer = await bridgeAsk("charMgr", "GetContactList", []);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
    const book = addressBookOf(answer);
    // GetContactLabels('contact') (1022 to 1044): the labels, asked as the form first shows them, and kept (on the
    // game port by the transport). A label not read leaves the form without its labels.
    const labels = await bridgeAsk("charMgr", "GetLabels", []).then(contactLabelsOf, () => null);
    await resolveNamesNow([
      ...[...book.contacts.map((contact) => contact.contactID), ...book.blocked].map((id) => ({ kind: "owner" as const, id })),
      ...book.agents.map((id) => ({ kind: "agent" as const, id })),
    ]);
    const resolved = store.names.get().resolved;
    const nameOf = (id: number, kind: "owner" | "agent" = "owner"): string => {
      const name = resolved[nameKey(kind, id)];
      return typeof name === "string" && name !== "" ? name : String(id);
    };
    return {
      contacts: book.contacts.map((contact) => ({ ...contact, name: nameOf(contact.contactID) })),
      blocked: book.blocked.map((ownerID) => ({ ownerID, name: nameOf(ownerID) })),
      labels,
      agents: book.agents.map((agentID) => ({ agentID, name: nameOf(agentID, "agent") })),
    };
  }

  // The client's online status service (comtool/onlineStatus.py): Prime (74 to 82) asks GetInitialState once and
  // keeps it by contact, on the game port answered from what the transport keeps; OnContactLoggedOn and
  // OnContactLoggedOff (26 to 34) prime it where it is not and set the one named.
  let onlinePriming: Promise<void> | null = null;
  function primeContactsOnline(): Promise<void> {
    if (store.addressBook.get().online !== null) {
      return Promise.resolve();
    }
    onlinePriming ??= (async () => {
      try {
        const answer = await bridgeAsk("onlineStatus", "GetInitialState", []);
        store.apply({ type: "address-book/online-primed", online: onlineStatesOf(answer) });
      } finally {
        onlinePriming = null;
      }
    })();
    return onlinePriming;
  }

  // The address book's writes (addressbookService.py 645 to 869), each a page write by the generic call; a refusal
  // told in the server's words, as the mail's are.
  async function contactWrite(method: string, args: readonly JsonValue[]): Promise<JsonValue> {
    try {
      return await bridgeDo("charMgr", method, [...args]);
    } catch (error) {
      throwIfRequestRetired(error);
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      throw new Error(mailRefusalMessage(error));
    }
  }

  // AddToAddressBook (705 to 816): AddContact, or EditContact for a contact the pilot has, with the standing, the
  // buddy list's box, the notification's and the message as the window's editor gives it (its markup). A character
  // put on the buddy list has its online state asked where the service keeps none (GetOnlineStatus, fetch: 806 to
  // 811; onlineStatus.py 42 to 51).
  async function addOrEditContact(contact: ContactWrite, edit: boolean): Promise<void> {
    await contactWrite(edit ? "EditContact" : "AddContact", [
      contact.contactID, contact.relationshipID, contact.inWatchlist, contact.sendNotification, mailMarkupOfTyped(contact.message),
    ]);
    const online = store.addressBook.get().online;
    if (contact.inWatchlist && contact.isCharacter && online !== null && online[contact.contactID] === undefined) {
      const answer = await bridgeAsk("onlineStatus", "GetOnlineStatus", [contact.contactID]).catch(() => null);
      if (typeof answer === "boolean") {
        store.apply({ type: "address-book/online-changed", contactID: contact.contactID, online: answer });
      }
    }
  }

  // RemoveFromAddressBook (817 to 869), after its question: DeleteContacts with the contacts, a list.
  async function deleteContacts(contactIDs: readonly number[]): Promise<void> {
    await contactWrite("DeleteContacts", [[...contactIDs]]);
  }

  // BlockOwner (645 to 664) and UnblockOwner (666 to 677): BlockOwners([ownerID]), UnblockOwners(blocked), lists.
  async function blockOwners(ownerIDs: readonly number[]): Promise<void> {
    await contactWrite("BlockOwners", [[...ownerIDs]]);
  }

  async function unblockOwners(ownerIDs: readonly number[]): Promise<void> {
    await contactWrite("UnblockOwners", [[...ownerIDs]]);
  }

  // EditContacts (682 to 703), from the window that edits several: EditContactsRelationshipID with the contacts, a
  // list, and the standing chosen.
  async function editContactsRelationship(contactIDs: readonly number[], relationshipID: number): Promise<void> {
    await contactWrite("EditContactsRelationshipID", [[...contactIDs], relationshipID]);
  }

  // notificationSvc.GetFormattedNotifications(groupContacts) for the Contacts tab's Notifications group
  // (notificationSvc.py 138 to 141; GetNotificationsByGroupID, 60 to 73): notificationMgr.GetByGroupID(9), which the
  // client's service keeps (on the game port the transport keeps it, until a notice or the pilot's own write changes
  // it); those of a type in communications; their senders named (mailSvc.PrimeOwners).
  async function contactNotifications(): Promise<readonly Notification[]> {
    return notificationsOfGroup(CONTACTS_NOTIFICATION_GROUP, false);
  }

  // The notification window's lists (neocom/notifications.py LoadGroupFromNode, 159 to 169): for the Unread group
  // notificationSvc.GetUnreadNotifications (103 to 122: GetUnprocessed()), for any other GetNotificationsByGroupID
  // (60 to 73: GetByGroupID(groupID)); each keeps those of a type in communications (IsTypeInCommunications) and
  // primes their senders' names (mailSvc.PrimeOwners). A sender of -1 is the EVE System (const.ownerSystem, LoadGroupFromNode 176 to 177).
  async function notificationsOfGroup(groupID: number, unread: boolean): Promise<readonly Notification[]> {
    let answer: JsonValue;
    try {
      answer = unread
        ? await bridgeAsk("notificationMgr", "GetUnprocessed", [])
        : await bridgeAsk("notificationMgr", "GetByGroupID", [groupID]);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
    const found = decodeNotifications(isListValue(answer) ? answer.items : answer).filter((notification) => isCommunicationType(notification.typeID));
    const senders = new Set(found.map((notification) => (notification.senderID === -1 ? OWNER_SYSTEM : notification.senderID)).filter((id) => id > 0));
    await resolveNamesNow([...senders].map((id) => ({ kind: "owner" as const, id })));
    return found;
  }

  // A write of the notification window's: the server's refusal said in its words.
  async function notificationWrite(method: string, args: JsonValue[]): Promise<void> {
    try {
      await bridgeDo("notificationMgr", method, args);
    } catch (error) {
      throwIfRequestRetired(error);
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      throw new Error(mailRefusalMessage(error));
    }
  }

  // notificationSvc.DeleteNotifications (312 to 321): DeleteNotifications with the notifications, a list.
  async function deleteNotifications(notificationIDs: readonly number[]): Promise<void> {
    await notificationWrite("DeleteNotifications", [[...notificationIDs]]);
  }

  // notificationSvc.MarkAsRead (241 to 260): MarkAsProcessed with the notifications, a list (Tranquility's recording
  // of a notification read: MarkAsProcessed([notificationID])).
  async function markNotificationsRead(notificationIDs: readonly number[]): Promise<void> {
    await notificationWrite("MarkAsProcessed", [[...notificationIDs]]);
  }

  // notificationSvc.MarkAllReadInGroup (213 to 227): MarkGroupAsProcessed with the group.
  async function markNotificationGroupRead(groupID: number): Promise<void> {
    await notificationWrite("MarkGroupAsProcessed", [groupID]);
  }

  // notificationSvc.MarkAllRead (229 to 239): MarkAllAsProcessed, with nothing.
  async function markAllNotificationsRead(): Promise<void> {
    await notificationWrite("MarkAllAsProcessed", []);
  }

  // notificationSvc.DeleteAllFromGroup (287 to 298): DeleteGroupNotifications with the group.
  async function deleteNotificationGroup(groupID: number): Promise<void> {
    await notificationWrite("DeleteGroupNotifications", [groupID]);
  }

  // notificationSvc.DeleteAll (300 to 310): DeleteAllNotifications, with nothing.
  async function deleteAllNotifications(): Promise<void> {
    await notificationWrite("DeleteAllNotifications", []);
  }

  // A dialog's answer kept, as the client keeps it in the user's settings (player_messaging/client/__init__.py 41 to
  // 47: settings.user.suppress, 'suppress.' and the dialog's name; dialog_handler.py _persist_prompt_suppress_choice),
  // kept in this browser. Only Yes is kept here, the page asking only the dialogs the client asks with
  // suppress=ID_YES (bridge/dialogSuppression.ts).
  const DIALOG_ANSWER_KEPT = "evejs.suppress.";

  function dialogYesKept(dialog: string): boolean {
    try {
      return settingsStorage?.getItem(`${DIALOG_ANSWER_KEPT}${dialog}`) === "yes";
    } catch {
      return false;
    }
  }

  function keepDialogYes(dialog: string): void {
    try {
      settingsStorage?.setItem(`${DIALOG_ANSWER_KEPT}${dialog}`, "yes");
    } catch {
      // Storage full or refused: the dialog is asked again.
    }
  }

  // The notification window's group last shown, as the client keeps it in the character's settings
  // (neocom/notifications.py 161: settings.char.ui 'mail_lastnotification'), kept in this browser for the pilot.
  const NOTIFICATION_GROUP_KEPT = "evejs.mail.lastnotification";

  function notificationGroupShown(): number | null {
    const characterID = store.character.get().selectedCharacterID;
    try {
      const kept: unknown = JSON.parse(settingsStorage?.getItem(NOTIFICATION_GROUP_KEPT) ?? "null");
      const shown = kept !== null && typeof kept === "object" ? (kept as Record<string, unknown>)[String(characterID)] : undefined;
      return typeof shown === "number" && Number.isSafeInteger(shown) ? shown : null;
    } catch {
      return null;
    }
  }

  function keepNotificationGroupShown(groupID: number): void {
    const characterID = store.character.get().selectedCharacterID;
    try {
      const kept: unknown = JSON.parse(settingsStorage?.getItem(NOTIFICATION_GROUP_KEPT) ?? "null");
      const byPilot = kept !== null && typeof kept === "object" ? { ...(kept as Record<string, unknown>) } : {};
      byPilot[String(characterID)] = groupID;
      settingsStorage?.setItem(NOTIFICATION_GROUP_KEPT, JSON.stringify(byPilot));
    } catch {
      // Storage full or refused: the group lasts as long as the page.
    }
  }

  // AddToAddressBook for an agent (addressbookService.py 732 to 735): AddContact with the agent and nothing else.
  async function addAgentToAddressBook(agentID: number): Promise<void> {
    await contactWrite("AddContact", [agentID]);
  }

  // GetResultsByGroupID (searchUtil.py 274 to 282) for the People & Places window's Search tab: the search service's
  // Query with the text, the result types, a list, and Search By as `exact`; the owners found named as the client
  // primes them (_PrimeOwners: cfg.eveowners, an agent by the agents' names), and each kind's sorted by name as
  // _SortResults sorts them (285 to 294: by the name's characters).
  async function searchOwners(text: string, resultTypes: readonly number[], matchBy: number): Promise<ReadonlyMap<number, readonly { readonly id: number; readonly name: string }[]>> {
    let answer: JsonValue;
    try {
      answer = await bridgeAsk("search", "Query", [text, [...resultTypes]], { exact: matchBy });
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
    const AGENT = 1;
    const found = new Map<number, number[]>();
    for (const [key, value] of readDictPairs(answer)) {
      const resultType = Number(key);
      const items = isListValue(value) ? value.items : Array.isArray(value) ? value : [];
      const ids = [...new Set(items.map((item) => Number(item)).filter((id) => Number.isSafeInteger(id) && id > 0))];
      if (Number.isSafeInteger(resultType)) found.set(resultType, ids);
    }
    const kindOf = (resultType: number): "agent" | "owner" => (resultType === AGENT ? "agent" : "owner");
    await resolveNamesNow([...found].flatMap(([resultType, ids]) => ids.map((id) => ({ kind: kindOf(resultType), id }))));
    const resolved = store.names.get().resolved;
    return new Map([...found].map(([resultType, ids]) => [resultType, ids
      .map((id) => {
        const name = resolved[nameKey(kindOf(resultType), id)];
        return { id, name: typeof name === "string" && name !== "" ? name : String(id) };
      })
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))]));
  }

  // The contact labels' writes (1001 to 1147): CreateLabel(name, None), answered the label's bit; EditLabel(labelID,
  // name, None), a rename; DeleteLabel(labelID), after which the client lets its labels go and asks them again
  // (1074 to 1084); AssignLabels and RemoveLabels(contactIDs, labelID), the contacts a list.
  async function createContactLabel(name: string): Promise<bigint | null> {
    return createdLabelOf(await contactWrite("CreateLabel", [name, null]));
  }

  async function renameContactLabel(labelID: bigint, name: string): Promise<void> {
    await contactWrite("EditLabel", [labelBitsSent(labelID), name, null]);
  }

  async function deleteContactLabel(labelID: bigint): Promise<readonly ContactLabel[] | null> {
    await contactWrite("DeleteLabel", [labelBitsSent(labelID)]);
    return bridgeAsk("charMgr", "GetLabels", []).then(contactLabelsOf, () => null);
  }

  async function labelContacts(contactIDs: readonly number[], bits: bigint, give: boolean): Promise<void> {
    await contactWrite(give ? "AssignLabels" : "RemoveLabels", [[...contactIDs], labelBitsSent(bits)]);
  }

  function contactLoggedOnOrOff(method: string | null, args: readonly unknown[]): void {
    if (method !== "OnContactLoggedOn" && method !== "OnContactLoggedOff") {
      return;
    }
    const contactID = Number(args[0]);
    if (!Number.isSafeInteger(contactID) || contactID <= 0) {
      return;
    }
    const online = method === "OnContactLoggedOn";
    void primeContactsOnline().then(
      () => store.apply({ type: "address-book/online-changed", contactID, online }),
      () => {},
    );
  }

  // addressbook.GetContacts (addressbookService.py 193 to 250): charMgr.GetContactList(), by the generic call (on
  // the game port answered from what the transport keeps, as the client's address book keeps it); the contacts
  // that are characters and not NPCs (the compose window's buddies, evemail.py 1782; the search window's All
  // Contacts, ownerSearch.py 190 to 204), named as the client primes them (cfg.eveowners), in the address book's
  // order. A contact that names as no character is a corporation's or an alliance's.
  async function mailContacts(): Promise<readonly api.CharacterMatch[]> {
    let answer: JsonValue;
    try {
      answer = await bridgeAsk("charMgr", "GetContactList", []);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
    const ids = addressBookOf(answer).contacts.map((contact) => contact.contactID).filter((id) => !isNpcOwner(id));
    await resolveNamesNow(ids.map((id) => ({ kind: "character" as const, id })));
    const resolved = store.names.get().resolved;
    return ids.flatMap((id) => {
      const name = resolved[nameKey("character", id)];
      return typeof name === "string" && name !== "" ? [{ characterID: id, name }] : [];
    });
  }

  // searchOld.Search for a pilot (searchOld.py 80 to 190; searchUtil.GetResultsList, 297 to 301): the search
  // service's QuickQuery with the text, characters only (ResultType.character, no agents with hideNPC), the keywords
  // as the client writes them; the pilots found named as the client primes them (cfg.eveowners).
  async function searchCharacters(text: string, matchBy: number): Promise<readonly api.CharacterMatch[]> {
    let answer: JsonValue;
    try {
      answer = await bridgeAsk("search", "QuickQuery", [text, [2]], { hideNPC: 1, onlyAltName: 0, exact: matchBy });
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
    const items = isListValue(answer) ? answer.items : Array.isArray(answer) ? answer : [];
    const ids = [...new Set(items.map((item) => Number(item)).filter((id) => Number.isSafeInteger(id) && id > 0))];
    await resolveNamesNow(ids.map((id) => ({ kind: "character" as const, id })));
    const resolved = store.names.get().resolved;
    return ids.flatMap((id) => {
      const name = resolved[nameKey("character", id)];
      return typeof name === "string" && name !== "" ? [{ characterID: id, name }] : [];
    });
  }

  async function ownCorporation(): Promise<{ readonly corporationID: number; readonly name: string } | null> {
    const corporationID = store.station.get().online?.corporationID ?? null;
    if (corporationID === null || !(corporationID > 0)) {
      return null;
    }
    await resolveNamesNow([{ kind: "corporation", id: corporationID }]);
    const name = store.names.get().resolved[nameKey("corporation", corporationID)];
    return typeof name === "string" && name !== "" ? { corporationID, name } : null;
  }

  async function ownAlliance(): Promise<{ readonly allianceID: number; readonly name: string } | null> {
    const allianceID = store.station.get().online?.allianceID ?? null;
    if (allianceID === null || !(allianceID > 0)) {
      return null;
    }
    await resolveNamesNow([{ kind: "alliance", id: allianceID }]);
    const name = store.names.get().resolved[nameKey("alliance", allianceID)];
    return typeof name === "string" && name !== "" ? { allianceID, name } : null;
  }

  // SearchOwners with hideNPC (searchOld.py 258 to 259): lookupSvc.LookupPCOwners(searchStr, exact), exact False as
  // the mailing list window asks it.
  async function lookupPlayerOwners(text: string): Promise<readonly OwnerMatch[]> {
    try {
      return ownerMatchesOf(await bridgeAsk("lookupSvc", "LookupPCOwners", [text, false]));
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
  }

  // mailSvc.GetLabels (676 to 679): the pilot's labels, asked once as the mail window first draws its folders
  // (evemail.py LoadLeftSide, by GetAllLabels), by the generic call, and kept for the character.
  async function loadMailLabels(): Promise<void> {
    if (store.mail.get().labels !== null) {
      return;
    }
    try {
      const answer = await bridgeAsk("mailMgr", "GetLabels", []);
      store.apply({ type: "mail/labels", labels: mailLabelsOf(answer) });
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
  }

  // mailSvc.GetReplyMessage asks the service's GetBody, which marks a message not read read.
  async function quotedMailBody(messageID: number): Promise<string | null> {
    // GetReplyMessage (1077 to 1083): the receivers first, a list among them named (GetReceiverText), then the body.
    const toListID = store.mail.get().messages.find((header) => header.messageID === messageID)?.toListID ?? null;
    if (toListID !== null) {
      await mailingListName(toListID);
    }
    const unread = store.mail.get().statuses.some((status) => status.messageID === messageID && !status.read);
    const body = await mailBodyRead(messageID, unread);
    return body === null ? null : body.unreadable ? "" : (body.text ?? "");
  }

  async function openMail(messageID: number, markRead: boolean): Promise<void> {
    const body = await mailBodyRead(messageID, markRead);
    if (body === null) {
      return;
    }
    store.apply({
      type: "mail/opened",
      open: {
        messageID,
        body: body.text,
        unreadable: body.unreadable,
        // Read as the mailbox kept now holds it: marked just now, or read before.
        markedRead: store.mail.get().statuses.find((status) => status.messageID === messageID)?.read ?? null,
      },
    });
    // GetMailText (1062 to 1076): the receivers written after the body is had, a list among them named.
    const toListID = store.mail.get().messages.find((header) => header.messageID === messageID)?.toListID ?? null;
    if (toListID !== null) {
      await mailingListName(toListID);
    }
  }

  // The mail window's writes of a message (evemail.py GetMsgMenu, 925 to 970; mailSvc.py 292 to 348, 478 to 491):
  // the mail manager asked with the messages, a list, by the generic call; what is kept changed as the client
  // changes it, nothing read again; a message open that leaves the folder it is in closed. True where it was done.
  async function mailWrite(method: string, messageIDs: readonly number[], after: (mailbox: DecodedMailbox) => DecodedMailbox, closes: boolean): Promise<boolean> {
    return mailCall(method, [[...messageIDs]], after, closes ? messageIDs : []);
  }

  // A write of the mail manager's with its own arguments: what is kept changed as the client changes it, and the
  // message open closed where it is among those that leave their folder. True where it was done.
  async function mailCall(method: string, args: readonly JsonValue[], after: (mailbox: DecodedMailbox) => DecodedMailbox, closing: readonly number[]): Promise<boolean> {
    try {
      await bridgeDo("mailMgr", method, [...args]);
    } catch (error) {
      throwIfRequestRetired(error);
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "mail/action-error", message: mailRefusalMessage(error) });
      return false;
    }
    mailboxLoaded(after(store.mail.get()));
    const open = store.mail.get().open;
    if (open !== null && closing.includes(open.messageID)) {
      closeMail();
    }
    return true;
  }

  // The mail window's writes of a folder (evemail.py StaticMenu, 1084 to 1160; mailSvc.py 350 to 476), each asked
  // to be sure of by the window before it comes here: the mail manager asked with nothing, or with the folder's
  // label, and what is kept changed as the client's service changes it.
  async function readAllMail(labelID: number | null): Promise<void> {
    await mailCall(labelID === null ? "MarkAllAsRead" : "MarkAsReadByLabel", labelID === null ? [] : [labelID], (mailbox) => mailboxAllRead(mailbox, labelID), []);
  }

  async function trashAllMail(labelID: number | null): Promise<void> {
    const leaving = store.mail.get().statuses.filter((status) => labelID === null || (status.labelMask & labelID) === labelID).map((status) => status.messageID);
    await mailCall(labelID === null ? "MoveAllToTrash" : "MoveToTrashByLabel", labelID === null ? [] : [labelID], (mailbox) => mailboxAllTrashed(mailbox, labelID), leaving);
  }

  // A mailing list's own (evemail.py MaillistMenu 545 to 549; 1145 to 1161), each asked to be sure of by the
  // window: the mail manager asked with the list, and the mails to it, not trashed, read (mailSvc.py 437 to 445), or
  // every mail to it trashed (371 to 380).
  async function readListMail(listID: number): Promise<void> {
    await mailCall("MarkAsReadByList", [listID], (mailbox) => mailboxListRead(mailbox, listID), []);
  }

  async function trashListMail(listID: number): Promise<void> {
    const leaving = store.mail.get().messages.filter((header) => header.toListID === listID).map((header) => header.messageID);
    await mailCall("MoveToTrashByList", [listID], (mailbox) => mailboxListTrashed(mailbox, listID), leaving);
  }

  async function restoreAllMail(): Promise<void> {
    const leaving = store.mail.get().statuses.map((status) => status.messageID);
    await mailCall("MoveAllFromTrash", [], mailboxAllRestored, leaving);
  }

  // EmptyTrash (458 to 476): the bodies kept of the messages deleted let go with them.
  async function emptyMailTrash(): Promise<void> {
    const { gone } = mailboxTrashEmptied(store.mail.get());
    if (await mailCall("EmptyTrash", [], (mailbox) => mailboxTrashEmptied(mailbox).mailbox, gone)) {
      const characterID = store.station.get().online?.characterID ?? 0;
      for (const messageID of gone) {
        mailBodies.delete(`${characterID}:${messageID}`);
      }
    }
  }

  // The mail labels' writes (mailSvc.py 711 to 807): the mail manager asked by the generic call, and the labels and
  // the mailbox kept changed as the client's service changes them.
  async function createMailLabel(name: string): Promise<number | null> {
    let answer: JsonValue;
    try {
      answer = await bridgeDo("mailMgr", "CreateLabel", [name, null]);
    } catch (error) {
      throwIfRequestRetired(error);
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "mail/action-error", message: mailRefusalMessage(error) });
      return null;
    }
    // AddLabel (727 to 730): the label kept, by the bit the server answered.
    const labelID = Number(answer);
    if (!Number.isSafeInteger(labelID) || labelID <= 0) {
      return null;
    }
    const kept = store.mail.get().labels ?? [];
    store.apply({ type: "mail/labels", labels: [...kept.filter((label) => label.labelID !== labelID), { labelID, name, color: 0 }] });
    return labelID;
  }

  async function renameMailLabel(labelID: number, name: string): Promise<void> {
    if (await mailCall("EditLabel", [labelID, name, null], (mailbox) => mailbox, [])) {
      const kept = store.mail.get().labels ?? [];
      store.apply({ type: "mail/labels", labels: kept.map((label) => (label.labelID === labelID ? { ...label, name } : label)) });
    }
  }

  async function deleteMailLabel(labelID: number): Promise<void> {
    if (await mailCall("DeleteLabel", [labelID], (mailbox) => mailboxLabelDropped(mailbox, labelID), [])) {
      store.apply({ type: "mail/labels", labels: (store.mail.get().labels ?? []).filter((label) => label.labelID !== labelID) });
    }
  }

  async function assignMailLabel(messageIDs: readonly number[], labelID: number): Promise<number> {
    const { changed } = mailboxLabelAssigned(store.mail.get(), messageIDs, labelID);
    if (changed.length === 0) {
      return 0;
    }
    const done = await mailCall("AssignLabels", [[...changed], labelID], (mailbox) => mailboxLabelAssigned(mailbox, changed, labelID).mailbox, []);
    return done ? changed.length : 0;
  }

  async function removeMailLabel(messageIDs: readonly number[], labelID: number): Promise<number> {
    const { changed } = mailboxLabelRemoved(store.mail.get(), messageIDs, labelID);
    if (changed.length === 0) {
      return 0;
    }
    const done = await mailCall("RemoveLabels", [[...changed], labelID], (mailbox) => mailboxLabelRemoved(mailbox, changed, labelID).mailbox, []);
    return done ? changed.length : 0;
  }

  async function markMail(messageIDs: readonly number[], read: boolean): Promise<void> {
    await mailWrite(read ? "MarkAsRead" : "MarkAsUnread", messageIDs, (mailbox) => (read ? mailboxMarkedRead(mailbox, messageIDs) : mailboxMarkedUnread(mailbox, messageIDs)), false);
  }

  async function trashMail(messageIDs: readonly number[]): Promise<void> {
    await mailWrite("MoveToTrash", messageIDs, (mailbox) => mailboxTrashed(mailbox, messageIDs), true);
  }

  async function restoreMail(messageIDs: readonly number[]): Promise<void> {
    await mailWrite("MoveFromTrash", messageIDs, (mailbox) => mailboxRestored(mailbox, messageIDs), true);
  }

  // DeleteMails (478 to 491): the bodies kept of the messages let go with them.
  async function deleteMail(messageIDs: readonly number[]): Promise<void> {
    if (await mailWrite("DeleteMail", messageIDs, (mailbox) => mailboxDeleted(mailbox, messageIDs), true)) {
      const characterID = store.station.get().online?.characterID ?? 0;
      for (const messageID of messageIDs) {
        mailBodies.delete(`${characterID}:${messageID}`);
      }
    }
  }

  function closeMail(): void {
    store.apply({ type: "mail/opened", open: null });
  }

  // --- R17 Contracts --------------------------------------------------------

  async function loadContracts(page: number): Promise<void> {
    let reads: Awaited<ReturnType<typeof api.loadContracts>>;
    try {
      reads = await api.loadContracts(page, callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
    const browse = decodeContractSearch(reads.browse.result);
    const outstanding = decodeContractList(reads.outstanding.result);
    const accepted = decodeContractList(reads.accepted.result);
    const expired = decodeContractList(reads.expired.result);
    // Each assigned contract arrives as a full GetContract BUNDLE, not a list
    // row — the panel only needs the row, but the detail decoder is what reads
    // that bundle's packed shape correctly.
    const assigned = reads.assigned.results
      .map((bundle) => decodeContractDetail(bundle))
      .filter((detail): detail is ContractDetail => detail !== null)
      .map((detail) => detail.contract);

    store.apply({
      type: "contracts/loaded",
      browse: browse.contracts,
      numFound: browse.numFound,
      page: reads.page,
      pageSize: reads.pageSize,
      outstanding,
      accepted,
      expired,
      assigned,
      // The BFF's count, not this list's length: the two differ exactly when
      // the fan-out was cut short, which is the one case worth saying out loud.
      numAssigned: reads.assigned.numAssigned,
      summary: reads.summary.error ? null : decodeContractSummary(reads.summary.result),
      browseError: reads.browse.error,
      // The player's own contracts come from three reads; any one failing
      // means the "yours" view is incomplete.
      mineError: reads.outstanding.error || reads.accepted.error || reads.expired.error,
      assignedError: reads.assigned.error,
      worldHasNoContracts: reads.worldHasNoContracts,
    });

    // Every ID the panel will show, resolved to a NAME (R7d). A contract is
    // issued by someone, runs between two stations in two systems, and may be
    // reserved for or taken by someone.
    const refs: NameRef[] = [];
    for (const row of [...browse.contracts, ...outstanding, ...accepted, ...expired, ...assigned]) {
      refs.push({ kind: "character", id: row.issuerID });
      refs.push({ kind: "corporation", id: row.issuerCorpID });
      refs.push({ kind: "station", id: row.startStationID });
      refs.push({ kind: "station", id: row.endStationID });
      refs.push({ kind: "system", id: row.startSolarSystemID });
      refs.push({ kind: "system", id: row.endSolarSystemID });
      if (row.assigneeID !== null) {
        refs.push({ kind: "owner", id: row.assigneeID });
      }
      if (row.acceptorID !== null) {
        refs.push({ kind: "owner", id: row.acceptorID });
      }
    }
    requestNames(refs);
  }

  async function openContract(contractID: number): Promise<void> {
    let raw: Awaited<ReturnType<typeof api.loadContractDetail>>;
    try {
      raw = await api.loadContractDetail(contractID, callOptions);
    } catch (error) {
      throwIfRequestRetired(error);
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "contracts/detail-error", message: contractRefusalMessage(error) });
      return;
    }
    const detail = decodeContractDetail(raw);
    store.apply({ type: "contracts/detail", detail });
    if (detail) {
      // The item types and the route endpoints all render as NAMES.
      const refs: NameRef[] = [
        { kind: "station", id: detail.contract.startStationID },
        { kind: "station", id: detail.contract.endStationID },
        { kind: "system", id: detail.startSolarSystemID },
        { kind: "system", id: detail.endSolarSystemID },
        { kind: "character", id: detail.contract.issuerID },
      ];
      for (const item of detail.items) {
        refs.push({ kind: "type", id: item.typeID });
      }
      requestNames(refs);
    }
  }

  function closeContract(): void {
    store.apply({ type: "contracts/detail", detail: null });
  }

  async function acceptContract(contractID: number): Promise<void> {
    store.apply({ type: "contracts/accepting", contractID });
    let accepted: number;
    try {
      // The details window's Accept, as the client's contracts service makes it (bridge/contractWrites.ts): for
      // the character, never for the corporation, whose roles this page is not told.
      accepted = await acceptContractCall(bridgeDo, contractID, false);
    } catch (error) {
      throwIfRequestRetired(error);
      store.apply({ type: "contracts/accepting", contractID: null });
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      // ⚠ THE SERVER'S OWN WORDS. A refusal here is specific and actionable
      // — not enough ISK, no room for the cargo, someone else took it first —
      // and rewording it into a house sentence would throw that away.
      store.apply({
        type: "contracts/accept-error",
        message: contractRefusalMessage(error),
      });
      return;
    }

    // ⚠ A 200 IS NOT PROOF. AcceptContract answers the accepted contract ROW,
    // and null when the settlement did not go through — an ack with no contract
    // in it is a decline, and saying "taken on" there would be a lie the very
    // next reload contradicts.
    if (accepted <= 0) {
      store.apply({ type: "contracts/accepting", contractID: null });
      store.apply({
        type: "contracts/accept-error",
        message: "That contract was not taken on. Nothing was transferred.",
      });
      return;
    }
    store.apply({ type: "contracts/accepted", contractID: accepted });

    // The lists and every count in the summary have all moved; reload rather
    // than guess at the new shape. The detail pane is reopened so the player
    // sees the contract they now hold, with its status changed.
    try {
      await loadContracts(store.contracts.get().page);
      await openContract(accepted);
    } finally {
      store.apply({ type: "contracts/accepting", contractID: null });
    }
  }

  // --- R37 Personal Assets --------------------------------------------------

  async function loadPersonalAssets(): Promise<void> {
    let read: AssetStationsRead;
    try {
      // The page's own call (bridge/assetReads.ts), as the client's assets window makes it.
      read = await readAssetStations(bridgeAsk);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      if (failsTheReading(error)) {
        throw error;
      }
      // ⚠ A FAILED READ MUST NOT LOOK LIKE "you own nothing". What the server
      // refused, and what came back as no rowset, is kept AS a failure, by the
      // call's own code; nothing is decoded, so the panel has nothing to
      // mistake for a successful empty answer.
      store.apply({ type: "assets/loaded", stations: [], error: failureCode(error), ownsNothing: false });
      return;
    }
    const stations = read.stations;
    store.apply({
      type: "assets/loaded",
      stations,
      error: null,
      ownsNothing: read.ownsNothing,
    });

    // R7d: a station is its NAME, and so is the system it sits in.
    const refs: NameRef[] = [];
    for (const row of stations) {
      refs.push({ kind: "station", id: row.stationID });
      refs.push({ kind: "system", id: row.solarSystemID });
      if (row.typeID !== null) {
        refs.push({ kind: "type", id: row.typeID });
      }
    }
    requestNames(refs);
  }

  /** Each type's volume as the BFF's static data has it: null where the tables have none. Kept once it is answered. */
  const typeVolumes = new Map<number, number | null>();

  /**
   * The volumes of these types, by their numbers as text: those the static data has one for. A type is asked for
   * once and kept, a volume being the type's own and the same for everyone. Volumes that could not be read are
   * left out this once and asked for again: they are what a thing measures, and never whether it is there.
   */
  async function volumesOfTypes(typeIDs: readonly number[]): Promise<Record<string, number>> {
    const unasked = [...new Set(typeIDs)].filter((typeID) => !typeVolumes.has(typeID));
    if (unasked.length > 0) {
      try {
        const answered = (await api.loadTypeVolumes(unasked, callOptions)).volumes;
        for (const typeID of unasked) {
          const volume = answered[typeID];
          if (volume !== undefined) {
            typeVolumes.set(typeID, volume);
          }
        }
      } catch (error) {
        throwIfRequestRetired(error);
      }
    }
    const known: Record<string, number> = {};
    for (const typeID of typeIDs) {
      const volume = typeVolumes.get(typeID);
      if (typeof volume === "number") {
        known[String(typeID)] = volume;
      }
    }
    return known;
  }

  /** Each type's compressed form as the BFF's static data has it: null where it has none. Kept once it is answered. */
  const compressedTypes = new Map<number, number | null>();

  /**
   * The compressed forms of these types (menucheckers/itemCheckers.py, OfferCompressInSpace: the client offers to
   * compress a type that has one, from its own static data). A type is asked for once and kept, being the same for
   * everyone; one the answer did not speak of, or a read that failed, is left out this once and asked for again.
   */
  async function compressedTypesOf(typeIDs: readonly number[]): Promise<ReadonlyMap<number, number | null>> {
    const unasked = [...new Set(typeIDs)].filter((typeID) => !compressedTypes.has(typeID));
    if (unasked.length > 0) {
      try {
        const answered = (await api.loadCompressedTypes(unasked, callOptions)).compressedTypeIDs;
        for (const typeID of unasked) {
          const compressed = answered[typeID];
          if (compressed !== undefined) {
            compressedTypes.set(typeID, compressed);
          }
        }
      } catch (error) {
        throwIfRequestRetired(error);
      }
    }
    const known = new Map<number, number | null>();
    for (const typeID of typeIDs) {
      const compressed = compressedTypes.get(typeID);
      if (compressed !== undefined) {
        known.set(typeID, compressed);
      }
    }
    return known;
  }

  /**
   * Expand one station and read what is there. Collapsing passes null and
   * touches no server.
   *
   * A failed read is kept AS a failure against that station, never thrown: one
   * station the server would not talk about must not blank the whole page.
   */
  async function openAssetStation(stationID: number | null): Promise<void> {
    store.apply({ type: "assets/expanded", stationID });
    if (stationID === null || stationID <= 0) {
      return;
    }
    let read: AssetStationItemsRead;
    try {
      // The page's own call (bridge/assetReads.ts), as the client's assets window makes it.
      read = await readAssetStationItems(bridgeAsk, stationID);
    } catch (error) {
      throwIfRequestRetired(error);
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      // (Kept under the call's own code; what came back as no list, as a read that failed.)
      store.apply({
        type: "assets/station-items",
        stationID,
        items: [],
        hasNoItems: false,
        error: failureCode(error),
      });
      return;
    }
    // What each type measures is static data, as it is a client's own: asked of the BFF's for the types here.
    const volumes = await volumesOfTypes(decodeAssetItems(read.listed).map((item) => item.typeID));
    const items = decodeAssetItems(read.listed, volumes);
    store.apply({
      type: "assets/station-items",
      stationID,
      items,
      hasNoItems: read.hasNoItems,
      error: null,
    });
    // Every stack renders as a type NAME and a type ICON (R7d / R27).
    requestNames(items.map((item) => ({ kind: "type", id: item.typeID }) as NameRef));
  }

  /**
   * Fly to where your stuff is.
   *
   * ⚠ THIS BUILDS NO NAVIGATION. `startRoute` already accepts a stationID,
   * resolves it, solves the route against the cached map graph and hands the
   * plan to the one shared autopilot controller — the same call Travel,
   * Overview, the agent finder and the mission bot all make. Setting a
   * destination from an asset location is that call with a station the player
   * picked from this list instead of from a search box.
   */
  async function setDestinationToAssetStation(stationID: number): Promise<void> {
    await startRoute(stationID);
  }

  /**
   * Send a message by the page's own call (bridge/mailWrites.ts: mailSvc.SendMail, the compose window's own checks
   * first), then reload the inbox so the panel shows the server's own picture, and record what happened.
   *
   * A thrown refusal becomes a sentence without inventing a cause; a SILENT decline (SendMail's bare None, which
   * carries no reason at all) is reported as exactly that; and a message's number answered is taken for sent, as the
   * client takes it (it reads nothing again). Until 2026-10-14 the BFF's route made the call and read the sender's
   * mailbox again for the message.
   */
  async function sendMail(request: MailToSend): Promise<void> {
    let messageID: number | null;
    try {
      messageID = await sendMailCall(bridgeDo, request);
    } catch (error) {
      throwIfRequestRetired(error);
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "mail/action-error", message: mailRefusalMessage(error) });
      return;
    }
    // mailSvc.SendMail (959 to 990) takes no header of the mail in: the server's OnMailSent brings it, as it brings
    // the client's (1119 to 1153). The message answered or forwarded is marked so in what is kept (979 to 990). A
    // stale refusal is cleared, as a load cleared it.
    if (messageID !== null && ((request.isReplyTo ?? 0) > 0 || (request.isForwardedFrom ?? 0) > 0)) {
      mailboxLoaded(mailboxAfterSending(store.mail.get(), request.isReplyTo ?? 0, request.isForwardedFrom ?? 0));
    }
    store.apply({ type: "mail/action-error", message: null });
    store.apply({
      type: "mail/outcome",
      outcome: {
        kind: "send",
        applied: messageID !== null,
        declinedSilently: messageID === null,
        recipientCount: new Set(request.toCharacterIDs).size,
        toList: request.toListID == null ? null : ((store.mail.get().lists ?? []).find((list) => list.listID === request.toListID)?.displayName ?? null),
        toCorpOrAlliance: request.toCorpOrAllianceID == null
          ? null
          : (store.names.get().resolved[nameKey(isAllianceOwner(request.toCorpOrAllianceID) ? "alliance" : "corporation", request.toCorpOrAllianceID)] ?? null),
        message: messageID === null ? "The server did not send that message, and did not say why." : null,
      },
    });
  }

  // --- R4 Agents & Missions ------------------------------------------------

  async function loadJournal(): Promise<void> {
    const result = await readJournal(bridgeAsk);
    store.apply({ type: "agents/journal", journal: decodeJournal(result) });
  }

  /**
   * A push that makes the window talk again is often the echo of the pilot's own action (an undock, a
   * package loaded) and comes while that action is still out. The client's window just asks. The BFF
   * does not let a second action through: while the session is changing place it refuses every one
   * (SESSION_CHANGE_IN_PROGRESS, seen live on an undock), and it runs one write for a pilot at a time
   * (CHARACTER_IN_USE). So what the window asks of its own accord is asked again until the pilot is free,
   * for a few seconds at most.
   */
  const PILOT_BUSY: ReadonlySet<string> = new Set(["SESSION_CHANGE_IN_PROGRESS", "CHARACTER_IN_USE"]);
  const AGENT_TALK_AGAIN_WAIT_MS = 200;
  const AGENT_TALK_AGAIN_TRIES = 15;
  const agentTalkAgainWaitMs = options.agentTalkAgainWaitMs ?? AGENT_TALK_AGAIN_WAIT_MS;
  async function whenThePilotIsFree<T>(ask: () => Promise<T>): Promise<T> {
    for (let tries = 1; ; tries += 1) {
      try {
        return await ask();
      } catch (error) {
        if (!(error instanceof BridgeCallError && PILOT_BUSY.has(error.code)) || tries >= AGENT_TALK_AGAIN_TRIES) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, agentTalkAgainWaitMs));
      }
    }
  }

  /** The agents whose window is talking to them now (agentDialogueWindow.isLoading, a window to an agent). */
  const agentsBeingTalkedTo = new Set<number>();
  /** The agents whose window was closed under a conversation that was still out (the window's `destroyed`). */
  const agentWindowsClosedWhileTalking = new Set<number>();

  /**
   * agentDialogueWindow.InteractWithAgent: one conversation with an agent at a time. Asked to talk to
   * an agent it is already talking to, the window does nothing.
   */
  async function interactWithAgent(agentID: number, talk: () => Promise<void>): Promise<void> {
    if (agentsBeingTalkedTo.has(agentID)) {
      return;
    }
    agentsBeingTalkedTo.add(agentID);
    try {
      await runAgentAction(talk);
    } finally {
      agentsBeingTalkedTo.delete(agentID);
      agentWindowsClosedWhileTalking.delete(agentID);
    }
  }

  /**
   * What the agent said, for a window that is still there to show it. InteractWithAgent: "if
   * self.destroyed: return". The server can close the window while its own question is out (declining
   * a mission is answered with the conversation and, on the way, with a change that closes the window).
   */
  async function agentSays(agentID: number, actionID: number | null): Promise<AgentConversation | null> {
    // The page's own call on the agent's object (bridge/agentWrites.ts), as the dialogue window makes it.
    const conversation = decodeConversation(await doAgentAction(bridgeDo, agentID, actionID));
    return agentWindowsClosedWhileTalking.has(agentID) ? null : conversation;
  }

  /**
   * agentDialogueWindow._GetConversation with no action, and the layout of what comes of it: the window
   * opens on what the agent says, and if the first thing on offer is to request a mission or view one,
   * it presses that at once.
   */
  async function talkToAgent(agentID: number, ofItsOwnAccord = false): Promise<void> {
    await interactWithAgent(agentID, async () => {
      let conversation = ofItsOwnAccord ? await whenThePilotIsFree(() => agentSays(agentID, null)) : await agentSays(agentID, null);
      if (conversation === null) {
        return;
      }
      const agent = store.agents.get().agents.find((row) => row.agentID === agentID);
      const first = openingAction(conversation, agent ? agent.agentTypeID : null);
      if (first !== null) {
        conversation = await agentSays(agentID, first.actionID);
        if (conversation === null) {
          return;
        }
      }
      await layOutConversation(agentID, conversation);
      // A press changes what there is between the pilot and the agent: a mission requested is an offer in the journal.
      if (first !== null) {
        await loadJournal();
      }
    });
  }

  /** The window that is open talks to its agent again, from the top, as the client's does when it is told to. */
  function talkToOpenAgentAgain(): void {
    const agentID = store.agents.get().activeAgentID;
    if (agentID !== null) {
      // Nobody is waiting on this: what goes wrong is shown where the conversation is, and a lost session has already been acted on.
      void talkToAgent(agentID, true).catch(() => {});
    }
  }

  let journalBeingRead = false;
  let journalReadAgain = false;
  /**
   * journal.py OnAgentMissionChange: what the journal holds is out of date. The client reads it again
   * when it is next looked at; here it is on show wherever it has been read, so it is read again now.
   * Changes that come while it is being read are answered by one more read, not one each.
   */
  function refreshJournal(): void {
    if (store.agents.get().journal === null) {
      return;
    }
    if (journalBeingRead) {
      journalReadAgain = true;
      return;
    }
    journalBeingRead = true;
    void (async () => {
      try {
        do {
          journalReadAgain = false;
          await loadJournal();
        } while (journalReadAgain);
      } catch {
        // The journal on show stays as it was; the next change, or Refresh, reads it again.
      } finally {
        journalBeingRead = false;
      }
    })();
  }

  /** OnAgentMissionChange(action, agentID), as each of the client's listeners takes it. */
  function onMissionChange(change: MissionChange): void {
    const what = windowOnMissionChange(change, store.agents.get().activeAgentID);
    // A window that is still opening, or has a press out, is a window too: closed, its answer is not laid out when it comes.
    if (change.agentID !== null && agentsBeingTalkedTo.has(change.agentID) && windowOnMissionChange(change, change.agentID) === "close") {
      agentWindowsClosedWhileTalking.add(change.agentID);
    }
    if (what === "close") {
      store.apply({ type: "agents/conversation-closed" });
    } else if (what === "again") {
      talkToOpenAgentAgain();
    }
    missionPageOnChange(change);
    refreshJournal();
  }

  // --- the journal's Read Details: the mission's page in the client's job board -------------------------

  // The client's own record of each mission, asked of the BFF once (evemissions.client.data.get_mission).
  const clientMissions = new Map<number, Promise<ClientMission | null>>();
  function clientMissionRecord(contentID: number): Promise<ClientMission | null> {
    let asked = clientMissions.get(contentID);
    if (asked === undefined) {
      asked = api.loadClientMission(contentID, callOptions).then(decodeClientMission, () => {
        // Not remembered: a later ask tries again.
        clientMissions.delete(contentID);
        return null;
      });
      clientMissions.set(contentID, asked);
    }
    return asked;
  }

  // How the client words each kind of notification, asked of the BFF once (its own code's tables:
  // bridge/notificationFormats.ts).
  let notificationFormatsAsked: Promise<NotificationFormats | null> | null = null;
  function notificationFormats(): Promise<NotificationFormats | null> {
    notificationFormatsAsked ??= api.loadNotificationFormats(callOptions).then(decodeNotificationFormats, () => {
      // Not remembered: a later ask tries again.
      notificationFormatsAsked = null;
      return null;
    });
    return notificationFormatsAsked;
  }

  /** The page on show, when it is this agent's. */
  function missionPageOf(agentID: number): MissionPageState | null {
    const page = store.agents.get().missionPage;
    return page !== null && page.agentID === agentID ? page : null;
  }

  // AgentMissionJob.update_objective_info: the page's one read of the server, made as it opens and again
  // whenever its job is marked out of date. A page closed, or opened on another agent, before the answer
  // came is not written to.
  async function readMissionPage(agentID: number): Promise<void> {
    const answer = decodeObjectives((await api.loadMissionObjectives(agentID, callOptions)) ?? undefined);
    const page = missionPageOf(agentID);
    if (page !== null) {
      store.apply({ type: "agents/mission-page", page: { ...page, objectives: pageObjectives(page.objectives, answer, page.contentID) } });
    }
  }

  function readOpenMissionPageAgain(): void {
    const page = store.agents.get().missionPage;
    if (page !== null) {
      // A read that fails leaves the page as it was; the next change reads again.
      void readMissionPage(page.agentID).catch(() => {});
    }
  }

  // AgentMissionsJobProvider.OnAgentMissionChanged, for the job whose page is on show. A change that
  // names no agent is every agent's.
  function missionPageOnChange(change: MissionChange): void {
    const page = store.agents.get().missionPage;
    if (page === null || (change.agentID !== null && change.agentID !== page.agentID)) {
      return;
    }
    const what = pageOnMissionChange(change.action);
    if (what === "close") {
      store.apply({ type: "agents/mission-page", page: null });
    } else if (what !== null) {
      if (what.missionState !== null) {
        store.apply({ type: "agents/mission-page", page: { ...page, missionState: what.missionState } });
      }
      readOpenMissionPageAgain();
    }
  }

  async function openMissionDetails(agentID: number): Promise<void> {
    const journal = store.agents.get().journal;
    const row = journal === null ? undefined : [...journal.active, ...journal.offered].find((mission) => mission.agentID === agentID);
    if (row === undefined) {
      return;
    }
    const contentID = row.missionID;
    store.apply({
      type: "agents/mission-page",
      page: {
        agentID,
        contentID,
        missionState: row.missionState,
        important: row.importantMission === true,
        expirationTime: row.expirationTime,
        missionTitleID: row.missionTitleID,
        missionTitle: row.missionTitle ?? null,
        objectives: null,
        record: null,
      },
    });
    // The agent's own card, and its corporation's (page.py _construct_agent_section).
    requestAgentRecord(agentID);
    // The corporation's card says the pilot's effective standing with the agent. The client has had the
    // pilot's standings and skills since it logged in; here they are read if they have not been.
    if (!store.standings.get().loaded) {
      void loadStandings().catch(() => {});
    }
    if (store.skills.get().skills === null) {
      void loadSkills().catch(() => {});
    }
    if (contentID !== null) {
      // What the page words the mission with: its keywords, from its agent (agents.PrimeMessageArguments),
      // and the client's own record of it. Neither holds the page up.
      requestMissionKeywords(agentID, contentID);
      void clientMissionRecord(contentID).then((record) => {
        const page = missionPageOf(agentID);
        if (page !== null && page.contentID === contentID) {
          store.apply({ type: "agents/mission-page", page: { ...page, record } });
        }
      });
    }
    await runAgentAction(() => readMissionPage(agentID));
  }

  async function loadBriefing(agentID: number): Promise<void> {
    const reads = await api.loadBriefing(agentID, callOptions);
    store.apply({
      type: "agents/briefing",
      briefing: decodeBriefing(reads.briefing, reads.objective),
    });
  }

  /**
   * agentDialogueWindow.ReconstructLayout: what the agent says, and beside it the mission. The client
   * reads the agent's place, the mission's briefing and its objectives afresh for EVERY layout, whatever
   * was pressed, and shows the objectives unless the last action ended the mission or was answered with
   * "not yet" (objectivesShown). So an offer's objectives are on show before it is accepted.
   */
  async function layOutConversation(agentID: number, conversation: AgentConversation): Promise<void> {
    store.apply({ type: "agents/conversation", agentID, conversation });
    const reads = await api.loadBriefing(agentID, callOptions);
    store.apply({
      type: "agents/briefing",
      briefing: objectivesShown(conversation.lastActionInfo) ? decodeBriefing(reads.briefing, reads.objective) : null,
    });
    // The pane itself, for a mission of any kind, by the same rule as the courier's table above.
    store.apply({ type: "agents/objectives", objectives: objectivesShown(conversation.lastActionInfo) ? decodeObjectives(reads.objective ?? undefined) : null });
    // The briefing's two times belong to what the agent says, not to the objectives: they are kept whatever the last action was.
    store.apply({ type: "agents/mission-times", times: decodeMissionTimes(reads.briefing) });
  }

  // R6 — the post-completion reward readout (Step 12): wallet / LP / standings.
  // The three reads are independent on the BFF (Promise.allSettled); a per-read
  // error rides in the `error` field rather than blanking the whole panel. The
  // journal (the fourth Step-12 read) is refreshed separately via loadJournal.
  async function loadRewards(): Promise<void> {
    const reads = await api.loadRewards(callOptions);
    const errors = [
      reads.errors.cash ? `wallet: ${reads.errors.cash}` : null,
      reads.errors.lp ? `LP: ${reads.errors.lp}` : null,
      reads.errors.standings ? `standings: ${reads.errors.standings}` : null,
    ].filter((entry): entry is string => entry !== null);
    store.apply({
      type: "rewards/loaded",
      cashBalance: decodeCashBalance(reads.cash),
      lpBalances: decodeLpBalances(reads.lp),
      standings: decodeCharStandings(reads.standings),
      error: errors.length ? errors.join("; ") : null,
    });
  }

  // R50 — the Wallet + Corp Wallet tabs. One pull carries the personal balance
  // and the corp division balances; the two halves are independent on the BFF
  // (Promise.allSettled) and keep their own errors here.
  //
  // ⚠ empty vs failed. A FAILED corp read leaves `corpDivisions` NULL and puts
  // the reason in `corpError`. A SUCCESSFUL corp read decodes to a list — which
  // may be empty, and an empty list is the real "this corporation has no wallet
  // divisions" answer. The two must not collapse into one another.
  async function pilotWealth(): Promise<number | null> {
    const cash = decodeWalletCash(await walletReads.wealth());
    const value = cash === null ? Number.NaN : Number(cash);
    return Number.isFinite(value) ? value : null;
  }

  // redeem.FetchRedeemTokens (redeemsvc.py 63 to 65): the page reads the tokens as the pilot comes online and at the
  // server's OnRedeemingQueueUpdated, and after a claim; the transport answers from what it keeps, fetched as the
  // client fetches (bridge/redeemReads.ts). A transport that does not carry the call has none to give.
  async function loadRedeemTokens(): Promise<void> {
    let answer: JsonValue;
    try {
      answer = await readRedeemTokens(bridgeAsk);
    } catch (error) {
      if (failsTheReading(error)) throw error;
      store.apply({ type: "redeem/tokens", tokens: null, error: "What you may redeem could not be read just now." });
      return;
    }
    if (answer === null) {
      store.apply({ type: "redeem/tokens", tokens: null, error: null });
      return;
    }
    const tokens = decodeRedeemTokens(answer);
    store.apply(tokens === null
      ? { type: "redeem/tokens", tokens: null, error: "What you may redeem could not be read just now." }
      : { type: "redeem/tokens", tokens, error: null });
    if (tokens !== null) requestNames(tokens.map((token) => ({ kind: "type", id: token.typeID })));
  }

  async function redeemHomeStation(): Promise<number | null> {
    try {
      const stationID = decodeHomeStationID(await bridgeAsk("home_station", "get_home_station", []));
      if (stationID !== null) requestNames([{ kind: "station", id: stationID }]);
      return stationID;
    } catch {
      return null;
    }
  }

  async function redeemTokens(tokens: readonly RedeemToken[], useHomeStation: boolean): Promise<RedeemOutcome> {
    const characterID = store.station.get().online?.characterID ?? null;
    if (characterID === null) throw new Error("There is no pilot online to redeem for.");
    try {
      return await claimRedeemTokens(bridgeDo, tokens, characterID, useHomeStation);
    } finally {
      // redeemsvc.py 127: the claim, answered or refused, is followed by the tokens' fetch.
      await loadRedeemTokens().catch(() => {});
    }
  }

  // loginCampaignService._get_campaign_state (106 to 119): the page reads the account's campaign as the pilot comes
  // online and at the server's OnCampaignEnrollmentChanged (84 to 88), by the service's own call
  // (bridge/loginRewardReads.ts). A transport that does not carry the call has none to give.
  async function loadLoginRewards(): Promise<void> {
    await Promise.all([loadDailyLoginCampaign(), loadSeasonalCampaign()]);
  }

  // seasonalLoginCampaignService.prime_campaign_data and get_claim_history (39 to 51, 90 to 97): the seasonal campaign
  // on, and the days the account has claimed of it. What each day gives is the client's own data, by the campaign's
  // ID (bridge/seasonalCampaignTable.ts), which the window reads.
  async function loadSeasonalCampaign(): Promise<void> {
    let seasonal: Awaited<ReturnType<typeof readSeasonalCampaign>>;
    try {
      seasonal = await readSeasonalCampaign(bridgeAsk);
    } catch (error) {
      if (failsTheReading(error)) throw error;
      return;
    }
    if (seasonal === null) {
      store.apply({ type: "login-rewards/seasonal", seasonal: null });
      return;
    }
    // SeasonalCampaignsStaticData().get_campaign(id): the table is the client's data, read only where a campaign is on.
    const { SEASONAL_CAMPAIGNS } = await import("../bridge/seasonalCampaignTable.ts");
    const definition = SEASONAL_CAMPAIGNS[seasonal.active.campaignID] ?? null;
    store.apply({ type: "login-rewards/seasonal", seasonal: { ...seasonal, definition } });
    if (definition !== null) {
      requestNames([...definition.alpha, ...definition.omega].map(([, typeID]) => ({ kind: "type", id: typeID })));
    }
  }

  async function claimSeasonalReward(): Promise<void> {
    let given = false;
    try {
      given = await claimSeasonalRewardCall(bridgeDo);
    } finally {
      // The client keeps its own history after a claim (_add_rewards_to_history); the page reads the server's.
      await loadSeasonalCampaign().catch(() => {});
    }
    if (!given) throw new Error("There is nothing to claim yet: today's reward has been claimed for this account.");
  }

  async function loadDailyLoginCampaign(): Promise<void> {
    let answer: JsonValue;
    try {
      answer = await readLoginCampaign(bridgeAsk);
    } catch (error) {
      if (failsTheReading(error)) throw error;
      store.apply({ type: "login-rewards/state", campaign: null, error: "Your daily login rewards could not be read just now." });
      return;
    }
    const campaign = answer === null ? null : decodeLoginCampaign(answer);
    store.apply({ type: "login-rewards/state", campaign, error: null });
    if (campaign !== null) requestNames(campaign.days.map((day) => ({ kind: "type", id: day.typeID })));
  }

  async function claimLoginReward(): Promise<LoginClaim> {
    const claim = await claimLoginRewardCall(bridgeDo);
    const campaign = store.loginRewards.get().campaign;
    if (claim === null || campaign === null) {
      // claim_reward answers None where nothing may be claimed: what the server holds is read again.
      await loadDailyLoginCampaign().catch(() => {});
      if (claim === null) throw new Error("There is nothing to claim yet: today's reward has been claimed for this account.");
      return claim;
    }
    store.apply({ type: "login-rewards/claimed", campaign: campaignAfterClaim(campaign, claim), reward: claim.reward });
    if (claim.reward !== null) requestNames([{ kind: "type", id: claim.reward.typeID }]);
    return claim;
  }

  /** How long a server's message waits for the client's dialog and names before it is said with what there is. */
  const SERVER_MESSAGE_WORDS_WAIT_MS = 1500;

  /** Resolves once `ready()` holds, re-checked as `signal` changes, or after `ms` whatever it says. */
  function until(signal: { subscribe(run: () => void): () => void }, ready: () => boolean, ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (ready()) {
        resolve();
        return;
      }
      let stop: () => void = () => {};
      const timer = setTimeout(() => { stop(); resolve(); }, ms);
      stop = signal.subscribe(() => {
        if (!ready()) return;
        clearTimeout(timer);
        queueMicrotask(() => stop());
        resolve();
      });
    });
  }

  // A server's message (bridge/serverMessages.ts): the client's dialog and the names in it are asked for, and given a
  // moment to come, as the client's own text takes none; then it is said with what the page has.
  async function sayServerMessage(message: ServerMessage): Promise<void> {
    const client = (): ClientWording => ({ templates: store.words.get().templates, playerID: store.station.get().online?.characterID ?? null });
    const keys = wordsLabels([message.words]);
    requestWords(keys);
    // (An answer without the client's words keeps each key too, as none: either way the keys are there when it comes.)
    await until(store.words, () => keys.every((key) => key in store.words.get().templates), SERVER_MESSAGE_WORDS_WAIT_MS);
    const refs = wordsNameRefs([message.words], client());
    requestNames(refs);
    await until(store.names, () => refs.every((ref) => nameKey(ref.kind, ref.id) in store.names.get().resolved), SERVER_MESSAGE_WORDS_WAIT_MS);
    const nameOf = (kind: NameKind, id: number): string => resolvedName(store.names.get().resolved, kind, id, `${kind} ${id}`);
    const text = serverMessageText(message, nameOf, client());
    if (text === null) return;
    store.apply({ type: "server-messages/said", kind: message.kind, text: null });
    store.apply({ type: "server-messages/said", kind: message.kind, text });
  }

  async function giveMoney(toID: number, amount: number, reason: string): Promise<void> {
    // (The page's own call, bridge/giveMoney.ts; the pilot's ISK is put right by the OnAccountChange that follows.)
    await giveMoneyCall(bridgeDo, toID, amount, reason);
  }

  async function loadWallet(how: { readonly fresh?: boolean } = {}): Promise<void> {
    const reads = await walletReads.read(how);
    const corpFailed = reads.errors.divisions !== null;
    const corpError = [
      reads.errors.divisions ? `corp wallet: ${reads.errors.divisions}` : null,
      // A missing division NAME is cosmetic (the panel falls back to
      // "Division N"), so a failed name read is not treated as a wallet error.
    ]
      .filter((entry): entry is string => entry !== null)
      .join("; ");
    // R54 ledger: the wallet's activity, which the client reads as account.GetTransactions
    // and nothing else. A FAILED read leaves the list NULL (with its own error); a
    // SUCCESSFUL read decodes to a list that may be []. The entry-types map is
    // cosmetic — if it fails, rows label "Other", never a raw code, so a failed
    // entryTypes read is NOT a ledger error.
    const labels = decodeWalletEntryTypeLabels(reads.entryTypes);
    const transactionsFailed = reads.errors.transactions !== null;
    store.apply({
      type: "wallet/loaded",
      cashBalance: decodeWalletCash(reads.cash),
      cashError: reads.errors.cash,
      corpDivisions: corpFailed
        ? null
        : decodeCorpDivisions(reads.divisions, normalizeDivisionNames(reads.divisionNames)),
      corpError: corpError === "" ? null : corpError,
      journal: transactionsFailed ? null : decodeWalletTransactions(reads.transactions, labels),
      journalError: reads.errors.transactions ? `transactions: ${reads.errors.transactions}` : null,
    });
  }

  // R55 — the Standings page. One pull carries the character's own standings and
  // the corporation's; each half is independent on the BFF (Promise.allSettled)
  // and keeps its own error here, so a failed corp read never blanks the
  // character's own standings.
  //
  // ⚠ R7d is the point of this page: a standing's `fromID` is an entity id (NPC
  // faction / NPC corporation / agent). Every id is classified by its EVE id
  // range (classifyStandingKind — the same split the retail idCheckers uses) and
  // resolved to a name through /api/names. The `agent` kind is asked for
  // explicitly: the generic `owner` kind does not resolve agents.
  async function loadStandings(): Promise<void> {
    const online = store.station.get().online;
    const reads = await readStandings(bridgeAsk, { characterID: online?.characterID ?? null, corporationID: online?.corporationID ?? null });
    const charFailed = reads.errors.char !== null;
    const corpFailed = reads.errors.corp !== null;
    const char = charFailed ? null : decodeCharStandings(reads.char);
    const corp = corpFailed ? null : decodeCharStandings(reads.corp);
    store.apply({
      type: "standings/loaded",
      char,
      charError: reads.errors.char ? `your standings: ${reads.errors.char}` : null,
      corp,
      corpError: reads.errors.corp ? `corp standings: ${reads.errors.corp}` : null,
    });
    // Resolve every entity id to a name, each by its classified kind (R7d).
    const refs: NameRef[] = [];
    for (const row of [...(char ?? []), ...(corp ?? [])]) {
      const kind = classifyStandingKind(row.fromID);
      if (kind !== null) {
        refs.push({ kind, id: row.fromID });
      }
    }
    requestNames(refs);
  }

  // R55 — the drill-down for one selected entity. A char row shows its standing
  // HISTORY (GetStandingTransactions); a corp row shows the per-member breakdown
  // (GetStandingCompositions). The one the row wants is asked for, of the pilot
  // or of its corporation, as the client's panel asks (standingsPanel.py 86); the
  // route asked for both. A composition's ownerID is a corp member, so
  // it is resolved as a name too (R7d), degrading to "Unknown entity".
  async function loadStandingDetail(
    fromID: number,
    scope: "char" | "corp",
  ): Promise<void> {
    if (!(fromID > 0)) {
      return;
    }
    const online = store.station.get().online;
    const toID = scope === "char" ? online?.characterID ?? null : online?.corporationID ?? null;
    let read: JsonValue;
    try {
      if (toID === null) {
        throw new Error(scope === "char" ? "No pilot is chosen." : "The pilot's corporation is not known.");
      }
      read = scope === "char" ? await standingHistory(bridgeAsk, fromID, toID) : await standingComposition(bridgeAsk, fromID, toID);
    } catch (error) {
      if (isSessionLost(error)) {
        throw error;
      }
      store.apply({
        type: "standings/detail-error",
        fromID,
        scope,
        // A call that failed says why by its code, as the route said of a read; anything else in its own words.
        message: error instanceof BridgeCallError ? error.code : errorWords(error),
      });
      return;
    }
    const compositions = scope === "corp" ? decodeStandingCompositions(read) : null;
    store.apply({
      type: "standings/detail",
      fromID,
      scope,
      transactions: scope === "char" ? decodeStandingTransactions(read) : null,
      compositions,
    });
    // Name a composition's corp-member owners (R7d): they are player characters,
    // so `character` is the kind, and an unresolved one degrades to a fallback.
    if (compositions && compositions.length > 0) {
      requestNames(
        compositions.map((row) => ({ kind: "character", id: row.ownerID }) as NameRef),
      );
    }
  }

  function closeStandingDetail(): void {
    store.apply({ type: "standings/detail-cleared" });
  }

  // R56 — the Character Sheet page. Four independent reads, asked by the page
  // itself as the client's windows ask them (bridge/characterSheetReads.ts: the
  // public info, the description, the home station, and the implants the clone
  // on show is made of); each keeps its own error here, so a failed clone read
  // never blanks the identity, and vice versa.
  //
  // ⚠ R7d: every id is resolved to a name. corporationID / allianceID (from the
  // public info), the home stationID and every implant typeID are asked for
  // through /api/names. An id static data cannot name (a PLAYER corp resolves to
  // null) degrades to "Unknown …" in the page — never the number. bloodline /
  // race / ancestry carry no name path and are not decoded at all.
  async function loadCharacterSheet(): Promise<void> {
    const reads = await characterSheetReads.read({ characterID: store.station.get().online?.characterID ?? null });
    const identity = reads.errors.publicInfo
      ? null
      : decodeCharacterIdentity(reads.publicInfo);
    const description = reads.errors.description
      ? null
      : decodeCharacterDescription(reads.description);
    const homeStationID = reads.errors.homeStation
      ? null
      : decodeHomeStationID(reads.homeStation);
    const clone = reads.errors.cloneInfo ? null : decodeCloneSummary(reads.cloneInfo);
    store.apply({
      type: "character-sheet/loaded",
      identity,
      identityError: reads.errors.publicInfo
        ? `your character info: ${reads.errors.publicInfo}`
        : null,
      description,
      descriptionError: reads.errors.description
        ? `your bio: ${reads.errors.description}`
        : null,
      homeStationID,
      homeStationError: reads.errors.homeStation
        ? `your home station: ${reads.errors.homeStation}`
        : null,
      clone,
      cloneError: reads.errors.cloneInfo ? `your clone: ${reads.errors.cloneInfo}` : null,
    });
    // Resolve every id to a name (R7d). An id the batch cannot resolve is cached
    // as a definitive unknown by the store, and the page shows a fallback.
    const refs: NameRef[] = [];
    if (identity) {
      if (identity.corporationID > 0) {
        refs.push({ kind: "corporation", id: identity.corporationID });
      }
      if (identity.allianceID !== null) {
        refs.push({ kind: "alliance", id: identity.allianceID });
      }
    }
    if (homeStationID !== null) {
      refs.push({ kind: "station", id: homeStationID });
    }
    if (clone) {
      for (const implant of clone.implants) {
        refs.push({ kind: "type", id: implant.typeID });
      }
    }
    requestNames(refs);
  }

  // The Character Sheet's skill history, as the client's panel asks for it (skillHistoryPanel.py 54 to 58): the
  // skill service's history, which is the skill handler's with no count said (the client's fifty; the game
  // port's transport says it, and keeps the answer as the service does), and the pilot's own skills, whose ranks
  // the levels are reckoned by. Either call failing is the history's failing; what fails a whole reading is thrown.
  async function loadSkillHistory(): Promise<void> {
    try {
      const [history, skills] = await Promise.all([
        bridgeAsk("skillHandler", "GetSkillHistory", []),
        bridgeAsk("skillHandler", "GetSkills", []),
      ]);
      const lines = skillHistoryLines(decodeSkillHistory(history), decodeSkills(skills));
      store.apply({ type: "character-sheet/skill-history", lines, error: null });
      requestNames(lines.map((line) => ({ kind: "type", id: line.skillTypeID })));
    } catch (error) {
      if (failsTheReading(error)) {
        throw error;
      }
      store.apply({ type: "character-sheet/skill-history", lines: null, error: `your skill history: ${failureCode(error)}` });
    }
  }

  // The Character Sheet's employment history, as the client's employment tab asks for it (infosvc.py 2842):
  // corporationSvc.GetEmployementRecordAndCharacterTransfers(the pilot), CCP's spelling, its days reckoned to now.
  // Through the web gateway, whose list has nothing of the corporation service's, it is not to be had, and the
  // sheet says so; on the game port it is asked as the client asks it.
  async function loadEmploymentHistory(): Promise<void> {
    const characterID = store.station.get().online?.characterID ?? 0;
    if (!(characterID > 0)) {
      store.apply({ type: "character-sheet/employment-history", history: null, error: "your employment history: no pilot is online" });
      return;
    }
    try {
      const answer = await bridgeAsk("corporationSvc", "GetEmployementRecordAndCharacterTransfers", [characterID]);
      const history = employmentHistoryOf(answer, filetimeOf(Date.now()));
      if (history === null) {
        store.apply({ type: "character-sheet/employment-history", history: null, error: "your employment history: the answer could not be read" });
        return;
      }
      store.apply({ type: "character-sheet/employment-history", history, error: null });
      requestNames(history.lines.map((line) => ({ kind: "corporation", id: line.corporationID })));
    } catch (error) {
      if (failsTheReading(error)) {
        throw error;
      }
      store.apply({
        type: "character-sheet/employment-history",
        history: null,
        error: failureCode(error) === "CALL_NOT_ALLOWED"
          ? "Your employment history is not to be had through this connection."
          : `your employment history: ${failureCode(error)}`,
      });
    }
  }

  // R7 — read a chat channel's roster + backlog and push it to the store. The
  // panel polls this while open (READ is a backlog poll). A lost session unwinds
  // to offline; any other failure surfaces through the chat slice so the panel
  // stays put and shows the reason.
  async function loadChat(channel: ChatChannel): Promise<void> {
    try {
      const raw = await api.readChat(channel, callOptions);
      store.apply({
        type: "chat/loaded",
        channel: decodeChatChannelName(raw, channel),
        channelState: decodeChatChannel(raw),
      });
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "chat/error", message: errorWords(error) });
    }
  }

  async function sendChatMessage(channel: ChatChannel, message: string): Promise<void> {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }
    try {
      await api.sendChat(channel, trimmed, callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "chat/error", message: errorWords(error) });
      return;
    }
    // Reflect the sent message immediately by re-reading the channel backlog
    // (loadChat clears the error on success).
    await loadChat(channel);
  }

  /** The table of agents while it is being read, and once it is had. */
  let agentsTableRead: ReturnType<typeof readAgentsTable> | null = null;

  /**
   * The whole table of agents, asked for once and kept, as the client's agents service keeps it for its life
   * (agents.py 89 to 115): the page's own call (bridge/agentReads.ts). A table that could not be read is not
   * kept, and is asked for again by whoever wants it next.
   */
  function agentsKnown(): ReturnType<typeof readAgentsTable> {
    if (agentsTableRead === null) {
      const reading = readAgentsTable(bridgeAsk);
      agentsTableRead = reading;
      reading.catch(() => {
        if (agentsTableRead === reading) {
          agentsTableRead = null;
        }
      });
    }
    return agentsTableRead;
  }

  // List the agents of the station the pilot is docked at: the table's, at the
  // station the page has its pilot at, as the client's docked view picks them
  // (dockedUI/agents.py 153). Standalone so both the tab (onMount / Refresh) and
  // the R6b docked-station-change refresh can call it.
  async function loadAgents(): Promise<void> {
    await runAgentAction(async () => {
      const dockedAt = (): number | null => store.station.get().online?.stationID ?? null;
      // A pilot at no station has no station's agents, and the table is not asked for to say so.
      if (dockedAt() === null) {
        store.apply({ type: "agents/list", stationID: null, agents: [] });
        return;
      }
      const table = await agentsKnown();
      // (Where the pilot is when the table comes: it may have docked elsewhere while it was read.)
      const stationID = dockedAt();
      store.apply({ type: "agents/list", stationID, agents: agentsAtStation(table, stationID) });
    });
  }

  // Run an agent read/action, unwinding to offline on a lost session and
  // surfacing any other failure through the store (the page stays put and shows
  // the reason) rather than throwing into the UI handler.
  async function runAgentAction(action: () => Promise<void>): Promise<void> {
    try {
      await action();
      store.apply({ type: "agents/action-error", message: null });
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "agents/action-error", message: errorWords(error) });
    }
  }

  // --- R5a Flight (manually-stepped space movement) ------------------------

  // A movement refusal (CALL_REFUSED, 409) carries the handler's OWN
  // user-facing text as the message (scrambled, invalid target,
  // docking-approach, lost control, ship destroyed). Surface it so the operator
  // sees the real reason, not just the code — "pause on unsafe" must show why.
  //
  // ⚠ THIS IS THE RAW TEXT AND MUST STAY RAW. It is what the autopilot and the
  // mining bot CLASSIFY on — `classifyJumpRefusal` reads it for
  // `NotWithingMaxJumpDist` to decide approach-and-retry versus pause, and
  // `isRangeRefusal` reads it to decide whether to close in. Translating here
  // would silently break both, because a plain sentence does not match a regex
  // written for the server's vocabulary. Player-facing text comes from
  // `flightRefusalWords` (R31); the two are deliberately separate.
  function flightErrorReason(error: unknown): string {
    throwIfRequestRetired(error);
    if (error instanceof BridgeCallError) {
      return error.message && error.message !== error.code
        ? `${error.code}: ${error.message}`
        : error.code;
    }
    return readErrorReason(error);
  }

  /**
   * R31 — a movement refusal in words a player reads.
   *
   * The player never sees `101,UI/Menusvc/MenuHints/NotWithingMaxJumpDist`
   * again; they read "That gate is too far away to jump through. Get closer to
   * it first." The refusal is still a refusal — every caller of this still
   * renders a failure, at the control that caused it (R30 slice C).
   */
  function flightRefusalWords(error: unknown): string {
    return sayRefusal(flightErrorReason(error));
  }

  // --- R6b docked-station-change refresh -----------------------------------

  // Re-run the station-scoped reads for a newly-docked station. The Station
  // panel identity is re-pointed immediately (so the header/finder-origin track
  // the new station before the async reads land), then the docked reads refresh:
  // the station panel always (it IS the docked context), and agents/inventory
  // only if their tab has already loaded (an unopened tab re-fetches on open via
  // its own onMount). A lost session inside any read unwinds to character select
  // (rethrown); any other per-read failure rides that read's own slice.
  async function relocateStationContext(
    stationID: number,
    solarSystemID: number | null,
    kind: "station" | "structure" = "station",
  ): Promise<void> {
    let station: StationStatic | null = null;
    if (kind === "station") {
      try { station = await api.loadStationStatic(stationID, callOptions); }
      catch { station = null; }
    }
    store.apply({ type: "station/relocated", stationID: kind === "station" ? stationID : null,
      structureID: kind === "structure" ? stationID : null, solarSystemID, station });

    await refreshStationPanel();
    if (kind === "station" && store.agents.get().loaded) {
      await loadAgents();
    }
    if (store.inventory.get().loaded) {
      try {
        await loadInventory();
      } catch (error) {
        if (isSessionLost(error)) {
          throw error;
        }
        store.apply({ type: "inventory/action-error", message: errorWords(error) });
      }
    }
  }

  // Observe a flight-status snapshot: when it reveals the character docked at a
  // station DIFFERENT from the one the panels are synced to, refresh the
  // station-scoped context (autopilot arrival, manual dock). Guarded so the
  // autopilot loop's per-tick reads relocate exactly once per change, and so an
  // in-flight relocate is never re-entered. Never rejects: a lost session has
  // already flipped the store offline inside the reads, so the swallowed
  // rejection is safe to `void` from an autopilot tick or to await from a step.
  async function syncDockedStation(status: FlightStatus): Promise<void> {
    // Only a docked, online character has a station context to reconcile; skip
    // otherwise (in space, or a flight read taken before a character is online).
    if (store.station.get().online === null) {
      return;
    }
    const stationID = status.docked ? status.structureID ?? status.stationID : null;
    if (stationID === null || stationID === syncedStationID || relocating) {
      return;
    }
    syncedStationID = stationID;
    relocating = true;
    try {
      await relocateStationContext(stationID, status.solarSystemID, status.structureID === stationID ? "structure" : "station");
    } catch {
      // Session-loss already unwound to offline; nothing more to do here.
    } finally {
      relocating = false;
    }
  }

  // R7a — resolve location IDs to names for the Flight readout, cached so the
  // status doesn't refetch every poll. The cache holds a resolved name, or null
  // for a definitive static "unknown" (e.g. a player structure not in the static
  // tables) so those are not refetched either; a transient network failure is
  // NOT cached (it can retry). Names resolve through the existing read-only
  // /api/map/resolve route — no new gateway/bridge call.
  const locationNames = new Map<number, string | null>();

  async function cachedLocationName(id: number): Promise<string | null> {
    if (locationNames.has(id)) {
      return locationNames.get(id) ?? null;
    }
    let resolved: Awaited<ReturnType<typeof api.resolveDestination>>;
    try {
      resolved = await api.resolveDestination(id, callOptions);
    } catch {
      // Best-effort: leave the UI on the raw-ID fallback and allow a later retry.
      return null;
    }
    // R38 — a player structure resolves like a station (it is a dockable place
    // and the route answers its name in stationName too), so the flight readout
    // and Travel name it without knowing it is runtime data.
    const name =
      resolved.kind === "station" || resolved.kind === "structure"
        ? resolved.stationName
        : resolved.kind === "system"
          ? resolved.systemName
          : null;
    // ⚠ Only a DEFINITE outcome is cached. `lookupFailed` means the structure
    // read could not be completed, not that the place is nameless; caching that
    // would pin the readout to its fallback for the whole session even once the
    // lookup could succeed. Same rule the batch name cache follows for
    // `unresolved`. A plain static miss is still cached, as it always was.
    if (!resolved.lookupFailed) {
      locationNames.set(id, name);
    }
    return name;
  }

  // Resolve the current status's system / station / structure names (from the
  // cache or a one-off static read) and push them to the flight slice, tagged
  // with the IDs they were resolved for so a stale resolve can't mislabel a newer
  // location. Fire-and-forget from observeFlightStatus (never blocks the loop).
  async function resolveFlightLocation(status: FlightStatus): Promise<void> {
    const [solarSystemName, stationName, structureName] = await Promise.all([
      status.solarSystemID !== null ? cachedLocationName(status.solarSystemID) : Promise.resolve(null),
      status.stationID !== null ? cachedLocationName(status.stationID) : Promise.resolve(null),
      status.structureID !== null ? cachedLocationName(status.structureID) : Promise.resolve(null),
    ]);
    store.apply({
      type: "flight/location",
      forSolarSystemID: status.solarSystemID,
      forStationID: status.stationID,
      forStructureID: status.structureID,
      solarSystemName,
      stationName,
      structureName,
    });
  }

  // The single choke point for a decoded flight-status snapshot: push it to the
  // flight slice, resolve its location names (cached), then reconcile the
  // docked-station context. Every flight read (manual step, autopilot tick,
  // route-origin read) flows through here. Returns the reconcile promise so a
  // manual step can await the refresh; the autopilot tick voids it (the loop must
  // not block on a panel refresh). Name resolution is always fire-and-forget.
  function observeFlightStatus(status: FlightStatus): Promise<void> {
    const previousSystemID = store.flight.get().status?.solarSystemID ?? null;
    const scannerBefore = store.scanner.get();
    const flightSystemChanged =
      previousSystemID !== null &&
      status.solarSystemID !== null &&
      previousSystemID !== status.solarSystemID;
    const scannerSystemChanged =
      scannerBefore.solarSystemID !== null &&
      status.solarSystemID !== null &&
      scannerBefore.solarSystemID !== status.solarSystemID;
    const refreshScanner =
      (flightSystemChanged || scannerSystemChanged) &&
      (scannerBefore.loaded || scannerBefore.loading);
    if (flightSystemChanged || scannerSystemChanged) {
      // Supersede any old-system request before the reducer clears its rows.
      scannerLoadGeneration += 1;
    }
    store.apply({ type: "flight/status", status });
    if (refreshScanner) {
      void loadScanner().catch(() => undefined);
    }
    // R30 slice B — the ship is back in space, so a viewer that kept its claim
    // through the dock gets its feed back. This is the single funnel EVERY
    // flight status flows through (manual undock, autopilot tick, panel read),
    // which is exactly why the re-arm belongs here and nowhere else.
    if (status.inSpace) {
      resumeSpacePolling();
    }
    // Once the ship is NOT docked, forget which station the panels are synced to,
    // so the NEXT dock reconciles the docked context even if it is the SAME
    // station we left. Without this, a bot that undocks, mines, and returns home
    // re-docks at `syncedStationID` and `syncDockedStation` skips the refresh —
    // leaving the docked panel stale/empty after the round trip.
    if (!status.docked) {
      syncedStationID = null;
    }
    void resolveFlightLocation(status);
    return syncDockedStation(status);
  }

  // Push a step's decoded flight snapshot into the store (+ docked-context sync).
  function applyFlight(step: FlightStepResult): Promise<void> {
    return observeFlightStatus(decodeFlightStatus(step.flight));
  }

  async function loadFlightStatus(): Promise<void> {
    try {
      await applyFlight(await api.getFlightStatus(callOptions));
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
  }

  /**
   * Docking is not instant — the dock command returns while the ship is still
   * "landing", so its immediate flight status is usually NOT docked yet. If
   * nothing is ambiently polling (e.g. no space panel is mounted, or a bot that
   * had been reading status has stopped), the store never learns the ship
   * actually docked and the UI stays on the space shell. So after a dock we
   * re-read a few times until the docked state lands, applying each read (which
   * flips the shell through the normal funnel). Bounded and best-effort.
   */
  async function settleUntilDocked(): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      let status: FlightStatus | null = null;
      try {
        status = decodeFlightStatus((await api.getFlightStatus(callOptions)).flight);
      } catch (error) {
        if (isSessionLost(error)) {
          stopLiveStream();
          store.apply({ type: "character/offline" });
          return;
        }
      }
      if (status !== null) {
        void observeFlightStatus(status);
        if (status.docked) {
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  // --- R11 Space overview + ship HUD ---------------------------------------

  // R30 slice A — the gate links that ride WITH each snapshot.
  //
  // The route graph is fetched once and cached (`loadRouteGraph`), but that read
  // is asynchronous while a snapshot arrives every second. So this is written to
  // be answerable SYNCHRONOUSLY or not at all: if the graph is already in hand,
  // the links come back with the snapshot; if it is not, this returns undefined
  // (meaning "no answer this time", which the store treats as "keep what you
  // had") and kicks off the one-time load in the background so the next beat can
  // answer. Nothing here ever blocks a snapshot on a map read.
  let gateMapLoading = false;
  let gateMapFailed = false;
  function gateLinksForSnapshot(
    snapshot: { readonly solarSystemID: number | null; readonly inSpace: boolean },
  ): readonly GateLink[] | undefined {
    if (!snapshot.inSpace || snapshot.solarSystemID === null) {
      return undefined;
    }
    if (routeGraph) {
      return buildGateLinks(routeGraph, snapshot.solarSystemID);
    }
    if (!gateMapLoading && !gateMapFailed) {
      gateMapLoading = true;
      void loadRouteGraph()
        .catch(() => {
          // Said once, not once per second: a map that cannot be read is a
          // standing condition, and re-reporting it every beat would bury the
          // rest of the panel's errors.
          gateMapFailed = true;
          store.apply({
            type: "space/gate-map-error",
            message: "Could not read the star map, so jumps are not offered here.",
          });
        })
        .finally(() => {
          gateMapLoading = false;
        });
    }
    return undefined;
  }

  // Read what the ship can currently see (plus its own shield/armor/hull/cap)
  // and push it to the space slice. A failed read is surfaced as a non-fatal
  // panel error rather than thrown at the poller — except a lost session, which
  // unwinds to character select like every other held-session read.
  //
  // Docked is not an error: the gateway answers a docked session with an empty
  // overview, and the slice is cleared so the panel shows the docked message
  // instead of a stale grid.
  async function loadSpaceSnapshot(): Promise<void> {
    let result;
    try {
      result = await api.getSpaceSnapshot({ ...callOptions, priority: "poll" });
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "space/error",
        message: `The view around the ship could not be read: ${flightRefusalWords(error)}`,
      });
      return;
    }
    const snapshot = decodeSpaceSnapshot(result.space);
    store.apply({
      type: "space/snapshot",
      snapshot,
      gateLinks: gateLinksForSnapshot(snapshot),
    });
    // Keep the flight readout honest too: a snapshot that says the ship is no
    // longer in space means the poll is about to stop, and the panel should not
    // keep showing the last grid it saw.
    if (!snapshot.inSpace) {
      store.apply({ type: "space/cleared" });
    }
  }

  // The ~1s overview poll. It runs while SOMETHING is watching space AND the
  // ship is in space AND the page is actually on screen, and it skips a beat
  // rather than queueing when a read is slow, so it never piles work behind the
  // autopilot's own flight-status cadence.
  //
  // R30 slice B — WHY THIS IS A COUNT AND NOT A BOOLEAN.
  //
  // It used to be `spacePanelOpen: boolean`, and the Overview panel was its only
  // caller. Tabs unmount their panel (App.svelte renders `{#if page === …}`), so
  // leaving "Around your ship" called stopSpacePolling and FROZE the cockpit:
  // the snapshot, the lock list, the gauges, the distances and the hostile list
  // all stopped updating. Switching to Travel to set a destination actively
  // stopped the data feed for the ship you were flying. The app punished the
  // very tab switch it forced on you.
  //
  // So the flag becomes a claim count and every panel that shows live space
  // data claims on mount and releases on unmount. Two claims and one release
  // must keep polling — that is the whole point, and it is what the test pins.
  //
  // ⚠ DO NOT "simplify" this into a global `isInSpace()` test. That was the
  // obvious-looking alternative and it is wrong twice: it would poll the ship
  // continuously while the player sits in Market or Mail reading nothing about
  // space, and it would make startSpacePolling/stopSpacePolling lying no-ops —
  // named as if they controlled something they no longer controlled.
  let spaceViewers = 0;

  // A backgrounded tab is not a viewer. `document` is absent under the test
  // runner and the server generator, where "not visible" would wrongly disable
  // every poll — so absence means visible.
  const pageIsVisible = (): boolean =>
    typeof document === "undefined" || document.visibilityState === "visible";
  /** When the locked-target list was last read. See targetsReadIsDue. */
  let lastTargetsReadAtMs: number | null = null;
  const spacePoller: SpacePoller = createSpacePoller({
    // R23: the locked-target list rides the SAME ~1s beat as the snapshot.
    // Locking is asynchronous — the server acquires a lock over a duration — so
    // without a poll the page would show "Locking…" forever. The targets read
    // is best-effort: it must never make a snapshot read look like a failure.
    refresh: async () => {
      await loadSpaceSnapshot();
      // Skip the targets read while the custom bot is running: its own tick already
      // reads the locks and pushes them to the store, so polling them again here
      // only doubles the gateway load — the contention that was timing this read
      // out. The overview's lock list stays fresh from the bot's push. (The poller
      // stays armed either way, so it resumes reading targets the moment the bot
      // stops — no re-arm needed.)
      // ⚠ AND IT KEEPS ITS OWN CADENCE (R92). This read used to ride the
      // snapshot beat, so raising the overview's refresh rate tripled it too —
      // six owner calls a second per pilot where there had been two, against a
      // gateway that serialises them. Locks change on human timescales; the
      // grid's smoothness is not a reason to ask about them more often.
      if (
        store.space.get().snapshot?.inSpace === true &&
        store.customBot.get().status !== "running" &&
        targetsReadIsDue(lastTargetsReadAtMs, Date.now())
      ) {
        lastTargetsReadAtMs = Date.now();
        await loadTargets().catch(() => {});
      }
    },
    shouldPoll: () => {
      if (spaceViewers <= 0) {
        return false;
      }
      if (!pageIsVisible()) {
        return false;
      }
      const flight = store.flight.get().status;
      const space = store.space.get().snapshot;
      // Trust either source: the flight slice is authoritative for in-space, and
      // a fresh snapshot that says "not in space" stops the poll immediately.
      if (space && !space.inSpace) {
        return false;
      }
      return flight === null || flight.inSpace;
    },
  });

  // The poller DISARMS ITSELF whenever a beat finds shouldPoll() false — that is
  // deliberate (a docked player and a hidden tab must cost nothing), but it also
  // means nothing re-arms it when the reason goes away. With a boolean that was
  // masked by the panel remounting on every tab switch; with a claim that
  // survives docking, it would be a poll that stops at the station and never
  // comes back. So both "the reason went away" edges call this.
  const resumeSpacePolling = (): void => {
    if (spaceViewers > 0 && !spacePoller.running()) {
      spacePoller.start();
    }
  };

  // The tab came back to the foreground. Registered once for the life of the
  // flow (which is the life of the page), and guarded for the test runner and
  // the server generator, where there is no document.
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (pageIsVisible()) {
        resumeSpacePolling();
      }
    });
  }

  /** Claim the space feed (a panel showing live space data has mounted). */
  const startSpacePolling = (): void => {
    spaceViewers += 1;
    // Not `if (spaceViewers === 1)`: the poller may have disarmed itself on a
    // dock while other viewers still held claims, and a newly-mounted panel is
    // exactly the moment to try again.
    spacePoller.start();
  };
  /** Release the claim. The feed stops only when the LAST viewer lets go. */
  const stopSpacePolling = (): void => {
    spaceViewers = Math.max(0, spaceViewers - 1);
    if (spaceViewers === 0) {
      spacePoller.stop();
    }
  };

  // --- R23 slice A: targeting + module activation --------------------------
  //
  // THE GENERIC IN-SPACE ACTION LAYER. Nothing below names mining, combat,
  // salvaging or ewar, and nothing should: lockTarget/unlockTarget take a ball,
  // activateModule/deactivateModule take a module and an OPTIONAL effect name.
  // Slice B drives a mining laser through these four; a later combat goal
  // drives a turret through the same four unchanged.
  //
  // Every one of them obeys the same two rules:
  //   1. A REFUSAL carries the server's own reason verbatim (targeting/action-error).
  //   2. A 200 IS NOT PROOF — the BFF re-reads the authoritative state after
  //      every mutation, and when that re-read shows nothing changed AND the
  //      server gave no reason, that is reported as a SILENT DECLINE
  //      (targeting/silent-decline), a different thing from a refusal. The page
  //      never invents a cause for it.

  /** Read the locked-target list. Also used by the overview poll. */
  async function loadTargets(): Promise<void> {
    let result;
    try {
      result = await api.getTargets(callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      // BEST-EFFORT, and it must STAY quiet on a transient failure. Every caller is
      // a background beat (the ~1s overview poll, the panel's mount) wrapped in its
      // own `.catch`, so a one-off gateway timeout here is not news to the player —
      // and the targeting slice has no self-clearing read-error slot, so surfacing
      // it would leave a banner stuck on screen long after the very next beat
      // succeeded. The last-known lock list stays; a real gateway outage still shows
      // through the snapshot read, which owns the "are we connected" story. So we
      // swallow it (a console note for diagnosis) rather than alarm over it.
      if (typeof console !== "undefined") {
        console.warn("loadTargets: locked-target read failed (transient, ignored)", error);
      }
      return;
    }
    store.apply({ type: "targeting/targets", targetIDs: decodeTargetIDs(result.targetIDs) });
  }

  /**
   * Run one targeting/activation action: record it, surface a refusal verbatim,
   * and land the server's own re-read. `verify` decides whether the action
   * actually took effect; false with no thrown refusal is a SILENT DECLINE.
   */
  async function runTargetingAction<T>(
    label: string,
    step: () => Promise<T>,
    apply: (result: T) => void | Promise<void>,
    verify: (result: T) => boolean,
    declineMessage: string,
  ): Promise<void> {
    let result: T;
    try {
      result = await step();
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "targeting/action-error",
        message: `${label} refused: ${flightRefusalWords(error)}`,
      });
      return;
    }
    store.apply({ type: "targeting/action", action: label });
    await apply(result);
    if (!verify(result)) {
      store.apply({ type: "targeting/silent-decline", message: declineMessage });
    }
  }

  /** What is locked, read now: the only authority on it (the page's read of dogmaIM.GetTargets). */
  async function readLockedTargetIDs(): Promise<readonly number[]> {
    return decodeTargetIDs((await api.getTargets(callOptions)).targetIDs);
  }

  /**
   * Lets go of a thing by the one of the client's two calls that what the page has of it says
   * (bridge/targetWrites.ts), and reads what is locked after. A lock the page took to be still being made, and
   * the read shows made, is let go of as the lock it is: one asking does for either.
   */
  async function releaseTarget(targetID: number): Promise<{ released: boolean; targetIDs: readonly number[] }> {
    const locked = store.targeting.get().lockedTargetIDs.includes(targetID);
    await unlockTargetCall(bridgeDo, targetID, locked ? "locked" : "acquiring");
    let targetIDs = await readLockedTargetIDs();
    if (!locked && targetIDs.includes(targetID)) {
      await unlockTargetCall(bridgeDo, targetID, "locked");
      targetIDs = await readLockedTargetIDs();
    }
    return { released: !targetIDs.includes(targetID), targetIDs };
  }

  async function lockTarget(targetID: number): Promise<void> {
    await runTargetingAction(
      "Lock",
      // The page's own call (bridge/targetWrites.ts): none for a thing the page has locked or is locking. And then
      // what is locked, read: a lock asked is not a lock made.
      async () => {
        const { pending } = await lockTargetCall(bridgeDo, targetID, store.targeting.get());
        const targetIDs = await readLockedTargetIDs();
        // (A lock the call said was still being made and the read shows made: the store takes no note of a
        // thing being locked that it has locked.)
        return { locked: targetIDs.includes(targetID), acquiring: pending, targetIDs };
      },
      (result) => {
        store.apply({ type: "targeting/targets", targetIDs: result.targetIDs });
        if (result.acquiring) {
          store.apply({ type: "targeting/acquiring", targetID });
        }
      },
      // Accepted-and-acquiring is a SUCCESS: a lock takes time, and reporting
      // "nothing happened" while the server is mid-acquisition would be wrong.
      (result) => result.locked || result.acquiring,
      "The server accepted that lock and then did not lock anything, and gave no reason.",
    );
  }

  async function unlockTarget(targetID: number): Promise<void> {
    await runTargetingAction(
      "Unlock",
      () => releaseTarget(targetID),
      (result) => {
        store.apply({ type: "targeting/targets", targetIDs: result.targetIDs });
        // The client's own mark of a thing being locked goes when it lets go (targetMgr.py 1299): so does the page's.
        if (result.released) {
          store.apply({ type: "targeting/lock-event", event: { kind: "lost", targetID, reason: null } });
        }
      },
      (result) => result.released,
      "The server did not release that lock, and gave no reason.",
    );
  }

  async function activateModule(
    itemID: number,
    opts: { effect?: string; typeID?: number; targetID?: number | null; repeat?: -1 | 0 } = {},
  ): Promise<void> {
    await runTargetingAction(
      "Switch on",
      () => switchModuleOn(itemID, opts, callOptions),
      // Refresh the snapshot NOW rather than waiting for the next poll tick, so
      // the button state the player sees after the click is the server's answer
      // to THIS action. Best-effort: a failed refresh must not turn a
      // successful activation into an error.
      () => loadSpaceSnapshot().catch(() => {}),
      // null means the verification read could not answer. That is NOT a silent
      // decline — we simply do not know — so it is not reported as one.
      (result) => result.active !== false,
      "The server accepted that module and then did not run it, and gave no reason.",
    );
  }

  // --- R23 slice B: the mining loop ----------------------------------------
  //
  // mine -> haul -> refine -> sell. There is deliberately NO mining loop
  // controller here: mining a rock is lockTarget + activateModule above, and the
  // browser never simulates a cycle, predicts a yield or decides when a hold is
  // full. It reads the server and shows the answer.

  /** Read the ship's mining holds (ore / gas / ice, falling back to cargo). */
  async function loadMiningHolds(): Promise<void> {
    let result;
    try {
      result = await api.getMiningHolds(callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "mining/holds-error",
        message: `Your holds could not be read: ${flightRefusalWords(error)}`,
      });
      return;
    }
    store.apply({ type: "mining/holds", holds: decodeMiningHolds(result.holds) });
  }

  /** The hangar read again where the pilot is docked, for the Mining window's list of its ore. It fails for itself. */
  async function hangarWhereDocked(): Promise<void> {
    if (store.flight.get().status?.docked === true) await loadInventory().catch(() => {});
  }

  /** The Mining window's own read: the ship's holds, and the hangar where the pilot is docked. */
  async function loadMiningWindow(): Promise<void> {
    await loadMiningHolds();
    await hangarWhereDocked();
  }

  /** Run the survey scanner and land what it saw. */
  async function runSurveyScan(): Promise<void> {
    let result;
    try {
      result = await api.runSurveyScan(callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "mining/survey-error",
        message: `The survey scan failed: ${flightRefusalWords(error)}`,
      });
      return;
    }
    if (result.asked === false) {
      // The client makes no scan from a ship with no mining scanner upgrade, and the BFF asked for none.
      store.apply({ type: "mining/survey-error", message: "No scan was made: this ship has no mining scanner upgrade." });
      return;
    }
    store.apply({
      type: "mining/survey",
      survey: decodeSurveyResults(result.results),
      atMs: Date.now(),
    });
  }

  // ── The surveyor, run FOR a mining bot ─────────────────────────────────────
  //
  // A player presses the Mining Surveyor button; a bot has to decide for itself,
  // and the deciding is `nav/surveyScan.ts` — the real client's own rules (an
  // 8 s busy window while the scan wave is travelling, ten calls a minute, never
  // in warp, and no re-asking about a rock already covered). Everything this
  // adds is the round trip and the two places the answer lands: the ship's own
  // memory of the grid, and the store, so the overview shows what the bot saw.
  //
  // ⚠ IT MERGES, IT DOES NOT REPLACE. `surveyedSnapshot` only fills rock rows
  // the server left blank, so a scan can never overwrite a live number with a
  // stale one — and a grid nobody scanned looks exactly as it did before.
  let surveyMemory: SurveyMemory = EMPTY_SURVEY_MEMORY;

  async function surveyForBot(snapshot: SpaceSnapshot): Promise<SpaceSnapshot> {
    if (!snapshot.inSpace) {
      // Docked or jumping — the client's `OnSessionChanged`, which clears the
      // scan data because it described a grid the ship has left.
      surveyMemory = forgetSurvey(surveyMemory);
      return snapshot;
    }
    // A hull swap re-arms the scanner: a Venture with no upgrade fitted must
    // not condemn the Procurer the pilot boards next.
    surveyMemory = surveyForShip(surveyMemory, snapshot.ship?.itemID ?? snapshot.shipID ?? null);
    const now = Date.now();
    if (decideSurveyScan(snapshot, surveyMemory, now).scan) {
      try {
        const answer = await api.runSurveyScan(callOptions);
        if (answer.asked === false) {
          // The ship has no mining scanner upgrade and the BFF asked nothing, as the client asks nothing
          // (asteroid_scanning_service.py 103). No scan was made, so none is landed.
          surveyMemory = rememberNoScannerUpgrade(surveyMemory);
        } else {
          const survey = decodeSurveyResults(answer.results);
          surveyMemory = rememberSurveyScan(surveyMemory, snapshot, survey, now);
          store.apply({ type: "mining/survey", survey, atMs: now });
        }
      } catch {
        // A refused or unreadable scan is not an answer about any rock, and it
        // is not a reason to stop a bot either. It costs a throttle slot, and
        // two in a row retire the scanner for this run — a hull with no mining
        // scanner upgrade must not be asked once every two seconds for ever.
        surveyMemory = rememberSurveyFailure(surveyMemory, now);
      }
    }
    return surveyedSnapshot(snapshot, surveyMemory);
  }

  /** Ask the refinery what these stacks would yield — and what the tax is. */
  async function loadReprocessingQuote(itemIDs: readonly number[]): Promise<void> {
    if (itemIDs.length === 0) {
      store.apply({ type: "mining/quotes", quotes: [], taxRate: null, quotesFor: [] });
      return;
    }
    let result;
    try {
      result = await api.getReprocessingQuote(itemIDs, callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "mining/quotes-error",
        message: `The refinery could not quote that: ${flightRefusalWords(error)}`,
      });
      return;
    }
    store.apply({
      type: "mining/quotes",
      quotes: decodeReprocessingQuotes(result.quotes),
      taxRate: decodeTaxRate(result.taxRate),
      quotesFor: [...itemIDs],
    });
  }

  /**
   * Run one mining action and report what it ACTUALLY did.
   *
   * Both actions here move or consume real items, so neither trusts its own
   * 200: the BFF re-reads and answers which stacks really moved. `moved: null`
   * means the verification read itself failed — that is reported as "could not
   * check", never as success and never as a decline.
   */
  async function runMiningAction(
    label: string,
    step: () => Promise<{
      readonly requested: readonly number[];
      readonly moved: readonly number[] | null;
    }>,
    partial: (moved: number, total: number) => string,
    none: string,
    unverified: string,
    // The stacks that were said beforehand to stay: one of them left is as it was foretold, and no decline.
    foretold: ReadonlySet<number> = new Set(),
  ): Promise<void> {
    let result;
    try {
      result = await step();
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "mining/action-error",
        message: `${label} refused: ${flightRefusalWords(error)}`,
      });
      return;
    }
    store.apply({ type: "mining/action", action: label });
    // Whatever happened, the holds are the ground truth now.
    await loadMiningHolds().catch(() => {});
    // And the hangar, where the pilot is docked: what was unloaded went into it, and what was refined was made in it.
    await hangarWhereDocked();
    if (result.moved === null) {
      store.apply({ type: "mining/silent-decline", message: unverified });
      return;
    }
    if (result.moved.length === 0) {
      store.apply({ type: "mining/silent-decline", message: none });
      return;
    }
    const moved = result.moved;
    if (result.requested.some((itemID) => !moved.includes(itemID) && !foretold.has(itemID))) {
      store.apply({
        type: "mining/silent-decline",
        message: partial(result.moved.length, result.requested.length),
      });
    }
  }

  /**
   * ⚠ JETTISON. The stacks leave the ship into a container in space that anyone
   * can take. The panel confirms first, as the client asks (ConfirmJettison).
   *
   * ⚠ JUDGED BY THE ANSWER, AS THE CLIENT JUDGES IT. The page's own call
   * (jettisonNow) answers what went into a can and what was launched as itself;
   * a stack in neither did not go (invItemFunctions.Jettison 63 to 72, where the
   * client raises NotAllItemsWereJettisoned), and that is a silent decline — the
   * failure mode this whole client exists to stop looking like a success. The
   * hold is read again after, for the window.
   */
  async function jettisonItems(itemIDs: readonly number[]): Promise<void> {
    if (itemIDs.length === 0) {
      return;
    }
    let outcome: JettisonOutcome;
    try {
      outcome = await jettisonNow(itemIDs);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "mining/action-error",
        message: `Jettison refused: ${flightRefusalWords(error)}`,
      });
      return;
    }
    store.apply({ type: "mining/action", action: "Jettison" });
    await loadMiningHolds().catch(() => {});
    const asked = new Set(itemIDs).size;
    const left = asked - outcome.stayed.length;
    if (left === 0) {
      store.apply({
        type: "mining/silent-decline",
        message: "Nothing was jettisoned, and the server gave no reason.",
      });
      return;
    }
    if (outcome.stayed.length > 0) {
      store.apply({
        type: "mining/silent-decline",
        message: `Only ${left} of ${asked} stacks were jettisoned. The server did not say why the rest stayed.`,
      });
    }
  }

  /**
   * ⚠ COMPRESS ONE STACK, against a support ship on the grid.
   *
   * ⚠ THE REFUSAL IS ONE SILENCE, AND THIS DOES NOT GUESS AT IT. The server
   * answers `compressed: false` for a missing facility, an out-of-range one, a
   * foreign item and an ore that has no compressed form alike. Naming one of
   * those would put an invented cause on screen beside real ones, so the
   * message says what is actually known: it was refused, and the hold has been
   * re-read so the player can see for themselves.
   */
  async function compressOre(itemID: number, facilityID: number): Promise<void> {
    let attempt;
    try {
      // The page's own call (bridge/compressionWrites.ts: itemCompression.CompressItemInSpace), whose answer is None
      // where nothing was compressed. Until 2026-10-14 the BFF's route made it.
      const result = await compressItemInSpace(bridgeDo, itemID, facilityID);
      attempt = { compressed: result !== null && result !== undefined };
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "mining/action-error",
        message: `Compress refused: ${flightRefusalWords(error)}`,
      });
      return;
    }
    store.apply({ type: "mining/action", action: "Compress" });
    // Whatever happened, the hold is the ground truth now.
    await loadMiningHolds().catch(() => {});
    if (!attempt.compressed) {
      store.apply({
        type: "mining/silent-decline",
        message:
          "That stack was not compressed. Your ship gave no reason — check the support ship is in range and still running its gear, and that the ore has a compressed form.",
      });
    }
  }

  // --- R25 slice A: drones ---------------------------------------------------

  /** Read the bay, what is in space, and the limits — one BFF round trip. */
  async function loadDrones(): Promise<void> {
    let result;
    try {
      result = await api.getDrones(callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "drones/error",
        message: `Your drones could not be read: ${flightRefusalWords(error)}`,
      });
      return;
    }
    droneBayShipID = typeof result.activeShipID === "number" ? result.activeShipID : null;
    store.apply({
      type: "drones/loaded",
      // null survives all the way to the panel: a failed read is "not known",
      // never an empty bay and never "no drones in space".
      bay: decodeDroneBay(result.bay),
      inSpace: decodeDronesInSpace(result.inSpace),
      limits: decodeDroneLimits(result.shipInfo),
    });
  }

  /**
   * Run one drone action and report what it ACTUALLY did.
   *
   * The shape is the same for all four: issue the call, land the fresh
   * in-space list the BFF re-read, and then decide whether anything happened.
   * `changed` is the per-action test — for a launch it is "did any new drone
   * appear", for an order it is "does the server still report these drones".
   * A null in-space list means the re-read failed, which is reported as
   * "could not check" and never as success.
   */
  /**
   * R34 — the server's per-drone reasons, turned into reports the panel can
   * render, with every droneID resolved to a NAME on the way through.
   *
   * ⚠ THE ID DIES HERE (R7d). The result dict is keyed by droneID and that key
   * is the only thing tying a sentence to a drone; it is spent on the lookup
   * and never stored. A report carries a label or nothing — there is no id
   * field for the panel to accidentally print.
   *
   * ⚠ AND THE SENTENCE IS NOT REWORDED. It goes through `sayRefusal`
   * (R31's one seam), which passes prose straight through — that is what makes
   * an UNKNOWN fourteenth sentence survive intact instead of being swallowed,
   * while a code or identifier still falls back to R31's generic wording rather
   * than being shown raw. Matching the thirteen against a table here would be
   * us talking over a server that already said it better.
   *
   * The name is looked for in the FRESH list first and the previous one second:
   * a drone that has just left space still has a name in the list we held a
   * moment ago, and "one of your drones" is a worse answer than the truth when
   * the truth is still sitting in the store.
   */
  function droneOrderReports(
    result: JsonValue,
    inSpace: readonly DroneInSpace[] | null,
  ): readonly DroneOrderReport[] {
    const refusals = decodeDroneOrderRefusals(result);
    if (refusals.length === 0) {
      return [];
    }
    const named = new Map<number, string>();
    for (const drone of store.get().drones.inSpace ?? []) {
      if (drone.name) {
        named.set(drone.itemID, drone.name);
      }
    }
    for (const drone of inSpace ?? []) {
      if (drone.name) {
        named.set(drone.itemID, drone.name);
      }
    }
    // No dedupe, no merge, no collapse: one report per refusal, in the order
    // the server gave them (R30 — two drones that share a name are still two
    // drones, and hiding the second is the bug this pattern exists to stop).
    return refusals.map((refusal) => ({
      label: named.get(refusal.droneID) ?? null,
      text: sayRefusal(refusal.raw),
    }));
  }

  async function runDroneAction(
    label: string,
    step: () => Promise<{
      readonly inSpace: JsonValue;
      readonly launched: JsonValue;
      readonly result: JsonValue;
    }>,
    verify: (
      inSpace: readonly DroneInSpace[] | null,
      launched: readonly DroneInSpace[] | null,
      /**
       * What the SERVER already said, per drone. A verifier that would end
       * "and gave no reason" must check this first: the reports render
       * alongside the decline, and claiming silence next to the server's own
       * sentence is simply false.
       */
      reports: readonly { readonly label: string | null; readonly text: string }[],
    ) => string | null,
  ): Promise<void> {
    let result;
    try {
      result = await step();
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "drones/action-error",
        message: `${label} refused: ${flightRefusalWords(error)}`,
      });
      return;
    }
    const inSpace = decodeDronesInSpace(result.inSpace);
    store.apply({ type: "drones/action", action: label });
    store.apply({ type: "drones/in-space", inSpace });
    // R34 — what the SERVER said, per drone, before this client judges anything.
    // It is applied AFTER `drones/action` (which clears the previous order's
    // reports) and independently of the verifier below, so a refusal the server
    // explained can never be displaced by our own guess about the same call.
    const reports = droneOrderReports(result.result, inSpace);
    store.apply({ type: "drones/order-reports", reports });
    const complaint = verify(inSpace, decodeDronesInSpace(result.launched), reports);
    if (complaint !== null) {
      store.apply({ type: "drones/silent-decline", message: complaint });
    }
    // The bay changed too (drones left it, or came back into it).
    await loadDrones().catch(() => {});
  }

  async function launchDrones(itemIDs: readonly number[]): Promise<void> {
    // The whole stack, as the retail client's Launch does: the panel picks
    // stacks, the bay it was drawn from says how many are in each.
    const request = wholeStackLaunch(itemIDs, droneStackSizes(store.drones.get().bay ?? []));
    const requestedCount = request.reduce((sum, entry) => sum + entry.quantity, 0);
    await runDroneAction(
      "Launch",
      () => launchedThenRead(request),
      (inSpace, launched) => {
        if (inSpace === null || launched === null) {
          return "The launch was accepted, but space could not be re-read, so what launched is unknown.";
        }
        if (launched.length === 0) {
          // The refusal case the server does not report: bandwidth, the active
          // drone cap, a stack that moved. All of them answer an empty dict.
          return "No drones launched. Check your bandwidth and how many are already out.";
        }
        if (launched.length < requestedCount) {
          return `Only ${launched.length} of ${requestedCount} drones launched — the rest did not fit in your bandwidth or drone limit.`;
        }
        return null;
      },
    );
  }

  /**
   * Drones launched by the page's own call (bridge/boundEntityWrites.ts: eveMisc.LaunchFromShip), with the drones
   * read before and after, as the launch's route read them until 2026-10-14. The drones the answer names come into
   * the pilot's park with its next update, which the first read may be ahead of: the drones are read again, a quarter
   * of a second apart, three seconds at most, while one the answer named is not out (where the answer names none,
   * nothing is waited for). Answers the drones in space and those new among them, null where a read failed.
   */
  async function launchedThenRead(stacks: readonly { readonly itemID: number; readonly quantity: number }[]): Promise<{
    readonly inSpace: JsonValue;
    readonly launched: JsonValue;
    readonly result: JsonValue;
  }> {
    let before: JsonValue = null;
    try {
      before = (await api.getDrones(callOptions)).inSpace;
    } catch {
      before = null;
    }
    const already = new Set((decodeDronesInSpace(before) ?? []).map((drone) => drone.itemID));
    const answer = await launchDronesCall(bridgeDo, stacks);
    const named = decodeLaunched(answer)?.droneIDs ?? [];
    let inSpace: JsonValue = null;
    try {
      inSpace = (await api.getDrones(callOptions)).inSpace;
      const missing = (read: JsonValue): boolean => {
        const out = new Set((decodeDronesInSpace(read) ?? []).map((drone) => drone.itemID));
        return named.some((droneID) => !out.has(droneID));
      };
      for (let waited = 0; waited < LAUNCH_ARRIVAL_WAIT_MS && missing(inSpace); waited += LAUNCH_ARRIVAL_STEP_MS) {
        await new Promise((resolve) => setTimeout(resolve, LAUNCH_ARRIVAL_STEP_MS));
        inSpace = (await api.getDrones(callOptions)).inSpace;
      }
    } catch {
      inSpace = null;
    }
    const rows = Array.isArray(inSpace) ? inSpace : null;
    const launched: JsonValue = before === null || rows === null
      ? null
      : rows.filter((row) => {
        const itemID = row !== null && typeof row === "object" && !Array.isArray(row) ? Number((row as Record<string, JsonValue>).itemID) : Number.NaN;
        return !already.has(itemID);
      });
    return { inSpace, launched, result: null };
  }

  /** The three in-space orders share one verification: did we still see them? */
  function orderVerifier(
    droneIDs: readonly number[],
    unverified: string,
  ): (inSpace: readonly DroneInSpace[] | null) => string | null {
    return (inSpace) => {
      if (inSpace === null) {
        return unverified;
      }
      const known = new Set(inSpace.map((drone) => drone.itemID));
      const missing = droneIDs.filter((itemID) => !known.has(itemID));
      // ⚠ A drone that is GONE from space is not a failure for a recall — it is
      // the recall finishing. Only the orders that expect the drone to still be
      // flying treat a disappearance as worth mentioning, which is why the
      // recall path below does not use this verifier.
      return missing.length === droneIDs.length
        ? "The order was accepted, but none of those drones are in space any more."
        : null;
    };
  }

  /**
   * An order to drones by the page's own call (bridge/boundEntityWrites.ts: the client's droneFunctions), and then
   * the drones as they are read again. What the server says of each drone that could not is the order's own answer.
   * Until 2026-10-14 the engagement, the mining and the sending home were routes of the BFF that did both.
   */
  async function orderedThenRead(order: () => Promise<JsonValue>): Promise<{
    readonly inSpace: JsonValue;
    readonly launched: JsonValue;
    readonly result: JsonValue;
  }> {
    const result = await order();
    const read = await api.getDrones(callOptions);
    return { inSpace: read.inSpace, launched: null, result };
  }

  /**
   * An engagement a bot must see settled before it goes on: each drone ordered is read in space after, set on the
   * target, or the server said why not (bridge/drones.ts, decodeDroneEngageOutcome); otherwise it fails with what
   * was and was not taken (api.DroneEngageOutcomeError).
   */
  async function engageDronesConfirmed(droneIDs: readonly number[], targetID: number): Promise<void> {
    const { inSpace, result } = await orderedThenRead(() => engageWithDrones(bridgeDo, droneIDs, targetID));
    const outcome = decodeDroneEngageOutcome(result, inSpace, droneIDs, targetID);
    if (outcome.status !== "accepted") throw new api.DroneEngageOutcomeError(outcome);
  }

  async function engageDrones(droneIDs: readonly number[], targetID: number): Promise<void> {
    await runDroneAction(
      "Engage",
      () => orderedThenRead(() => engageWithDrones(bridgeDo, droneIDs, targetID)),
      orderVerifier(droneIDs, "The order was accepted, but space could not be re-read."),
    );
  }

  async function mineWithDrones(droneIDs: readonly number[], targetID: number): Promise<void> {
    await runDroneAction(
      "Mine",
      () => orderedThenRead(() => mineWithDronesCall(bridgeDo, droneIDs, targetID)),
      orderVerifier(droneIDs, "The order was accepted, but space could not be re-read."),
    );
  }

  async function salvageDrones(droneIDs: readonly number[], targetID: number | null): Promise<void> {
    // The client's Salvage is never called with none (droneFunctions.PerformPrimaryAction, the menu's one drone).
    if (droneIDs.length === 0) return;
    await runDroneAction(
      "Salvage",
      // droneFunctions.Salvage (156 to 161): the order, and then the drones as they are read again. What the
      // server says of each drone that could not is the order's own answer.
      async () => {
        const result = await salvageWithDrones(bridgeDo, droneIDs, targetID);
        const read = await api.getDrones(callOptions);
        return { inSpace: read.inSpace, launched: null, result };
      },
      orderVerifier(droneIDs, "The order was accepted, but space could not be re-read."),
    );
  }

  async function recallDrones(droneIDs: readonly number[]): Promise<void> {
    await runDroneAction(
      "Recall",
      () => orderedThenRead(() => returnDronesToBay(bridgeDo, droneIDs)),
      (inSpace) =>
        inSpace === null
          ? "The recall was accepted, but space could not be re-read."
          : // A recalled drone stays visibly in space, flying home, until the
            // runtime scoops it inside 2500 m. So there is nothing to complain
            // about either way: still-there is in progress, gone is done.
            null,
    );
  }

  /**
   * Take control of orphaned drones (entity.CmdReconnectToDrones).
   *
   * Success is the drone becoming CONTROLLED, which the re-read answers
   * directly — not its presence in space, which was never in doubt.
   */
  async function reconnectDrones(droneIDs: readonly number[]): Promise<void> {
    await runDroneAction(
      "Reconnect",
      // The page's own call (bridge/boundEntityWrites.ts), and then the drones as they are read again. What the
      // server says of each drone it would not take is the call's own answer.
      async () => {
        const result = await reconnectToDronesCall(bridgeDo, droneIDs);
        const read = await api.getDrones(callOptions);
        return { inSpace: read.inSpace, launched: null, result };
      },
      (inSpace, _launched, reports) => {
        if (inSpace === null) {
          return "The reconnect was accepted, but space could not be re-read.";
        }
        const asked = new Set(droneIDs);
        const stillLoose = inSpace.filter((drone) => asked.has(drone.itemID) && !drone.controlled);
        if (stillLoose.length === 0 || reports.length > 0) {
          // Either it worked, or the server already explained itself per drone
          // and those sentences are on screen — adding "gave no reason" beside
          // them would be a lie.
          return null;
        }
        return stillLoose.length === droneIDs.length
          ? "The server accepted that and none of them answered, and gave no reason."
          : `${stillLoose.length} of ${droneIDs.length} did not answer, and the server gave no reason.`;
      },
    );
  }

  /**
   * Scoop drones into the bay (ship.ScoopDrone).
   *
   * Success is the drone LEAVING space. A drone still out there was not
   * scooped — unlike a recall, there is no in-flight middle state to allow for.
   */
  async function scoopDrones(droneIDs: readonly number[]): Promise<void> {
    await runDroneAction(
      "Scoop",
      // The page's own call (bridge/boundEntityWrites.ts), and then the drones as they are read again. What the
      // server says of each drone it would not scoop is the call's own answer.
      async () => {
        const result = await scoopDronesCall(bridgeDo, droneIDs);
        let read = await api.getDrones(callOptions);
        // A scooped drone goes out of space with the ballpark's update that follows the call's answer, as a
        // launched one comes with it (the launch's route waits for that: DRONE_ARRIVAL_WAIT_MS, src/server.js).
        // This read is one round trip behind the call, which was enough each time it was measured on the game
        // port (2026-10-11) and which nothing promises. So while a drone the server refused nothing of is still
        // read as out, the drones are read again, a quarter of a second apart, three seconds at most; a drone
        // the server gave its reason for is not waited for.
        const refused = new Set(decodeDroneOrderRefusals(result).map((refusal) => refusal.droneID));
        const awaited = droneIDs.filter((droneID) => !refused.has(droneID));
        const stillOut = (inSpace: JsonValue): boolean =>
          (decodeDronesInSpace(inSpace) ?? []).some((drone) => awaited.includes(drone.itemID));
        const waitMs = options.scoopLeaveWaitMs ?? SCOOP_LEAVE_WAIT_MS;
        for (let waited = 0; waited < waitMs && stillOut(read.inSpace); waited += SCOOP_LEAVE_STEP_MS) {
          await new Promise((resolve) => setTimeout(resolve, SCOOP_LEAVE_STEP_MS));
          read = await api.getDrones(callOptions);
        }
        return { inSpace: read.inSpace, launched: null, result };
      },
      (inSpace, _launched, reports) => {
        if (inSpace === null) {
          return "The scoop was accepted, but space could not be re-read.";
        }
        const stillOut = inSpace.filter((drone) => droneIDs.includes(drone.itemID)).length;
        if (stillOut === 0 || reports.length > 0) {
          // Measured live: a scoop the server declines answers with a per-drone
          // CustomNotify ("That drone cannot currently be scooped into the drone
          // bay"), which the reports already carry. Saying "gave no reason"
          // underneath the server's own sentence is simply false.
          return null;
        }
        return stillOut === droneIDs.length
          ? "Nothing was scooped, and the server gave no reason."
          : `${stillOut} of ${droneIDs.length} stayed in space, and the server gave no reason.`;
      },
    );
  }

  /**
   * ⚠⚠ DEV-ONLY. Run a GM chat command, then re-read what it could have changed.
   *
   * A GM command does not belong to one panel: /giveitem lands in the hangar,
   * /gmships fits a hull, /giveskill rewrites the sheet. So rather than guess
   * which panel to refresh, the ones that are cheap and already loaded are all
   * re-read, and every one of them is allowed to fail quietly — a refresh that
   * did not work must not swallow the server's reply, which is the whole point
   * of the call.
   */
  async function runGmCommand(command: string): Promise<string> {
    // The page's own call (bridge/gmWrites.ts): the line as it was typed, to the slash service.
    const reply = await runSlashCommand(bridgeDo, command);
    await Promise.allSettled([
      loadInventory().catch(() => {}),
      loadFitting().catch(() => {}),
      loadDrones().catch(() => {}),
      loadSpaceSnapshot().catch(() => {}),
    ]);
    return reply;
  }

  /**
   * The ship's mining holds unloaded into the pilot's own hangar by the page's own call (bridge/inventoryWrites.ts,
   * moveItems: invCache.GetInventory(const.containerHangar), Add for one stack and MultiAdd for several, from the
   * ship they lie in), the holds read before for the stacks named (one in none of them is moved by nobody) and after
   * for what stayed, as the unload's route read them. A stack still in a hold did not move. Until 2026-10-14 the
   * BFF's route made it, which keeps a corporation division's delivery and an operation's for the bot host.
   */
  async function unloadToOwnHangar(itemIDs: readonly number[]): Promise<{ readonly requested: readonly number[]; readonly moved: readonly number[] | null }> {
    const now = decodeFlightStatus((await api.getFlightStatus(callOptions)).flight);
    if (!now.docked) throw Object.assign(new Error("Dock at a station before unloading."), { code: "NOT_DOCKED" });
    const requested = [...new Set(itemIDs.filter((itemID) => Number.isSafeInteger(itemID) && itemID > 0))];
    const held = async (): Promise<{ readonly shipID: number | null; readonly rows: readonly HoldItem[] }> => {
      const read = await api.getMiningHolds(callOptions);
      return { shipID: read.activeShipID, rows: decodeMiningHolds(read.holds).flatMap((hold) => hold.items ?? []) };
    };
    const before = await held();
    const shipID = before.shipID ?? now.shipID ?? null;
    if (shipID === null) throw Object.assign(new Error("No active ship."), { code: "NO_ACTIVE_SHIP" });
    const rows = requested.flatMap((itemID) => {
      const row = before.rows.find((each) => each.itemID === itemID);
      // (A quantity below nought is a singleton's, as the client reads one: eveMisc.LaunchFromShip, 19 to 21.)
      return row ? [{ itemID, quantity: row.quantity, singleton: row.quantity < 0 }] : [];
    });
    if (rows.length > 0) await moveItemsCall(bridgeDo, "hangar", { kind: "hangar" }, shipID, rows, null);
    let after: readonly HoldItem[];
    try {
      after = (await held()).rows;
    } catch {
      return { requested, moved: null };
    }
    const still = new Set(after.map((row) => row.itemID));
    return { requested, moved: requested.filter((itemID) => !still.has(itemID) && rows.some((row) => row.itemID === itemID)) };
  }

  async function unloadMiningHolds(itemIDs: readonly number[]): Promise<void> {
    await runMiningAction(
      "Unload",
      () => unloadToOwnHangar(itemIDs),
      (moved, total) =>
        `Only ${moved} of ${total} stacks moved to your hangar. The server did not say why the rest stayed.`,
      "Nothing moved to your hangar, and the server gave no reason.",
      "The unload was accepted, but your holds could not be re-read, so what moved is unknown.",
    );
  }

  /**
   * The refinery's Reprocess by the page's own calls (bridge/reprocessWrites.ts: itemReprocessor.Reprocess), each
   * item's place read as the route read it until 2026-10-14: the hangar of where the pilot is docked, and the ship's
   * mining holds where an item is not in it (an item in neither is asked of nobody). What an answer said it
   * reprocessed was; where an answer did not say, the places are read again, and a stack still there is taken for not
   * reprocessed (null, "could not check", where that read fails).
   */
  async function reprocessNow(itemIDs: readonly number[]): Promise<{ readonly requested: readonly number[]; readonly moved: readonly number[] | null }> {
    const now = decodeFlightStatus((await api.getFlightStatus(callOptions)).flight);
    const dockedAt = now.docked ? now.structureID ?? now.stationID ?? null : null;
    if (dockedAt === null) throw Object.assign(new Error("Dock at a station to use its refinery."), { code: "NOT_DOCKED" });
    const online = store.station.get().online;
    if (!online) throw new Error("No pilot is online.");
    const requested = [...new Set(itemIDs.filter((itemID) => Number.isSafeInteger(itemID) && itemID > 0))];
    let activeShipID: number | null = now.shipID ?? null;
    const placesOf = async (wanted: readonly number[]): Promise<Map<number, number>> => {
      const places = new Map<number, number>();
      for (const row of decodeInventoryRows((await api.loadInventory(callOptions)).hangar.list)) {
        if (wanted.includes(row.itemID)) places.set(row.itemID, dockedAt);
      }
      if (wanted.every((itemID) => places.has(itemID))) return places;
      const holds = await api.getMiningHolds(callOptions);
      activeShipID = holds.activeShipID ?? activeShipID;
      for (const hold of decodeMiningHolds(holds.holds)) {
        for (const item of hold.items ?? []) {
          if (wanted.includes(item.itemID) && !places.has(item.itemID) && activeShipID !== null) places.set(item.itemID, activeShipID);
        }
      }
      return places;
    };
    const outcomes = await reprocessCall(bridgeDo, requested, await placesOf(requested), activeShipID, { dockedAt, ownerID: online.characterID });
    const said = new Set<number>();
    const unsaid: number[] = [];
    for (const outcome of outcomes) {
      if (outcome.said === null) unsaid.push(...outcome.asked);
      else for (const itemID of outcome.said) said.add(itemID);
    }
    let gone = new Set<number>();
    if (unsaid.length > 0) {
      try {
        const still = await placesOf(unsaid);
        gone = new Set(unsaid.filter((itemID) => !still.has(itemID)));
      } catch {
        return { requested, moved: null };
      }
    }
    return { requested, moved: requested.filter((itemID) => said.has(itemID) || gone.has(itemID)) };
  }

  /**
   * ⚠ REPROCESS. This consumes the ore and charges the station's ISK tax. The
   * panel confirms first (showing the quote AND the tax). This method is
   * unconditional by design — the gate is before it, as with destroyRig.
   */
  async function reprocessItems(itemIDs: readonly number[]): Promise<void> {
    // What the quote on the page said of these stacks before they were refined: one with nothing to process is too
    // few for a batch, and is left as the page said it would be.
    const tooFew = new Set(store.mining.get().quotes.filter((quote) => quote.quantityToProcess === 0).map((quote) => quote.itemID));
    await runMiningAction(
      "Reprocess",
      () => reprocessNow(itemIDs),
      (moved, total) =>
        `Only ${moved} of ${total} stacks were reprocessed. The server did not say why the rest were left.`,
      "Nothing was reprocessed, and the server gave no reason.",
      "The refinery accepted that, but what you picked could not be read again, so what was reprocessed is unknown.",
      tooFew,
    );
    // The previous quote described stacks that may no longer exist.
    store.apply({ type: "mining/quotes", quotes: [], taxRate: null, quotesFor: [] });
  }

  /**
   * Switch a module off.
   *
   * ⚠ STILL RUNNING IS NOT A REFUSAL. Retail stops a module at the END OF ITS
   * CURRENT CYCLE, so `stopped:false` immediately after an ACCEPTED Deactivate
   * is the normal case, not a silent decline — this used to report "The server
   * did not stop that module, and gave no reason", which is alarming and wrong.
   * Measured live on a 1MN Civilian Afterburner: Deactivate accepted with
   * stopped:false and the module still in activeModuleIDs; ~12s later a repeat
   * Deactivate refused with "is not active" — it had stopped on its own.
   *
   * The same reasoning `lockTarget` already applies to a lock the server is
   * still acquiring: accepted-and-in-progress is a SUCCESS, and the panel says
   * what is true right now ("finishing its cycle") rather than predicting.
   * A genuine refusal still throws and lands in actionError, untouched.
   */
  /**
   * Start or stop overloading a module.
   *
   * ⚠ VERIFIED AGAINST THE SNAPSHOT, not the 200. Overloading is a state the
   * server owns and ends on its own, and this server has a habit of answering
   * success for writes that did nothing (LoadAmmo, Deactivate, ApplyFreeSkill
   * Points all do). So the snapshot's own overloaded list is the authority —
   * and a `null` list is "we could not tell", which is NOT a decline.
   */
  async function setModuleOverload(itemID: number, overloaded: boolean): Promise<void> {
    await runTargetingAction(
      overloaded ? "Overload" : "Stop overloading",
      async () => {
        // The client's button (shipmodulebutton.py 231): the module's own effect of the overload category is what
        // is named, and for a module that has none nothing is asked of the server at all.
        const module = store.fitting.get().slots.find((slot) => slot.module?.itemID === itemID)?.module ?? null;
        if (module === null) throw new Error("That module is not fitted to this ship.");
        const effectID = await overloadEffects.of(module.typeID);
        if (effectID === null) throw new Error("That module cannot be overloaded.");
        await setOverloadCall(bridgeDo, itemID, effectID, overloaded);
      },
      () => loadSpaceSnapshot().catch(() => {}),
      () => {
        const list = store.space.get().snapshot?.ship?.overloadedModuleIDs ?? null;
        if (list === null) {
          return true; // Unknown is not a decline.
        }
        return list.includes(itemID) === overloaded;
      },
      overloaded
        ? "The server accepted that and the module is not overloaded, and gave no reason."
        : "The server accepted that and the module is still overloaded, and gave no reason.",
    );
  }

  /**
   * How long godma would let this module's repair run (RepairModule_thread): the module's damage over the
   * character's repair rate, both godma's own from its priming. The damage is the ship's reading of it, a share
   * of the module's hit points.
   */
  async function repairWaitOf(itemID: number): Promise<number> {
    const primed = (): { hp: number | null; rate: number | null } => {
      const info = store.dogma.get().allInfo;
      const module = info?.ships.find((item) => Number(item.itemID) === itemID) ?? null;
      return { hp: dogmaNumber(module, ATTRIBUTE_HP), rate: dogmaNumber(info?.character ?? null, ATTRIBUTE_MODULE_REPAIR_RATE) };
    };
    let known = primed();
    if (known.hp === null || known.rate === null) {
      await loadDogma();
      known = primed();
    }
    const share = store.space.get().snapshot?.ship?.moduleDamage?.[itemID] ?? null;
    if (known.hp === null || known.rate === null || !(known.rate > 0) || share === null) {
      throw new Error("How long that repair takes could not be worked out, so it was not begun.");
    }
    return repairWaitMs(known.hp * share, known.rate);
  }

  /**
   * Repair a damaged module with nanite paste, as godma does (godma.py 2225 to 2262): the repair is begun, which
   * takes the paste, and is ended by the page when its time is up, which is when the server mends the module.
   *
   * ⚠ VERIFIED AGAINST THE DAMAGE READING, not the 200 — this server has a
   * documented habit of answering success for writes that did nothing. Repair
   * takes TIME, though, so the test here is only that the damage is no HIGHER:
   * it goes when the repair is ended, and the ship is read again then.
   */
  async function repairModule(itemID: number): Promise<void> {
    const before = store.space.get().snapshot?.ship?.moduleDamage?.[itemID] ?? null;
    await runTargetingAction(
      "Repair",
      async () => {
        // A module being repaired has Cancel Repair in the client's menu, and no Repair.
        if (moduleRepairs.beingRepaired(itemID)) throw new Error("That module is being repaired already.");
        const waitMs = await repairWaitOf(itemID);
        if (!(await moduleRepairs.begin(itemID, waitMs))) throw new Error("The server did not begin that repair.");
      },
      () => loadSpaceSnapshot().catch(() => {}),
      () => {
        const after = store.space.get().snapshot?.ship?.moduleDamage?.[itemID] ?? null;
        // Unknown either side is not a decline; a repair that has started but
        // not yet ticked is not one either, so only a HIGHER reading fails.
        if (before === null || after === null) {
          return true;
        }
        return after <= before;
      },
      "The server accepted that and the module is no better, and gave no reason.",
    );
  }

  /**
   * Bank or unbank every weapon on the ship.
   *
   * ⚠ VERIFIED AGAINST THE SNAPSHOT'S OWN BANK MAP, not the 200 — the fourth
   * write on this server checked that way. Banking is refused outright when the
   * hull has nothing bankable (one gun, or none), and that refusal reaches the
   * player in the server's words.
   */
  async function setWeaponBanks(linked: boolean): Promise<void> {
    await runTargetingAction(
      linked ? "Link weapons" : "Unlink weapons",
      async () => {
        // groupAllIcon.OnClick (36, 38) names session.shipid: the ship the pilot is flying.
        const shipID = store.fitting.get().activeShipID ?? store.space.get().snapshot?.shipID ?? null;
        if (shipID === null) throw new Error("Which ship this is is not known yet.");
        const asked = linked ? await weaponGrouping.linkAll(shipID) : await weaponGrouping.unlinkAll(shipID);
        if (!asked) throw new Error("That was done a moment ago. Try again in a moment.");
      },
      () => loadSpaceSnapshot().catch(() => {}),
      () => {
        const banks = store.space.get().snapshot?.ship?.weaponBanks ?? null;
        if (banks === null) {
          return true; // Unknown is not a decline.
        }
        return linked ? Object.keys(banks).length > 0 : Object.keys(banks).length === 0;
      },
      linked
        ? "The server accepted that and banked nothing, and gave no reason."
        : "The server accepted that and the banks are still there, and gave no reason.",
    );
  }

  async function deactivateModule(itemID: number, opts: { effect?: string; typeID?: number } = {}): Promise<void> {
    await runTargetingAction(
      "Switch off",
      () => switchModuleOff(itemID, opts, callOptions),
      async (result) => {
        await loadSpaceSnapshot().catch(() => {});
        if (result.stopped === false) {
          // Refine the label the action step just recorded, so whatever shows
          // the last action says WHY the module is still lit.
          store.apply({ type: "targeting/action", action: "Switch off — finishing its cycle" });
        }
      },
      // Never a decline. The only two answers this can give — stopped, or still
      // cycling — are both the server doing as it was told, so there is no
      // "quietly did nothing" case left for this verb to report.
      () => true,
      "",
    );
  }

  // Run one movement step, record it as the last action, and refresh the flight
  // snapshot the step returned. A lost session unwinds to the character list; a
  // movement refusal (scrambled, invalid target, docking-approach, lost control,
  // ship destroyed) is surfaced through the store as a visible reason — never a
  // silent no-op or a fake success. On refusal the flight snapshot is still
  // refreshed so the readout reflects the real (unchanged) state.
  async function runFlightStep(
    label: string,
    step: () => Promise<FlightStepResult>,
  ): Promise<void> {
    if (label !== "Stop") requireAutomationReady();
    let result: FlightStepResult;
    try {
      result = await step();
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "flight/action-error", message: `${label} refused: ${flightRefusalWords(error)}` });
      // Re-read the true state so the page shows where the ship actually is,
      // not a stale optimistic guess (best-effort; ignore a follow-up failure).
      try {
        await applyFlight(await api.getFlightStatus(callOptions));
      } catch {
        // The refusal reason is already surfaced; a failed re-read changes nothing.
      }
      return;
    }
    store.apply({ type: "flight/action", action: label });
    // Await the docked-context reconcile so a step that changes the docked
    // station (dock) doesn't resolve before the new station's panels refresh.
    await applyFlight(result);
  }

  // --- R28: skills ----------------------------------------------------------
  //
  // The sheet is a plain read; the queue is a plain write. What makes this
  // careful rather than trivial is the third thing: NOTHING is believed until
  // the sheet has been re-read. The BFF does that re-read, and both functions
  // below land the SAME decoded sheet, so the panel's queue and the panel's
  // skill levels always came from one instant on the server's clock.

  /** Land a decoded sheet, or say the read failed without inventing a sheet. */
  function applySkillSheet(raw: JsonValue): void {
    const sheet = decodeSkillSheet(raw, Date.now());
    store.apply({
      type: "skills/loaded",
      characterName: sheet.characterName,
      totalSkillPoints: sheet.totalSkillPoints,
      freeSkillPoints: sheet.freeSkillPoints,
      skills: sheet.skills,
      queue: sheet.queue,
      clockOffsetMs: sheet.clockOffsetMs,
    });
  }

  /**
   * The Skills window's sheet, in the form the route's is in. The page makes it from the reads it asks for itself,
   * as the client's skill and queue services ask them (bridge/skillReads.ts). Where the pilot's transport does not
   * carry the queue's read, which is the web gateway, there is none to be made here and the route's is read; and
   * so it is with nobody chosen, whose sheet it would be the route's to refuse.
   */
  async function readSkillSheetRaw(): Promise<JsonValue> {
    const online = store.station.get().online;
    const made = online === null
      ? null
      : await readSkillSheet(bridgeAsk, { characterID: online.characterID, characterName: online.characterName, typeFacts: skillTypeFacts, now: serverNow });
    return made ?? (await api.getSkills(callOptions)).skills;
  }

  async function loadSkills(): Promise<void> {
    let raw: JsonValue;
    try {
      raw = await readSkillSheetRaw();
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "skills/error",
        message: `Your skills could not be read: ${errorWords(error)}`,
      });
      return;
    }
    applySkillSheet(raw);
  }

  async function saveSkillQueue(
    entries: readonly { readonly typeID: number; readonly toLevel: number }[],
    label: string,
    context = "that skill",
    start = false,
  ): Promise<void> {
    let raw: JsonValue;
    try {
      raw = await saveQueueAndRead(entries, start);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      // ⚠ THE REFUSAL IS THE FEATURE. All eleven of the server's public codes
      // are things a player hits in ordinary play, and every one of them says
      // what to do next instead of showing its name.
      store.apply({
        type: "skills/action-error",
        message: error instanceof BridgeCallError
          ? skillQueueRefusal(error.code, error.message, context)
          : `That change could not be saved: ${errorWords(error)}`,
      });
      // The queue is unchanged on the server, but the panel may have been
      // showing an optimistic order — re-read so what is on screen is the
      // server's, not ours.
      await loadSkills().catch(() => {});
      return;
    }
    // The sheet read after the save IS the confirmation. Landing it first means
    // the "saved" message can never be on screen next to a stale queue.
    applySkillSheet(raw);
    store.apply({ type: "skills/action", action: label });
  }

  /**
   * A queue saved, and the sheet as it then is. The page makes the client's own call where its pilot's transport
   * carries it (bridge/skillWrites.ts) and reads its sheet again as it reads it at any time. Where the call is
   * not carried, which is the web gateway, nothing was saved by it, and the route saves and answers its own sheet.
   */
  async function saveQueueAndRead(entries: readonly QueuePlace[], start: boolean): Promise<JsonValue> {
    const online = store.station.get().online;
    // The start button starts the queue (skillQueuePanelNew.StartOrStopTraining). A change of the queue is
    // committed started too, and unstarted where every training slot of the account is in use by its other
    // characters (skillQueueSvc.OnClientQueueModified, 389). Where that cannot be told (nobody chosen, or a
    // transport that does not carry the reads) it is saved started, as it was before.
    const activate = start || online === null || (await trainingSlots.allUsed(online.characterID)) !== true;
    return (await saveQueue(bridgeDo, entries, activate)) ? readSkillSheetRaw() : (await api.saveSkillQueue(entries, callOptions)).skills;
  }

  async function pauseSkillTraining(): Promise<void> {
    let raw: JsonValue;
    try {
      // The queue panel's Pause, as the client's makes it: the one call (bridge/skillWrites.ts).
      await pauseTraining(bridgeDo);
      // Whether it stopped is the server's to say: the sheet read again, as it is read at any time.
      raw = await readSkillSheetRaw();
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "skills/action-error",
        message: `Training could not be paused: ${errorWords(error)}`,
      });
      // Whether it stopped or not is the server's to say: read it again.
      await loadSkills().catch(() => {});
      return;
    }
    applySkillSheet(raw);
    store.apply({ type: "skills/action", action: "Paused training" });
  }

  /**
   * Spend unallocated skill points into one skill.
   *
   * ⚠ THE NEW FREE-SP TOTAL IS THE ONLY HONEST RECEIPT. The server caps the
   * amount at what the skill is missing and at what is actually held, so what
   * was asked for and what was spent need not match — the message reports the
   * DIFFERENCE between the totals, never the request. A total that did not move
   * means nothing was spent, and says so rather than claiming success.
   */
  async function applyFreeSkillPoints(skillTypeID: number, points: number): Promise<void> {
    const before = store.skills.get().freeSkillPoints ?? 0;
    let remaining: number | null;
    try {
      // A skill's own "apply skill points", as the client's skill service makes it (bridge/skillWrites.ts):
      // the handler answers the free points left, which is the receipt.
      const left = await applyFreePoints(bridgeDo, skillTypeID, points);
      remaining = typeof left === "number" ? left : null;
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "skills/action-error",
        message: error instanceof BridgeCallError
          ? skillQueueRefusal(error.code, error.message, "that skill")
          : `Those points could not be applied: ${errorWords(error)}`,
      });
      await loadSkills().catch(() => {});
      return;
    }
    // Re-read first, so the message can never sit beside a stale sheet.
    await loadSkills().catch(() => {});
    const after = remaining ?? store.skills.get().freeSkillPoints ?? before;
    const spent = before - after;
    if (spent <= 0) {
      store.apply({
        type: "skills/action-error",
        message: "The server accepted that and spent no points, and gave no reason.",
      });
      return;
    }
    store.apply({
      type: "skills/action",
      action: `Applied ${spent.toLocaleString()} skill points`,
    });
  }

  // --- R41: planetary colonies ---------------------------------------------
  //
  // One read, no write. The BFF answers it from the gateway's owner-scoped
  // snapshot, so this panel costs the call allowlist nothing.
  //
  // ⚠ `coloniesReadable` is carried through UNTOUCHED. It is the difference
  // between "you have built nothing" and "we could not see whether you have",
  // and the panel words those two differently.

  /**
   * Fetch the planetary recipe table, once per session (goal R108).
   *
   * ⚠ A FAILURE HERE IS NOT A FAILED COLONY READ, and must never be reported
   * as one. The recipes are static reference data fetched beside the colony,
   * not part of it: without them a factory still renders exactly as it did
   * before this slice, naming what it makes from the colony read's own words.
   * So this swallows its error rather than surfacing a second, confusing
   * failure on a panel whose real read succeeded.
   *
   * ⚠ NOT RETRIED AND NOT RE-READ. The table cannot change while the app is
   * open, so a book already in the store is left alone — including across a
   * character change, which is why the store keeps it (see clearedPlanets).
   */
  async function ensurePiRecipes(): Promise<void> {
    if (store.planets.get().recipes.readable) {
      return;
    }
    try {
      const result = await api.getPiSchematics(callOptions);
      store.apply({ type: "planets/recipes", recipes: decodeRecipeBook(result.recipes) });
    } catch {
      // Deliberately silent — see above. The panel degrades, it does not break.
    }
  }

  async function loadPlanets(): Promise<void> {
    // Started alongside the colony read rather than before it: the colony is
    // what the player asked for, and the recipes only enrich what it says.
    const recipes = ensurePiRecipes();
    try {
      let result;
      try {
        result = await api.getPlanets(callOptions);
      } catch (error) {
        if (isSessionLost(error)) {
          stopLiveStream();
          store.apply({ type: "character/offline" });
          throw error;
        }
        store.apply({
          type: "planets/error",
          message: `Your colonies could not be read: ${errorWords(error)}`,
        });
        return;
      }
      const report = decodeColonyReport(result.planets, Date.now());
      store.apply({
        type: "planets/loaded",
        colonies: report.colonies,
        coloniesReadable: report.coloniesReadable,
        clockOffsetMs: report.clockOffsetMs,
      });
    } finally {
      // Settled on every path, including the session-lost throw: a caller that
      // awaits this read has awaited the whole of it, and a test never races a
      // store write against its own assertions.
      await recipes;
    }
  }

  function selectColony(planetID: number | null): void {
    store.apply({ type: "planets/selected", planetID });
  }

  // --- R5b Travel (browser autopilot decide-loop) --------------------------

  // The client-side route solver's graph (fetched once, then cached) and the
  // single autopilot controller instance. The loop runs in the browser; closing
  // the tab kills this JS and the loop simply stops issuing (no "stop" sent) —
  // the ship completes its last server-side command and sits (roadmap §7).
  let routeGraph: SystemGraph | null = null;
  let routeGraphLoading: Promise<SystemGraph> | null = null;
  let autopilot: AutopilotController | null = null;

  // Read once: those who ask while it is on its way wait for the same read, and a read that fails is not kept.
  function loadRouteGraph(): Promise<SystemGraph> {
    if (routeGraph) {
      return Promise.resolve(routeGraph);
    }
    // (The graph is one for a page, whichever of its flows reads it: kept by what this flow asks with,
    // nav/systemGraphKept.ts.)
    routeGraphLoading ??= systemGraphOnce(callOptions.fetch ?? pageFetch(), () => api.loadSystemGraph(callOptions)).then(
      (graph) => {
        routeGraph = graph;
        routeGraphLoading = null;
        return graph;
      },
      (error) => {
        routeGraphLoading = null;
        throw error;
      },
    );
    return routeGraphLoading;
  }

  // The autopilot's settings, as the client keeps them: with the character, on this machine. Read when the
  // pilot at the helm is first asked about, and kept here from then on.
  const settingsStorage: SettingsStorage | null = options.storage !== undefined ? options.storage : typeof localStorage === "undefined" ? null : localStorage;
  let autopilotKept: { readonly characterID: number | null; readonly stored: StoredAutopilotSettings } = { characterID: null, stored: {} };
  function autopilotSettings(): StoredAutopilotSettings {
    const characterID = store.station.get().online?.characterID ?? null;
    if (characterID !== autopilotKept.characterID) {
      autopilotKept = { characterID, stored: characterID === null ? {} : loadAutopilotSettings(settingsStorage, characterID) };
      // Another pilot, other settings: what was worked out for the last one is not this one's.
      store.apply({ type: "names/autopilot-jumps-cleared" });
    }
    return autopilotKept.stored;
  }
  function changeAutopilotSettings(change: (stored: StoredAutopilotSettings) => StoredAutopilotSettings): StoredAutopilotSettings {
    const stored = change(autopilotSettings());
    const characterID = autopilotKept.characterID;
    autopilotKept = { characterID, stored };
    if (characterID !== null) {
      saveAutopilotSettings(settingsStorage, characterID, stored);
    }
    // The client's pathfinder keeps what it has worked out by its settings, and works it out again when they change.
    store.apply({ type: "names/autopilot-jumps-cleared" });
    return stored;
  }

  // The jumps on the autopilot's route from a system to every system it reaches, with the pilot's settings: what
  // the client's own lists count (GetAutopilotJumpCount), and what a bot would have to fly.
  async function autopilotDistancesFrom(fromSystemID: number): Promise<Map<number, number>> {
    const settings = autopilotSettingsFrom(autopilotSettings());
    return autopilotDistances(autopilotMap(await loadRouteGraph()), fromSystemID, settings);
  }

  // The jumps on the autopilot's route, worked out here as the client works them out
  // (clientPathfinderService.GetAutopilotJumpCount): nothing is asked of the server.
  function requestAutopilotJumps(fromSystemID: number, toSystemIDs: readonly number[]): void {
    if (!Number.isSafeInteger(fromSystemID) || fromSystemID <= 0) {
      return;
    }
    const settings = autopilotSettingsFrom(autopilotSettings());
    const held = store.names.get().autopilotJumps;
    const keyOf = (toID: number): string => `${fromSystemID}:${toID}`;
    const wanted = [...new Set(toSystemIDs)].filter((toID) => Number.isSafeInteger(toID) && toID > 0 && !(keyOf(toID) in held));
    if (wanted.length === 0) {
      return;
    }
    void loadRouteGraph()
      .then((graph) => {
        const counts = autopilotJumpCounts(autopilotMap(graph), fromSystemID, wanted, settings);
        store.apply({ type: "names/autopilot-jumps", jumps: Object.fromEntries([...counts].map(([toID, count]) => [keyOf(toID), count])) });
      })
      // Without the map nothing is kept: a later ask reads it again.
      .catch(() => {});
  }

  // Wire the framework-agnostic controller to the BFF calls and the store. The
  // loop reads flight-status each cycle (pushed to the flight slice too, so the
  // Flight readout stays in sync) and pushes its progress into the travel slice.
  function makeAutopilotDeps(): AutopilotDeps {
    return {
      getStatus: async () => {
        const step = await api.getFlightStatus(callOptions);
        const status = decodeFlightStatus(step.flight);
        // Reconcile the docked station in the background — the tick must not
        // block on a panel refresh (the loop owns its own cadence).
        void observeFlightStatus(status);
        return status;
      },
      // R13 — the measurement the decide-loop runs retail's distance ladder on.
      // A READ (it starts nothing); the decoded snapshot is pushed into the
      // space slice too, so the Overview stays fresh while the autopilot flies
      // even if the panel's own poll is not running. A failure returns null and
      // the loop falls back to mode + refusals for that cycle.
      getSpaceSnapshot: async () => {
        try {
          const result = await api.getSpaceSnapshot(callOptions);
          const snapshot = decodeSpaceSnapshot(result.space);
          store.apply({
      type: "space/snapshot",
      snapshot,
      gateLinks: gateLinksForSnapshot(snapshot),
    });
          return snapshot;
        } catch (error) {
          if (isSessionLost(error)) {
            throw error;
          }
          return null;
        }
      },
      undock: async () => {
        await orderedStep((flightNow) => undockCall(bridgeDo, flightNow, true));
      },
      warp: async (destinationID, byMenu) => {
        // A pilot's own Dock or Jump: the menu's warp at nought, as the client's
        // system navigation warps (autopilot.py, NavigateSystemTo: WarpToItem at
        // `minWarpEndDistance`). Tranquility has it before each of its docks.
        if (byMenu) {
          await warpToThing(destinationID, MENU_WARP_RANGE_M);
          return;
        }
        // The client's autopilot's own warp (autopilot.py, AP_WarpToDestID:
        // `CmdWarpToStuffAutopilot(destinationID)`), by the page's own call
        // (bridge/movementWrites.ts, autopilotWarp). This server stops it ten
        // kilometres short, and the loop's floor for a warp is that call's
        // (nav/autopilotLoop.ts, AUTOPILOT_WARP_STOPS_SHORT_M). Until 2026-10-11
        // this was the menu's warp at nought (R24 slice A), which a client's
        // autopilot does not make.
        await warpAsTheAutopilot(destinationID);
      },
      approach: async (destinationID, byMenu) => {
        // The autopilot's own approach is the throttle and a follow at nought
        // (AP_ApproachDestID). The menu's is a follow at the client's fifty
        // metres with no throttle (ShipApproach): a pilot's own Dock or Jump, and
        // the autopilot's last station under fifty kilometres.
        await approachShip(destinationID, byMenu ? null : 0);
      },
      jump: async (fromGateID, toGateID) => {
        await jumpStep(fromGateID, toGateID);
      },
      dock: async (stationID) => {
        await dockStep(stationID);
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      onProgress: (progress) => {
        const nameFor = (systemID: number | null): string | null =>
          systemID !== null && routeGraph ? routeGraph.systemName(systemID) : null;
        store.apply({
          type: "travel/progress",
          status: progress.status,
          action: progress.action,
          phase: progress.phase,
          currentSystemID: progress.currentSystemID,
          currentSystemName: nameFor(progress.currentSystemID),
          nextSystemID: progress.nextSystemID,
          nextSystemName: nameFor(progress.nextSystemID),
          remainingJumps: progress.remainingJumps,
          totalJumps: progress.totalJumps,
          failureReason: progress.failureReason,
        });
        // A lost session inside the loop unwinds to character select, like every
        // other held-session flow (R3-R5a).
        if (progress.status === "error") {
          stopLiveStream();
        store.apply({ type: "character/offline" });
        }
      },
      isSessionLost,
      refusalReason: (error) => flightErrorReason(error),
    };
  }

  async function startRoute(destinationID: number): Promise<RouteStartOutcome> {
    const generation = sessionCloseGeneration;
    store.apply({ type: "travel/plan-error", message: null });

    // Every plan failure BOTH writes the travel slice (the Travel panel's
    // surface) AND returns `started: false` — see RouteStartOutcome.
    function planFailed(reason: string, cause?: unknown): RouteStartOutcome {
      store.apply({ type: "travel/plan-error", message: reason });
      return { started: false, reason, cause };
    }
    try { requireAutomationReady(); } catch (error) {
      return planFailed(error instanceof Error ? error.message : "Drone recovery is pending.", error);
    }

    // 1. The client-side route graph (retail's clientPathfinderService is local;
    //    this is read-only static reference data, not a gateway/route call).
    let graph: SystemGraph;
    try {
      graph = await loadRouteGraph();
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      return planFailed(`Could not load the map graph: ${errorWords(error)}`, error);
    }

    // 2. The current location is the route origin (also validates the session).
    let originSystem: number | null;
    try {
      const step = await api.getFlightStatus(callOptions);
      const status = decodeFlightStatus(step.flight);
      void observeFlightStatus(status);
      originSystem = status.solarSystemID;
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      return planFailed(`Could not read your location: ${errorWords(error)}`, error);
    }
    if (originSystem === null) {
      return planFailed("Your current solar system is unknown.");
    }

    // 3. Resolve the destination (a courier destination is a station; the solver
    //    routes systems) from static reference data.
    let destination: Awaited<ReturnType<typeof api.resolveDestination>>;
    try {
      destination = await api.resolveDestination(destinationID, callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      return planFailed(`Could not resolve the destination: ${errorWords(error)}`, error);
    }
    if (destination.kind === "unknown" || destination.solarSystemID === null) {
      return planFailed(`Unknown destination ${destinationID}.`);
    }

    let structure: Awaited<ReturnType<typeof api.resolveAccessibleStructure>> | null = null;
    if (destination.kind === "structure") {
      try {
        structure = await api.resolveAccessibleStructure(destinationID, callOptions);
      } catch (error) {
        return planFailed(`Structure access could not be confirmed: ${errorWords(error)}`, error);
      }
    }
    const targetSystemID = structure?.solarSystemID ?? destination.solarSystemID;

    // 4. Solve the route: the one the client's autopilot plots with its settings as they come, the safe
    //    way and round the systems it avoids unless the pilot has set it otherwise (nav/autopilotRoute.ts,
    //    nav/autopilotSettings.ts), not the fewest jumps.
    const way = autopilotPath(autopilotMap(graph), originSystem, targetSystemID, autopilotSettingsFrom(autopilotSettings()));
    // The way is through this same map, so each of its jumps has a gate.
    const route = way === null ? null : routeAlong(graph, way);
    if (route === null) {
      return planFailed(
        `No gate route from ${graph.systemName(originSystem) ?? originSystem} to ${structure?.solarSystemName ?? destination.systemName ?? targetSystemID}.`,
      );
    }

    const destinationStationID = structure?.id ?? (destination.kind === "station" ? destination.stationID : null);
    const destinationName = structure?.name ?? (destination.kind === "station" ? destination.stationName : destination.systemName);
    if (generation !== sessionCloseGeneration || sessionClosing)
      return { started: false, reason: "This pilot session was released while planning the route." };
    const plan: RoutePlan = {
      destinationSystemID: targetSystemID,
      destinationStationID,
      destinationKind: structure ? "structure" : destination.kind === "station" ? "station" : null,
      destinationName,
      hops: route.hops,
    };

    store.apply({
      type: "travel/planned",
      destinationSystemID: targetSystemID,
      destinationStationID,
      destinationName,
      route: route.hops.map((hop) => ({
        fromSystemID: hop.fromSystemID,
        toSystemID: hop.toSystemID,
        gateToWarpID: hop.gateToWarpID,
        jumpToGateID: hop.jumpToGateID,
        fromSystemName: graph.systemName(hop.fromSystemID),
        toSystemName: graph.systemName(hop.toSystemID),
      })),
      totalJumps: route.hops.length,
      startedAt: Date.now(),
    });

    // 5. Run the decide-loop in the browser.
    if (!autopilot) {
      autopilot = createAutopilot(makeAutopilotDeps());
    }
    autopilot.start(plan);
    void autopilot.run();
    return { started: true };
  }

  // --- R24 slice B: the smart Dock command ---------------------------------
  //
  // Retail sequences docking CLIENT-side and there is exactly one server call in
  // it. `menusvc.py:2981 Dock` -> `DockStation` ->
  // `GetCloseAndTryCommand(itemID, RealDock, interactionRange=2500)` ->
  // `autopilot.py:503 __NavigateSystemTo`, re-armed every 2000 ms, evaluating:
  // in warp -> do nothing; within the docking radius -> fire Dock and stop;
  // too far to close under sublight -> warp; otherwise -> approach; and if none
  // of that can make progress, give up with a reason.
  //
  // That IS the decide-loop this app already runs. So Dock does not get its own
  // autopilot: it gets a zero-hop plan handed to the SAME controller, at the
  // same 2000 ms cadence, with the same measurement, the same settle windows and
  // the same bounds — including R24 slice A's warp floor and warp counter. The
  // ladder's dock rung now tests the server's real 2,500 m surface radius
  // (STATION_DOCKING_RADIUS_M), so Dock is asked once, when it will work,
  // instead of being fired at 50 km to be refused.
  //
  // ⚠ A 200 IS NOT PROOF, twice over here:
  //   * out of range `Handle_CmdDock` (beyonceService.js:2994) starts an
  //     approach AND refuses with `DockingApproach` (:3013-3025) — nothing
  //     auto-docks on arrival, the client must come back;
  //   * and it can return 200/null WITHOUT docking (:3031-3042) —
  //     `WARP_LANDING_PENDING`, `STATION_NOT_FOUND`, `SHIP_IMMOBILE` and
  //     `DOCKING_APPROACH_REQUIRED` all reach the browser as `ok:true`.
  // So nothing here reads the Dock response to decide it worked. The loop's
  // arrival test is `isAtDestination`, which is `docked === true` AND the
  // station id matching, both read back from `flight-status`.
  async function dockAt(stationID: number, shouldAbort: () => boolean = () => false): Promise<void> {
    if (shouldAbort()) return;
    store.apply({ type: "travel/plan-error", message: null });
    if (!(stationID > 0)) {
      store.apply({ type: "travel/plan-error", message: "That is not a station to dock at." });
      return;
    }

    // Where are we? Also the session check, and the origin system for the plan.
    let status: FlightStatus;
    try {
      const step = await api.getFlightStatus(callOptions);
      status = decodeFlightStatus(step.flight);
      void observeFlightStatus(status);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "travel/plan-error",
        message: `Could not read your location: ${errorWords(error)}`,
      });
      return;
    }
    if (shouldAbort()) return;

    if (status.docked && status.stationID === stationID) {
      // Already there. Say so rather than starting a loop that would only
      // discover it on its first tick.
      store.apply({ type: "travel/plan-error", message: "You are already docked here." });
      return;
    }
    if (status.solarSystemID === null) {
      store.apply({ type: "travel/plan-error", message: "Your current solar system is unknown." });
      return;
    }

    // Resolve the dockable kind before constructing a zero-hop plan; a
    // structure must be access-checked, never inferred from its numeric ID.
    let destinationName: string | null = null;
    let destinationKind: "station" | "structure";
    try {
      const resolved = await api.resolveDestination(stationID, callOptions);
      if (resolved.kind !== "station" && resolved.kind !== "structure") throw new Error("Not a dockable location.");
      destinationKind = resolved.kind;
      if (resolved.kind === "structure") {
        const accessible = await api.resolveAccessibleStructure(stationID, callOptions);
        if (accessible.solarSystemID !== status.solarSystemID) throw new Error("Structure is not in this system.");
        destinationName = accessible.name;
      } else {
        if (resolved.solarSystemID !== status.solarSystemID) throw new Error("Station is not in this system.");
        destinationName = resolved.stationName;
      }
    } catch (error) {
      store.apply({ type: "travel/plan-error", message: `Could not confirm docking destination: ${errorWords(error)}` });
      return;
    }
    if (shouldAbort()) return;
    if (status.docked && (destinationKind === "structure" ? status.structureID : status.stationID) === stationID) {
      store.apply({ type: "travel/plan-error", message: "You are already docked here." });
      return;
    }

    // A plan with NO hops: same system, one station to reach. Everything else
    // about the loop is unchanged.
    const plan: RoutePlan = {
      destinationSystemID: status.solarSystemID,
      destinationStationID: stationID,
      destinationKind,
      destinationName,
      hops: [],
      // A pilot's own Dock: the client's system navigation, and no autopilot's.
      navigation: true,
    };

    store.apply({
      type: "travel/planned",
      destinationSystemID: status.solarSystemID,
      destinationStationID: stationID,
      destinationName,
      route: [],
      totalJumps: 0,
      startedAt: Date.now(),
    });

    if (!autopilot) {
      autopilot = createAutopilot(makeAutopilotDeps());
    }
    autopilot.start(plan);
    void autopilot.run();
  }

  // The smart Jump command: `dockAt`'s twin for a stargate. A ONE-hop plan
  // through this gate with no final dock, handed to the same controller — the
  // ladder's gate rung already tests the server's 2,500 m jump range, so the
  // jump is asked when it will work instead of being refused from 200 km.
  // Arrival is `solarSystemID` reading the far system, never the call's 200.
  async function jumpThrough(link: GateLink): Promise<void> {
    store.apply({ type: "travel/plan-error", message: null });
    if (!(link.gateID > 0) || !(link.destinationGateID > 0)) {
      store.apply({ type: "travel/plan-error", message: "This gate has no far side to jump to." });
      return;
    }

    let status: FlightStatus;
    try {
      const step = await api.getFlightStatus(callOptions);
      status = decodeFlightStatus(step.flight);
      void observeFlightStatus(status);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "travel/plan-error",
        message: `Could not read your location: ${errorWords(error)}`,
      });
      return;
    }

    const fromSystemID = status.solarSystemID;
    if (fromSystemID === null) {
      store.apply({ type: "travel/plan-error", message: "Your current solar system is unknown." });
      return;
    }
    if (fromSystemID === link.toSystemID) {
      store.apply({ type: "travel/plan-error", message: "You are already in that system." });
      return;
    }

    const hop = {
      fromSystemID,
      toSystemID: link.toSystemID,
      gateToWarpID: link.gateID,
      jumpToGateID: link.destinationGateID,
    };
    const plan: RoutePlan = {
      destinationSystemID: link.toSystemID,
      destinationStationID: null,
      destinationKind: null,
      destinationName: link.toSystemName,
      hops: [hop],
      // A pilot's own Jump: the client's system navigation, and no autopilot's.
      navigation: true,
    };

    store.apply({
      type: "travel/planned",
      destinationSystemID: link.toSystemID,
      destinationStationID: null,
      destinationName: link.toSystemName,
      route: [
        {
          ...hop,
          fromSystemName: routeGraph?.systemName(fromSystemID) ?? null,
          toSystemName: link.toSystemName,
        },
      ],
      totalJumps: 1,
      startedAt: Date.now(),
    });

    if (!autopilot) {
      autopilot = createAutopilot(makeAutopilotDeps());
    }
    autopilot.start(plan);
    void autopilot.run();
  }

  // --- R26: the mining bot (a second browser decide-loop) ------------------
  //
  // Wired exactly as the autopilot is: a framework-agnostic controller whose
  // every dependency is a BFF call, driven from the browser at its own cadence.
  // It is deliberately a SEPARATE controller from the travel autopilot but
  // never a simultaneous one — starting the bot aborts the autopilot first,
  // because two loops steering one ship is the bug neither of them can see.
  //
  // Note what these deps are NOT wired to: the flow's own lockTarget /
  // activateModule / launchDrones wrappers, which swallow a refusal into the
  // store and return normally. The bot has to SEE the refusal to decide on it,
  // so it goes straight to the api layer, like makeAutopilotDeps does.
  let miningBot: MiningBotController | null = null;

  /**
   * The companion's own per-tick world read.
   *
   * ⚠ THIS IS NOT THE SCRIPT RUNNER'S `observe(hint)`, AND IT CANNOT BE. That
   * builder gates almost every read on which MACRO is active — surveys on
   * `SURVEY_MACROS`, scanner ops on `SCANNER_MACROS`, the squad primary on
   * `hint.squadRole`, the fleet roster on `FLEET_SUPPORT_MACROS`. The companion
   * has no active macro, so every one of those gates would read nothing, and
   * threading a fake macro id through to trip them would couple the companion to
   * the DSL it is deliberately not part of.
   *
   * So the reads are UNCONDITIONAL here, and what is reused is the layer that
   * actually generalises: the decoders. Same `decodeFlightStatus`,
   * `decodeSpaceSnapshot`, `decodeFleetCenter`, `hostileRows`, `lowestHealth`
   * the script runner uses — just called without a macro deciding whether to.
   */
  /**
   * The companion's own hull-bay cache, for the `loot` chat order.
   *
   * ⚠ A SECOND CACHE, NOT A SECOND ROUTING RULE, AND THE DIFFERENCE MATTERS.
   * The actual work is `lootIntoShip` -- the one implementation the Overview's
   * "Take everything" and every scripted bot also go through -- so a companion
   * cannot fill a different hold than a player would. What is duplicated here is
   * only the question "which bays does this hull have", because the script
   * runner answers it off its own `capabilityCache`, which is DSL machinery this
   * loop deliberately does not have (the same reason it builds its own
   * observation instead of reusing `observe(hint)`).
   *
   * ⚠ AND THE ROUTING IS THE WHOLE POINT OF GOING THROUGH IT. Every bay this
   * hull has is offered the loot first; only what nothing will take falls to
   * ship cargo. Looting straight into cargo would be wrong on any hull with a
   * specialised bay.
   *
   * Keyed on the hull, because what bays a ship has is a property of the ship
   * and not of the moment. Fill level is deliberately never cached: the server
   * rules on room, and a refused bay spills into cargo.
   */
  let companionBayCache: { readonly shipID: number; readonly bays: readonly ShipBay[] } | null =
    null;
  /**
   * What the `loot` order has finished with: cans it emptied, and cans it tried
   * enough times without emptying.
   *
   * ⚠ THE RUNG USED TO MARK A CAN DONE THE MOMENT IT ASKED, and throw the
   * outcome away. `lootIntoShip` returns how many stacks it found and how many
   * it actually moved, and those differ constantly: each stack is routed to the
   * bay that will take it, and what fits nowhere STAYS IN THE CAN. So a pilot
   * took one stack of three, recorded the can as looted, and flew off -- seen
   * live twice ("flew to can, and nothing or 1 item only looted").
   *
   * ⚠ AND IT IS BOUNDED, because "it did not all fit" can be permanent. A hold
   * with no room for what is left would otherwise have the pilot re-open the
   * same can for the rest of the run. After MAX_LOOT_ATTEMPTS it is set aside --
   * not emptied, but finished with.
   */
  /**
   * This companion's own ship, from the snapshot it reads every tick.
   *
   * ⚠ `store.inventory.activeShipID` IS NOT AVAILABLE TO THIS LOOP. The
   * inventory slice is filled by the Inventory panel's own reads, which a
   * companion never makes -- so it is null for the whole run. `companionLootFrom`
   * asked it for the ship id, got null, and returned without doing ANYTHING:
   * no loot call, no error, no attempt counted. The rung re-issued the same
   * `lootContainer` every two seconds and the pilot sat next to a can for ever
   * (observed live, 2026-09-11). The snapshot has the ship in it; ask that.
   */
  let companionShipID: number | null = null;
  const companionLootAttempts = new Map<number, number>();
  const companionLootFinished = new Set<number>();
  const MAX_LOOT_ATTEMPTS = 3;
  /**
   * What OTHER pilots have already emptied, from the BFF's shared loot memory
   * (src/lootMemory.js), refreshed on a slow beat while there is anything
   * lootable on the grid.
   *
   * ⚠ THIS IS THE HALF `companionLootFinished` CANNOT COVER. That set is this
   * pilot's own record, and every companion keeps its own -- so a fleet of four
   * sends four ships to the same wreck, three of them arriving at a hold that
   * the first one already emptied. Nothing in the snapshot says a wreck is empty
   * (the slim item's `isEmpty` never reaches a web session), so the only pilot
   * who can answer is one that flew there, and this is where the answer is
   * shared.
   *
   * ⚠ IT IS ONLY EVER ADDED TO, NEVER TRUSTED TO BE COMPLETE. A wreck missing
   * from it is "nobody has said", never "it has loot" -- which is exactly how
   * the ladder already treats an unknown can, so a failed read costs a wasted
   * approach and never a skipped one.
   */
  const companionSharedEmpty = new Set<number>();
  let companionSharedEmptyReadAtMs = 0;
  // Slower than the tick, because a shared mark is worth having within a few
  // seconds and never within one: at worst a pilot sets off for a can that was
  // emptied while it was reading, notices on arrival, and marks it itself.
  const COMPANION_LOOT_MEMORY_READ_MS = 6_000;

  async function refreshCompanionSharedEmpty(
    snapshot: SpaceSnapshot | null,
    nowMs: number,
  ): Promise<void> {
    const solarSystemID = snapshot?.solarSystemID ?? null;
    if (
      solarSystemID === null ||
      nowMs - companionSharedEmptyReadAtMs < COMPANION_LOOT_MEMORY_READ_MS ||
      // No wreck and no can on this grid: nothing this answer could be used on,
      // so the read is not made at all. Same rule as the gated drone-bay read.
      !(snapshot?.entities ?? []).some(
        (entity) => entity.kind === "wreck" || entity.kind === "container",
      )
    ) {
      return;
    }
    companionSharedEmptyReadAtMs = nowMs;
    try {
      for (const itemID of await api.readEmptiedContainers(solarSystemID, callOptions)) {
        companionSharedEmpty.add(itemID);
      }
    } catch {
      // Unreadable is "nobody has said", which is what an empty set already
      // means here. A companion never stops looting because the board is down.
    }
  }

  async function companionLootFrom(containerID: number): Promise<void> {
    // ⚠ COUNTED BEFORE ANYTHING CAN RETURN EARLY. Every path out of this
    // function has to count as an attempt, or a path that does nothing becomes
    // a rung that asks for ever -- which is exactly what the `activeShipID`
    // early return did.
    const attempts = (companionLootAttempts.get(containerID) ?? 0) + 1;
    companionLootAttempts.set(containerID, attempts);
    if (attempts >= MAX_LOOT_ATTEMPTS) {
      companionLootFinished.add(containerID);
    }
    const shipID = companionShipID ?? store.inventory.get().activeShipID;
    if (shipID === null) {
      return;
    }
    if (companionBayCache === null || companionBayCache.shipID !== shipID) {
      try {
        companionBayCache = {
          shipID,
          bays: decodeShipBays((await api.getShipBays(shipID, callOptions)).bays),
        };
      } catch {
        // Unreadable is not "no bays", but for ROUTING it has to behave like it:
        // the only safe destination for a hull we cannot describe is cargo.
        companionBayCache = { shipID, bays: [] };
      }
    }
    try {
      const outcome = await lootIntoShip(containerID, companionBayCache.bays, shipID);
      // Emptied is the only clean finish: every stack it found, it moved.
      if (outcome.moved >= outcome.stacks) {
        companionLootFinished.add(containerID);
      }
    } catch {
      // ⚠ SOME CONTAINERS SIMPLY CANNOT BE OPENED. A can 316 m away answered
      // `FakeItemNotFound` on every try (observed live) -- the id is on the grid
      // but the inventory service does not recognise it. Nothing here can fix
      // that, so the attempt bound above is what stops it mattering: the can is
      // set aside and the pilot gets on with the next one.
    }
  }

  /**
   * How many drones each bay STACK holds, from the last bay read.
   *
   * ⚠ THE LADDER DEALS IN STACK IDS AND KNOWS NOTHING OF QUANTITY, deliberately
   * -- it decides WHICH stacks fly, which is a judgement; how many are in one is
   * a fact about the bay that belongs to the layer that read it. Without this
   * the dispatcher fell back to `quantity: 1` and launched ONE drone per stack,
   * so a pilot carrying five identical drones (one stack) put out one. Observed
   * live 2026-09-11: a bay of three launched one.
   *
   * ⚠ THE SHIP'S CONTROL LIMIT IS THE SERVER'S JOB, NOT OURS.
   * `launchDronesForSession` stops at `maxActiveDrones` by itself, so asking for
   * the whole stack is safe: it launches what it can and ignores the rest.
   */
  let companionDroneStackSizes: ReadonlyMap<number, number> = new Map();

  /**
   * The reload rung's three facts, and the clock that rations them.
   *
   * ⚠ THROTTLED, BECAUSE EACH IS A ROUND TRIP AND NEITHER CHANGES ON A TICK'S
   * TIMESCALE. `readCompanionFitFacts` reads the fit ONCE at start, so nothing
   * the ladder sees per tick knows whether a gun still has rounds in it; that
   * is the gap this fills. Doing it every two seconds would add two calls per
   * companion per tick on the bot host for an answer that changes when a
   * magazine empties -- minutes apart, not seconds. The rung is written to
   * cost nothing on a stale answer (it confirms a load by watching the gun
   * leave this list on a LATER tick, never by the call returning), so the
   * cadence below is a cost decision and not a correctness one.
   */
  const COMPANION_AMMO_READ_INTERVAL_MS = 10_000;
  let companionAmmoReadAtMs = 0;
  let companionAmmoFacts: {
    emptyWeaponModuleIDs: readonly number[] | null;
    cargoCharges: readonly CompanionCargoCharge[] | null;
    weaponChargeGroups: Readonly<Record<number, readonly number[]>> | null;
    loadedCharges: readonly CompanionLoadedCharge[] | null;
  } = { emptyWeaponModuleIDs: null, cargoCharges: null, weaponChargeGroups: null, loadedCharges: null };
  /**
   * The hull's lock count and lock range, off the fit `readCompanionFitFacts`
   * reads at start. The lock-ahead needs the count (unreadable means it never
   * pre-locks) and free fire and the lock-ahead both need the range; neither
   * was reaching the companion's observation before, so free fire's range gate
   * was always open. `null` until a fit is read, and for a fit that said
   * nothing -- never a guess.
   */
  let companionTargeting: { maxLockedTargets: number | null; maxTargetRangeM: number | null } = {
    maxLockedTargets: null,
    maxTargetRangeM: null,
  };
  /**
   * The drone boat's leash for `flight auto`. Same read as `companionTargeting`
   * and the same rule: once, at start, off the hull and the pilot's skills;
   * `null` is "cannot say".
   */
  let companionDroneControlRangeM: number | null = null;
  /**
   * The fitted weapons with the reach of their LOADED charge (`combatFit`), for
   * the range gate and the `flight auto` rung. `null` until read, and whenever
   * the read fails -- the gate fails open on it.
   *
   * ⚠ BUILT FROM THE AMMO READ'S OWN FIT AND CARGO, AND THE DOGMA ONLY WHEN A
   * CHARGE CHANGED. Reach needs the bound dogma (`boundDogma`), which fans out
   * to about eleven gateway reads; reading it on every ammo interval tripled a
   * pilot's gateway calls, the saturation that has caused gateway timeouts
   * before. Reach moves only when a gun's loaded charge or the fit moves, so the
   * dogma is re-read only when `companionCombatChargeKey` changes.
   */
  let companionCombatWeapons: CombatWeapons | null = null;
  let companionCombatChargeKey: string | null = null;
  /**
   * The fitted combat utilities (`combatUtilityFit`) for rung 8a, built from the
   * SAME fit and the SAME bound dogma read as `companionCombatWeapons`, under the
   * same key (widened with each utility module's item, online and charge state).
   * Their `active` flags are stale by design: the rung reads what is running off
   * the snapshot every tick. `null` until read and whenever the read fails.
   */
  let companionCombatUtilities: CombatUtilities | null = null;
  /**
   * Ammo by target: each charge type aboard or loaded, and each gun type's
   * cycle, from static type dogma via `attributesOfTypes` (kept per type, so a
   * type costs one read ever). `null` is unread, which ranks on nothing.
   */
  let companionChargeFacts: {
    chargeFactsByTypeID: Readonly<Record<number, ChargeFacts>> | null;
    weaponCycleByTypeID: Readonly<Record<number, WeaponCycleFacts>> | null;
  } = { chargeFactsByTypeID: null, weaponCycleByTypeID: null };

  // --- waking the companion on a push ---------------------------------------
  //
  // ⚠ THIS IS THE FIX FOR THE COMPANION'S REACTION TIME, AND IT IS A CHANGE TO
  // THE SLEEP, NOT TO THE CADENCE. Before it, `FLEET_COMPANION_CADENCE_MS` was
  // an unconditional `setTimeout`: an order that arrived one millisecond after
  // a tick finished sat in the store, fully decoded and completely unread,
  // until the next tick came round -- and the measured tick interval is not the
  // 2 s the constant names but ~4 s, because the tick's own reads cost the
  // rest. So a fleet broadcast cost up to four seconds before the pilot so much
  // as looked at it, and the lock it then issued cost another four before
  // anything used it.
  //
  // Every one of those facts was ALREADY in the browser the instant the server
  // sent it. `OnFleetBroadcast`, `OnFleetStateChange`, `OnTarget` and
  // `OnJamStart` all land in `applyPushedNotification` and are applied to the
  // store immediately; the loop simply was not awake to read them. This turns
  // the cadence into a CEILING on how long the pilot may go without looking,
  // and lets any of those four pushes end the wait early.
  //
  // ⚠ IT IS A CEILING AND A FLOOR, AND THE FLOOR IS WHAT MAKES IT SAFE. A fleet
  // fight pushes a great many of these -- every fleet-mate's tag change, every
  // cycle of every tackle module -- and a wake that fired on each one would run
  // the ladder, and its six round trips, as fast as the wire could deliver.
  // `COMPANION_WAKE_FLOOR_MS` is the shortest gap between two ticks that a push
  // may produce: a wake that arrives sooner than that does not run the tick
  // early, it only brings the sleep's end forward TO the floor. So a storm of
  // pushes settles at the floor rather than at zero, and the pilot's read
  // traffic is bounded no matter what the fleet is doing.
  //
  // ⚠ BROWSER-ONLY, AND THAT IS NOT A GAP IN THE FIX. `src/botHost.js` hands a
  // headless companion `stubEventSource()`, so no push is ever pushed to one --
  // it learns everything from `applyDrainedNotifications` off its own reads,
  // which by definition happen at tick time and cannot be earlier. A headless
  // companion therefore keeps exactly today's behaviour: the wake never fires,
  // the sleep runs its full length, and nothing about it changes.
  const COMPANION_WAKE_FLOOR_MS = 350;
  /**
   * Ends the current companion sleep early. Null whenever no sleep is pending —
   * which is most of a tick, and every moment of a run that is not running at
   * all — so a push that arrives then is simply dropped, as it should be: the
   * tick about to start will read the store anyway.
   */
  let companionWake: (() => void) | null = null;

  function wakeFleetCompanion(): void {
    companionWake?.();
  }

  /**
   * The companion's sleep: at most `ms`, at least `COMPANION_WAKE_FLOOR_MS`,
   * ended early by a push that the ladder has something to do about.
   *
   * ⚠ THE LATCH IS CLEARED BEFORE THE PROMISE RESOLVES, not after, so a second
   * push landing in the same turn cannot resolve an already-settled promise or
   * — worse — resolve the NEXT sleep before it has begun.
   */
  function companionSleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const startedAtMs = Date.now();
      let timer: ReturnType<typeof setTimeout> = setTimeout(finish, ms);
      function finish(): void {
        clearTimeout(timer);
        companionWake = null;
        resolve();
      }
      companionWake = (): void => {
        const waited = Date.now() - startedAtMs;
        if (waited >= COMPANION_WAKE_FLOOR_MS) {
          finish();
          return;
        }
        // Too soon. Bring the end forward to the floor rather than to now --
        // and drop the latch so the pushes still arriving in that window do not
        // each re-arm a timer. The shortened wait stands.
        //
        // ⚠ `Math.min` AGAINST THE ORIGINAL DEADLINE, so a wake can only ever
        // SHORTEN a sleep. Without it, a caller sleeping for less than the floor
        // -- which `FLEET_COMPANION_BURST_MS` is one tuning away from being --
        // would have a push push its end LATER, which is the exact opposite of
        // what waking is for.
        companionWake = null;
        clearTimeout(timer);
        timer = setTimeout(finish, Math.min(COMPANION_WAKE_FLOOR_MS, ms) - waited);
      };
    });
  }

  function makeFleetCompanionDeps(): FleetCompanionDeps {
    return {
      observe: async (): Promise<FleetCompanionObservation> => {
        // The supervision read rides along with the other two rather than
        // queueing behind them: it is independent of both, and a companion
        // decides on a two-second cadence.
        // ⚠ THE CHAT READ IS PAID FOR ONLY BY A PILOT THAT OBEYS CHAT. It is a
        // fifth round trip on a two-second tick, and on the bot host that cost
        // is per companion per tick.
        //
        // ⚠ IT IS NO LONGER GATED, AND THE OLD GATE WAS A BUG RATHER THAN A
        // SAVING. It read chat only when the operator had ticked a channel AND
        // hand-typed at least one character id -- so the settings screen's own
        // promise that "whoever the fleet roster names a commander is obeyed
        // regardless" was false twice over: nothing consulted the roster, and
        // with an empty list the read never happened at all. A companion now
        // always listens, and the roster decides who it hears.
        const chatWanted = liveCompanionRequest !== null;
        // The drone BAY is the one thing rung 6 needs that the space snapshot
        // does not already carry, and it is a whole extra round trip per tick.
        //
        // ⚠ NO LONGER GATED ON A SETTING, BECAUSE THERE IS NO SETTING. A pilot
        // flies the drones it is carrying, so "is it carrying any" is precisely
        // what this read answers and cannot be skipped on the strength of an
        // answer nobody gave. What the snapshot gives free -- which drones are
        // out and how hurt they are -- is still built below without a call.
        const droneBayWanted = liveCompanionRequest !== null;
        const [statusStep, spaceResult, targetsResult, botDriven, chatRaw, droneRaw, fleetRaw] =
          await Promise.all([
          api.getFlightStatus(callOptions),
          api.getSpaceSnapshot(callOptions),
          // ⚠ THE LOCK LIST IS AUTHORITATIVE AND THE LADDER NEEDS IT, rather
          // than its own memory of what it last asked for. A lock the server
          // REFUSED still looks issued from in here, so a rung that stamped
          // "I locked that" and trusted the stamp would never retry —
          // permanently and silently, for the rest of the run. Reading the real
          // list every tick is what makes the fleet-order rung's already-locked
          // check honest rather than hopeful. It also says what has this ship
          // locked, which a fleet order to leave reads to know whether to wait
          // for the drones.
          api.getTargets(callOptions, true),
          botDrivenCharacterIDs(),
          // LOCAL, deliberately. Fleet chat is not reachable: the gateway's chat
          // service hardcodes CHAT_CHANNELS to local and corp, and its push side
          // only ever computes a local and a corp room name, so a fleet room
          // never matches and is never delivered. Local needs no gateway patch
          // and every fleet-mate in the system can see it. What makes an order
          // on a PUBLIC channel safe is the sender allowlist, not the channel.
          // ⚠ BOTH OF THESE SWALLOW THEIR OWN FAILURE, and they did not have to
          // before. While each was gated on a setting, a companion whose
          // operator had not enabled it never made the call at all -- so a
          // route that answers badly could not reach this `Promise.all`. Now
          // that every companion reads chat and its own drone bay, an
          // unavailable route would reject the whole tick and stop a pilot that
          // is otherwise flying perfectly well. Neither read is load-bearing:
          // `null` already means "did not look" to every rung beneath, and a
          // pilot that cannot read chat simply obeys broadcasts and tags.
          chatWanted
            ? api.readChat("local", callOptions).catch(() => null)
            : Promise.resolve(null),
          droneBayWanted ? api.getDrones(callOptions).catch(() => null) : Promise.resolve(null),
          // ⚠ THE ROSTER RIDES IN THE BATCH, AND IT USED TO QUEUE BEHIND IT.
          // It is this loop's most load-bearing read (supervision, `inFleet`,
          // the tagging verdict -- see where it is decoded below) and it is
          // made on EVERY tick, so it was also this loop's most expensive
          // mistake: awaited on its own after the batch had already resolved,
          // it added a whole serial round trip to every tick a companion has
          // ever run. It depends on nothing the batch produces, so there was
          // never a reason for it to wait -- the awaits it sat behind were
          // simply written in the order the facts were needed rather than in
          // the order they could be fetched.
          //
          // ⚠ IT SWALLOWS ITS OWN FAILURE HERE FOR THE REASON THE TWO READS
          // ABOVE DO: inside a `Promise.all` a rejection takes the whole tick
          // down with it. The `catch` below used to be the thing that turned an
          // unreadable roster into `inFleet: null`, and that contract is
          // preserved exactly -- `null` here means the same thing and is
          // decoded the same way.
          api.loadBoundFleet(callOptions).catch(() => null),
        ]);
        // api.ts delivers trusted response drains through the current flow/session sink.
        // The same authority the Targeting panel reads, kept live while the
        // companion flies so the panel never shows a stale lock list.
        const lockedTargetIDs = decodeTargetIDs(targetsResult.targetIDs);
        store.apply({ type: "targeting/targets", targetIDs: lockedTargetIDs });
        // Absent stays absent: `null` is "could not say who has us locked", and
        // the fleet-order recall falls back to its short wait on it.
        const lockedByIDs = targetsResult.targeterIDs == null ? null : decodeTargetIDs(targetsResult.targeterIDs);
        const status = decodeFlightStatus(statusStep.flight);
        void observeFlightStatus(status);
        // ⚠ THE REPAIR QUOTE IS GATED ON BEING DOCKED, AND ON NOTHING ELSE ANY
        // MORE. It is a sixth round trip on a two-second tick, so it is gated on
        // the shop being answerable at all -- the ship has to be in the station
        // -- which also makes it free in every tick a companion spends flying.
        //
        // ⚠ IT USED TO BE GATED ON `repairsAtStation` AS WELL, AND THAT SECOND
        // GATE WAS A BUG RATHER THAN A SAVING. The quote is not a purchase: it
        // is the ONLY thing that can tell a docked pilot whether its hull is
        // whole, because `obs.health` is folded from the space snapshot and a
        // station has none. So a pilot that does not pay for repairs was a pilot
        // that could never learn it was fixed -- including when its operator had
        // just repaired it BY HAND, which is how this was found (2026-09-13: "I
        // repaired the one ship which had damaged armor and it still refuses to
        // undock"). Asking the shop what is damaged costs ISK nowhere; the
        // setting still decides whether anything is ever PAID for, which is the
        // thing an operator was actually consenting to.
        //
        // It runs AFTER the Promise.all rather than inside it because `docked`
        // is not known until the flight status resolves. That costs a serial
        // round trip on the ticks it fires, which are only ever ticks spent
        // sitting in a station with nothing else to do.
        //
        // ⚠ NULL IS "COULD NOT SAY", NEVER "NOTHING IS DAMAGED" -- the same
        // contract the DSL's repair-ship read keeps, and the flee rung treats
        // it as a tick spent waiting rather than as permission to undock.
        let damagedItemIDs: FleetCompanionObservation["damagedItemIDs"] = null;
        if (liveCompanionRequest !== null && status.docked) {
          try {
            const quotes = await quoteShipRepair();
            damagedItemIDs = quotes === null ? null : repairTargets(quotes);
          } catch {
            damagedItemIDs = null;
          }
        }
        const snapshot = decodeSpaceSnapshot(spaceResult.space);
        // Keep the Overview live while the companion flies, exactly as the
        // mining bot does — the panel's own poll may not be running.
        store.apply({
          type: "space/snapshot",
          snapshot,
          gateLinks: gateLinksForSnapshot(snapshot),
        });

        // ⚠ FILTERED HERE, ON THE BROADCAST'S OWN TTL, because the ladder is pure
        // and carries no clock of its own. One staleness policy for both order
        // sources is the point: a chat order that has gone quiet is exactly as
        // stale as a broadcast that has, and a lapsed order must stop standing so
        // the pilot falls back to its own ladder. Without this the backlog the
        // channel read returns would replay as live orders every tick, and a
        // restart would obey a line somebody typed ten minutes ago.
        const chatNowMs = Date.now();
        const chatMessages =
          chatRaw === null
            ? []
            : decodeChatChannel(chatRaw).messages.filter(
                (entry) => chatNowMs - entry.createdAtMs < FLEET_BROADCAST_TTL_MS,
              );

        const ship = snapshot?.ship ?? null;
        const origin = ship?.position ?? { x: 0, y: 0, z: 0 };
        // ⚠ A BLIND SCENE IS UNKNOWN, NOT EMPTY (seen live 2026-10-14 12:00:11 UTC: a
        // dead ballpark answered `{inSpace:true, entities:[], ship:null}` with a 200
        // for ten minutes). `decodeSpaceSnapshot` never returns null, so the
        // `snapshot === null ? null : ...` guards below were dead and every fact read
        // off the empty list came out a confident "none": no hostile, no drones out,
        // grid clear. Those facts are null here instead, and `sceneBlind` lets the
        // ladder say so and wait.
        const sceneBlind = isSceneBlind(status.inSpace, snapshot);

        // What the OTHER pilots have already emptied. Gated on there being
        // something lootable on this grid and rationed to a slow beat, so a
        // companion that is not looting pays nothing for it. BFF-local: no
        // gateway call, and a failure leaves the set as it was.
        await refreshCompanionSharedEmpty(snapshot, Date.now());

        // ── The two grid reads the ladder shares with the DSL's own bots.
        //
        // ⚠ `targetedByPlayer` IS FREE AND SO IT IS NEVER GATED. It is a pass
        // over the snapshot already decoded above and makes no call at all, so
        // there is no cost to weigh against it the way there is for the chat
        // read or the drone bay.
        //
        // It is also the only evidence this client has of a PURE PLAYER
        // engagement. `hostileOnGrid` below is `hostileRows`, and `hostileRows`
        // filters on `isHostile`, which is NPC-or-not — so a fleet being shot
        // by another fleet lights up neither half of the tank rung's `fightOn`
        // test unless this field is set — which is how this shipped: the field
        // was declared, never filled, and a companion in a player gatecamp had
        // no reason to switch a hardener on.
        const targetedByPlayer = sceneBlind ? null : isTargetedByPlayer(snapshot, ship?.itemID ?? null);
        // ⚠ THIS ONE IS GATED, because unlike the line above it can cost a
        // round trip. `classifyTargetGroups` resolves a GROUP NAME per ship
        // type on grid: nothing on an empty grid, nothing on a repeat tick
        // (`requestNames` skips ids already cached or in flight), but one
        // batched lookup each time a NEW hull type shows up — and on a busy
        // grid that is a real, if bounded, cost on a two-second tick.
        //
        // The gate is `attemptsTagging` because `decideTackleTag` is the whole
        // readership: it is the one rung that ranks ships, and with tagging off
        // it returns before it ever looks. Same rule the chat read and the
        // drone bay are under — a companion must not pay for an answer no rung
        // will read.
        //
        // Player hulls ARE asked for (the `true`), which is the opposite of
        // what a script bot gets by default. The ships this rung ranks are its
        // TACKLERS, and a ship running a scrambler on a fleet-mate is almost
        // always a player — resolving only the NPC rows would hand `pickPrimary`
        // a null class for exactly the targets that matter and collapse it to
        // nearest-first, which is the degradation this field exists to avoid.
        // ⚠ RESOLVED FOR EVERY COMPANION NOW. This used to be gated on the
        // `attemptsTagging` tick; every pilot tags what tackles it, so every
        // pilot needs the class ranking that decides WHICH tackler gets the
        // letter first. The cost is one /api/names round trip per NEW ship type
        // seen, not one per tick -- group names are cached after first look.
        const targetGroupNames = await classifyTargetGroups(
          snapshot,
          origin,
          true,
          ship?.itemID ?? null,
        );
        // ⚠ PAID FOR HERE TOO, UNDER THE SAME GATE, because `pickPrimary` is the
        // second reader of it: the companion ranks the ships shooting at its
        // fleet with the same ladder a script bot does, and a group name cannot
        // tell a tackle frigate from its harmless sibling for either of them.
        // The cost is the same as the line above and smaller: one round trip per
        // NEW rat type EVER SEEN on this tab (the cache is permanent, since type
        // dogma is static), nothing per tick, and nothing at all on a grid with
        // no NPCs on it -- so a companion escorting a miner does not start
        // paying for reads its ladder will not use.
        const threatByTypeID = await classifyRatThreats(snapshot, origin);

        // ── The drone reads (rung 6). Two of the three are free: they come off
        // the snapshot already in hand. Only the bay costs a call, and it is
        // gated above.
        //
        // ⚠ `canMyShipOrderDrone === true`, NEVER `isMyDrone`. The narrower test
        // is the right one for both of these: a drone this hull cannot ORDER is
        // one it cannot recall either, so counting it would make the rung wait
        // for a recall that can never land. That case is real and was observed
        // live -- an abandoned drone answers a recall with a 200 and does not
        // move (see `canMyShipOrderDrone`'s own comment).
        const myShipID = ship?.itemID ?? null;
        companionShipID = myShipID;
        const myDroneIDs: number[] = [];
        // Per drone, for the rotation in rung 6: it pulls the ONE drone that is
        // being shot, so it needs that drone's own shield and not the fold.
        const myDrones: { itemID: number; shieldRatio: number | null; armorRatio: number | null; hullRatio: number | null }[] = [];
        let lowestDroneHealth: number | null = null;
        for (const entity of snapshot?.entities ?? []) {
          if (canMyShipOrderDrone(entity, myShipID) !== true) {
            continue;
          }
          myDroneIDs.push(entity.itemID);
          myDrones.push({
            itemID: entity.itemID,
            shieldRatio: entity.shieldRatio,
            armorRatio: entity.armorRatio,
            hullRatio: entity.hullRatio,
          });
          // The worst of the three layers, per drone, then the worst across
          // them -- the same fold `makeScriptRunnerDeps` makes, so a companion
          // and a script bot judge an identical rack identically. A layer that
          // did not read is skipped rather than counted as zero.
          const ratios = [entity.shieldRatio, entity.armorRatio, entity.hullRatio].filter(
            (ratio): ratio is number => ratio !== null,
          );
          if (ratios.length === 0) {
            continue;
          }
          const worst = Math.min(...ratios);
          lowestDroneHealth =
            lowestDroneHealth === null ? worst : Math.min(lowestDroneHealth, worst);
        }
        // ⚠ `null` HERE IS "DID NOT LOOK", AND THE RUNG TREATS IT AS SUCH. An
        // empty array is a real "the bay is empty" and a launch that finds one
        // issues nothing; `null` means the read was never made or failed, and
        // the rung must not read that as an empty bay.
        const companionBay = droneRaw === null ? null : decodeDroneBay(droneRaw.bay);
        const droneBayItemIDs = companionBay?.map((stack) => stack.itemID) ?? null;
        if (companionBay !== null) {
          companionDroneStackSizes = droneStackSizes(companionBay);
        }
        // ⚠ SPLIT BY ROLE, AND THIS IS THE FIX FOR THE ONE PLACE IN THIS APP
        // THAT MIXED DRONE TYPES. Rung 6 used to launch `droneBayItemIDs` whole,
        // so a bay holding combat and salvage drones sent both into the same
        // fight -- the salvage drones unable to fight it, and occupying the
        // control slots the combat drones needed. The scripted blocks have always
        // used this same split (`launchRoleDrones`); the companion never did.
        // Reusing `classifyDroneRoles` rather than growing a second classifier
        // means one answer to "what is this drone for", not two.
        const companionDroneRoles = await classifyDroneRoles(
          companionBay,
          sceneBlind ? null : snapshot,
          ship?.itemID ?? null,
        );
        // ── Drone sizing's inputs. The combat stacks WITH their types (the
        // role split above keeps only ids), the hull's limits off the same
        // drones read, and each combat type's dogma -- bay types and the types
        // already out, since a size switch compares the two.
        const combatBayIDs = new Set(companionDroneRoles.bay?.combat ?? []);
        const combatDroneStacks =
          companionBay === null || companionDroneRoles.bay === null
            ? null
            : companionBay.filter((stack) => combatBayIDs.has(stack.itemID));
        const limits = droneRaw === null ? null : decodeDroneLimits(droneRaw.shipInfo);
        const companionDroneLimits =
          limits === null || limits.droneBandwidth === null || limits.maxActiveDrones === null
            ? null
            : { bandwidthMbit: limits.droneBandwidth, maxActive: limits.maxActiveDrones };
        const combatOutIDs = new Set(companionDroneRoles.out?.combat ?? []);
        const companionDroneFacts = await combatDroneFacts([
          ...(combatDroneStacks ?? []).map((stack) => stack.typeID),
          ...(snapshot?.entities ?? [])
            .filter((entity) => combatOutIDs.has(entity.itemID) && entity.typeID !== null)
            .map((entity) => entity.typeID as number),
        ]);

        // The roster is read EVERY tick and not gated, because a companion with
        // no fleet has nothing to obey — this is its most load-bearing read, not
        // an optional extra. A failure lands as null (unreadable), never as
        // "not in a fleet".
        //
        // ⚠ THE CALL ITSELF IS UP IN THE BATCH NOW; only the DECODE is here.
        // See `api.loadBoundFleet` in the `Promise.all` above for why it moved.
        // `fleetRaw === null` is the batch's own `catch`, and `decodeFleetCenter`
        // throwing is the second way this read can fail -- both land in exactly
        // the same place they always did.
        let inFleet: boolean | null = null;
        let fleetMemberCharacterIDs: readonly number[] | null = null;
        // Held past the try so the tagging verdict below can be answered from
        // the read that ALREADY happened. A second roster read to ask "am I a
        // commander" would double this loop's most frequent HTTP call to learn
        // something the first read's own rows already say.
        let fleetSnapshot: FleetCenterSnapshot | null = null;
        try {
          fleetSnapshot = fleetRaw === null ? null : decodeFleetCenter(fleetRaw);
          inFleet = fleetSnapshot === null ? null : fleetSnapshot.availability === "ready";
          fleetMemberCharacterIDs =
            fleetSnapshot === null ? null : authoritativeFleetMemberCharacterIDs(fleetSnapshot);
        } catch {
          inFleet = null;
          fleetMemberCharacterIDs = null;
          fleetSnapshot = null;
        }
        const ownCharacterID = store.station.get().online?.characterID ?? null;
        // ⚠ FREE, NEVER GATED — unlike the roster read just above (an HTTP
        // call, gated elsewhere behind FLEET_SUPPORT_MACROS), these two ride
        // the fleet slice the notification drain already fills. Gating them
        // too would mean a companion that could have obeyed its fleet simply
        // never looked.
        const fleetSlice = store.fleet.get();
        const fleetTargetTags = fleetSlice.targetTags;
        // ⚠ TTL APPLIED HERE, AT OBSERVATION BUILD — never in the store's
        // reducer. The store keeps the raw broadcast until the next one
        // replaces it; asking "is it still fresh" is this reader's job, same
        // discipline as `src/squadBoard.js` dropping a lapsed call when ASKED
        // rather than on a timer. A follower whose call has lapsed falls back
        // to its own ladder, which is a working bot, not a stopped one.
        const fleetBroadcast =
          fleetSlice.lastBroadcast !== null &&
          isFleetBroadcastFresh(fleetSlice.lastBroadcast, Date.now())
            ? fleetSlice.lastBroadcast
            : null;
        return {
          inSpace: status.inSpace,
          docked: status.docked,
          inWarp: status.shipMode === null ? null : /warp/i.test(status.shipMode),
          shieldRatio: ship?.shieldRatio ?? null,
          armorRatio: ship?.armorRatio ?? null,
          hullRatio: ship?.hullRatio ?? null,
          health: lowestHealth(snapshot),
          capacitorRatio: ship?.capacitorRatio ?? null,
          // The companion does not mine. `null` is the honest answer for a hold
          // nobody read, and it is what every threshold treats as cannot-tell.
          oreHoldFraction: null,
          holdEmpty: null,
          hostileOnGrid: snapshot === null || sceneBlind ? null : hostileRows(snapshot, origin).length > 0,
          sceneBlind,
          targetedByPlayer,
          targetGroupNames,
          threatByTypeID,
          signatureByTypeID: ratSignaturesOnGrid(snapshot, origin),
          hitPointsByTypeID: ratHitPointsOnGrid(snapshot, origin),
          ratCombatByTypeID: ratCombatOnGrid(snapshot, origin),
          ratResonancesByTypeID: ratResonancesOnGrid(snapshot, origin),
          droneControlRangeM: companionDroneControlRangeM,
          combatDroneStacks,
          droneFactsByTypeID: companionDroneFacts,
          droneLimits: companionDroneLimits,
          dronesOut:
            snapshot === null || sceneBlind
              ? null
              : snapshot.entities.some((entity) =>
                  canMyShipOrderDrone(entity, ship?.itemID ?? null),
                ),
          flightStatus: status,
          damagedItemIDs,
          snapshot,
          inFleet,
          fleetMemberCharacterIDs,
          myCharacterID: ownCharacterID,
          // Needed by the `loot` rung's ownership gate. Absent until now,
          // which is why its corp clause was silently dead.
          myCorporationID: store.station.get().online?.corporationID ?? null,
          fleetTargetTags,
          fleetBroadcast,
          lockedTargetIDs,
          lockedByIDs,
          maxLockedTargets: companionTargeting.maxLockedTargets,
          maxTargetRangeM: companionTargeting.maxTargetRangeM,
          // ⚠ THE GATE IS CLIENT-SIDE BECAUSE THE SERVER REFUSES SILENTLY.
          // `setFleetTargetTag` returns a bare `false` for a non-commander and
          // its only caller discards that boolean, so the write's own ack says
          // `ok` either way -- there is no answer to read back. The roster this
          // tick already fetched is the only place the truth exists. See
          // `bridge/fleetCommand.ts`.
          //
          // Three-state, and the middle state matters: `null` is "could not
          // look" and `false` is "looked, and no". Both mean do not write; only
          // `false` may be remembered. An unknown own-character id is `null` for
          // the same reason -- without it there is no row to find, which is not
          // evidence of anything.
          canTag: ownCharacterID === null ? null : canTagInFleet(fleetSnapshot, ownCharacterID),
          // The other half of rung 4's fork, off the SAME roster read — so the
          // two verdicts can never disagree about which fleet they describe.
          // `canTag === false` alone cannot be used here: it is also what a
          // pilot in NO fleet gets, and that pilot has nobody to broadcast to.
          canBroadcast:
            ownCharacterID === null ? null : canBroadcastInFleet(fleetSnapshot, ownCharacterID),
          botDrivenCharacterIDs: botDriven,
          // The invite the notification drain already parked in the fleet slice.
          // Read rather than re-fetched: every bridge response on this tick
          // carried its own drain, so the slice is as fresh as anything else
          // here, and a companion polls no extra route for it.
          pendingFleetInvite: companionPendingInvite(),
          chatMessages,
          // Who this pilot is, so a `status` or `repair` line naming pilots can
          // be told apart from one naming somebody else.
          selfCharacterID: ownCharacterID,
          selfCharacterName: store.station.get().online?.characterName ?? null,
          // Rung 4, "tackle → tag". Narrowed to the two tackle jam types and
          // freshness-filtered HERE, at observation build, for the same reason
          // `fleetBroadcast` is: the slice keeps every jam the wire carried
          // until its `OnJamEnd` lands, and one clock read per tick gives the
          // whole ladder one consistent answer. Free — it rides the same
          // notification drain the fleet slice does and polls nothing.
          tackledBy: tacklersHolding(store.space.get().jams, Date.now()),
          // The narrower half of the same jam slice: is a warp SCRAMBLER on us,
          // as opposed to the disruptor `tackledBy` also counts. Only the
          // scrambler carries `blocksMicrowarpdrive`, so only it means anything
          // to `decidePropulsion` — and reading it off the same one clock read
          // keeps the two answers about this tick consistent.
          scrammed: scrammedByWarpScrambler(store.space.get().jams, Date.now()),
          // ⚠ WHAT "TRAVELLING" MEANS FOR A COMPANION, and the only place it can
          // be seen. Both of the companion's own travel rungs — the `destination`
          // trip and a `TravelTo` order — hand the flying to the SHARED autopilot
          // (`startRoute`), so the autopilot's own status IS the answer to "is
          // this pilot on a trip". Synchronous, no gateway call, exactly as the
          // DSL observation's identical read is; null when no autopilot exists
          // yet, which reads as "not travelling" and never as "travelling".
          travel: autopilot
            ? {
                status: autopilot.snapshot().status,
                destinationStationID: store.travel.get().destinationStationID,
                destinationSystemID: store.travel.get().destinationSystemID,
                remainingJumps: autopilot.snapshot().remainingJumps,
                failureReason: autopilot.snapshot().failureReason,
              }
            : null,
          lowestDroneHealth,
          // Absent, not empty, on a blind scene: "did not look" (see `sceneBlind`).
          myDroneIDs: sceneBlind ? undefined : myDroneIDs,
          // Absent, not empty, when there was no snapshot: "did not look".
          myDrones: snapshot == null || sceneBlind ? undefined : myDrones,
          droneBayItemIDs,
          // ⚠ WHAT THE LOOT CALLS ACTUALLY ACHIEVED, which the ladder cannot see
          // for itself: it issues one atomic call and never learns what came
          // back. A can is finished when it was emptied, or when it has been
          // tried enough times not to be worth another.
          // ⚠ TWO SOURCES, AND THE SECOND IS WHAT KEEPS A FLEET FROM DOING ONE
          // PILOT'S WORK FOUR TIMES. `companionLootFinished` is what THIS pilot
          // settled; `companionSharedEmpty` is what any other pilot on this BFF
          // (or the hand-flown client, which loots through the same path) found
          // empty and said so. Merged here rather than in the ladder because
          // the ladder must stay a pure decider with no reads of its own.
          lootFinishedItemIDs: [...companionLootFinished, ...companionSharedEmpty],
          combatDroneBayItemIDs: companionDroneRoles.bay?.combat ?? null,
          salvageDroneBayItemIDs: companionDroneRoles.bay?.salvage ?? null,
          logisticDroneBayItemIDs: companionDroneRoles.bay?.logistic ?? null,
          combatDroneIDs: companionDroneRoles.out?.combat ?? null,
          salvageDroneIDs: companionDroneRoles.out?.salvage ?? null,
          logisticDroneIDs: companionDroneRoles.out?.logistic ?? null,
          // ⚠ THE CHAT-ORDER GATE, AND THE ONLY THING BETWEEN A COMPANION AND A
          // STRANGER TYPING "target" IN LOCAL. Derived from the roster read this
          // tick already made -- the same rows `canTag` above is decided from, so
          // there is one definition of "commander" and not two. A roster that
          // could not be read yields null, which the ladder treats as "no chat
          // orders", never as "anybody will do".
          fleetCommanderCharacterIDs:
            fleetSnapshot === null ? null : fleetCommanderCharacterIDs(fleetSnapshot),
          // Where those commanders are, off the same rows: the rejoin warp
          // (rung 9b) does not warp to one that is docked or in another system.
          fleetCommanderWhereabouts:
            fleetSnapshot === null ? null : fleetCommanderWhereabouts(fleetSnapshot),
          // The reload rung's three facts. ⚠ THE REQUEST IS WHAT SAYS WHICH
          // MODULES ARE GUNS — `weaponModuleIDs` is derived from the hull at
          // start (`requestForFit`), and without it this read cannot tell a
          // turret from any other module that happens to take a charge. A run
          // with no live request yet reads nothing and reports "cannot say".
          ...(liveCompanionRequest === null
            ? {
                emptyWeaponModuleIDs: null,
                cargoCharges: null,
                weaponChargeGroups: null,
                loadedCharges: null,
              }
            : await readCompanionAmmoFacts(
                liveCompanionRequest,
                status.inSpace === true,
                Date.now(),
              )),
          // The guns' reach with what is LOADED, for the range gate and the
          // `flight auto` rung. ⚠ AFTER THE AMMO READ, WHICH FILLS IT: a literal
          // evaluates in order, so above it this was always one read stale and
          // `null` on the first tick in space.
          combatWeapons: companionCombatWeapons,
          // Rung 8a's fit facts, filled by the same read (and the same order rule).
          combatUtilities: companionCombatUtilities,
          // Ammo by target's static facts, filled by the same ammo read.
          chargeFactsByTypeID: companionChargeFacts.chargeFactsByTypeID,
          weaponCycleByTypeID: companionChargeFacts.weaponCycleByTypeID,
        };
      },
      // ⚠ STRAIGHT TO THE WRAPPER, NEVER THROUGH `sendChatMessage`. That one
      // re-reads the channel into the store, which would repaint the Chat panel
      // of whichever pilot the player is looking at; a background companion must
      // not move the furniture in front of a human (see `readCompanionAmmoFacts`).
      // Local, for the reason the chat READ is local: fleet chat is not reachable.
      say: async (text) => {
        await api.sendChat("local", text, callOptions);
      },
      issue: async (action) => {
        // Straight to the `api.*` wrapper, the way `makeMiningBotDeps` does —
        // never through the script runner's own switch, which belongs to the
        // DSL. Every one of these is an abandonment-protocol call (decision 5);
        // the companion's ordinary work still issues nothing.
        switch (action.kind) {
          case "wait":
            return;
          case "warp":
            await warpAsTheAutopilot(action.targetID);
            return;
          case "warpToFleetMember":
            // Rung e2's other half: an id the ladder could not find on its own
            // grid, which got that far only by being a fleet-mate. The server
            // resolves where they are — see the route's own note.
            await warpToMember(action.characterID);
            return;
          case "approach":
            // ⚠ `range` IS WHERE TO STOP, and null hugs the object. Salvaging
            // and looting pass their working distance so the ship stops in
            // reach instead of flying all the way in for nothing.
            await approachShip(action.targetID, action.range ?? null);
            return;
          case "dock":
            await dockStep(action.stationID);
            return;
          case "leaveFleet":
            await leaveFleetCall(bridgeDo);
            return;
          case "acceptFleetInvite":
            await acceptFleetInviteCall(bridgeDo, action.fleetID, false);
            return;
          // Rung 7, "obeying the fleet" (fleetCompanionLoop.ts): a tag or a
          // `Target` broadcast, locked; an `AlignTo` broadcast, aligned to.
          // Straight to the api layer for the same reason every case above
          // is — the companion has to see a refusal to decide on it, not have
          // it swallowed the way the flow's own lockTarget()/alignTo() do.
          // (The align is the page's own call, bridge/movementWrites.ts, and
          // its refusal comes back here all the same.)
          case "align":
            await alignShip(action.targetID);
            return;
          case "lock":
            await lockTargetCall(bridgeDo, action.targetID, null);
            return;
          // Rung 7, the Heal family (fleetCompanionLoop.ts): a fitted remote
          // repairer, aimed at the ship the broadcast named. `repeat: -1` is
          // this codebase's own "run continuously" (see the DSL's own
          // `activate` case above `makeFleetCompanionDeps`). Phase 3 adds
          // SELF-targeted modules too (a hardener, a self-repairer), so this
          // adopts the DSL's own form: omitting the `targetID` key entirely
          // is this codebase's convention for "run it on the caster", and
          // `targetID: 0` is the DSL's sentinel for that, never a real item
          // id — it is not a ship this ladder measured on grid.
          case "activate":
            await switchModuleOn(
              action.moduleID,
              action.targetID > 0 ? { targetID: action.targetID, repeat: -1 } : { repeat: -1 },
              callOptions,
            );
            return;
          // Phase 3, "tank up": switch a module OFF. Same shape as the DSL's
          // own `deactivate` case — no target, since deactivation always
          // targets the caster's own fit.
          //
          // ⚠ THE typeID IS NOT OPTIONAL DECORATION FOR A PROP MOD. Deactivate
          // stops an afterburner/MWD only when it names the module's propulsion
          // effect, and the page asks the game's data for that name by the typeID
          // alone — without it the call returns success and the burner keeps
          // cycling (bridge/dogmaWrites.ts, deactivateModule: the page's own call
          // since 2026-10-14). The rung that emits a propulsion `deactivate` fills
          // this in; the tank-up rung leaves it undefined and the body simply
          // omits the key, exactly as before.
          case "deactivate":
            await switchModuleOff(
              action.moduleID,
              action.typeID === undefined ? {} : { typeID: action.typeID },
              callOptions,
            );
            return;
          // Rung 7, `TravelTo`: hand off to the SHARED autopilot, exactly as
          // the DSL's own `startSystemRoute` case does — same solver, same
          // bounds, and the ride ends in space at the destination system
          // since a fleet companion has no station to dock at here.
          case "travelTo":
            await startRoute(action.systemID);
            return;
          // Rung 4, "tackle → tag". ⚠ NOTHING IS READ BACK OFF THIS CALL, AND
          // NOTHING CAN BE. The server refuses a non-commander with a bare
          // `false` that its own caller discards, so the ack is identical
          // whether the tag landed or was dropped. The gate ran before the
          // write (`bridge/fleetCommand.ts`), and the confirmation is the
          // letter turning up in a later `fleetTargetTags` — which is why the
          // rung keeps its own attempt budget rather than trusting this
          // returning cleanly.
          case "setFleetTargetTag":
            await tagFleetTarget(bridgeDo, action.targetID, action.tag);
            return;
          // Rung 4's other arm, the one a plain member actually has: call the
          // tackler out by `Target` broadcast. THE ACK IS REAL HERE — the
          // server returns whether it sent, and both of its handlers return
          // that boolean rather than discarding it (the exact thing the tag
          // path above cannot say). A `false` is the 2-second broadcast rate
          // limit, which is ordinary and not an error: the rung calls each ship
          // once and is already shooting the one it just tried to name, so
          // there is nothing to raise and nothing to retry. Logged, not thrown.
          case "broadcastFleetTarget": {
            // The page's own call. To everyone: the scope a client is set to unless its pilot chose another.
            const sent = await fleetBroadcasts.toBubble("Target", FLEET_BROADCAST_SCOPE_ALL, action.targetID);
            if (!sent) {
              // ⚠ NOT AN ERROR AND NOT RETRIED. The rung calls each ship once
              // and is already shooting the one it just tried to name; a
              // re-send would be the same shout, and the next tick's rate limit
              // would very likely drop that too. Surfaced here rather than
              // swallowed only because this is the ONE fleet call whose refusal
              // is knowable at all -- worth being able to see in a console when
              // somebody asks why a call never reached the fleet.
              console.warn("companion: fleet target broadcast dropped (rate limit)", action.targetID);
            }
            return;
          }
          // Rung 6. `launchDrones` takes BAY STACK ids and `recallDrones` takes
          // the ENTITY ids of drones in space -- two different id spaces, which
          // is why the two action kinds carry differently named fields rather
          // than sharing one.
          //
          // Launch and recall are confirmed from the grid on the next tick.
          // Engage instead settles each requested drone from the server's
          // refusal dict and the authoritative post-call target read.
          case "launchDrones":
            // ⚠ THE WHOLE STACK, NOT ONE FROM IT. See wholeStackLaunch.
            await launchedThenRead(
              action.quantities === undefined
                ? wholeStackLaunch(action.droneItemIDs, companionDroneStackSizes)
                : action.droneItemIDs.map((itemID) => ({
                    itemID,
                    quantity: action.quantities?.[itemID] ?? companionDroneStackSizes.get(itemID) ?? 1,
                  })),
            );
            return;
          // ⚠ NO SCOOP FOLLOWS THIS. The server flies them home at full speed
          // and scoops them itself inside 2500 m; a scoop call would only ever
          // duplicate what it is already doing.
          case "recallDrones":
            await returnDronesToBay(bridgeDo, action.droneIDs);
            return;
          // ⚠ ONE CALL, TWO MEANINGS, AND THE SERVER PICKS. `CmdEngage` aimed at
          // a hostile is an attack; aimed at a friendly ship it is dispatched to
          // the drone REPAIR path instead. Both flights receive an explicit
          // order; server auto-defense alone does not follow the fleet primary.
          case "engageDrones":
            await engageDronesConfirmed(action.droneIDs, action.targetID);
            return;
          // ⚠ `targetID: 0` IS THE SERVER'S AUTO-PICK, not a missing value.
          case "salvageDrones":
            await salvageWithDrones(bridgeDo, action.droneIDs, action.targetID);
            return;
          // The `loot` chat order. Two calls because a wreck and a can are
          // different objects on the wire, not because they are different rules.
          case "lootWreck":
            await companionLootFrom(action.wreckID);
            return;
          case "lootContainer":
            await companionLootFrom(action.containerID);
            return;
          // Rung 5, the flee's recovery step. ⚠ THE ITEM IDS ARE THE SHOP'S OWN
          // QUOTE, read in observe() above and never guessed at here. The
          // wrapper carries `confirm: true` in the body, which is what
          // `requireWriteConfirmation` on the route wants -- a caller stating
          // intent, not a dialog. Forgetting it is a 400 CONFIRMATION_REQUIRED,
          // never a hang.
          //
          // ⚠ AND IT SPENDS THE OPERATOR'S MONEY. Nothing reaches this case
          // unless `repairsAtStation` was ticked; the rung checks before it
          // decides, and the request's risk classes say `financial` because of
          // it.
          case "repairItems":
            // A tick names items and has no quote in hand: the shop is asked for one, and paid at it.
            await repairItemsAtShop(bridgeAsk, bridgeDo, action.itemIDs, await dockedIn());
            return;
          // Rung 5, the last step of a round trip: back out into space. The
          // only call this loop makes that deliberately re-enters danger, which
          // is why `recoverAndReturn` does all its checking above it.
          case "undock":
            await orderedStep((flightNow) => undockCall(bridgeDo, flightNow, true));
            return;
          // ⚠ NO FAR-SIDE GATE, AND THAT IS THE POINT. The server resolves the
          // destination from the gate we are sitting on (`sourceGate.destinationID`);
          // passing 0 is what asks it to. See the action's own comment.
          case "jumpGate":
            await jumpStep(action.gateID, 0);
            return;
          // The standing follow rung: hold station off the fleet commander at
          // the range a `follow` chat order named — `CmdFollowBall` with a
          // non-zero range, the same call the DSL's own `follow-fleet-mate`
          // block makes for a hand-picked mate.
          //
          // ⚠ THE RUNG ISSUES THIS ONCE PER ANCHOR AND RANGE, NEVER ONCE PER
          // TICK, and this case is written on that promise. The server treats
          // it as a STANDING order: the ship goes on holding that station with
          // nothing further sent. A rung that re-sent it every tick would be
          // pure bridge traffic for a command already in force — which is why
          // the memory gate lives up in the ladder and not down here.
          case "keepAtRange":
            await keepShipAtRange(action.targetID, action.range);
            return;
          // `flight auto`: a gun boat orbits what it is shooting. Standing on the
          // server like keep-at-range, and gated the same way up in the ladder
          // (`holdNeedsReissue`), so this case is sent once per anchor and range.
          case "orbit":
            await orbitShip(action.targetID, action.range);
            return;
          // `stop` in fleet chat — the only companion action that exists to
          // UNDO standing orders rather than to issue one.
          //
          // ⚠ BOTH HALVES ARE NEEDED AND THE ORDER IS RETAIL'S, mirroring
          // `flow.stopShip()` above: abort the browser decide-loop FIRST so it
          // cannot issue another move into the stop, then tell the server to
          // cut the engines. Aborting alone ends the route and leaves the ship
          // coasting on the leg it was already flying; stopping alone halts a
          // ship the autopilot sets moving again on its next tick. A companion
          // told to stop has to end up stationary by both measures, because
          // the operator's words for this order are "it stops where it is".
          case "stopShip":
            autopilot?.abort();
            await cutEngines();
            return;
          // The reload rung: put rounds in the guns from the ship's own cargo.
          //
          // ⚠ ALWAYS "cargo", NEVER "hangar". A companion that needs this is in
          // space, where there is no station hangar to draw from. The page's own
          // call (bridge/dogmaWrites.ts) names the ship as where the charges lie,
          // and asks nothing for a hangar the pilot is not docked at.
          //
          // ⚠ NOTHING IS READ BACK OFF THIS CALL, AND NOTHING CAN BE. Which
          // charges a module accepts lives in dogma attributes the browser has
          // no allowlisted read for, so the server refuses an incompatible load
          // with its own words that never reach this layer — an accepted load
          // and a refused one look identical from here. That is why the rung
          // confirms by watching the gun leave `emptyWeaponModuleIDs` on a
          // later tick and keeps its own attempt budget, exactly as rung 4's
          // tag write does.
          case "loadAmmo":
            await loadAmmoFrom(action.moduleIDs, [action.chargeItemID], "cargo");
            // ⚠ THE ONE THING THAT MAKES THE RUNG'S ATTEMPT BUDGET MEAN WHAT IT
            // SAYS. Its budget is three ATTEMPTS per gun, but the facts above
            // refresh only every ten seconds against a two-second tick — so
            // without this, all three could be spent against the SAME stale
            // "still empty" reading, and a load that actually worked would cost
            // three calls before the next refresh proved it. Expiring the cache
            // here makes the very next tick re-read, so each attempt is judged
            // against a fresh answer. Costs one extra pair of reads per load,
            // which only happens when a gun was genuinely dry.
            companionAmmoReadAtMs = 0;
            return;
          default: {
            // ⚠ EXHAUSTIVE ON PURPOSE. Every FleetCompanionAction kind MUST be
            // issued here, or a new kind silently no-ops at runtime instead of
            // failing to compile — exactly the gap that let `deactivate` land
            // with nothing wired up for one revision.
            const never: never = action;
            throw new Error(`The fleet companion action dispatcher is missing an action: ${String(never)}`);
          }
        }
      },
      // ⚠ NOT A PLAIN `setTimeout` -- see `companionSleep`. This is the one
      // loop of the four whose inputs ARRIVE AS PUSHES rather than as reads, so
      // it is the one loop for which sleeping out a fixed cadence means sitting
      // on an order it already has.
      sleep: companionSleep,
      // The same per-character log the script runner writes; see nav/companionLog.ts.
      log: botLogSink,
      onProgress: (progress) => {
        store.apply({
          type: "companion/progress",
          status: progress.status,
          phase: progress.phase,
          action: progress.action,
          why: progress.why,
          inFleet: progress.inFleet,
          followingOrderFrom: progress.followingOrderFrom,
          lastOrderHeard: progress.lastOrderHeard,
          targetMode: progress.targetMode,
          canTag: progress.canTag,
          abandonment: progress.abandonment,
          failureReason: progress.failureReason,
          selfPaused: progress.selfPaused,
        });
      },
    };
  }

  /**
   * Who this host is flying with a bot — the union of the BFF's OWN running-bot
   * roster and whatever this host says it drives itself.
   *
   * The union is the point, because neither half alone is enough:
   *
   *   • `/api/bots/active` is the BFF's live claim map, so a headless companion
   *     reading it over loopback gets an EXACT answer covering every other
   *     headless companion — including ones this tab never started. It is
   *     unauthenticated by design (the login screen marks bot-flown pilots), so
   *     there is no token question here.
   *   • It cannot see a companion running in a BROWSER, which holds an ordinary
   *     bridge session like any human. That is what the injected half covers.
   *
   * A failed read returns `null`, never `[]`. An empty list would read as
   * "nobody is bot-driven", which makes every companion in the fleet look like a
   * human and disables the gate silently — the loudest possible failure being
   * the quiet one. `null` leaves the gate undecidable, which is the honest
   * answer and the one `decideCompanionAction` fails open on.
   */
  async function botDrivenCharacterIDs(): Promise<readonly number[] | null> {
    let serverBots: readonly number[];
    try {
      serverBots = (await api.listActiveServerBots(callOptions)).map((bot) => bot.characterID);
    } catch {
      return null;
    }
    const mine = options.botDrivenCharacterIDs?.() ?? ownDrivenCharacterIDs();
    if (mine === null) {
      return null;
    }
    return [...new Set([...serverBots, ...mine])];
  }

  /**
   * The fallback for a host that injected nothing: this session alone, and only
   * while a bot is actually holding its ship.
   *
   * It is deliberately narrow. A pilot this session is flying BY HAND is not
   * something to subtract — a human at the keyboard is exactly the supervision
   * the gate is looking for.
   */
  function ownDrivenCharacterIDs(): readonly number[] {
    const me = store.station.get().online?.characterID ?? null;
    return me !== null && store.bots.get().runningBotID !== null ? [me] : [];
  }

  /** The pending fleet invite, narrowed to the two ids the rejoin gate reads. */
  function companionPendingInvite(): { readonly fleetID: number; readonly inviterID: number | null } | null {
    const invite = store.fleet.get().pendingInvite;
    return invite === null ? null : { fleetID: invite.fleetID, inviterID: invite.inviterID };
  }

  async function readCombatLoadout(shipID: number | null, weaponIDs: readonly number[]): Promise<{
    weapons: CombatWeapons; utilities: CombatUtilities | null;
  } | null> {
      if (shipID === null) return null;
      try {
        const [fit, bound, inventory, space] = await Promise.all([
          api.loadFitting(callOptions), api.boundDogma(callOptions), api.loadInventory(callOptions), api.getSpaceSnapshot(callOptions),
        ]);
        if (fit.activeShipID !== shipID || fit.errors.slots || fit.errors.online || fit.errors.shipInfo || bound.allInfo.error ||
            Number(bound.allInfo.value?.activeShipID) !== shipID) return null;
        const container = decodeContainer(inventory.cargo.list, inventory.cargo.capacity,
          inventory.cargo.error, inventory.volumes);
        const rows = container.rows.filter(row => row.categoryID === CHARGE_CATEGORY_ID && row.quantity > 0);
        const sizes = rows.length > 0 ? await attributesOfTypes([...new Set(rows.map(row => row.typeID))], [128]) : {};
        const cargo = container.error !== null ? null : rows.map(row => ({
          itemID: row.itemID, typeID: row.typeID, groupID: row.groupID, quantity: row.quantity,
          size: sizes[row.typeID]?.[128] ?? null,
        }));
        const snapshot = decodeSpaceSnapshot(space.space);
        const slots = buildSlots(fit.slots, fit.shipInfo, fit.online);
        const typeIDs = [...new Set([...slots.flatMap(slot => slot.module ? [slot.module.typeID,
          ...(slot.module.charge ? [slot.module.charge.typeID] : [])] : []), ...rows.map(row => row.typeID)])];
        const types = await combatUtilityOfTypes(typeIDs);
        return { utilities: combatUtilityFit(shipID, slots, bound.allInfo.value, types,
          container.error === null ? rows.flatMap(row => types[row.typeID] ? [{ itemID: row.itemID, quantity: row.quantity, type: types[row.typeID]! }] : []) : null,
          snapshot?.ship?.itemID === shipID ? snapshot.ship.capacitorRatio : null),
          weapons: { ...combatFit(shipID, slots, weaponIDs,
          decodeChargeFits(fit.chargeFits), bound.allInfo.value, cargo),
          weaponBanks: snapshot?.ship?.itemID === shipID ? snapshot.ship.weaponBanks : null } };
      } catch { return null; }
    }

  async function readCombatWeapons(shipID: number | null, weaponIDs: readonly number[]): Promise<CombatWeapons | null> {
    return (await readCombatLoadout(shipID, weaponIDs))?.weapons ?? null;
  }

  function makeMiningBotDeps(): MiningBotDeps {
    // The bay's stack sizes from its last read, for `launchDrones` below.
    let droneStackSizesSeen: ReadonlyMap<number, number> = new Map();
    return {
      getStatus: async () => {
        const step = await api.getFlightStatus(callOptions);
        const status = decodeFlightStatus(step.flight);
        void observeFlightStatus(status);
        return status;
      },
      getSpaceSnapshot: async () => {
        const result = await api.getSpaceSnapshot(callOptions);
        // Run the surveyor when this grid has rocks nobody has measured yet —
        // the mining ladder chooses rocks, and a rock with no `remainingQuantity`
        // gives it nothing to choose ON. `surveyForBot` decides whether a scan is
        // actually due; on most ticks it is not, and this costs one map lookup.
        const snapshot = await surveyForBot(decodeSpaceSnapshot(result.space));
        // Push it to the space slice too, so the Overview stays live while the
        // bot works even if the panel's own poll is not running.
        store.apply({
      type: "space/snapshot",
      snapshot,
      gateLinks: gateLinksForSnapshot(snapshot),
    });
        return snapshot;
      },
      // THE LOCK AUTHORITY. A failed read must return null, never [] — an empty
      // list would read as "nothing is locked" and re-lock a rock already being
      // mined.
      getLockedTargetIDs: async () => {
        const result = await api.getTargets(callOptions);
        const ids = decodeTargetIDs(result.targetIDs);
        store.apply({ type: "targeting/targets", targetIDs: ids });
        return ids;
      },
      // THE ORE AUTHORITY, and the same rule: a hold nobody could read is not
      // an empty hold.
      getHolds: async () => {
        const result = await api.getMiningHolds(callOptions);
        const holds = decodeMiningHolds(result.holds);
        store.apply({ type: "mining/holds", holds });
        return holds;
      },
      getDroneBayItemIDs: async () => {
        const result = await api.getDrones(callOptions);
        const bay = decodeDroneBay(result.bay);
        if (bay === null) {
          return null;
        }
        droneStackSizesSeen = droneStackSizes(bay);
        return bay.map((stack) => stack.itemID);
      },
      getDroneState: async () => {
        const state = await miningDroneState(await api.getDrones(callOptions));
        if (state?.bay) droneStackSizesSeen = droneStackSizes(state.bay);
        return state;
      },
      undock: async () => {
        await orderedStep((flightNow) => undockCall(bridgeDo, flightNow, true));
      },
      // The mining bot's own warp is the menu's at nought (retail's
      // `WarpToItem(warpRange=0)`), not the autopilot's: it is a pilot's warp to
      // a belt or a station, and its floor is that call's.
      warp: async (destinationID) => {
        await warpToThing(destinationID, MENU_WARP_RANGE_M);
      },
      // The mining bot's own approach is the menu's too (`ShipApproach`: a
      // follow at the client's fifty metres, and no throttle), not the
      // autopilot's. Tranquility has 88 such follows recorded and two of the
      // autopilot's.
      approach: async (destinationID) => {
        await approachShip(destinationID, null);
      },
      dock: async (stationID) => {
        await dockStep(stationID);
      },
      lockTarget: async (targetID) => {
        await lockTargetCall(bridgeDo, targetID, null);
      },
      // No `effect` is passed: the SERVER resolves the module's own default
      // activation effect from its type. The browser never guesses which effect
      // a module runs — that rule is R23's and it holds here.
      activateModule: async (moduleID, targetID) => {
        await switchModuleOn(moduleID, { targetID, repeat: -1 }, callOptions);
      },
      launchDrones: async (itemIDs) => {
        await launchedThenRead(wholeStackLaunch(itemIDs, droneStackSizesSeen));
      },
      recallDrones: async (ids) => { await returnDronesToBay(bridgeDo, ids); },
      engageDrones: async (ids, targetID) => { await engageDronesConfirmed(ids, targetID); },
      mineDrones: async (ids, targetID) => { await mineWithDronesCall(bridgeDo, ids, targetID); },
      unloadHolds: async (itemIDs) => {
        await unloadToOwnHangar(itemIDs);
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      onProgress: (progress) => {
        store.apply({
          type: "bot/progress",
          status: progress.status,
          phase: progress.phase,
          action: progress.action,
          why: progress.why,
          rung: progress.rung,
          step: progress.step,
          rockName: progress.rockName,
          cyclesCompleted: progress.cyclesCompleted,
          oreUnitsMined: progress.oreUnitsMined,
          holdUsed: progress.holdUsed,
          holdCapacity: progress.holdCapacity,
          failureReason: progress.failureReason,
        });
        // A lost session inside the loop unwinds to character select, like
        // every other held-session flow.
        if (progress.status === "error") {
          stopLiveStream();
          store.apply({ type: "character/offline" });
        }
      },
      isSessionLost,
      refusalReason: (error) => flightErrorReason(error),
    };
  }

  // --- R36: the mission bot (a THIRD browser decide-loop) ------------------
  //
  // Wired exactly as the mining bot is, with one deliberate difference: it does
  // NOT own a flight ladder. A courier route is multi-system, which is precisely
  // what the R5b autopilot already solves, sequences and bounds — so `startTravel`
  // hands the destination to the SAME `autopilot` controller the Travel panel
  // drives, and `getTravel` reads that controller's own snapshot back. One
  // flight ladder, one set of bounds.
  //
  // As with the mining bot, these deps go STRAIGHT to the api layer rather than
  // through the flow's own agent wrappers: `runAgentAction` swallows a refusal
  // into the store and returns normally, and the bot has to SEE the refusal to
  // decide on it.
  let missionBot: MissionBotController | null = null;

  function makeMissionBotDeps(): MissionBotDeps {
    return {
      getStatus: async () => {
        const step = await api.getFlightStatus(callOptions);
        const status = decodeFlightStatus(step.flight);
        void observeFlightStatus(status);
        return status;
      },
      // Opening the conversation is how the tokens are re-minted. It is called
      // fresh on every tick that could press something — never cached.
      openConversation: async (agentID) => {
        const result = await doAgentAction(bridgeDo, agentID, null);
        const conversation = decodeConversation(result);
        store.apply({ type: "agents/conversation", agentID, conversation });
        return conversation;
      },
      // ⚠ THIS RETURNS THE CONVERSATION RATHER THAN A BOOLEAN, deliberately.
      // `doAgentAction` answers `success: true` on every branch it has, so the
      // caller must be able to read `lastActionInfo.missionCompleted` itself —
      // and the loop tests it with `=== true`, because a refusal carries null.
      doAgentAction: async (agentID, actionID) => {
        const result = await botPresses.during(agentID, () => doAgentAction(bridgeDo, agentID, actionID));
        const conversation = decodeConversation(result);
        store.apply({ type: "agents/conversation", agentID, conversation });
        return conversation;
      },
      getBriefing: async (agentID) => {
        const reads = await api.loadBriefing(agentID, callOptions);
        const briefing = decodeBriefing(reads.briefing, reads.objective);
        store.apply({ type: "agents/briefing", briefing });
        return briefing;
      },
      getJournal: async () => {
        const journal = decodeJournal(await readJournal(bridgeAsk));
        store.apply({ type: "agents/journal", journal });
        return journal;
      },
      getCargo: async () => {
        const panel = await api.loadInventory(callOptions);
        return {
          rows: decodeInventoryRows(panel.cargo.list),
          capacity: decodeCapacity(panel.cargo.capacity),
        };
      },
      getHangar: async () => decodeInventoryRows((await api.loadInventory(callOptions)).hangar.list),
      // ⚠ THE FIRST STACK OF THE RIGHT TYPE IS NOT THE PACKAGE, and a 200 is not
      // a loaded one. This is the same discipline as `loadPackageIntoShip`
      // above: match on type AND quantity, then go through the VERIFYING
      // /transfer (which re-reads and judges by the source giving something up)
      // and raise when nothing actually moved. The bot's own bound counts the
      // retries; its ladder re-reads the cargo to confirm.
      loadPackage: async (typeID, quantity) => {
        const panel = await api.loadInventory(callOptions);
        const candidates = decodeInventoryRows(panel.hangar.list).filter(
          (row) => row.typeID === typeID,
        );
        const item =
          candidates.find((row) => row.quantity === quantity) ??
          candidates.find((row) => row.quantity > quantity);
        if (!item) {
          throw new Error(`The mission package is not in the station hangar (${quantity} needed).`);
        }
        const outcome = await api.transferItems(
          [item.itemID],
          { kind: "hangar" },
          { kind: "cargo" },
          quantity,
          callOptions,
        );
        if (!outcome.applied) {
          throw new Error(
            outcome.declinedSilently
              ? "The station refused to load the mission package and gave no reason. It did not move."
              : "The mission package did not move into the ship.",
          );
        }
      },
      unloadPackage: async (itemIDs, quantity) => {
        const outcome = await api.transferItems(
          [...itemIDs],
          { kind: "cargo" },
          { kind: "hangar" },
          quantity,
          callOptions,
        );
        if (!outcome.applied) {
          throw new Error(
            outcome.declinedSilently
              ? "The station refused to take the cargo and gave no reason. It did not move."
              : "The cargo did not move into the hangar.",
          );
        }
      },
      // THE SHARED AUTOPILOT. Not a second flight ladder — the same controller,
      // the same route solver, the same R24 bounds.
      startTravel: async (stationID) => {
        const outcome = await startRoute(stationID);
        if (!outcome.started) {
          // The plan never reached the autopilot. A bot that books this as a
          // running flight spins "Flying to…" forever against a stale
          // snapshot, so the failure must THROW here — the underlying error
          // when there is one (its code drives the loop's transport-transient
          // retry), otherwise the plan reason in the player's words.
          if (outcome.cause !== undefined) {
            throw outcome.cause;
          }
          throw new Error(outcome.reason);
        }
      },
      getTravel: () => {
        if (!autopilot) {
          return null;
        }
        const progress = autopilot.snapshot();
        return {
          status: progress.status,
          destinationStationID: store.travel.get().destinationStationID,
          remainingJumps: progress.remainingJumps,
          failureReason: progress.failureReason,
        };
      },
      stopTravel: () => {
        autopilot?.abort();
      },
      // The jump gate's number, from the SAME client-side graph the autopilot
      // routes on, plotted the same way — so the number the bot refuses on is
      // the number it would have had to fly.
      getJumps: async (fromSystemID, toSystemID) => (await autopilotDistancesFrom(fromSystemID)).get(toSystemID) ?? null,
      // ⚠ THE PAYOUT IS A BALANCE DIFFERENCE, NOT A FIELD. R35 watched
      // `lastActionInfo.loyaltyPoints` read 0 on a completion that paid 213 LP,
      // so the bot reads the ACCOUNTS either side of the Complete instead.
      getBalances: async () => {
        const reads = await api.loadRewards(callOptions);
        const lp = decodeLpBalances(reads.lp);
        store.apply({
          type: "rewards/loaded",
          cashBalance: decodeCashBalance(reads.cash),
          lpBalances: lp,
          standings: decodeCharStandings(reads.standings),
          error: null,
        });
        // LP is per issuing corp; the run's total is what the player watches go
        // up, and summing is bigint-safe because LP is kept as a string.
        const total = lp.reduce((sum, row) => {
          try {
            return sum + BigInt(row.loyaltyPoints);
          } catch {
            return sum;
          }
        }, 0n);
        return { isk: decodeCashBalance(reads.cash), lp: total.toString() };
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      onProgress: (progress) => {
        store.apply({
          type: "mission-bot/progress",
          status: progress.status,
          phase: progress.phase,
          action: progress.action,
          why: progress.why,
          agentName: progress.agentName,
          missionName: progress.missionName,
          cargoText: progress.cargoText,
          destinationName: progress.destinationName,
          jumpsRemaining: progress.jumpsRemaining,
          missionsCompleted: progress.missionsCompleted,
          iskEarned: progress.iskEarned,
          lpEarned: progress.lpEarned,
          caution: progress.caution,
          failureReason: progress.failureReason,
        });
        if (progress.status === "error") {
          stopLiveStream();
          store.apply({ type: "character/offline" });
        }
      },
      isSessionLost,
      refusalReason: (error) => flightErrorReason(error),
    };
  }

  // --- R43: one ship, one bot, and a preflight against fresh authority -------
  //
  // ⚠ THE CLAIM IS THE ONLY PLACE A BOT IS STOPPED FOR ANOTHER BOT. It walks
  // every OTHER registered bot; the record it is built from is exhaustive over
  // `BotID`, so a fourth bot cannot compile without its stopper and inherits
  // exclusion from all three existing ones for free. This replaces the two
  // asymmetric hand-written lines that let the mining bot start on top of a
  // running mission bot.
  function stopMiningController(): void {
    miningBot?.stop();
  }

  function stopMissionController(): void {
    missionBot?.stop();
    // Mission travel rides the shared autopilot. Stopping only its outer loop
    // leaves that inner controller flying after another bot takes the ship.
    autopilot?.abort();
  }

  function stopCustomController(): void {
    customBotGeneration += 1;
    scriptRunner?.stop();
    // Custom travel blocks use the same shared autopilot as missions.
    autopilot?.abort();
  }

  const HOSTED_ISSUE_SETTLE_MS = 10_000;
  let hostedStopPending: Promise<void> | null = null;

  function requireCustomControllerSettled(): void {
    if (hostedStopPending) throw new Error("Combat Stop is still settling; pilot custody is retained.");
    if (scriptRunner?.transportCustody() || scriptRunner?.combatDronesForStop?.() != null)
      throw new Error("The previous controller owns unresolved work. Finish Stop settlement before replacing it.");
  }

  async function settleHostedIssue(pending: Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("An issued bot action has not settled; Stop is paused with pilot control retained.")), HOSTED_ISSUE_SETTLE_MS);
        }),
      ]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  function cancelHostedHome(kind: "script" | "companion"): Promise<void> {
    autopilot?.abort();
    if (kind === "script") {
      customBotGeneration += 1;
      return settleHostedIssue(scriptRunner?.beginGracefulStop() ?? Promise.resolve());
    }
    liveCompanionRequest = null;
    return settleHostedIssue(fleetCompanion?.beginGracefulStop() ?? Promise.resolve());
  }

  function prepareHostedBotStop(kind: "script" | "companion", deadlineMs: number): Promise<void> {
    if (hostedStopPending !== null) return hostedStopPending;
    const pending = (async () => {
      // Prevent a pending start or an active tick from issuing new script work.
      // The in-flight issue still has to settle before a drone read is trusted.
      await cancelHostedHome(kind);
      const combatDrones = kind === "script" ? scriptRunner?.combatDronesForStop?.() ?? null : null;
      if (kind === "script") await scriptRunner?.settleCombatStop?.(deadlineMs);
      if (kind === "script" && supportScript !== null) {
        const frame = supportScript;
        await settleHostedMiningSupport({ readFlight: async () => decodeFlightStatus((await api.getFlightStatus(callOptions)).flight),
          unresolvedCustody: () => !!(frame.tractor.claim || frame.tractor.order || frame.collection.pending || frame.collection.fault),
          tick: () => maintainOperationSupport(true, true), ready: () => frame.work.readyForRelocation, reason: () => frame.work.reason,
          releaseAnchor: () => api.releaseMiningSupportAnchor(callOptions), now: Date.now,
          sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), deadlineMs });
      }
      await confirmControlledDronesHome({
        read: async () => {
          const flight = decodeFlightStatus((await api.getFlightStatus(callOptions)).flight);
          if (flight.docked) return [];
          if (!flight.inSpace || flight.shipID === null) return null;
          const raw = await api.getDrones(callOptions);
          const rows = decodeDronesInSpace(raw.inSpace);
          if (raw.activeShipID !== flight.shipID || !Array.isArray(raw.inSpace) || rows === null ||
              rows.length !== raw.inSpace.length || raw.inSpace.some((value) =>
                value === null || typeof value !== "object" || Array.isArray(value) ||
                typeof value.controlled !== "boolean")) return null;
          return combatDrones === null ? rows : rows.filter(row => combatDrones.includes(row.itemID));
        },
        recall: async (ids) => { await returnDronesToBay(bridgeDo, ids); },
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now(),
        deadlineMs,
      });
    })();
    hostedStopPending = pending.finally(() => { hostedStopPending = null; });
    return hostedStopPending;
  }

  function stopCompanionController(): void {
    fleetCompanion?.stop();
    liveCompanionRequest = null;
    // The companion's movement rungs ride the same shared autopilot the mission
    // and custom loops use, so stopping the outer loop alone would leave that
    // inner controller flying after another bot takes the ship.
    autopilot?.abort();
  }

  const claimShip = createShipClaim({
    mining: stopMiningController,
    mission: stopMissionController,
    companion: stopCompanionController,
    custom: stopCustomController,
  });

  function beginSessionClose(): void {
    if (sessionClosing) throw new Error("This pilot session is already being released.");
    sessionClosing = true;
    sessionCloseGeneration += 1;
    // Stop producers before attempting release. A refused or ambiguous release
    // keeps the token and pilot held, with automation stopped for reconciliation.
    stopMiningController();
    stopMissionController();
    stopCompanionController();
    stopCustomController();
  }

  /**
   * Resolve names and WAIT for them, unlike the fire-and-forget `requestNames`.
   *
   * The preflight has to know whether a powered-up module is a mining laser,
   * and that is a question about its NAME. Reading the cache without waiting
   * would report "no miner fitted" on a ship whose Strip Miners simply had not
   * been looked up yet — a guess dressed as a fact. Anything still unresolved
   * afterwards stays unresolved and becomes a cannot-tell, never a "no".
   */
  async function resolveNamesNow(refs: readonly NameRef[]): Promise<void> {
    requestNames(refs);
    if (nameFlushScheduled) {
      nameFlushScheduled = false;
      await flushNameQueue();
    }
  }

  /**
   * What the mining bot's requirements are checked against — read NOW.
   *
   * ⚠ FRESH, NOT WHATEVER THE STORE WAS HOLDING. The panel evaluates the same
   * requirements against the store so a player can see the checklist, but that
   * copy can be minutes old: a ship that has since docked, a laser since
   * unfitted. Only these reads decide, and they are taken immediately before
   * the first call the loop would make. Every read is independent and a failure
   * lands as `null` — which the requirement turns into cannot-tell, and
   * cannot-tell does not pass.
   */
  async function miningBotReads(request: MiningBotRequest): Promise<MiningBotReads> {
    let inSpace: boolean | null = null;
    try {
      const step = await api.getFlightStatus(callOptions);
      const status = decodeFlightStatus(step.flight);
      void observeFlightStatus(status);
      inSpace = !status.docked;
    } catch {
      inSpace = null;
    }

    let minersFitted: number | null = null;
    let minersOnline: number | null = null;
    try {
      await loadFitting();
      const fit = store.fitting.get();
      if (fit.slotsError === null) {
        // Ask for every fitted module's name AND its GROUP and WAIT, then look
        // at the HIGH SLOTS — where every mining module lives. The GROUP is the
        // game's own answer to "is this a laser" (space/rowActions.ts, R47).
        await resolveNamesNow(
          fit.slots
            .filter((slot) => slot.module !== null)
            .flatMap((slot) => [
              { kind: "type" as const, id: slot.module!.typeID },
              { kind: "typeGroup" as const, id: slot.module!.typeID },
            ]),
        );
        const resolved = store.names.get().resolved;
        const nameOf = (typeID: number): string | null =>
          resolved[nameKey("type", typeID)] ?? null;
        const groupOf = (typeID: number): string | null =>
          resolved[nameKey("typeGroup", typeID)] ?? null;
        // A high-slot module whose GROUP nobody could resolve might BE a Strip
        // Miner, so an ungrouped one poisons BOTH counts rather than being read
        // as "not a miner". Only a fit we could read end to end produces numbers.
        if (ungroupedHighSlotModules(fit.slots, nameOf, groupOf).length === 0) {
          const miners = highSlotMiningModules(fit.slots, nameOf, groupOf);
          minersFitted = miners.length;
          minersOnline = miners.filter((row) => row.online).length;
        }
      }
    } catch {
      minersFitted = null;
      minersOnline = null;
    }

    let holdHasRoom: boolean | null = null;
    try {
      const result = await api.getMiningHolds(callOptions);
      const holds = decodeMiningHolds(result.holds);
      store.apply({ type: "mining/holds", holds });
      // The loop's OWN pair: the hold it will actually fill, and its own 0.9
      // headroom. "Should haul already" is exactly "has no room left".
      const shouldHaul = holdShouldHaul(destinationHold(holds));
      holdHasRoom = shouldHaul === null ? null : !shouldHaul;
    } catch {
      holdHasRoom = null;
    }

    return {
      inSpace,
      minersFitted,
      minersOnline,
      beltChosen: request.beltID > 0,
      stationChosen: request.stationID > 0,
      holdHasRoom,
    };
  }

  /**
   * The mission bot's reads. Only "where is the ship" needs the server — the
   * agent and its station come from the request the player just made, so they
   * are knowable rather than readable and can never be cannot-tell.
   */
  async function missionBotReads(request: MissionBotRequest): Promise<MissionBotReads> {
    let docked: boolean | null = null;
    try {
      const step = await api.getFlightStatus(callOptions);
      const status = decodeFlightStatus(step.flight);
      void observeFlightStatus(status);
      docked = status.docked;
    } catch {
      docked = null;
    }
    return {
      docked,
      agentChosen: request.agentID > 0,
      agentStationKnown: request.agentStationID > 0,
    };
  }

  async function startMissionBot(request: MissionBotRequest): Promise<void> {
    requireCustomControllerSettled();
    requireAutomationReady();
    const generation = sessionCloseGeneration;
    store.apply({ type: "mission-bot/start-error", message: null });

    // ⚠ THE CLAIM COMES FIRST, BEFORE THE PREFLIGHT CAN REFUSE. The player has
    // said which bot they want; whether or not this one turns out to be able to
    // start, the other must not be left flying the ship out from under a
    // decision that has already been made. A refusal that leaves the previous
    // bot running would be the old two-loops bug wearing an error message.
    autopilot?.abort();
    claimShip("mission");

    const preflight = evaluateRequirements(MISSION_BOT_REQUIREMENTS, await missionBotReads(request));
    if (generation !== sessionCloseGeneration || sessionClosing) return;
    if (!preflight.canStart) {
      store.apply({ type: "mission-bot/start-error", message: preflight.blockedBy });
      return;
    }

    const plan: MissionPlan = {
      agentID: request.agentID,
      agentName: request.agentName,
      agentStationID: request.agentStationID,
      agentStationName: request.agentStationName,
      maxJumps: request.maxJumps,
      maxMissions: request.maxMissions,
    };

    store.apply({
      type: "mission-bot/started",
      agentName: request.agentName,
      stationName: request.agentStationName,
      startedAt: Date.now(),
    });

    if (!missionBot) {
      missionBot = createMissionBot(makeMissionBotDeps());
    }
    missionBot.start(plan);
    void missionBot.run();
  }

  async function startMiningBot(request: MiningBotRequest): Promise<void> {
    requireCustomControllerSettled();
    requireAutomationReady();
    const generation = sessionCloseGeneration;
    store.apply({ type: "bot/start-error", message: null });

    // Taking the ship is the first semantic act of every start, even one whose
    // own preflight later refuses. Otherwise an invalid mining click can leave a
    // custom/mission controller flying after the player chose to replace it.
    autopilot?.abort();
    claimShip("mining");

    if (request.miningModuleIDs.length === 0) {
      store.apply({
        type: "bot/start-error",
        message: "Pick at least one piece of mining equipment for the bot to run.",
      });
      return;
    }

    // Two loops must never steer one ship. Retail's own Stop switches the
    // autopilot off for the same reason; so does this. The travel autopilot is
    // NOT a peer bot — the mission bot drives it rather than competing with it
    // — so it is aborted here and does not go through the ship claim.
    // ⚠ AND THIS IS THE LINE THAT WAS MISSING. `startMiningBot` aborted the
    // autopilot and stopped nothing else, so a running mission bot kept
    // ticking. It is now the same declarative claim the mission bot takes,
    // before the preflight, for the same reason.

    const preflight = evaluateRequirements(MINING_BOT_REQUIREMENTS, await miningBotReads(request));
    if (generation !== sessionCloseGeneration || sessionClosing) return;
    if (!preflight.canStart) {
      store.apply({ type: "bot/start-error", message: preflight.blockedBy });
      return;
    }

    const plan: MiningPlan = {
      beltID: request.beltID,
      beltName: request.beltName,
      stationID: request.stationID,
      stationName: request.stationName,
      miningModuleIDs: [...request.miningModuleIDs],
      healthFloor: request.healthFloor,
      useDrones: request.useDrones,
      myCharacterID: store.character.get().selectedCharacterID,
    };

    store.apply({
      type: "bot/started",
      beltName: request.beltName,
      stationName: request.stationName,
      startedAt: Date.now(),
    });

    if (!miningBot) {
      miningBot = createMiningBot(makeMiningBotDeps());
    }
    miningBot.start(plan);
    void miningBot.run();
  }

  // --- Fleet companion ------------------------------------------------------
  // The fifth decide-loop, and the first one whose orders come from OUTSIDE the
  // client: the fleet. It composes the SAME calls the other loops fire.

  /** The preflight reads. Both are best-effort; a failure is null, never "no". */
  async function fleetCompanionReads(): Promise<FleetCompanionReads> {
    let inFleet: boolean | null = null;
    let docked: boolean | null = null;
    try {
      const fleetSnapshot = decodeFleetCenter(await api.loadBoundFleet(callOptions));
      inFleet = fleetSnapshot.availability === "ready";
    } catch {
      inFleet = null;
    }
    try {
      const step = await api.getFlightStatus(callOptions);
      docked = decodeFlightStatus(step.flight).docked;
    } catch {
      docked = null;
    }
    return { inFleet, docked };
  }

  /**
   * `resuming` re-seats an abandonment that was already under way when the BFF
   * went down, so its thirty-minute clock continues instead of restarting.
   * Only the bot host ever passes it; a player pressing Start never does.
   */
  /** A fit we could not read: judged nowhere, warned about nowhere. */
  const UNREADABLE_COMPANION_FIT: CompanionFitFacts = Object.freeze({
    defenseModuleIDs: [],
    shieldBoosterModuleIDs: [],
    armorRepairerModuleIDs: [],
    hullRepairerModuleIDs: [],
    remoteShieldModuleIDs: [],
    remoteArmorModuleIDs: [],
    remoteCapacitorModuleIDs: [],
    weaponModuleIDs: [],
    salvagerModuleIDs: [],
    droneAssistModuleIDs: [],
    propulsionModules: [],
    modules: [],
    droneBay: null,
    droneBayRoles: { combat: [], salvage: [], logistic: [], unknown: [] },
    tankLayer: null,
    fitReadable: false,
  });

  /**
   * What ship this companion is actually in: the eight lists classified off the
   * hull, plus what each module is carrying.
   *
   * ⚠ THE GROUP NAMES MUST BE WARMED FIRST OR EVERY LIST COMES BACK EMPTY.
   * `resolveDefenseModuleIDs` and `resolveRemoteRepModuleIDs` both skip any
   * module whose typeGroup is not already in the name cache -- deliberately,
   * "never run a mystery module" -- and on the BOT HOST that cache starts
   * EMPTY. Without the `resolveNamesNow` below, a headless deriving start would
   * classify nothing, fly with no tank and no guns, and report no error at all.
   * The DSL path gets this warming as a side effect of calling
   * `resolveMiningModuleIDs` first; relying on that here would be an invisible
   * coupling to a mining read the companion has no other use for.
   */
  /**
   * The Charge category. Not a guess: this server names it itself, twice —
   * `services/fitting/liveFittingState.js:44` and
   * `services/inventory/invBrokerService.js:475` both declare
   * `CHARGE_CATEGORY_ID = 8`.
   *
   * It is what keeps the reload rung's "largest stack" fallback from reaching
   * for a hold full of ore: without a category filter the biggest stack in a
   * cargo bay is very often not ammunition at all.
   */
  const CHARGE_CATEGORY_ID = 8;

  /**
   * What the reload rung needs to know, read at most every
   * `COMPANION_AMMO_READ_INTERVAL_MS` and served from the cache in between.
   *
   * ⚠ STRAIGHT TO THE `api.*` WRAPPERS, NEVER THROUGH `loadFitting()` OR
   * `loadInventory()`. Those two APPLY to the store, which would repaint the
   * fitting and inventory panels of whichever pilot the player happens to be
   * looking at — and a background companion must not move the furniture in
   * front of a human (R92: a background pilot is still working, and its flow
   * outlives the panel). Decoding here and keeping the answer in this closure
   * leaves the store alone.
   *
   * ⚠ EVERY FIELD IS THREE-STATE. `null` means "could not read", which the
   * ladder treats as "cannot say" and never as "there is none" — a fit read
   * that stumbled must not be reported as a ship with no empty guns, nor a
   * cargo read that stumbled as a ship with no ammunition aboard.
   */
  async function readCompanionAmmoFacts(
    request: FleetCompanionRequest,
    inSpace: boolean,
    nowMs: number,
  ): Promise<typeof companionAmmoFacts> {
    // Docked there is nothing here to decide: the rung is guarded on being in
    // space, and a docked pilot's guns are not drawing from this cargo bay.
    if (!inSpace || nowMs - companionAmmoReadAtMs < COMPANION_AMMO_READ_INTERVAL_MS) {
      return companionAmmoFacts;
    }
    // Stamped BEFORE the reads, so a read that throws waits out the full
    // interval instead of being retried on every tick.
    companionAmmoReadAtMs = nowMs;

    let emptyWeaponModuleIDs: readonly number[] | null = null;
    let weaponChargeGroups: Readonly<Record<number, readonly number[]>> | null = null;
    let loadedCharges: CompanionLoadedCharge[] | null = null;
    let fitReads: Awaited<ReturnType<typeof api.loadFitting>> | null = null;
    try {
      const reads = await api.loadFitting(callOptions);
      fitReads = reads;
      if (!reads.errors.slots && !reads.errors.online) {
        const slots = buildSlots(reads.slots, reads.shipInfo, reads.online);
        const chargeFits = decodeChargeFits(reads.chargeFits);
        const guns = new Set(request.weaponModuleIDs);
        const empty: number[] = [];
        const groups: Record<number, readonly number[]> = {};
        const loaded: CompanionLoadedCharge[] = [];
        for (const slot of slots) {
          const module = slot.module;
          if (module === null || !module.online || !guns.has(module.itemID)) {
            continue;
          }
          const fitment = chargeFits[module.typeID];
          groups[module.itemID] = fitment?.groups ?? [];
          // ⚠ ONLY A MODULE THAT DEMONSTRABLY TAKES A CHARGE COUNTS AS EMPTY.
          // `decodeChargeFits` returns `{}` both for a module that takes none
          // and for a fit whose charge data never arrived — its own comment
          // says so — so a missing fitment is "cannot say", not "empty". This
          // is the same three-state `companionFitCheck.takesCharge` keeps, for
          // the same reason: a companion must not spend its attempt budget
          // trying to load rounds into a shield hardener.
          if (module.charge === null && (fitment?.groups.length ?? 0) > 0) {
            empty.push(module.itemID);
          }
          // What is in it, for the `status` answer and the low-ammo warning.
          if (module.charge !== null && module.charge.quantity > 0) {
            loaded.push({ moduleID: module.itemID, typeID: module.charge.typeID, quantity: module.charge.quantity });
          }
        }
        emptyWeaponModuleIDs = empty;
        weaponChargeGroups = groups;
        loadedCharges = loaded;
      }
    } catch {
      // Left null on purpose. See the three-state note above.
    }

    let cargoCharges: readonly CompanionCargoCharge[] | null = null;
    try {
      const panel = await api.loadInventory(callOptions);
      const cargo = decodeContainer(
        panel.cargo.list,
        panel.cargo.capacity,
        panel.cargo.error,
        panel.volumes,
      );
      cargoCharges =
        cargo.error !== null
          ? null
          : cargo.rows
              .filter((row) => row.categoryID === CHARGE_CATEGORY_ID && row.quantity > 0)
              .map((row) => ({
                itemID: row.itemID,
                typeID: row.typeID,
                groupID: row.groupID,
                quantity: row.quantity,
              }));
    } catch {
      // Left null on purpose. See the three-state note above.
    }

    companionAmmoFacts = { emptyWeaponModuleIDs, cargoCharges, weaponChargeGroups, loadedCharges };
    companionCombatWeapons = await readCompanionCombatWeapons(request, fitReads);
    companionChargeFacts = await readCompanionChargeFacts(cargoCharges, companionCombatWeapons);
    return companionAmmoFacts;
  }

  /**
   * The static facts ammo by target ranks with (companionAmmo.ts): every charge
   * type in the cargo or in a gun, and every gun type. `attributesOfTypes`
   * keeps what it was told per type, so after the first read of a type this
   * costs no call. A failure leaves that half `null`; names are warmed with the
   * same cache the panels use and are only ever a readout nicety.
   */
  async function readCompanionChargeFacts(
    cargo: readonly CompanionCargoCharge[] | null,
    weapons: CombatWeapons | null,
  ): Promise<typeof companionChargeFacts> {
    const chargeTypes = [...new Set([
      ...(cargo ?? []).map((charge) => charge.typeID),
      ...(weapons?.weapons ?? []).flatMap((weapon) => (weapon.chargeTypeID === null ? [] : [weapon.chargeTypeID])),
    ])];
    const weaponTypes = [...new Set((weapons?.weapons ?? []).map((weapon) => weapon.typeID))];
    let chargeFactsByTypeID: Record<number, ChargeFacts> | null = null;
    let weaponCycleByTypeID: Record<number, WeaponCycleFacts> | null = null;
    try {
      await resolveNamesNow(chargeTypes.map((id) => ({ kind: "type" as const, id }))).catch(() => {});
      const rows: Readonly<Record<number, Readonly<Record<number, number>>>> =
        chargeTypes.length > 0 ? await attributesOfTypes(chargeTypes, CHARGE_ATTRIBUTE_IDS) : {};
      const resolved = store.names.get().resolved;
      chargeFactsByTypeID = {};
      for (const typeID of chargeTypes) {
        if (rows[typeID] !== undefined) {
          chargeFactsByTypeID[typeID] = chargeFactsFromAttributes(rows[typeID], resolved[nameKey("type", typeID)] ?? null);
        }
      }
    } catch {
      chargeFactsByTypeID = null;
    }
    try {
      const rows: Readonly<Record<number, Readonly<Record<number, number>>>> =
        weaponTypes.length > 0 ? await attributesOfTypes(weaponTypes, WEAPON_CYCLE_ATTRIBUTE_IDS) : {};
      weaponCycleByTypeID = {};
      for (const typeID of weaponTypes) {
        const cycle = weaponCycleFromAttributes(rows[typeID]);
        if (cycle !== null) {
          weaponCycleByTypeID[typeID] = cycle;
        }
      }
    } catch {
      weaponCycleByTypeID = null;
    }
    return { chargeFactsByTypeID, weaponCycleByTypeID };
  }

  /**
   * The guns' reach with their loaded charges, from the fit the ammo read just
   * made. See `companionCombatWeapons` for why the bound dogma is read only when
   * `companionCombatChargeKey` changes: the key is every gun's loaded charge
   * type plus the hull, which is everything reach depends on that can change
   * mid-run. Any failure answers `null`, which the range gate reads as "fire".
   *
   * It also fills `companionCombatUtilities` (rung 8a) off the same two reads:
   * the key carries the utility modules' state too, so a ship with no guns but a
   * web still reads its dogma once, and again only when that module changes.
   */
  async function readCompanionCombatWeapons(
    request: FleetCompanionRequest,
    reads: Awaited<ReturnType<typeof api.loadFitting>> | null,
  ): Promise<CombatWeapons | null> {
    const shipID = companionShipID;
    if (shipID === null || reads === null ||
      reads.activeShipID !== shipID || reads.errors.slots || reads.errors.online || reads.errors.shipInfo) {
      companionCombatChargeKey = null;
      companionCombatUtilities = null;
      return null;
    }
    const slots = buildSlots(reads.slots, reads.shipInfo, reads.online);
    const guns = new Set(request.weaponModuleIDs);
    // Rung 8a's modules, told apart by the static data's group (kept per type, so
    // a call only the first time a type is seen). A read that stumbles finds no
    // utility this time; the next interval asks again.
    let types: Awaited<ReturnType<typeof combatUtilityOfTypes>> = {};
    try {
      types = await combatUtilityOfTypes([...new Set(slots.flatMap((slot) => slot.module === null ? []
        : [slot.module.typeID, ...(slot.module.charge === null ? [] : [slot.module.charge.typeID])]))]);
    } catch {
      types = {};
    }
    const utilityIDs = new Set(slots.flatMap((slot) => slot.module !== null &&
      AUTOMATIC_UTILITY_FAMILIES[types[slot.module.typeID]?.groupID ?? -1] !== undefined ? [slot.module.itemID] : []));
    if (request.weaponModuleIDs.length === 0 && utilityIDs.size === 0) {
      companionCombatChargeKey = null;
      companionCombatUtilities = null;
      return null;
    }
    const stateOf = (ids: ReadonlySet<number>): string => slots
      .flatMap((slot) => slot.module !== null && ids.has(slot.module.itemID)
        ? [`${slot.module.itemID}:${slot.module.online ? 1 : 0}:${slot.module.charge?.typeID ?? "-"}`] : [])
      .join(",");
    // ⚠ WIDENED, NOT A SECOND KEY: one dogma read serves both the guns and the
    // utilities, and it is re-read only when either's item, online or loaded
    // charge state moved.
    const key = `${shipID}|${stateOf(guns)}|${stateOf(utilityIDs)}`;
    if (key === companionCombatChargeKey) {
      return companionCombatWeapons;
    }
    try {
      const bound = await api.boundDogma(callOptions);
      if (bound.allInfo.error || Number(bound.allInfo.value?.activeShipID) !== shipID) {
        companionCombatChargeKey = null;
        companionCombatUtilities = null;
        return null;
      }
      companionCombatChargeKey = key;
      // No cargo for either: the reload rung reads its own (`cargoCharges`), reach
      // does not depend on what is in the hold, and the capacitor booster (the one
      // utility that loads from it) is not run by the companion. The ratio only
      // scales the capacity back out (`companionUtilities.ts`), so the page's own
      // last snapshot is enough.
      const seen = store.space.get().snapshot?.ship ?? null;
      const utilities = utilityIDs.size === 0 ? null : combatUtilityFit(shipID, slots, bound.allInfo.value,
        types, null, seen !== null && seen.itemID === shipID ? seen.capacitorRatio : null);
      // Gated like every other list of modules to switch on (`fittedModuleActivation`).
      if (utilities !== null) await readTypeActivation(utilities.modules.map((module) => module.typeID));
      companionCombatUtilities = utilities === null ? null
        : { ...utilities, modules: utilities.modules.filter((module) => fittedModuleActivation(module) !== "passive") };
      return request.weaponModuleIDs.length === 0 ? null
        : combatFit(shipID, slots, request.weaponModuleIDs, decodeChargeFits(reads.chargeFits), bound.allInfo.value, null);
    } catch {
      companionCombatChargeKey = null;
      companionCombatUtilities = null;
      return null;
    }
  }

  async function readCompanionFitFacts(): Promise<CompanionFitFacts> {
    try {
      await loadFitting();
      const fit = store.fitting.get();
      // Read before the slots gate: the stats come off the hull, not the slots.
      companionTargeting = {
        maxLockedTargets: fit.stats.targeting.maxLockedTargets.known
          ? fit.stats.targeting.maxLockedTargets.value
          : null,
        maxTargetRangeM: fit.stats.targeting.maxTargetRange.known
          ? fit.stats.targeting.maxTargetRange.value
          : null,
      };
      // The DSL's own resolver: the fit stat when it is known, the pilot's
      // drone skills otherwise, `null` for a hull with a known-empty bay.
      companionDroneControlRangeM = await resolveDroneControlRange(fit);
      if (fit.slotsError !== null) {
        return UNREADABLE_COMPANION_FIT;
      }
      await resolveNamesNow(
        fit.slots
          .filter((slot) => slot.module !== null)
          .flatMap((slot) => [
            { kind: "typeGroup" as const, id: slot.module!.typeID },
            // ⚠ WARMED HERE OR THE PROPULSION SPLIT SILENTLY COLLAPSES. Group 46
            // says "this is a prop mod" and this says WHICH, and the classifier
            // reads both out of the already-resolved cache rather than awaiting
            // anything itself. A prop mod whose effect is unresolved is still
            // classified (the group answered), but as neither kind -- see
            // `resolveDefenseModuleIDs`, which records what that costs.
            { kind: "propulsionEffect" as const, id: slot.module!.typeID },
          ]),
      );
      // ⚠ AWAITED, UNLIKE loadFitting's OWN FIRE-AND-FORGET CALL. `loadFitting`
      // kicks dogma off with `void loadDogma().catch(...)` so a stumbling dogma
      // read cannot hold the fit up -- which means that after awaiting the fit
      // alone the dogma slice may still be empty. The hardener branch needs it
      // to tell a Damage Control from a real hardener; without this the
      // classifier falls back to the name every time and inherits the very
      // defect it now avoids.
      await loadDogma().catch(() => {});
      // ⚠ AWAITED FOR THE SAME REASON, and before every classifier below: each
      // list is gated by whether its module can be switched on at all
      // (`fittedModuleActivation`), and that is this read. Kept per type, so it
      // is a call only the first time a type is fitted.
      await readTypeActivation(fit.slots.flatMap((slot) => slot.module === null ? [] : [slot.module.typeID]));
      const defense = resolveDefenseModuleIDs();
      const remote = resolveRemoteRepModuleIDs();
      // The buffer fit's own answer to "where is this ship's tank", voted off
      // the same already-resolved group names the classifiers above read. Only
      // ever consulted when nothing repairable has already said so.
      const tankLayer = resolveTankLayer();
      const modules = fit.slots
        .filter((slot) => slot.module !== null && slot.module.online)
        .map((slot) => {
          const module = slot.module!;
          const fitment = fit.chargeFits[module.typeID];
          return {
            itemID: module.itemID,
            typeID: module.typeID,
            hasCharge: module.charge !== null,
            // ⚠ NULL WHEREVER WE CANNOT SAY. `decodeChargeFits` gives `{}` both
            // for a module that takes no charge and for a fit whose charge data
            // did not arrive, so only a positive group list is a confident
            // "this has somewhere to load something".
            takesCharge: fitment !== undefined && fitment.groups.length > 0 ? true : null,
          };
        });
      // ⚠ READ UNCONDITIONALLY NOW. This used to sit behind `useDrones`, because
      // the bay is a round trip and a pilot whose operator had not ticked drones
      // could never use one. There is no such tick: a companion flies the drones
      // it is carrying, so whether it has any is exactly the question this read
      // answers, and it cannot be skipped on the strength of an answer nobody
      // gave. One extra call, once, at start — not per tick.
      let droneBay: ReturnType<typeof decodeDroneBay> = null;
      let droneBayRoles: DroneRoleIDs = { combat: [], salvage: [], logistic: [], unknown: [] };
      try {
        const raw = await api.getDrones(callOptions);
        droneBay = decodeDroneBay(raw.bay);
        if (droneBay !== null) {
          // The same resolve-then-judge pass the module classifier makes, for
          // the same reason: the game says what a type IS and we only read the
          // answer. Warmed here because a bot host's name cache starts empty,
          // and an unresolved group leaves a drone in NO role rather than in a
          // wrong one.
          await resolveNamesNow(
            droneBay.map((stack) => ({ kind: "typeGroup" as const, id: stack.typeID })),
          );
          const names = store.names.get().resolved;
          droneBayRoles = splitDroneRoles(
            droneBay,
            (stack) => stack.typeID,
            (stack) => stack.itemID,
            (typeID) => names[nameKey("typeGroup", typeID)] ?? null,
          );
        }
      } catch {
        droneBay = null;
      }
      return {
        defenseModuleIDs: defense.hardeners,
        shieldBoosterModuleIDs: defense.shield,
        armorRepairerModuleIDs: defense.armor,
        hullRepairerModuleIDs: defense.hull,
        ancillaryRepairerModuleIDs: defense.ancillary,
        remoteShieldModuleIDs: remote.shield,
        remoteArmorModuleIDs: remote.armor,
        remoteCapacitorModuleIDs: remote.cap,
        weaponModuleIDs: defense.weapons,
        // ⚠ ITS OWN CLASSIFIER, NOT A BRANCH OF `resolveDefenseModuleIDs`.
        // `resolveSalvageModuleIDs` already existed for the DSL and matches the
        // game's own "Salvager" group in high slots only; reusing it means one
        // answer to "is this a salvager", not two that can drift.
        salvagerModuleIDs: resolveSalvageModuleIDs(),
        droneAssistModuleIDs: resolveDroneAssistModuleIDs(),
        propulsionModules: defense.propulsion,
        modules,
        droneBay,
        droneBayRoles,
        tankLayer,
        fitReadable: true,
      };
    } catch {
      return UNREADABLE_COMPANION_FIT;
    }
  }

  async function startFleetCompanion(
    setup: CompanionSetup,
    resuming: CompanionAbandonmentRecord | null = null,
  ): Promise<void> {
    requireCustomControllerSettled();
    requireAutomationReady();
    const generation = sessionCloseGeneration;
    store.apply({ type: "companion/start-error", message: null });

    // Taking the ship is the first semantic act of every start, even one whose
    // own preflight later refuses — the player has said which loop they want.
    autopilot?.abort();
    claimShip("companion");

    // ⚠ A NEW RUN HAS FINISHED WITH NOTHING, and these two outlive the
    // controller because they hang off the flow. The ladder's own
    // `lootedItemIDs` already starts empty on every `start()` — for the reason
    // spelled out there: a can this run has not emptied is a can it must be
    // willing to try — and leaving these standing made that promise false from
    // the outside. A can set aside once (out of reach, a hold with no room, a
    // bind the server refused) stayed set aside for the life of the tab, so
    // re-ordering `loot` after fixing the cause did nothing at all and the pilot
    // ignored the can for ever.
    companionLootAttempts.clear();
    companionLootFinished.clear();
    // The shared marks go too, and are read back on the first tick that sees a
    // can on the grid. Nothing is lost -- the board is the BFF's, not this
    // run's -- and it keeps the promise above literally true: a new run starts
    // out willing to try everything, then asks.
    companionSharedEmpty.clear();
    companionSharedEmptyReadAtMs = 0;

    const preflight = evaluateRequirements(FLEET_COMPANION_REQUIREMENTS, await fleetCompanionReads());
    if (generation !== sessionCloseGeneration || sessionClosing) return;
    if (!preflight.canStart) {
      store.apply({ type: "companion/start-error", message: preflight.blockedBy });
      return;
    }

    // ⚠ READ THE SHIP BEFORE THE LOOP SEES ANYTHING. The setup carries no module
    // lists at all -- they exist only once this has read the hull -- and the
    // first tick can fire immediately, so a loop started before this returned
    // would spend that tick believing the ship carries nothing.
    const fitFacts = await readCompanionFitFacts();
    if (generation !== sessionCloseGeneration || sessionClosing) return;
    const flownRequest = requestForFit(setup, fitFacts);
    // Advisory, never a refusal: a human loads the missing thing or flies
    // anyway. Judged against the DERIVED request, because its lists are what
    // this run will actually cycle.
    const fitWarnings = companionFitWarnings(flownRequest, fitFacts);

    store.apply({
      type: "companion/started",
      startedAt: Date.now(),
      fitWarnings,
    });

    if (!fleetCompanion) {
      fleetCompanion = createFleetCompanion(makeFleetCompanionDeps());
    }
    // Before start(), not after: the first tick can fire immediately, and a tick
    // that read a stale request would decide this run on the last one's orders.
    liveCompanionRequest = flownRequest;
    fleetCompanion.start(flownRequest, resuming);
    void fleetCompanion.run();
  }

  function pauseFleetCompanion(): void {
    fleetCompanion?.pause();
  }

  function resumeFleetCompanion(): void {
    requireAutomationReady();
    if (!fleetCompanion) {
      return;
    }
    fleetCompanion.resume();
    void fleetCompanion.run();
  }

  function stopFleetCompanion(): void {
    stopCompanionController();
  }

  // --- Player Bot Builder runner --------------------------------------------
  // The fourth decide-loop. It composes the SAME calls the mining/mission bots
  // fire; the player's blocks choose which, in which order.
  let scriptRunner: ScriptRunnerController | null = null;
  let fleetCompanion: FleetCompanionController | null = null;
  /**
   * The request the companion is CURRENTLY running, for the reads whose cost
   * depends on it -- chat, today.
   *
   * ⚠ IT IS A LIVE REFERENCE AND NOT A CAPTURED ONE, AND THAT IS THE WHOLE
   * POINT. `makeFleetCompanionDeps()` is built ONCE and the controller is
   * cached (`if (!fleetCompanion)`), so a request threaded in at deps-build
   * time would be the FIRST run's request forever: start a companion with chat
   * off, stop it, start another with chat on, and the second one would silently
   * never read chat. Assigned on EVERY start, cleared on stop.
   */
  let liveCompanionRequest: FleetCompanionRequest | null = null;
  // Bumped on every start/stop/panic. `startCustomBot` awaits a fitting read
  // before it creates the runner; without this a second Start (or a Stop) during
  // that gap would leave the FIRST run() loop orphaned and unstoppable — two
  // loops driving one hull. Whoever bumps last wins; a superseded start bails.
  let customBotGeneration = 0;
  let hostedRecoveryVerified = false;
  let hostedRecoveryFitting: string | null = null;
  let hostedTransportSuspended = false;
  let hostedRecoveryName: string | null = null;
  let invalidateScriptRecoveryCaches: (() => void) | null = null;

  let hostedJettisonPending = false;
  function suspendHostedSession(): Promise<void> {
    hostedRecoveryVerified = false;
    hostedTransportSuspended = true;
    hostedRecoveryName = store.customBot.get().name;
    const priorFit = store.fitting.get();
    hostedRecoveryFitting = priorFit.loaded && priorFit.slotsError === null ? fittingCapabilitySignature() : null;
    pilotRecoveryEnabled = true;
    customBotGeneration += 1;
    recoveryGeneration += 1;
    recoverySignal.set({ phase: "checking", reason: null });
    recoveryTask = null;
    stopLiveStream();
    autopilot?.abort();
    return settleHostedIssue(scriptRunner?.suspendTransport() ?? Promise.resolve());
  }

  async function verifyHostedSessionRecovery(shipID: number): Promise<void> {
    const generation = customBotGeneration;
    const current = () => {
      if (generation !== customBotGeneration || scriptRunner?.getStatus() !== "paused")
        throw new Error("The hosted recovery was superseded.");
    };
    await retryDroneRecovery(); current(); requireAutomationReady();
    await loadFlightStatus(); current();
    const flight = store.flight.get().status;
    if (!flight || flight.shipID !== shipID || flight.shipIsCapsule === true || (!flight.inSpace && !flight.docked))
      throw new Error("The original hosted ship is unavailable or changed.");
    await resolveScriptModuleCapabilities(); current();
    const fit = store.fitting.get();
    if (!fit.loaded || fit.activeShipID !== shipID || fit.slotsError !== null || fit.dogmaError !== null ||
        hostedRecoveryFitting === null || fittingCapabilitySignature() !== hostedRecoveryFitting)
      throw new Error("The hosted fitting is unreadable or changed during recovery.");
    const readStarted = Date.now();
    await loadSpaceSnapshot(); current();
    const space = store.space.get();
    if (flight.inSpace && (!space.loaded || space.error !== null || space.snapshot?.inSpace !== true || space.snapshot.shipID !== shipID ||
        space.snapshot.ship?.characterID !== store.station.get().online?.characterID || space.snapshot.ship?.geometryAvailable !== true ||
        space.snapshot.sampledAtMs === null || !Number.isFinite(space.snapshot.sampledAtMs) || Date.now() - readStarted >= 10_000))
      throw new Error("The reacquired hosted scene is unavailable or stale.");
    await loadFleet(); current();
    const fleet = readMiningSupportFleet("recovery-preflight");
    if (!fleet || fleet.receivedAtMs < readStarted || !["ready", "not-in-fleet"].includes(fleet.snapshot.availability) ||
        fleet.snapshot.availability === "ready" && authoritativeFleetMemberCharacterIDs(fleet.snapshot) === null)
      throw new Error("The reacquired fleet membership is unavailable.");
    if (options.miningOperationID) {
      const assignment = await api.readMiningOperationAssignment(callOptions); current();
      const target = assignment?.role === "HAULER" ? assignment.logisticsTarget ?? assignment.currentTarget : assignment?.currentTarget;
      if (assignment?.operationID !== options.miningOperationID || assignment.stopRequested ||
          !target || target.claimedByOperationID !== assignment.operationID || !["RESERVED", "ACTIVE", "DRAINING"].includes(target.state))
        throw new Error("The operation target or productive assignment is unavailable.");
    }
    if (options.hostedOreJettisonRecovery) {
      const receipt = await api.reconcileHostedJettison(callOptions); current();
      if (receipt) hostedJettisonPending = !api.recoverableHostedJettison(receipt);
    }
    const frame = supportScript;
    if (frame?.self.order?.action.kind === "lock" && !frame.self.fault) {
      const targets = await api.getTargets(callOptions); current();
      frame.self = retireHostedSelfLock(frame.self, targets.targetIDs);
    }
    if (frame && flight.inSpace) {
      const freshServices = readMiningSupportServices();
      // Quiescence retires movement intent; only observed physical settlement
      // permits abandoning it. This does not claim arrival or coverage.
      const stopped = hostedSupportMotionSettled(space.snapshot, freshServices);
      frame.position = { ...frame.position, support: { ...frame.position.support,
        orders: observeMiningSupportOrders(freshServices, frame.position.support) },
        ...(stopped && !frame.position.fault ? { braking: null, relocation: null } : {}) };
    }
    const custody = [scriptRunner?.transportCustody() && "runner claim or Travel Assist", frame?.collection.pending && "collection transfer",
      frame?.collection.fault && "collection fault", frame?.tractor.claim && "tractor claim", frame?.tractor.order && "tractor order",
      frame?.tractor.fault && "tractor fault", frame?.self.order && "self-mining order", frame?.self.fault && "self-mining fault",
      frame && frame.position.support.orders.length > 0 && "support module order", frame?.position.relocation && "support relocation",
      frame?.position.braking && "support braking", frame?.fleet.order && "fleet membership order"].filter(Boolean);
    if (frame?.position.fault) custody.push("support movement fault");
    if (custody.length) throw new Error(`Session recovery retains unresolved work custody (${custody.join(", ")}); reconcile or Stop before resuming.`);
    if (frame) {
      const fresh = freshSupportScript();
      // Confirmed collected provenance stays owned; pending inventory is never
      // rebased. Other session-scoped movement/module/fleet feedback expires.
      fresh.collection = { ...frame.collection, scope: frame.collection.scope ? { ...frame.collection.scope, sessionEpoch: fresh.epoch } : null };
      supportScript = fresh;
    }
    invalidateScriptRecoveryCaches?.();
    hostedRecoveryVerified = true;
  }

  function resumeHostedSession(): void {
    if (!hostedRecoveryVerified || scriptRunner?.getStatus() !== "paused") throw new Error("Hosted recovery has not been verified.");
    requireAutomationReady();
    hostedRecoveryVerified = false;
    hostedTransportSuspended = false;
    scriptRunner.resumeTransport();
    void scriptRunner.run();
  }

  /**
   * The ship's fitted mining-module item ids, resolved at start and whenever the
   * active hull / fit changes (the same high-slot + resolved-group rule the
   * mining bot's preflight uses). Empty when the fit could not be read.
   */
  async function resolveMiningModuleIDs(): Promise<readonly number[]> {
    try {
      await loadFitting();
      const fit = store.fitting.get();
      if (fit.slotsError !== null) {
        return [];
      }
      await resolveNamesNow(
        fit.slots
          .filter((slot) => slot.module !== null)
          .flatMap((slot) => [
            { kind: "type" as const, id: slot.module!.typeID },
            { kind: "typeGroup" as const, id: slot.module!.typeID },
          ]),
      );
      const resolved = store.names.get().resolved;
      const nameOf = (typeID: number): string | null => resolved[nameKey("type", typeID)] ?? null;
      const groupOf = (typeID: number): string | null => resolved[nameKey("typeGroup", typeID)] ?? null;
      return highSlotMiningModules(fit.slots, nameOf, groupOf).map((row) => row.itemID);
    } catch {
      return [];
    }
  }

  /**
   * The fitted SALVAGERS, by the game's own group name ("Salvager") — the same
   * resolve-then-judge pass the miner resolution makes. Runs after
   * resolveMiningModuleIDs, so the names are already in the cache.
   */
  /**
   * The fitted DEFENSE modules by the game's own group names, for the repair
   * watch and the hardeners block. Same resolve-then-judge pass as the miners;
   * runs after resolveMiningModuleIDs so the names are already cached. Reps live
   * in mids/lows, so every family is scanned (not just high slots).
   */
  /**
   * Which layer this hull is BUILT around — the answer for a buffer fit, which
   * cycles nothing and therefore says nothing through any of the lists
   * `resolveDefenseModuleIDs` fills. The judging lives in `bots/tankLayer.ts`,
   * where it can be tested against real SDE group names without a store; this
   * half is the resolve, exactly as the drone-role split is arranged.
   *
   * ⚠ RIGS ARE INCLUDED, AND ARE EXCLUDED EVERYWHERE ELSE IN THIS FILE. A rig
   * cannot be activated, so no cycling list may hold one — but "Rig Armor" on a
   * hull is about as plain a statement of tank as this game makes. Their group
   * names are already in the cache: `readCompanionFitFacts` warms `typeGroup`
   * for every fitted slot, rigs included.
   *
   * ⚠ AN OFFLINE MODULE COUNTS TOO, unlike everywhere else here. What a hull
   * CARRIES is the statement; whether it happens to be powered this minute is
   * about capacitor and powergrid, not about where its tank was built.
   * Subsystems are skipped because a T3's subsystem group names describe a
   * hull role rather than a tank.
   */
  function resolveTankLayer(): CompanionTankLayer | null {
    const fit = store.fitting.get();
    if (fit.slotsError !== null) {
      return null;
    }
    const resolved = store.names.get().resolved;
    return voteTankLayer(
      fit.slots
        .filter((slot) => slot.module !== null && slot.family !== "subsystem")
        .map((slot) => resolved[nameKey("typeGroup", slot.module!.typeID)] ?? null),
    );
  }

  function resolveDefenseModuleIDs(): {
    readonly shield: readonly number[];
    readonly armor: readonly number[];
    readonly hull: readonly number[];
    /** The ancillary ones among shield/armor/hull: they eat a charge a cycle. */
    readonly ancillary: readonly number[];
    readonly hardeners: readonly number[];
    readonly weapons: readonly number[];
    readonly propulsion: readonly CompanionPropulsionModule[];
  } {
    const fit = store.fitting.get();
    const shield: number[] = [];
    const armor: number[] = [];
    const hull: number[] = [];
    const ancillary: number[] = [];
    const hardeners: number[] = [];
    const weapons: number[] = [];
    const propulsion: CompanionPropulsionModule[] = [];
    if (fit.slotsError === null) {
      const resolved = store.names.get().resolved;
      for (const slot of fit.slots) {
        if (slot.module === null || !slot.module.online || slot.family === "rig" || slot.family === "subsystem") {
          continue;
        }
        const group = resolved[nameKey("typeGroup", slot.module.typeID)] ?? null;
        if (group === null) {
          continue; // cannot tell what it is — never run a mystery module
        }
        // ⚠ PASSIVE MODULES ARE DROPPED HERE, FOR EVERY FAMILY, NOT JUST FOR
        // HARDENERS. This test used to live inside the hardener branch alone,
        // because that is where the bug was found: group 60 "Damage Control"
        // holds the passive Damage Control II AND the cycling Assault Damage
        // Control II, so no test on the group NAME could separate them. But the
        // principle was never specific to hardeners -- "what is this for" comes
        // from the group and "can it be cycled" comes from dogma attribute 73 --
        // and now that every list is DERIVED rather than ticked by a player
        // (docs/fleet-companion-simplification.md), a passive module landing in
        // any of these lists is a call wasted every tick with nothing to show.
        //
        // ⚠ UNREADABLE STILL FAILS OPEN, and that is unchanged and deliberate. A
        // dogma snapshot that did not arrive must not quietly disarm a ship:
        // cycling a passive module wastes a call, refusing to cycle a real one
        // loses the tank or the guns. `itemHasActivationCycle` is three-state and
        // only an explicit `false` excludes.
        //
        // ⚠ SINCE 2026-10-14 THE TYPE'S OWN ANSWER COMES FIRST: the server's
        // test of whether the type has an effect a pilot switches on
        // (`fittedModuleActivation`, nav/moduleActivation.ts), with the item's
        // cycle standing in only while that is unread. Still only "passive"
        // excludes.
        if (fittedModuleActivation(slot.module) === "passive") {
          continue;
        }
        if (/remote/i.test(group)) {
          // ⚠ EXCLUDED BEFORE THE SELF TESTS BELOW, on purpose — this is the
          // Remote-Shield-Booster-read-as-a-local-rep bug the warp-scrambler
          // comment further down already warned about. Verified against the SDE
          // (`_local/sde/.../groups.jsonl`): "Remote Shield Booster", "Ancillary
          // Remote Shield Booster", "Remote Armor Repairer", "Ancillary Remote
          // Armor Repairer", "Mutadaptive Remote Armor Repairer" and "Remote Hull
          // Repairer" EVERY ONE of them also matches a self test two lines down
          // (their names literally contain "shield booster"/"armor repair"/"hull
          // repair"), and resolveRemoteRepModuleIDs (below) already classifies
          // every one of them correctly. Without this guard a fitted remote
          // repairer would land in BOTH lists, and the `repair` interrupt
          // (nav/scriptDecide.ts) activates a self-list module SELF-TARGETED
          // (targetID: 0) — a remote repairer told to repair itself repairs
          // NOTHING and burns capacitor, on the one hull whose job is repairing
          // someone else. No group any branch here (or the weapon/tackle/web
          // tests) cares about has "remote" in its name except the remote-rep
          // groups themselves, so this cannot swallow a genuine self module.
        } else if (/shield booster/i.test(group)) {
          // "booster", not "boost": group 338 "Shield Boost Amplifier" also
          // reads as /shield boost/i but is a PASSIVE module — it raises what an
          // ACTIVE Shield Booster elsewhere on the fit repairs and has no cycle
          // of its own, so it must never land in a list this ladder activates.
          // Anchoring on "booster" keeps "Shield Booster" and "Ancillary Shield
          // Booster" and drops the amplifier, with no extra branch needed.
          shield.push(slot.module.itemID);
          if (/ancillary/i.test(group)) ancillary.push(slot.module.itemID);
        } else if (/armor repair/i.test(group)) {
          armor.push(slot.module.itemID);
          if (/ancillary/i.test(group)) ancillary.push(slot.module.itemID);
        } else if (/hull repair/i.test(group)) {
          hull.push(slot.module.itemID);
        } else if (/hardener|damage control|resistance/i.test(group)) {
          // ⚠ THIS BRANCH IS WHERE THE DURATION TEST WAS DISCOVERED, and the
          // test itself has moved ABOVE the whole chain so every family gets it.
          // Kept here as the record of why it exists at all: checked against the
          // SDE on 2026-09-11, group 60 "Damage Control" holds Damage Control II,
          // which has NO duration and is passive the moment it is online, AND
          // Assault Damage Control II, which cycles for 10125ms and is worth
          // running. One group, both answers -- so no regex over this name could
          // ever have told them apart, which is why this defect outlived attempts
          // to fix it by editing the pattern. Group 295 "Shield Resistance
          // Amplifier" is passive throughout and was being swept in by the
          // `/resistance/` arm for the same reason.
          hardeners.push(slot.module.itemID);
        } else if (/^propulsion module$/i.test(group)) {
          // ⚠ ONE GROUP, TWO MODULES THAT MUST BE TOLD APART, AND THE GROUP NAME
          // CANNOT DO IT. SDE group 46 "Propulsion Module" holds every
          // afterburner AND every microwarpdrive, so this branch is the whole of
          // what the group can say. The split comes from the SDE's own
          // dogmaEffects instead — 6731 `moduleBonusAfterburner`, 6730
          // `moduleBonusMicrowarpdrive` — resolved through the `propulsionEffect`
          // name kind and warmed alongside the group above.
          //
          // ⚠ AND THE SPLIT IS LOAD-BEARING, not decoration. A warp SCRAMBLER
          // (`warpScramblerMWD`, the jam that carries `blocksMicrowarpdrive`)
          // shuts an MWD off and leaves an afterburner running at full effect.
          // A classifier that knew only "prop mod" would have to pick one wrong
          // behaviour for every scrammed companion: keep re-activating an MWD
          // the server has already killed, or stand down an afterburner that is
          // working — and the second is worse, because a scrammed ship is
          // exactly the one that needs its speed.
          //
          // ⚠ THE TYPEID RIDES ALONG BECAUSE TURNING ONE OFF NEEDS IT. Deactivate
          // only stops a prop mod when it NAMES the propulsion effect; the server
          // infers the default effect on activate but not on deactivate, so a
          // bare Deactivate answers success while the burner keeps cycling
          // (bridge/dogmaWrites.ts, deactivateModule). The page asks the game's
          // data for that name by the typeID, so the id is what a caller must carry —
          // which is why this list holds objects and the others above hold ids.
          //
          // ⚠ AN UNRESOLVED EFFECT IS `null`, AND THAT IS NOT AN ERROR. It means
          // "the group said prop mod and the effect read did not arrive": the
          // module is still run, because refusing to would disarm a ship over a
          // missing cache entry, and it is treated as scram-vulnerable, because
          // between wasting a call on a dead MWD and stripping the speed off a
          // tackled ship the first is the cheap mistake. Same fail-open shape as
          // `itemHasActivationCycle` above.
          const effect = resolved[nameKey("propulsionEffect", slot.module.typeID)] ?? null;
          propulsion.push({
            itemID: slot.module.itemID,
            typeID: slot.module.typeID,
            kind:
              effect === "moduleBonusAfterburner"
                ? "afterburner"
                : effect === "moduleBonusMicrowarpdrive"
                  ? "microwarpdrive"
                  : null,
          });
        } else if (slot.family === "high" && isWeaponModuleGroup(group)) {
          // The game's own turret/launcher groups, high slots only — minus the
          // launchers that are not weapons (see isWeaponModuleGroup).
          weapons.push(slot.module.itemID);
        }
      }
    }
    return { shield, armor, hull, ancillary, hardeners, weapons, propulsion };
  }

  /**
   * The fitted REMOTE repairers (they repair ANOTHER ship), by the game's own
   * group names — the fleet-support blocks run these. Same resolve-then-judge pass
   * as the local reps; the "remote" prefix in the group name is what separates a
   * Remote Shield Booster from a self shield booster.
   */
  function resolveRemoteRepModuleIDs(): RemoteRepModuleIDs {
    const fit = store.fitting.get();
    const shield: number[] = [];
    const armor: number[] = [];
    const hull: number[] = [];
    const cap: number[] = [];
    if (fit.slotsError === null) {
      const resolved = store.names.get().resolved;
      for (const slot of fit.slots) {
        if (slot.module === null || !slot.module.online || slot.family === "rig" || slot.family === "subsystem") {
          continue;
        }
        const group = resolved[nameKey("typeGroup", slot.module.typeID)] ?? null;
        if (group === null) {
          continue; // cannot tell what it is — never run a mystery module
        }
        // The same passive-module test the local classifier above applies to
        // every family. No remote repairer group is known to be passive, so this
        // is expected to exclude nothing — it is here so that "group says what,
        // duration says whether" is one rule with no exceptions to remember,
        // rather than a rule with a footnote. Three-state; only "passive" excludes.
        if (fittedModuleActivation(slot.module) === "passive") {
          continue;
        }
        if (/remote shield/i.test(group)) {
          shield.push(slot.module.itemID);
        } else if (/remote armor/i.test(group)) {
          armor.push(slot.module.itemID);
        } else if (/remote (hull|structure)/i.test(group)) {
          hull.push(slot.module.itemID);
        } else if (/^remote capacitor transmitter$/i.test(group)) {
          // SDE group 67, verified in `_local/sde/.../groups.jsonl`. Anchored so it
          // cannot catch the other five "Capacitor …" module groups (Recharger,
          // Battery, Booster, Power Relay, Flux Coil) — every one of those is a
          // SELF module, and running one on a fleet-mate is not a thing.
          cap.push(slot.module.itemID);
        }
      }
    }
    return { shield, armor, hull, cap };
  }

  /**
   * The drone bay and the drones this hull controls BY ROLE, from the game's own
   * group name — the resolve-then-judge pass the module classifiers above make,
   * applied to drones so a block never launches the whole bay (the salvage
   * block used to send Hobgoblins to salvage; see nav/droneRoles.ts). Group
   * names are cached after the first look, so this costs one /api/names round
   * trip per NEW drone type, not one per tick. A name read that fails leaves
   * those drones in no role for the tick: cannot tell, so never launched.
   */
  async function miningDroneState(result: DronesResult): Promise<MiningDroneState | null> {
    // The generic panel decoder treats an absent control flag as false. That is
    // safe for a button, but a flight switch must not call it confirmed empty.
    if (Array.isArray(result.inSpace) && result.inSpace.some((row) =>
      row === null || typeof row !== "object" || Array.isArray(row) ||
      typeof (row as Record<string, unknown>).controlled !== "boolean")) return null;
    const bay = decodeDroneBay(result.bay);
    const out = decodeDronesInSpace(result.inSpace);
    const maxActive = decodeDroneLimits(result.shipInfo).maxActiveDrones;
    if (out === null || !Array.isArray(result.inSpace) || out.length !== result.inSpace.length) return null;
    const typeIDs = [...new Set([
      ...(bay ?? []).map((stack: DroneBayStack) => stack.typeID),
      ...out.map((drone: DroneInSpace) => drone.typeID).filter((id): id is number => id !== null),
    ])];
    if (typeIDs.length > 0) {
      try {
        await resolveNamesNow(typeIDs.map((id) => ({ kind: "typeGroup" as const, id })));
      } catch { /* Unresolved roles remain unknown and cannot launch. */ }
    }
    const resolved = store.names.get().resolved;
    const roles: Record<number, DroneRole | null> = {};
    for (const id of typeIDs) roles[id] = droneRoleForGroup(resolved[nameKey("typeGroup", id)] ?? null);
    return { bay, out, maxActive, roles };
  }

  async function prepareCustomBotParking(): Promise<void> {
    if (!scriptRunner) throw new Error("The operation runner is unavailable; parking cannot take over a different controller.");
    await prepareHostedBotStop("script", Date.now() + (supportScript ? 6 : 3) * 60_000);
    const flight = decodeFlightStatus((await api.getFlightStatus(callOptions)).flight);
    if (flight.docked === true) return;
    const mining = await resolveMiningModuleIDs();
    const fit = store.fitting.get();
    const names = store.names.get().resolved;
    if (!flight.shipID || fit.activeShipID !== flight.shipID || fit.slotsError !== null ||
        ungroupedHighSlotModules(fit.slots, id => names[nameKey("type", id)] ?? null,
          id => names[nameKey("typeGroup", id)] ?? null).length > 0) {
      throw new Error("Mining module state is unreadable; parking settlement is blocked.");
    }
    const characterID = store.station.get().online?.characterID;
    if (!characterID) throw new Error("Parking pilot is unavailable.");
    await settleParkingMiningModules({ shipID: flight.shipID, characterID, miningModuleIDs: mining,
      readScene: async () => decodeSpaceSnapshot((await api.getScriptObservation(callOptions)).space),
      deactivate: async id => { await switchModuleOff(id, {}, callOptions); } });
  }

  async function parkCustomBot(policy: FleetParkingPolicy, deadlineMs: number): Promise<void> {
    requireAutomationReady();
    const doc = parkingScript(policy);
    stopCustomController();
    const capabilities = await resolveScriptModuleCapabilities();
    store.apply({ type: "custom-bot/started", name: doc.name });
    try {
      await runFleetParking(makeScriptRunnerDeps(capabilities, null, doc.home, new Set(), true), policy,
        deadlineMs, runner => { scriptRunner = runner; });
    } finally {
      autopilot?.abort();
    }
  }

  async function classifyDroneRoles(
    bay: ReturnType<typeof decodeDroneBay>,
    snapshot: ReturnType<typeof decodeSpaceSnapshot> | null,
    shipID: number | null,
  ): Promise<{ readonly bay: DroneRoleIDs | null; readonly out: DroneRoleIDs | null }> {
    const drones = snapshot === null ? null : snapshot.entities.filter((e) => canMyShipOrderDrone(e, shipID) === true);
    const typeIDs = new Set<number>();
    for (const stack of bay ?? []) {
      typeIDs.add(stack.typeID);
    }
    for (const drone of drones ?? []) {
      if (drone.typeID !== null) {
        typeIDs.add(drone.typeID);
      }
    }
    if (typeIDs.size > 0) {
      try {
        await resolveNamesNow([...typeIDs].map((id) => ({ kind: "typeGroup" as const, id })));
      } catch {
        // Unresolved groups land in no role this tick; the next tick asks again.
      }
    }
    const resolved = store.names.get().resolved;
    const groupOf = (typeID: number): string | null => resolved[nameKey("typeGroup", typeID)] ?? null;
    return {
      bay: bay === null ? null : splitDroneRoles(bay, (stack) => stack.typeID, (stack) => stack.itemID, groupOf),
      out: drones === null ? null : splitDroneRoles(drones, (drone) => drone.typeID, (drone) => drone.itemID, groupOf),
    };
  }

  /**
   * The game's own GROUP NAME for every ship on grid a combat block might shoot
   * — the resolve half of nav/targetPriority.ts's resolve-then-judge pass, the
   * same shape `classifyDroneRoles` uses for the drone bay.
   *
   * ⚠ NOT GATED ON A COMBAT BLOCK, gated on HOSTILES BEING THERE. The
   * fight-back watch runs over whatever step is active — a mining step, a
   * hauling step — so gating this on the active macro would leave the watch
   * picking its primary blind, which is the one moment prioritising matters
   * most. Player hulls are the exception: they are only prey to a caller that
   * says so, which is what `includePlayerHulls` asks.
   *
   * ⚠ THE FLAG IS A BOOLEAN, NOT A MACRO NAME, because the fleet companion has
   * no macros at all — it runs a ladder, not a script — and would otherwise
   * have to invent a fake step name to be told about the hulls it exists to
   * rank. The script runner never asks (no script block targets a player); the
   * companion asks whether its operator wants tagging.
   *
   * Cheap after the first look: `requestNames` skips ids already cached or in
   * flight, so this costs one round trip per NEW ship type, not one per tick,
   * and nothing at all on an empty grid.
   */
  /**
   * How many warps this pilot has COMPLETED since the app loaded — a count that
   * only ever goes up, bumped on the tick a warp ends.
   *
   * ⚠ IT EXISTS BECAUSE A MACRO CANNOT SEE A WARP AT ALL. The script runner's
   * orchestrator holds everything — watches and macros alike — while `inWarp`
   * is true, and returns before the program is reached, so no macro is ever
   * called on a tick where the ship is warping. A block that needs to know it
   * ARRIVED therefore cannot watch for the warp; it has to compare a count taken
   * across the flight, and this is the only layer that is read on every tick.
   *
   * ⚠ AN UNREADABLE `inWarp` NEVER MOVES THE COUNT, in either direction. A null
   * is "the ship mode did not read", and treating it as "not in warp" would book
   * a completed warp on the first blind tick of a flight — which is exactly the
   * false ARRIVED a block would act on by finishing a step it never finished.
   * The count only moves on a true that is followed by a false.
   */
  let completedWarps = 0;
  let wasInWarp: boolean | null = null;
  function countCompletedWarps(inWarp: boolean | null): number {
    if (wasInWarp === true && inWarp === false) {
      completedWarps += 1;
    }
    if (inWarp !== null) {
      wasInWarp = inWarp;
    }
    return completedWarps;
  }

  async function classifyTargetGroups(
    snapshot: ReturnType<typeof decodeSpaceSnapshot>,
    origin: SpaceVector,
    includePlayerHulls: boolean,
    shipID: number | null,
  ): Promise<Readonly<Record<number, string | null>> | null> {
    if (snapshot === null) {
      return null;
    }
    const typeIDs = new Set<number>();
    for (const row of hostileRows(snapshot, origin)) {
      if (row.typeID !== null) {
        typeIDs.add(row.typeID);
      }
    }
    if (includePlayerHulls) {
      for (const entity of snapshot.entities) {
        if (
          entity.kind === "ship" &&
          entity.isNpc === false &&
          entity.isSelf === false &&
          entity.itemID !== shipID &&
          entity.characterID !== null &&
          entity.typeID !== null
        ) {
          typeIDs.add(entity.typeID);
        }
      }
    }
    if (typeIDs.size === 0) {
      return null;
    }
    try {
      await resolveNamesNow([...typeIDs].map((id) => ({ kind: "typeGroup" as const, id })));
    } catch {
      // An unresolved group ranks with "everything else"; the next tick asks again.
    }
    const resolved = store.names.get().resolved;
    const groups: Record<number, string | null> = {};
    for (const typeID of typeIDs) {
      groups[typeID] = resolved[nameKey("typeGroup", typeID)] ?? null;
    }
    return groups;
  }

  /**
   * What each HOSTILE TYPE on this grid does to a ship it fights, from the
   * type's own dogma — the other half of `classifyTargetGroups` above, and
   * deliberately built to the same shape: gather the typeIDs actually on grid,
   * resolve only the ones nobody has looked up yet, hand back a per-typeID map.
   *
   * ⚠ IT IS A SECOND CLASSIFIER AND NOT A SECOND COPY. The group name answers
   * "what KIND of hull is this" and cannot answer "will it hold me here":
   * `Pithi Arrogator` and `Dire Pithi Arrogator` share a group, a faction and a
   * size, and only attribute 504 separates the one that lets you leave from the
   * one that does not. See nav/ratThreat.ts, which carries that whole argument.
   *
   * ⚠ NPC ROWS ONLY, UNLIKE `classifyTargetGroups`. Every attribute in
   * `THREAT_ATTRIBUTE_IDS` is an ENTITY attribute — a player hull carries none
   * of them and never will — so asking about player types would spend a round
   * trip to cache `UNKNOWN_THREAT` under a typeID that can never say anything
   * else. `hostileRows` is already the NPC-or-not filter the rest of this file
   * ranks on, so this simply uses it and takes no flag.
   *
   * ⚠ GATED EXACTLY AS `classifyTargetGroups` IS: on hostiles being on the
   * grid, and on nothing else. Not on a combat block, because the fight-back
   * watch runs over whatever step is active and prioritising matters most in
   * the moment a mining bot is jumped; and not on a macro name, because the
   * companion has no macros at all. The cost to a mining bot with no rats in
   * front of it is zero calls, and to one that meets a new wave it is one
   * round trip per NEW rat type EVER SEEN — not per tick, and not per wave:
   * the cache above is permanent for the session.
   *
   * ⚠ A FETCH FAILURE IS NOT CACHED AND DOES NOT STOP THE TICK. The types that
   * did not resolve are simply left out of the returned map, the next tick asks
   * again, and everything already known is still reported. Caching a guess
   * would make one stumbling round trip decide a rat's classification for the
   * rest of the session.
   */
  async function classifyRatThreats(
    snapshot: ReturnType<typeof decodeSpaceSnapshot>,
    origin: SpaceVector,
  ): Promise<Readonly<Record<number, RatThreat>> | null> {
    if (snapshot === null) {
      return null;
    }
    const typeIDs = new Set<number>();
    for (const row of hostileRows(snapshot, origin)) {
      if (row.typeID !== null) {
        typeIDs.add(row.typeID);
      }
    }
    if (typeIDs.size === 0) {
      return null;
    }
    const missing = [...typeIDs].filter((typeID) => !ratThreatByTypeID.has(typeID));
    if (missing.length > 0) {
      try {
        // The signature radius rides along: same types, same round trip, and
        // `threatFromAttributes` reads only the ids it names.
        const attributes = await api.fetchTypeDogma(
          missing,
          // ⚠ 30 IDS OF THE ROUTE'S 32 (TYPE_ATTRIBUTES_MAX_ATTRIBUTES): one more
          // set of this size needs its own call, never a silently short answer.
          [...THREAT_ATTRIBUTE_IDS, ATTR_SIGNATURE_RADIUS, ATTR_SHIELD_CAPACITY, ATTR_ARMOR_HP, ATTR_HULL_HP, ...RAT_COMBAT_ATTRIBUTE_IDS,
            ...RAT_RESONANCE_ATTRIBUTE_IDS],
          callOptions,
        );
        for (const typeID of missing) {
          const row = attributes[typeID];
          // ⚠ ONLY WHAT THE ROUTE ACTUALLY ANSWERED FOR. A typeID the response
          // omitted entirely is left uncached — `fetchTypeDogma` keeps an empty
          // object for a type it was asked about and found nothing for, so an
          // ABSENT key means the answer never arrived rather than "nothing
          // there", and those two must not both become a permanent verdict.
          if (row !== undefined) {
            ratThreatByTypeID.set(typeID, threatFromAttributes(row));
            const signature = row[ATTR_SIGNATURE_RADIUS];
            if (typeof signature === "number" && Number.isFinite(signature) && signature > 0) {
              ratSignatureByTypeID.set(typeID, signature);
            }
            const layer = (id: number): number | null => {
              const value = row[id];
              return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
            };
            ratHitPointsByTypeID.set(typeID, {
              shield: layer(ATTR_SHIELD_CAPACITY),
              armor: layer(ATTR_ARMOR_HP),
              hull: layer(ATTR_HULL_HP),
            });
            ratCombatByTypeID.set(typeID, ratCombatFromAttributes(row));
            const resonances = ratResonancesFromAttributes(row);
            if (resonances !== null) {
              ratResonancesByTypeID.set(typeID, resonances);
            }
          }
        }
      } catch {
        // Left uncached on purpose: the next tick asks again, and this tick
        // proceeds with whatever was already known. See the ⚠ above.
      }
    }
    const threats: Record<number, RatThreat> = {};
    for (const typeID of typeIDs) {
      const threat = ratThreatByTypeID.get(typeID);
      // A type still missing is one whose read has not landed. It is LEFT OUT
      // rather than filled with `UNKNOWN_THREAT`, so a reader sees "not told"
      // as an absence and cannot mistake it for a rat that was read and found
      // harmless.
      if (threat !== undefined) {
        threats[typeID] = threat;
      }
    }
    return threats;
  }

  /**
   * The signature radius of each hostile type on this grid, from the cache
   * `classifyRatThreats` fills. Free: it reads no route, so it must run AFTER
   * that call on the same tick to see this tick's new types.
   */
  function ratSignaturesOnGrid(
    snapshot: ReturnType<typeof decodeSpaceSnapshot>,
    origin: SpaceVector,
  ): Readonly<Record<number, number>> | null {
    if (snapshot === null) {
      return null;
    }
    const signatures: Record<number, number> = {};
    for (const row of hostileRows(snapshot, origin)) {
      const signature = row.typeID === null ? undefined : ratSignatureByTypeID.get(row.typeID);
      if (row.typeID !== null && signature !== undefined) {
        signatures[row.typeID] = signature;
      }
    }
    return signatures;
  }

  /** As `ratSignaturesOnGrid`, for the positioning facts. Free; same ordering rule. */
  function ratCombatOnGrid(
    snapshot: ReturnType<typeof decodeSpaceSnapshot>,
    origin: SpaceVector,
  ): Readonly<Record<number, RatCombatFacts>> | null {
    if (snapshot === null) {
      return null;
    }
    const facts: Record<number, RatCombatFacts> = {};
    for (const row of hostileRows(snapshot, origin)) {
      const known = row.typeID === null ? undefined : ratCombatByTypeID.get(row.typeID);
      if (row.typeID !== null && known !== undefined) {
        facts[row.typeID] = known;
      }
    }
    return facts;
  }

  /** As `ratSignaturesOnGrid`, for the resonances ammo is ranked on. Free; same ordering rule. */
  function ratResonancesOnGrid(
    snapshot: ReturnType<typeof decodeSpaceSnapshot>,
    origin: SpaceVector,
  ): Readonly<Record<number, RatResonances>> | null {
    if (snapshot === null) {
      return null;
    }
    const resonances: Record<number, RatResonances> = {};
    for (const row of hostileRows(snapshot, origin)) {
      const known = row.typeID === null ? undefined : ratResonancesByTypeID.get(row.typeID);
      if (row.typeID !== null && known !== undefined) {
        resonances[row.typeID] = known;
      }
    }
    return resonances;
  }

  /** As `ratSignaturesOnGrid`, for the full hit points. Free; same ordering rule. */
  function ratHitPointsOnGrid(
    snapshot: ReturnType<typeof decodeSpaceSnapshot>,
    origin: SpaceVector,
  ): Readonly<Record<number, CompanionHitPoints>> | null {
    if (snapshot === null) {
      return null;
    }
    const hitPoints: Record<number, CompanionHitPoints> = {};
    for (const row of hostileRows(snapshot, origin)) {
      const full = row.typeID === null ? undefined : ratHitPointsByTypeID.get(row.typeID);
      if (row.typeID !== null && full !== undefined) {
        hitPoints[row.typeID] = full;
      }
    }
    return hitPoints;
  }

  /**
   * Sizing facts for these combat drone types, reading only the ones never
   * looked up. One round trip per NEW drone type this tab ever sees. A failed
   * read is not cached and costs only this tick's sizing: the rung then
   * launches the whole bay as it always did.
   */
  async function combatDroneFacts(typeIDs: readonly number[]): Promise<ReadonlyMap<number, DroneFacts>> {
    const missing = [...new Set(typeIDs)].filter((typeID) => !droneFactsByTypeID.has(typeID));
    if (missing.length > 0) {
      try {
        const attributes = await api.fetchTypeDogma(missing, DRONE_SIZING_ATTRIBUTE_IDS, callOptions);
        for (const typeID of missing) {
          const row = attributes[typeID];
          if (row !== undefined) {
            droneFactsByTypeID.set(typeID, droneFactsFromAttributes(typeID, row));
          }
        }
      } catch {
        // Left uncached: asked again next tick.
      }
    }
    const facts = new Map<number, DroneFacts>();
    for (const typeID of typeIDs) {
      const known = droneFactsByTypeID.get(typeID);
      if (known !== undefined && known !== null) {
        facts.set(typeID, known);
      }
    }
    return facts;
  }

  // --- the drone leash, from the PILOT --------------------------------------
  //
  // ⚠ THIS IS THE ROOT CAUSE OF A LOST SHIP, AND THE WHOLE REASON THE FIELD
  // BELOW IS NO LONGER FILLED FROM THE FIT ALONE. A live run logged:
  //
  //     "I could not read your drone control range, so I assumed the
  //      no-skills 20 km"
  //
  // held at the 17 km ceiling that guess produces, and sat inside the 20 km
  // scram reach of the rats it was fighting. `fit.stats.bays.droneControlRange`
  // reads dogma attribute 458 off the FITTING and a hull does not carry 458 —
  // checked against the local SDE, the Tristan's own typeDogma row has no such
  // attribute — so that read was not stumbling, it was structurally incapable
  // of answering, for every pilot, on every tick. The fallback was the only
  // path. See nav/droneControlRange.ts for the arithmetic and the argument.
  //
  // What follows reconstructs the number from the SKILLS, which is where it
  // actually comes from, and leaves the fit stat as the preferred source for
  // the day it ever answers.

  /**
   * The trained levels of the two drone-range skills, cached.
   *
   * ⚠ CACHED BECAUSE THE READ IS THIRTEEN BRIDGE CALLS AND THE ANSWER MOVES ON
   * A TRAINING TIMER. `/api/bridge/bound-skills` fires the whole R73 batch
   * (sheet, queue, history, boosters, implants, SP scalars, an injector probe
   * that legitimately refuses) — far too much to spend on a ~2s bot tick, and
   * pointless to repeat: Drone Avionics takes hours to gain a level, so a value
   * read once is right for the rest of a bot's run and then some. The capability
   * cache above deliberately does NOT own this, because that one re-resolves on
   * the FIT SIGNATURE and a refit does not retrain a pilot; hanging thirteen
   * calls off every module swap would be paying repeatedly for a fact that did
   * not change.
   *
   * ⚠ A FAILED READ IS CACHED TOO, BUT ONLY BRIEFLY. Not caching it at all would
   * re-fire thirteen calls every tick against a session that is refusing them;
   * caching it as long as a success would freeze an honest `null` in place long
   * after the session recovered. So a failure is remembered for a minute and
   * then retried, and in the meantime the leash reports unreadable — which is
   * the correct thing to report and not a guess.
   */
  const DRONE_SKILL_CACHE_MS = 10 * 60 * 1000;
  const DRONE_SKILL_RETRY_MS = 60 * 1000;
  let droneSkillLevelCache:
    | { readonly at: number; readonly levels: ReadonlyMap<number, number> | null }
    | null = null;

  /**
   * What level this pilot has in each drone-range skill, or `null` when the
   * sheet could not be read.
   *
   * ⚠ ABSENT FROM THE SHEET IS LEVEL 0, BUT ONLY WHEN THE SHEET ITSELF READ. An
   * untrained skill does not appear in a skill sheet at all, so "not listed"
   * genuinely means zero — and zero is a real reading worth 20 km exactly. That
   * inference is only safe once the read has proved itself, which is why a read
   * carrying an error, or answering with an EMPTY sheet (no character has zero
   * skills), is treated as unreadable rather than as a pilot with nothing
   * trained. Getting that backwards is how you tell a 60 km pilot they have 20.
   */
  async function readDroneRangeSkillLevels(): Promise<ReadonlyMap<number, number> | null> {
    const now = Date.now();
    if (droneSkillLevelCache !== null) {
      const age = now - droneSkillLevelCache.at;
      const ttl = droneSkillLevelCache.levels === null ? DRONE_SKILL_RETRY_MS : DRONE_SKILL_CACHE_MS;
      if (age < ttl) {
        return droneSkillLevelCache.levels;
      }
    }
    let levels: ReadonlyMap<number, number> | null = null;
    try {
      // ⚠ THE ONE-CALL READ, NOT THE THIRTEEN-CALL ONE. `/api/bridge/skills` is a
      // single `gateway.getSkills`; the bound-skills route answers the same
      // trained levels but pays for the sheet, the queue, the history, boosters,
      // implants, three SP scalars and an injector probe to do it. This wants two
      // integers, it runs on a timer behind a bot that is already paying for a
      // grid read every tick, and the gateway is the shared thing everything else
      // on this account is queued behind.
      //
      // (Still the route's sheet, where the Skills window's is the page's own
      // since 2026-10-10 (readSkillSheetRaw): no test reaches this read, and it
      // is not moved until one does.)
      const answer = await api.getSkills(callOptions);
      const rows =
        answer.skills === null ? [] : decodeSkillSheet(answer.skills, Date.now()).skills;
      if (rows.length > 0) {
        const byTypeID = new Map<number, number>();
        for (const typeID of DRONE_RANGE_SKILL_TYPE_IDS) {
          const row = rows.find((entry) => entry.typeID === typeID);
          // A skill ABSENT from a sheet that did read is genuinely untrained —
          // level 0, a real 20 km answer — while a sheet that did not read at all
          // is caught by the `rows.length > 0` gate above and reported as
          // unreadable. Those are different facts and only one of them is a
          // reading.
          byTypeID.set(typeID, row?.level ?? 0);
        }
        levels = byTypeID;
      }
    } catch {
      // Unreadable, which is reported as unreadable. See the ⚠ on the cache.
      levels = null;
    }
    droneSkillLevelCache = { at: now, levels };
    return levels;
  }

  /**
   * Metres per level for each drone-range skill, off the SDE through
   * /api/types/dogma — one round trip per session for both skills, shared by
   * every pilot on the tab (`droneRangeBonusByTypeID`).
   *
   * ⚠ THE BONUS IS READ, NEVER WRITTEN DOWN. The values this build's tables
   * carry are 5000 and 3000 metres per level, and neither number appears in the
   * client: a server content pack that retunes a skill has to be able to move
   * the leash, because a hardcoded bonus would keep the ship at a distance the
   * drones no longer reach with nothing anywhere reporting a fault — the same
   * silent-and-confident failure as the 20 km guess.
   */
  async function readDroneRangeBonuses(): Promise<ReadonlyMap<number, number | null>> {
    const missing = DRONE_RANGE_SKILL_TYPE_IDS.filter(
      (typeID) => !droneRangeBonusByTypeID.has(typeID),
    );
    if (missing.length > 0) {
      try {
        const attributes = await api.fetchTypeDogma(
          missing,
          [DRONE_RANGE_BONUS_ATTRIBUTE_ID],
          callOptions,
        );
        for (const typeID of missing) {
          const row = attributes[typeID];
          // ⚠ ONLY WHAT THE ROUTE ANSWERED FOR, exactly as `classifyRatThreats`
          // does it: an ABSENT key means the read never arrived and must not
          // become a permanent verdict, while an EMPTY object is the tables
          // saying this type carries no 459 — cached as `null`, which is
          // "cannot say", not zero.
          if (row !== undefined) {
            const bonus = row[DRONE_RANGE_BONUS_ATTRIBUTE_ID];
            droneRangeBonusByTypeID.set(
              typeID,
              typeof bonus === "number" && Number.isFinite(bonus) ? bonus : null,
            );
          }
        }
      } catch {
        // Left uncached on purpose: the next ask tries again.
      }
    }
    return droneRangeBonusByTypeID;
  }

  /**
   * How far the drones still answer, in metres — THE PRECEDENCE, in one place:
   *
   *   1. THE FIT STAT, whenever it is `known`. It is the authority when present:
   *      it is the server's own post-dogma number and already accounts for
   *      anything the reconstruction below does not model.
   *   2. OTHERWISE THE VALUE COMPUTED FROM THE PILOT'S SKILLS — which today is
   *      the one that ever answers, because no hull carries attribute 458.
   *   3. OTHERWISE `null`, which still means "unreadable". The band's own 20 km
   *      fallback then stands and says so in the run log. ⚠ A COMPUTED VALUE IS
   *      NEVER REPORTED AS THOUGH IT WERE MEASURED when the skills could not be
   *      read either: `null` is the honest answer, and a confident wrong leash
   *      is what killed the ship.
   *
   * ⚠ GATED ON BOTH HALVES BEING WORTH ASKING. Nothing is read when the fit
   * already answered (case 1 wins outright), and nothing is read for a hull with
   * no drone bay — a Retriever pilot's Drone Avionics level cannot change where
   * a mining bot sits, so it does not pay thirteen bridge calls to find it out.
   * `droneCapacity` is an ordinary hull attribute and is on the fit read that is
   * already in hand, so the gate itself costs nothing.
   */
  async function resolveDroneControlRange(
    fit: ReturnType<typeof store.fitting.get>,
  ): Promise<number | null> {
    const fitStatM = fit.stats.bays.droneControlRange.known
      ? fit.stats.bays.droneControlRange.value
      : null;
    if (fitStatM !== null) {
      return resolveDroneControlRangeM(fitStatM, null).rangeM;
    }
    const bay = fit.stats.bays.droneCapacity;
    // ⚠ ONLY A KNOWN ZERO BAILS, AND THE DIFFERENCE IS THE WHOLE FEATURE. This
    // gate used to read `!bay.known || bay.value <= 0`, which treats UNREADABLE
    // as "no drone bay" — and the fitting stats are unreadable on almost every
    // bot run, because the fit read is not forced by one (`maxTargetRangeM`'s
    // own comment in nav/scriptConditions.ts says so in as many words: "it rides
    // the fitting read, which a bot run does not force, so it is frequently
    // unreadable"). So the gate fired every single time, the skills were never
    // asked for, and the leash stayed the no-skills guess that had just cost a
    // ship — the fix silently gated out by a guard meant to save thirteen calls
    // on a hull that has no drones. Caught live on 2026-09-14, one run after the
    // loss, by a log still saying "I could not read your drone control range".
    //
    // Unreadable never decides. A hull whose bay we cannot see is asked about;
    // the answer costs one skills read on a timer, and being wrong the other way
    // costs the ship.
    if (bay.known && bay.value <= 0) {
      // A hull with genuinely no drone bay: a Retriever pilot's Drone Avionics
      // level cannot change where a mining bot sits, so do not go and find it out.
      return null;
    }
    const [levels, bonuses] = await Promise.all([
      readDroneRangeSkillLevels(),
      readDroneRangeBonuses(),
    ]);
    const readings: DroneRangeSkillReading[] | null =
      levels === null
        ? null
        : DRONE_RANGE_SKILL_TYPE_IDS.map((typeID) => ({
            typeID,
            level: levels.get(typeID) ?? 0,
            bonusPerLevelM: bonuses.get(typeID) ?? null,
          }));
    return resolveDroneControlRangeM(null, droneControlRangeFromSkills(readings)).rangeM;
  }

  /**
   * Fitted, online modules that boost the DRONES and must be switched on to do
   * it: the game's "Drone Tracking Modules" (Omnidirectional Tracking Link) and
   * "Drone Navigation Computer" groups, matched exactly. The passive "Drone
   * Tracking Enhancer" group is a different name and is never matched.
   *
   * ⚠ THE GROUP NAME DID NOT MAKE THEM SWITCHABLE. Seen live 2026-10-14: on this
   * server a Drone Navigation Computer I has no effect a pilot switches on, and
   * companions asked for it once a fight ("... cannot be activated."). The
   * group says what a module is FOR; whether it can be switched on is
   * `fittedModuleActivation`, here as in every list.
   */
  function resolveDroneAssistModuleIDs(): readonly number[] {
    const fit = store.fitting.get();
    if (fit.slotsError !== null) {
      return [];
    }
    const resolved = store.names.get().resolved;
    const ids: number[] = [];
    for (const slot of fit.slots) {
      if (slot.module === null || !slot.module.online || slot.family === "rig" || slot.family === "subsystem") {
        continue;
      }
      const group = resolved[nameKey("typeGroup", slot.module.typeID)] ?? null;
      if (group !== null && /^(drone tracking modules|drone navigation computer)$/i.test(group.trim()) &&
        fittedModuleActivation(slot.module) !== "passive") {
        ids.push(slot.module.itemID);
      }
    }
    return ids;
  }

  /** The fitted, online tractor beams, judged as the salvagers are: high slot, online, group name (nav/salvageModules.ts). */
  function resolveTractorModuleIDs(): readonly number[] {
    const fit = store.fitting.get();
    const resolved = store.names.get().resolved;
    return classifySalvageModules(fit.slotsError === null ? fit.slots : null, (typeID) => resolved[nameKey("typeGroup", typeID)] ?? null)
      .tractors.map((module) => module.moduleID);
  }

  function resolveSalvageModuleIDs(): readonly number[] {
    const fit = store.fitting.get();
    if (fit.slotsError !== null) {
      return [];
    }
    const resolved = store.names.get().resolved;
    const ids: number[] = [];
    for (const slot of fit.slots) {
      if (slot.family !== "high" || slot.module === null || !slot.module.online) {
        continue;
      }
      const group = resolved[nameKey("typeGroup", slot.module.typeID)] ?? null;
      if (group !== null && /salvager/i.test(group) && fittedModuleActivation(slot.module) !== "passive") {
        ids.push(slot.module.itemID);
      }
    }
    return ids;
  }

  // Which mission blocks need which extra reads — so a mining bot's tick never
  // pays for an agent-conversation read (the observe HINT gates them).
  const MISSION_MACROS = new Set([
    "find-distribution-agent",
    "request-mission",
    "accept-mission",
    "load-mission-cargo",
    "travel-to-dropoff",
    "turn-in-mission",
    "return-to-agent",
    "find-combat-agent",
    "fly-to-mission-site",
  ]);
  const CONVO_MACROS = new Set(["request-mission", "accept-mission", "turn-in-mission"]);
  const CARGO_MACROS = new Set(["accept-mission", "load-mission-cargo", "turn-in-mission", "unload-cargo", "refine-ore", "refit-ship", "board-previous-ship", "board-planetary-hauler", "move-items", "repair-ship", "sell-item", "jettison-cargo", "load-cargo", "haul-all", "route-hauler", "salvage-bookmarked-sites"]);
  // Blocks that need the ACTIVE HULL'S BAY LIST, contents included. Kept apart
  // from CARGO_MACROS because the two reads have very different prices: the
  // inventory panel is one call, `/bays` is one capacity call per candidate
  // flag plus a listing. Only a block that actually empties the ship earns it.
  const BAY_MACROS = new Set(["unload-cargo", "load-cargo", "haul-all", "route-hauler", "salvage-bookmarked-sites"]);
  // Blocks that WORK A ROCK, and so are worth running the mining surveyor for.
  // `travel-to-belt` and `compress-ore` are deliberately not here: neither one
  // reads a rock, and a scan they cannot use is a round trip nobody asked for.
  const SURVEY_MACROS = new Set(["mine-at-belt", "fleet-mine"]);
  // Blocks that fly to a cosmic anomaly, and so pay for the scanner read. Both
  // kinds are here: each one filters the SAME list down to the sites it wants.
  const ANOMALY_MACROS = new Set(["warp-to-anomaly", "warp-to-ore-anomaly"]);
  const MINING_OPERATION_MACROS = new Set(["mine-at-belt", "fleet-mine", "mining-support", "warp-to-ore-anomaly", "travel-to-belt", "loot-containers", "deliver-ore"]);
  const FLEET_MANAGEMENT_MACROS = new Set([
    "create-fleet",
    "invite-to-fleet",
    "join-fleet",
    "join-advertised-fleet",
  ]);
  // Only the join-by-name block reads the finder, and only it pays for that read.
  const FLEET_FINDER_MACROS = new Set(["join-advertised-fleet"]);
  /**
   * What the last fleet-finder apply answered. Run-scoped because only the
   * runner sees a write's result -- a decider is handed observations, never
   * return values -- and the join-by-name block cannot choose its next move
   * without it: an open advert mints an invite to accept, an approval-gated one
   * does not. Carries the fleet id so a block can tell its own application from
   * one an earlier lap made (step memory resets per lap; this does not).
   */
  let fleetApplication: ScriptObservation["fleetApplication"] = null;
  const FLEET_SUPPORT_MACROS = new Set([
    "remote-rep",
    "orbit-and-boost",
    "remote-cap",
    "orbit-fleet-mate",
    "follow-fleet-mate",
    // Also needs the bound-fleet read: it is where `canTag` comes from (see the
    // fleet-read block below), not because it reads `fleetMemberCharacterIDs`.
    "fleet-tag-target",
  ]);
  const SCANNER_MACROS = new Set([
    "launch-scan-probes",
    "analyze-signatures",
    "recover-scan-probes",
  ]);

  interface DefenseModuleIDs {
    readonly shield: readonly number[];
    readonly armor: readonly number[];
    readonly hull: readonly number[];
    readonly hardeners: readonly number[];
    readonly weapons: readonly number[];
    /**
     * Afterburners and microwarpdrives (SDE group 46), each with the `kind` the
     * SDE's own dogma effects supply — `resolveDefenseModuleIDs` has always
     * filled this list, and until now only the fleet companion's fit read
     * carried it out of there. Declared here so the SCRIPT runner can hand the
     * same list to the same shared policy (nav/propulsion.ts) rather than a
     * second resolution being grown beside it.
     */
    readonly propulsion: readonly CompanionPropulsionModule[];
  }
  interface RemoteRepModuleIDs {
    readonly shield: readonly number[];
    readonly armor: readonly number[];
    readonly hull: readonly number[];
    /** Remote CAPACITOR transmitters (SDE group 67) — the cap-chain block. */
    readonly cap: readonly number[];
  }
  interface ScriptModuleCapabilities {
    readonly combatWeaponIDs: readonly number[];
    readonly combatHardeners: readonly number[];
    readonly shipID: number | null;
    readonly mining: readonly number[];
    readonly oreMining: readonly number[];
    readonly iceMining: readonly number[];
    readonly travelPropulsion: readonly import("../nav/propulsion.ts").PropulsionModule[];
    readonly salvage: readonly number[];
    readonly defense: DefenseModuleIDs;
    readonly remoteReps: RemoteRepModuleIDs;
    /**
     * How far the hull can LOCK, in metres, so the combat ladder never picks a
     * target it cannot reach. It rides this cache rather than the per-tick reads
     * because it comes off the very fit read the module lists already come off —
     * no extra call, and it refreshes on exactly the same fit-changed signature.
     * Null when the ship does not report it; the ladder then does not gate.
     */
    readonly maxTargetRangeM: number | null;
    /**
     * How far the DRONES still answer, in metres — the second of the stand-off
     * band's two leashes, and NOT interchangeable with the first (see
     * `ScriptObservation.droneControlRangeM`).
     *
     * ⚠ IT IS THE ONE FIELD ON THIS CACHE THAT IS NOT PURELY OFF THE FIT READ,
     * BECAUSE IT COULD NOT BE. It used to be attribute 458 off the fitting, for
     * the same "no extra call" reason `maxTargetRangeM` still is — and a hull
     * DOES NOT CARRY 458. Drone control range is a CHARACTER number, from Drone
     * Avionics and Advanced Drone Avionics, so the fit read answered `null` for
     * every pilot on every tick, the band fell back to its 20 km no-skills
     * guess, and a live run held at the resulting 17 km ceiling inside the rats'
     * 20 km scram and lost the ship. `resolveDroneControlRange` keeps the fit
     * stat as the preferred source and otherwise computes the pilot's real leash
     * from their skills; its reads are cached OUTSIDE this cache, because skills
     * move on a training timer and a refit cannot change them.
     *
     * ⚠ NULL IS STILL A REAL OUTCOME AND MUST NEVER ARRIVE AS 0 OR AS A GUESS.
     * Null here means neither source could be read — the band's own fallback
     * then applies and says so in the log, which is the honest failure. A 0, or
     * a computed number reported when the skills were unreadable, would be a lie
     * the band could not recover from.
     */
    readonly droneControlRangeM: number | null;
    /**
     * How many targets the hull can hold at once (attribute 192) — the drone
     * boat's pre-lock rung fills the spare slots so the next primary is already
     * locked when this one dies. It rides this cache for the same reason the two
     * ranges above do: it comes off the very fit read they come off, so it costs
     * no extra call and refreshes on the same fit-changed signature.
     *
     * ⚠ NULL IS EXPECTED AND A `Stat` THAT IS NOT `known` MUST ARRIVE AS NULL
     * RATHER THAN AS 0. The rung reads null as "do not pre-lock", which is the
     * safe answer; a 0 would read as a hull that can lock nothing, and a guessed
     * number would spend a server refusal — the ledger's run-ending kind — on
     * every tick of every hull whose count nobody had measured.
     */
    readonly maxLockedTargets: number | null;
    /**
     * Fitted weapons that take a charge and have none in them — the three-state
     * `takesCharge && !hasCharge` pair, computed off the very fit read this
     * cache is built from.
     *
     * ⚠ ITS FRESHNESS IS THE CACHE'S, AND THE CACHE RE-RESOLVES ON THE FIT
     * SIGNATURE, WHICH DOES NOT INCLUDE THE CHARGE. So this answers "did this
     * ship undock with an empty launcher", not "has that gun run dry in the
     * last thirty seconds". That is the question the block asks — the ledger
     * ends a run over a gun that was never loadable in the first place — and
     * paying a `loadFitting` every tick to answer the sharper one is exactly
     * the cost this file exists to refuse. The fleet companion pays for the
     * live answer on its own slow beat (`readCompanionAmmoFacts`); if a script
     * block ever needs that, it wants that read and not this field.
     */
    readonly unloadedWeaponIDs: readonly number[];
  }

  /** A stable fit identity: active hull + every module fact used by classifiers. */
  function fittingCapabilitySignature(): string {
    const fit = store.fitting.get();
    return describeFitting(fit.activeShipID, fit.slots);
  }

  function readMiningSupportCapabilities(): MiningSupportCapabilities {
    const fit = store.fitting.get();
    const inventory = store.inventory.get();
    const shipID = inventory.loaded ? inventory.activeShipID : fit.activeShipID;
    const fitCurrent = fit.loaded && fit.slotsError === null && fit.activeShipID === shipID;
    const openShip = inventory.openShip;
    return deriveMiningSupportCapabilities({
      scope: { shipID, fittingSignature: describeFitting(shipID, fitCurrent ? fit.slots : []) },
      slots: fitCurrent ? fit.slots : null,
      dogma: fitCurrent && fit.dogmaError === null ? fit.dogma : null,
      bays: openShip?.loaded && openShip.error === null ? { shipID: openShip.itemID, rows: openShip.bays } : null,
      groupOf: typeID => store.names.get().resolved[nameKey("typeGroup", typeID)] ?? null,
      typeNameOf: typeID => store.names.get().resolved[nameKey("type", typeID)] ?? null,
    });
  }

  function capabilityScope(shipID: number | null): CapabilityScope {
    return { shipID, fittingSignature: fittingCapabilitySignature() };
  }

  function readMiningSupportServices(): MiningSupportServiceSnapshot {
    const space = store.space.get();
    return deriveMiningSupportServices(readMiningSupportCapabilities(), space.loaded && space.error === null ? space.snapshot : null,
      typeID => store.names.get().resolved[nameKey("type", typeID)] ?? null);
  }

  function publishMiningSupportAnchor(observation: MiningSupportServiceSnapshot): Promise<MiningSupportAnchor> {
    const shipID = observation.capabilities.scope.shipID;
    if (shipID === null || observation.sampledAtMs === null) return Promise.reject(new Error("Mining support observation is unknown."));
    return api.publishMiningSupportAnchor(shipID, observation.sampledAtMs, callOptions);
  }

  function readMiningSupportAnchors(): Promise<MiningSupportAnchorRead> {
    return api.readMiningSupportAnchors(callOptions);
  }

  let supportPositionTickBusy = false;
  let supportWorkScriptGeneration: number | null = null;
  function freshSupportScript() {
    return { epoch: crypto.randomUUID(), position: freshSupportPositionMemory(), feedback: null as SupportPositionFeedback | null,
      self: freshSupportSelfMiningMemory(), selfFeedback: null as SupportSelfMiningFeedback | null,
      tractor: freshSupportTractorMemory(), tractorFeedback: null as SupportTractorFeedback | null,
      collection: freshSupportCollectionMemory(), emptiedContainerID: undefined as number | undefined,
      handoffContainerID: undefined as number | undefined,
      emergencyStopAttemptAtMs: 0,
      emergencyPending: false,
      diagnostics: null as SupportWorkDiagnostics | null,
      fleet: freshMiningSupportFleetMemory(), fleetFeedback: undefined as MiningSupportFleetFeedback | undefined,
      fleetDiagnostic: null as MiningSupportFleetDiagnostic | null,
      fleetLastCall: null as MiningSupportFleetCallDiagnostic | null,
      assignment: null as ScriptObservation["miningOperation"],
      work: { readyForRelocation: false, reason: "Support has not been observed." as string | null, phase: "RECOVERY" } };
  }
  let supportScript: ReturnType<typeof freshSupportScript> | null = null;
  // True while the running script flies to or mines the scanner's ore/ice sites: like an
  // operation, it needs its miners split into ore lasers and ice harvesters.
  let classifySiteMiners = false;
  function readMiningSupportWork(): SupportWorkDiagnostics | null {
    return supportScript?.diagnostics ? structuredClone(supportScript.diagnostics) : null;
  }
  function readMiningSupportFleetDiagnostic(): MiningSupportFleetDiagnostic | null {
    return supportScript?.fleetDiagnostic ? structuredClone(supportScript.fleetDiagnostic) : null;
  }
  async function maintainOperationSupport(relocating: boolean, stopping = false): Promise<void> {
    const frame = supportScript;
    if (!frame) throw new Error("The support script has no owned work frame.");
    const generation = customBotGeneration;
    const characterID = store.station.get().online?.characterID;
    if (!characterID) throw new Error("Support pilot is unavailable.");
    if (!stopping) {
      // Local safety must not wait for fleet creation, invitation or recovery.
      await loadSpaceSnapshot();
      if (generation !== customBotGeneration || frame !== supportScript || store.station.get().online?.characterID !== characterID)
        throw new Error("The support run changed during the safety read.");
      const observed = store.space.get();
      frame.emergencyPending = latchSupportEmergency(frame.emergencyPending, frame.self.stopReason,
        !observed.error && observed.snapshot?.ship?.characterID === characterID ? lowestHealth(observed.snapshot) : null);
    }
    const emergency = frame.emergencyPending || frame.self.stopReason === "emergency-health-floor";
    let assignment = frame.assignment;
    let fleets: readonly MiningSupportFleetObservation[] = [];
    if (!stopping && !emergency) {
      const context = await api.readMiningOperationSupportContext(callOptions);
      assignment = context.assignment; fleets = context.fleets;
      if (assignment?.role !== "COMMAND" || assignment.support?.characterID !== characterID || assignment.operationID !== options.miningOperationID)
        throw new Error("The COMMAND operation assignment changed.");
      frame.assignment = assignment;
    }
    if (generation !== customBotGeneration || frame !== supportScript) throw new Error("The support run changed during its read.");
    const config = assignment?.support;
    const intended = (assignment?.intendedFleetCharacterIDs ?? []).filter(id => id !== characterID);
    const report = async (state: "READY" | "DEGRADED" | "RECOVERY" | "BLOCKED", reason: string | null, collection: string | null) => {
      if (stopping) return;
      const services = readMiningSupportServices();
      const core = services.cores.length && services.cores.every(row => row.state === "active") ? "active"
        : services.cores.every(row => row.state === "inactive") ? "inactive" : "unknown";
      await api.reportMiningOperationSupport({ state, core, reason, collection }, callOptions);
    };
    let fleetResult: MiningSupportFleetResult | null = null;
    if (!stopping && !emergency) {
      await loadFleet();
      if (generation !== customBotGeneration || frame !== supportScript || store.station.get().online?.characterID !== characterID) throw new Error("The support run changed during the fleet read.");
      const invite = store.fleet.get().pendingInvite;
      const own = readMiningSupportFleet(frame.epoch, { inviteKnown: invite !== null, invite, ads: null });
      fleetResult = decideMiningSupportFleet({ own, intendedCharacterIDs: intended, memberObservations: fleets,
        policy: { mode: config!.fleetPolicy }, nowMs: Date.now(), feedback: frame.fleetFeedback }, frame.fleet);
      frame.fleet = fleetResult.memory; frame.fleetFeedback = undefined;
      frame.fleetDiagnostic = miningSupportFleetDiagnostic(fleetResult, Date.now(), frame.fleetLastCall);
      if (fleetResult.action) {
        let outcome: MiningSupportFleetFeedback["outcome"] = "acknowledged", code: string | null = null;
        let diagnosticCode: string | null = null, httpStatus: number | null = null;
        let applicationOutcome: MiningSupportFleetFeedback["applicationOutcome"];
        try {
          const action = fleetResult.action;
          // (A support ship forms a fleet on its own reading that it is in none.)
          if (action.kind === "createFleet") await formFleetCall(bridgeDo, false);
          else if (action.kind === "inviteToFleet") await inviteToFleetCall(bridgeDo, action.charID, onlineCharacterID());
          else if (action.kind === "acceptFleetInvite") await acceptFleetInviteCall(bridgeDo, action.fleetID, false);
          else applicationOutcome = await applyToJoinFleetCall(bridgeDo, action.fleetID, true);
        } catch (error) {
          outcome = "unknown"; code = errorWords(error);
          if (error instanceof BridgeCallError) { diagnosticCode = error.code; httpStatus = error.status; }
        }
        if (generation !== customBotGeneration || frame !== supportScript) throw new Error("The support run changed during its fleet action.");
        frame.fleetFeedback = { scope: own!.scope, actionID: fleetResult.actionID!, outcome, code, ...(applicationOutcome ? { applicationOutcome } : {}) };
        frame.fleetLastCall = { actionID: fleetResult.actionID!, action: fleetResult.action, finishedAtMs: Date.now(),
          outcome, code: diagnosticCode, httpStatus };
        frame.fleetDiagnostic = miningSupportFleetDiagnostic(fleetResult, Date.now(), frame.fleetLastCall);
        frame.work = { readyForRelocation: false, phase: "RECOVERY", reason: fleetResult.issues[0]?.reason ?? "fleet-reconciling" };
        await report("RECOVERY", frame.work.reason, null); return;
      }
      if (!fleetResult.anchorReady) {
        frame.work = { readyForRelocation: false, phase: "RECOVERY", reason: fleetResult.issues[0]?.reason ?? "support-fleet-unavailable" };
        await report("RECOVERY", frame.work.reason, null); return;
      }
    }
    supportWorkScriptGeneration = generation;
    let result: SupportWorkTickResult;
    try {
      result = await tickMiningSupportPositioning(frame.position, { sessionEpoch: frame.epoch, intendedCharacterIDs: assignment?.miningOwnerIDs ?? [],
        requirements: { requireMiningBurst: true }, policy: { service: config ?? { maintainBursts: true, useIndustrialCore: false, enableCompression: false, coreRequirement: "continueWithoutCore" },
          deadbandMeters: 250, arrivalMeters: 100, settledSpeedMetersPerSecond: 0.5 }, feedback: frame.feedback ?? undefined,
        stopRequested: relocating || stopping || emergency, stopAll: stopping || emergency,
        selfMining: { previous: frame.self, feedback: frame.selfFeedback ?? undefined, enabled: !!config?.selfMining && !relocating && !stopping && !emergency, useFittedMiningModules: true,
          stopRequested: relocating || stopping || emergency, plan: { myCharacterID: characterID, miningModuleIDs: [], healthFloor: 0.25, useDrones: true,
            beltID: 0, beltName: assignment?.currentTarget?.targetName ?? null, stationID: 0, stationName: null } },
        tractor: { previous: frame.tractor, feedback: frame.tractorFeedback ?? undefined, runID: frame.epoch,
          enabled: !!config?.tractor && !stopping && !relocating && !emergency && assignment?.containerProvenanceUnconfirmed !== true,
          stopRequested: relocating || stopping || emergency, eligibleContainerIDs: assignment?.ownedContainerIDs ?? [],
          allowedOwnerIDs: assignment?.miningOwnerIDs ?? [], collectedContainerID: frame.emptiedContainerID },
        collection: { previous: frame.collection, handoffContainerID: frame.handoffContainerID,
          policy: { mode: config?.collection ?? "TRACTOR_ONLY", compressCollectedOre: !!config?.compressCollectedOre } },
      });
    } finally { supportWorkScriptGeneration = null; }
    frame.position = result.decision.memory; frame.feedback = result.feedback;
    if (result.selfMining) { frame.self = result.selfMining.decision.memory; frame.selfFeedback = result.selfMining.feedback; }
    frame.emergencyPending = latchSupportEmergency(frame.emergencyPending, frame.self.stopReason, null);
    if (result.tractor) { frame.tractor = result.tractor.decision.memory; frame.tractorFeedback = result.tractor.feedback; }
    if (result.collection) {
      frame.collection = result.collection.memory;
      if (result.collection.state === "FULL" && !frame.collection.pending && !frame.collection.fault)
        frame.handoffContainerID = result.tractor?.decision.readyContainerID ?? undefined;
      if (["MOVED", "COMPRESSED"].includes(result.collection.state)) frame.handoffContainerID = undefined;
      if (result.collection.sourceEmpty && !frame.collection.pending && !frame.collection.fault && ["MOVED", "EMPTY"].includes(result.collection.state))
        frame.emptiedContainerID = result.tractor?.decision.readyContainerID ?? frame.tractor.claim?.itemID ?? frame.emptiedContainerID;
    }
    const service = result.decision.support;
    const ready = service?.state === "ready-for-relocation" && !frame.tractor.claim && !frame.tractor.order && !frame.collection.pending && !frame.collection.fault;
    const handoff = supportHandoff(frame.emergencyPending ? "emergency-health-floor" : frame.self.stopReason,
      ["HANDOFF", "SETTLED"].includes(result.selfMining?.decision.state ?? ""), ready && !frame.tractor.fault && !frame.self.fault);
    let phase: "READY" | "DEGRADED" | "RECOVERY" | "BLOCKED" = result.decision.state === "BLOCKED" || service?.state === "blocked" || frame.collection.fault || frame.tractor.fault || frame.self.fault ? "BLOCKED"
      : !relocating && result.decision.state === "HOLD" && ["ready", "degraded"].includes(service?.state ?? "")
        ? service?.state === "degraded" || result.collection?.state === "FULL" ? "DEGRADED" : "READY" : "RECOVERY";
    if (handoff?.phase === "BLOCKED") phase = "BLOCKED";
    else if (handoff && phase === "READY") phase = "DEGRADED";
    const reason = result.collection?.state === "FULL" ? "Support hold FULL; collection paused, ordinary logistics retains remaining ore."
      : frame.collection.fault ?? frame.tractor.fault ?? frame.self.fault ?? handoff?.reason ?? service?.issues[0]?.reason ?? result.decision.reason;
    frame.work = { readyForRelocation: ready, phase, reason };
    frame.diagnostics = { atMs: Date.now(),
      position: { state: result.decision.state, reason: result.decision.reason, action: result.decision.action?.kind ?? null,
        ...(result.decision.recipientIssue ? { recipientIssue: result.decision.recipientIssue } : {}) },
      selfMining: result.selfMining?.diagnostic ?? supportSelfMiningDiagnostic(null, frame.self, null, null),
      tractor: { claimID: frame.tractor.claim?.itemID ?? null, order: frame.tractor.order?.action.kind ?? null, fault: frame.tractor.fault },
      collection: { state: result.collection?.state ?? null, pending: !!frame.collection.pending, fault: frame.collection.fault } };
    if (!stopping && !relocating && fleetResult?.anchorReady && (phase === "READY" || phase === "DEGRADED")) {
      await loadSpaceSnapshot();
      await publishReconciledMiningSupportAnchor(fleetResult, readMiningSupportServices());
    } else await api.releaseMiningSupportAnchor(callOptions);
    await report(phase, reason, result.collection?.state ?? null);
    if (!stopping && handoff?.requestEmergencyStop && generation === customBotGeneration && frame === supportScript &&
        Date.now() - frame.emergencyStopAttemptAtMs >= 30000) {
      frame.emergencyStopAttemptAtMs = Date.now();
      try { await api.stopMiningOperationForSupport(callOptions, "emergency-health-floor"); }
      catch (error) {
        if (generation !== customBotGeneration || frame !== supportScript) return;
        // A healthy/unknown new server sample cannot authorize an earlier low
        // health receipt. Keep ownership and the visible handoff for recovery.
        frame.work = { readyForRelocation: ready, phase: "BLOCKED", reason: `${handoff.reason}; emergency Stop unconfirmed: ${errorWords(error)}` };
        await report("BLOCKED", frame.work.reason, result.collection?.state ?? null);
      }
    }
  }
  async function tickMiningSupportPositioning(previous: SupportPositionMemory, request: {
    readonly sessionEpoch: string; readonly intendedCharacterIDs: readonly number[];
    readonly requirements: SupportRequirements; readonly policy: SupportPositionPolicy;
    readonly feedback?: SupportPositionFeedback;
    readonly selfMining?: SupportSelfMiningRequest;
    readonly tractor?: SupportTractorRequest;
    readonly collection?: SupportCollectionRequest;
    readonly stopRequested?: boolean; readonly stopAll?: boolean;
  }): Promise<SupportWorkTickResult> {
    const anotherController = () => supportWorkScriptGeneration !== null && supportWorkScriptGeneration !== customBotGeneration || [store.bot.get().status, store.missionBot.get().status, store.companion.get().status,
      ...(supportWorkScriptGeneration === customBotGeneration ? [] : [store.customBot.get().status]), store.travel.get().status].some(status => status === "running" || status === "paused");
    if (supportPositionTickBusy || anotherController()) throw new Error("Another controller owns this ship.");
    supportPositionTickBusy = true;
    const characterID = store.station.get().online?.characterID;
    const token = callOptions.token;
    try {
      if (!characterID || !request.sessionEpoch) throw new Error("An online pilot and run epoch are required.");
      const workCapabilities = await resolveScriptModuleCapabilities();
      const fleetRead = await api.readMiningSupportAnchors(callOptions);
      const raw = await api.getScriptObservation(callOptions);
      const receivedAtMs = Date.now();
      const scene = decodeSpaceSnapshot(raw.space);
      const capabilities = readMiningSupportCapabilities();
      const services = deriveMiningSupportServices(capabilities, scene);
      if (supportWorkScriptGeneration !== null) store.apply({ type: "space/snapshot", snapshot: scene, gateLinks: gateLinksForSnapshot(scene) });
      const selfRead = request.selfMining ? await Promise.all([api.getFlightStatus(callOptions), api.getTargets(callOptions), api.getMiningHolds(callOptions)]) : null;
      const droneState = request.selfMining ? await miningDroneState(raw) : null;
      const shipID = scene.shipID, fleetID = fleetRead.fleet?.fleetID ?? (request.stopRequested ? previous.scope?.fleetID ?? "" : undefined), solarSystemID = scene.solarSystemID;
      if (store.station.get().online?.characterID !== characterID || token !== callOptions.token || anotherController()
        || shipID === null || fleetID == null || solarSystemID === null) throw new Error("Pilot, fleet or scene authority changed during positioning read.");
      const scope = { characterID, sessionEpoch: request.sessionEpoch, shipID, fleetID, solarSystemID,
        fittingSignature: capabilities.scope.fittingSignature };
      const guardDispatch = (receipt = receivedAtMs) => {
        const stamp = Date.now();
        if (anotherController() || store.station.get().online?.characterID !== characterID || token !== callOptions.token ||
            scene.ship?.characterID !== characterID || capabilities.scope.shipID !== shipID ||
            stamp < receipt || stamp - receipt >= 10000) throw new Error("Support action authority changed or became stale before dispatch.");
      };
      if (request.collection && !request.tractor) throw new Error("Collection requires its sequential tractor claim owner.");
      async function collectionTick(readyContainerID: number | null, mayWork: boolean, dispatch: boolean): Promise<SupportCollectionResult> {
        const owner = request.tractor!, collection = request.collection!;
        let memory = collection.previous;
        const pending = memory.pending?.action;
        const containerID = pending?.kind === "transfer" ? pending.containerID : readyContainerID ?? owner.previous.claim?.itemID ?? null;
        const read = async (): Promise<SupportCollectionInput> => {
          const [container, holds, freshRaw, freshFleet] = await Promise.all([
            containerID === null ? null : api.openContainer(containerID, callOptions).catch(() => null),
            api.getShipBays(shipID!, callOptions, ["ore", "asteroid", "ice", "gas", "cargo"]).catch(() => null),
            api.getScriptObservation(callOptions), api.readMiningSupportAnchors(callOptions),
          ]);
          await loadFitting();
          const freshScene = decodeSpaceSnapshot(freshRaw.space), freshCapabilities = readMiningSupportCapabilities();
          if (freshScene.shipID !== shipID || freshScene.ship?.characterID !== characterID || freshScene.solarSystemID !== solarSystemID ||
            (!request.stopRequested && freshFleet.fleet?.fleetID !== fleetID) || freshCapabilities.scope.shipID !== shipID || freshCapabilities.scope.fittingSignature !== scope.fittingSignature)
            throw new Error("Ship, fit, fleet or system authority changed during collection read.");
          const observedAtMs = Date.now();
          const currentServices = deriveMiningSupportServices(freshCapabilities, freshScene);
          const own = currentServices.compression.facilities.find(row => row.origin === "self" && row.shipID === shipID && row.pilotID === characterID);
          const ownActiveTypeListIDs = own?.state === "active" ? own.typeListRanges?.map(row => row.typeListID) ?? [] : [];
          const typeIDs = [...new Set(memory.stacks.map(row => row.typeID))];
          const compatibility = collection.policy.compressCollectedOre && !memory.pending && typeIDs.length && ownActiveTypeListIDs.length
            ? await api.getMiningCompressionCompatibility(typeIDs, ownActiveTypeListIDs, callOptions).catch(() => null) : null;
          if (store.station.get().online?.characterID !== characterID || token !== callOptions.token || anotherController())
            throw new Error("Pilot authority changed during collection read.");
          return { scope, runID: owner.runID, policy: collection.policy, mayWork, readyContainerID,
            source: containerID === null ? null : { containerID, rows: container?.containerID === containerID
              ? decodeInventoryRowsChecked(container.list, container.volumes) : null },
            bays: holds?.shipID === shipID ? decodeShipBaysChecked(holds.bays) : null,
            receivedAtMs: observedAtMs, nowMs: Date.now(), ownActiveTypeListIDs, compatibility };
        };
        let observed = await read(), result = decideSupportCollection(observed, memory);
        if (!dispatch || !result.action) return result;
        const action = result.action;
        memory = result.memory;
        let receipt: import("../nav/miningSupportCollection.ts").SupportCollectionReceipt;
        try {
          guardDispatch(observed.receivedAtMs);
          receipt = await dispatchSupportCollectionAction(action, owner.runID, { shipID: shipID!, solarSystemID: solarSystemID! }, callOptions, bridgeDo);
        } catch (error) { receipt = { acknowledged: false, reason: errorWords(error) }; }
        memory = recordSupportCollectionReceipt(memory, receipt);
        try { observed = await read(); }
        catch { return decideSupportCollection({ ...observed, bays: null, mayWork: false }, memory); }
        // Observe this call only. Never issue a second gameplay action here.
        return decideSupportCollection({ ...observed, mayWork: false }, memory);
      }
      if (request.collection?.previous.pending) {
        const collection = await collectionTick(null, false, false);
        return { decision: { state: "WAIT", reason: "collection-result-settlement", worstSurfaceDistanceMeters: null,
          target: null, relocationRequested: previous.relocation !== null, support: null, action: null, memory: previous }, feedback: null, collection };
      }
      const selfInput = request.selfMining && selfRead ? {
        scope, observation: { status: decodeFlightStatus(selfRead[0].flight), snapshot: scene, measurement: null,
          lockedTargetIDs: decodeTargetIDs(selfRead[1].targetIDs), holds: selfRead[2].activeShipID === shipID ? decodeMiningHolds(selfRead[2].holds) : null,
          droneBayItemIDs: droneState?.bay?.map(row => row.itemID) ?? null, drones: raw.activeShipID === shipID ? droneState : null },
        capabilities, receivedAtMs, nowMs: Date.now(), maxTargetRangeM: workCapabilities.maxTargetRangeM,
        droneControlRangeM: workCapabilities.droneControlRangeM, enabled: request.selfMining.enabled,
        plan: request.selfMining.useFittedMiningModules ? fittedSupportMiningPlan(request.selfMining.plan, capabilities) : request.selfMining.plan,
        settledSpeedMetersPerSecond: request.policy.settledSpeedMetersPerSecond,
      } : null;
      if (request.selfMining && request.selfMining.plan.myCharacterID !== characterID) throw new Error("Self-mining plan belongs to another pilot.");
      const drones = decodeDronesInSpace(raw.inSpace);
      const active = scene.ship?.activeModuleIDs ?? null;
      const dependentIDs = [...capabilities.mining.modules, ...capabilities.tractors.modules].map(row => row.itemID);
      const dependentsSettled = capabilities.mining.presence !== "unknown" && capabilities.tractors.presence !== "unknown"
        && active !== null && !dependentIDs.some(id => active.includes(id)) && drones !== null && Array.isArray(raw.inSpace)
        && raw.activeShipID === shipID && drones.length === raw.inSpace.length && controlledFlightSettled(raw.inSpace);
      const emergency = selfInput && ((lowestHealth(scene) ?? 1) < selfInput.plan.healthFloor || request.selfMining!.previous.stopReason === "emergency-health-floor");
      const preempt = request.stopRequested === true || emergency || request.selfMining?.stopRequested === true || !!request.selfMining?.previous.fault
        || request.tractor?.stopRequested === true || !!request.tractor?.previous.fault;
      let decision: SupportPositionResult = preempt ? { state: "SETTLING", reason: emergency ? "emergency-health-floor" : request.selfMining?.previous.fault ?? "stop-requested",
        worstSurfaceDistanceMeters: null, target: null, relocationRequested: previous.relocation !== null, support: null, action: null, memory: previous }
        : decideSupportPositioning({ scope, scene, receivedAtMs, nowMs: Date.now(), fleet: fleetRead.fleet,
        intendedCharacterIDs: request.intendedCharacterIDs, services, envelope: supportServiceEnvelope(observedSupportAnchorServices(scene), request.requirements),
        dependentsSettled }, previous, request.policy, request.feedback);
      if (preempt && dependentsSettled && !request.tractor?.previous.claim && !request.tractor?.previous.order &&
          !request.collection?.previous.pending && !request.collection?.previous.fault) {
        const support = decideMiningSupport(services, previous.support, request.policy.service, true, request.feedback?.module, request.stopAll === true || emergency === true);
        decision = { ...decision, support, action: support.action, memory: { ...previous, scope, support: support.memory, relocation: null } };
      }
      const action = decision.action;
      let selfMining: SupportWorkTickResult["selfMining"];
      const leaseOrder = request.tractor?.previous.order?.action.kind;
      const leaseDue = request.tractor?.previous.claim && Date.now() >= request.tractor.previous.claim.renewAtMs;
      const reserveTractor = !preempt && !decision.relocationRequested && (leaseDue || leaseOrder === "claimContainer" || leaseOrder === "releaseContainerClaim" || leaseOrder === "deactivate"
        || request.collection?.policy.mode === "TRACTOR_AND_COLLECT" && !!request.tractor?.previous.claim);
      if (!action && !reserveTractor && selfInput && request.selfMining) {
        const self = decideSupportSelfMining({ ...selfInput,
          mayWork: decision.state === "HOLD" && !decision.relocationRequested && (decision.support?.state === "ready" || decision.support?.state === "degraded"),
          settleReason: preempt ? decision.reason : decision.relocationRequested ? "support-relocation" : null,
        }, request.selfMining.previous, request.selfMining.feedback);
        const selfResult = (feedback: SupportSelfMiningFeedback | null) => ({ decision: self, feedback,
          diagnostic: supportSelfMiningDiagnostic(self, self.memory, feedback, selfInput.observation.drones ?? null) });
        selfMining = selfResult(null);
        if (self.action) {
        guardDispatch();
        let outcome: SupportSelfMiningFeedback["outcome"] = "acknowledged", reason: string | undefined;
        try {
          switch (self.action.kind) {
            case "lock": await lockTargetCall(bridgeDo, self.action.targetID, null); break;
            case "activate": await switchModuleOn(self.action.moduleID, { targetID: self.action.targetID, repeat: -1 }, callOptions); break;
            case "deactivate": await switchModuleOff(self.action.moduleID, { typeID: self.action.typeID }, callOptions); break;
            case "launchDrones": await launchedThenRead(wholeStackLaunch(self.action.droneItemIDs, droneStackSizes(droneState?.bay ?? []))); break;
            case "recallDrones": await returnDronesToBay(bridgeDo, self.action.droneIDs); break;
            case "mineDrones": await mineWithDronesCall(bridgeDo, self.action.droneIDs, self.action.targetID); break;
            case "engageDrones": await engageDronesConfirmed(self.action.droneIDs, self.action.targetID); break;
          }
        } catch (error) { outcome = "failed"; reason = errorWords(error); }
        return { decision, feedback: null, selfMining: selfResult({ scope, actionID: self.actionID!, outcome, ...(reason ? { reason } : {}) }) };
        }
      }
      if (!action && request.tractor) {
        const [dogma, targetsRead, claimed] = await Promise.all([api.boundDogma(callOptions), api.getTargets(callOptions),
          api.readClaimedContainers(request.tractor.runID, solarSystemID, callOptions)]);
        if (store.station.get().online?.characterID !== characterID || token !== callOptions.token || anotherController()) throw new Error("Pilot authority changed during tractor read.");
        const tractor = decideSupportTractor({ scope, runID: request.tractor.runID, scene, dogma: dogma.allInfo.error === null ? dogma.allInfo.value : null,
          capabilities, lockedTargetIDs: decodeTargetIDs(targetsRead.targetIDs), claimedByOtherItemIDs: claimed,
          receivedAtMs, nowMs: Date.now(), eligibleContainerIDs: request.tractor.eligibleContainerIDs, allowedOwnerIDs: request.tractor.allowedOwnerIDs,
          mayWork: request.tractor.enabled && !(request.collection?.handoffContainerID !== undefined && request.collection.handoffContainerID === request.tractor.previous.claim?.itemID &&
            !request.collection?.previous.pending && !request.collection?.previous.fault) && !preempt && decision.state === "HOLD" && !decision.relocationRequested &&
            (decision.support?.state === "ready" || decision.support?.state === "degraded"),
          settleReason: preempt ? decision.reason : decision.relocationRequested ? "support-relocation" : null,
          retainSettledClaim: request.tractor.retainSettledClaim === true || request.collection?.policy.mode === "TRACTOR_AND_COLLECT",
          collectedContainerID: request.tractor.collectedContainerID,
          claimSettlementBlocked: !!request.collection?.previous.pending || !!request.collection?.previous.fault,
        }, request.tractor.previous, request.tractor.feedback);
        if (!tractor.action) {
          const collection = request.collection ? await collectionTick(tractor.readyContainerID,
            !preempt && tractor.state !== "BLOCKED" && decision.state === "HOLD" && !decision.relocationRequested && (decision.support?.state === "ready" || decision.support?.state === "degraded"), true) : undefined;
          return { decision, feedback: null, ...(selfMining ? { selfMining } : {}), tractor: { decision: tractor, feedback: null }, ...(collection ? { collection } : {}) };
        }
        let outcome: SupportTractorFeedback["outcome"] = "acknowledged", reason: string | undefined, claimedResult: boolean | undefined;
        guardDispatch();
        try {
          switch (tractor.action.kind) {
            case "claimContainer": claimedResult = await api.claimContainer(request.tractor.runID, solarSystemID, tractor.action.itemID, tractor.action.renewOnly, callOptions); break;
            case "releaseContainerClaim": await api.releaseContainerClaims(request.tractor.runID, callOptions); break;
            case "lock": await lockTargetCall(bridgeDo, tractor.action.targetID, null); break;
            case "activate": await switchModuleOn(tractor.action.moduleID, { targetID: tractor.action.targetID, repeat: -1 }, callOptions); break;
            case "deactivate": await switchModuleOff(tractor.action.moduleID, { typeID: tractor.action.typeID }, callOptions); break;
          }
        } catch (error) { outcome = "failed"; reason = errorWords(error); }
        return { decision, feedback: null, ...(selfMining ? { selfMining } : {}), tractor: { decision: tractor,
          feedback: { scope, runID: request.tractor.runID, actionID: tractor.actionID!, outcome, ...(claimedResult !== undefined ? { claimed: claimedResult } : {}), ...(reason ? { reason } : {}) } } };
      }
      if (!action) return { decision, feedback: null, ...(selfMining ? { selfMining } : {}) };
      guardDispatch();
      try {
        switch (action.kind) {
          case "activate": await switchModuleOn(action.moduleID, { targetID: action.targetID, repeat: -1 }, callOptions); break;
          case "deactivate": await switchModuleOff(action.moduleID, { typeID: action.typeID }, callOptions); break;
          case "gotoPoint": await flyToPoint(action.position, action.shipID, action.solarSystemID); break;
          case "stopShip": await cutEngines(); break;
        }
        return { decision, feedback: { scope, ...(action.kind === "activate" || action.kind === "deactivate"
          ? { module: { actionID: decision.support!.actionID!, outcome: "acknowledged" as const } } : { movement: "acknowledged" as const }) } };
      } catch (error) {
        // Never replay an uncertain command. Subsequent observations may prove
        // a module outcome; movement ambiguity requires explicit run recovery.
        return { decision, feedback: { scope, ...(action.kind === "activate" || action.kind === "deactivate"
          ? { module: { actionID: decision.support!.actionID!, outcome: "failed" as const, code: errorWords(error) } } : { movement: "unknown" as const }) } };
      }
    } finally { supportPositionTickBusy = false; }
  }

  function readMiningSupportFleet(sessionEpoch: string, join?: SupportFleetJoinAuthority): MiningSupportFleetObservation | null {
    const characterID = store.station.get().online?.characterID;
    const state = store.fleet.get();
    if (!characterID || !sessionEpoch || !state.loaded || state.loading || state.fleet === null
      || state.availability === "unknown" || state.refreshedAtMs === null || state.fleet.characterID !== characterID) return null;
    return { scope: { characterID, sessionEpoch }, snapshot: { availability: state.availability, fleet: state.fleet },
      receivedAtMs: state.refreshedAtMs, join: join ?? { inviteKnown: state.pendingInvite !== null, invite: state.pendingInvite, ads: null } };
  }

  function publishReconciledMiningSupportAnchor(fleetResult: MiningSupportFleetResult, observation: MiningSupportServiceSnapshot): Promise<MiningSupportAnchor> {
    const characterID = store.station.get().online?.characterID;
    const now = Date.now();
    const scope = fleetResult.memory.scope;
    if (fleetResult.role !== "support" || !fleetResult.anchorReady || fleetResult.fleetID === null
      || !Number.isSafeInteger(fleetResult.fleetID) || fleetResult.fleetID <= 0
      || !characterID || scope?.characterID !== characterID || !scope.sessionEpoch
      || fleetResult.observedAtMs === null || !Number.isFinite(fleetResult.observedAtMs)
      || fleetResult.observedAtMs > now || now - fleetResult.observedAtMs >= SUPPORT_FLEET_READ_MAX_AGE_MS) {
      return Promise.reject(new Error("Mining support fleet authority is unknown or stale."));
    }
    const shipID = observation.capabilities.scope.shipID;
    const space = store.space.get();
    if (shipID === null || observation.sampledAtMs === null || !Number.isFinite(observation.sampledAtMs)
      || !space.loaded || space.error !== null || !space.snapshot?.inSpace
      || space.snapshot.shipID !== shipID || space.snapshot.ship?.characterID !== characterID
      || space.snapshot.sampledAtMs !== observation.sampledAtMs) {
      return Promise.reject(new Error("Mining support service observation is unknown or superseded."));
    }
    return api.publishMiningSupportAnchor(shipID, observation.sampledAtMs, callOptions,
      { expectedCharacterID: characterID, expectedFleetID: fleetResult.fleetID });
  }

  /** Re-read the fit, wait for its group names AND its dogma, then classify every bot module. */
  async function resolveScriptModuleCapabilities(): Promise<ScriptModuleCapabilities> {
    const mining = await resolveMiningModuleIDs();
    // ⚠ AWAITED, EXACTLY AS `readCompanionFitFacts` AWAITS IT, AND FOR THE SAME
    // REASON. `loadFitting` (which `resolveMiningModuleIDs` just called) kicks
    // dogma off with `void loadDogma().catch(...)` so a stumbling dogma read
    // cannot hold the fit up -- which means that after awaiting the fit alone
    // the dogma slice is still whatever it was, and on a fresh session that is
    // NOTHING. `resolveDefenseModuleIDs` drops passive modules on dogma
    // attribute 73, and its unreadable case FAILS OPEN (a dogma that did not
    // arrive must never quietly disarm a ship) -- so without this await the
    // passive Damage Control every fit carries landed in `hardeners` on every
    // run, and the Hardeners-on block spent its whole attempt budget switching
    // on a module that has nothing to switch, then stopped the bot with "a
    // hardener kept refusing to switch on".
    //
    // ⚠ AND IT HAS TO BE HERE, NOT LEFT TO THE NEXT TICK TO CORRECT. The
    // capability cache re-resolves on the FIT SIGNATURE (hull + modules), which
    // a late-arriving dogma snapshot does not change -- so a list classified
    // before dogma landed is the list the whole run uses.
    await loadDogma().catch(() => {});
    // ⚠ WARMED HERE OR THE PROPULSION SPLIT SILENTLY COLLAPSES ON THE SCRIPT
    // SIDE. `resolveMiningModuleIDs` warms `type` and `typeGroup` and nothing
    // else, so SDE group 46 would answer "this is a prop mod" and the effect
    // lookup in `resolveDefenseModuleIDs` would find an empty cache and hand
    // back `kind: null` for EVERY module, on every run, for ever. The companion
    // already warms this in `readCompanionFitFacts` (with the same ⚠); a script
    // bot got the classifier without the warm, which is a fail-open that never
    // once fails closed and so would never have been noticed from the outside —
    // every prop mod would simply be treated as scram-vulnerable.
    //
    // Cached after the first look, like every other name kind, so this is one
    // batched round trip per NEW module type and nothing at all on a re-resolve.
    const warmFit = store.fitting.get();
    if (warmFit.slotsError === null) {
      try {
        await resolveNamesNow(
          warmFit.slots
            .filter((slot) => slot.module !== null)
            .map((slot) => ({ kind: "propulsionEffect" as const, id: slot.module!.typeID })),
        );
      } catch {
        // An unresolved effect is `kind: null`, which the policy fails open on.
      }
    }
    const fit = store.fitting.get();
    const classifiedDefense = resolveDefenseModuleIDs();
    // Script combat supports continuous ordinary tank, not strategic burst or ancillary modules.
    const ordinary = (id: number, group: RegExp): boolean => {
      const module = fit.slots.find(slot => slot.module?.itemID === id)?.module;
      return module != null && itemHasActivationCycle(fit.dogma, id) === true &&
        group.test(store.names.get().resolved[nameKey("typeGroup", module.typeID)] ?? "");
    };
    const defense = { ...classifiedDefense,
      shield: classifiedDefense.shield.filter(id => ordinary(id, /^shield booster$/i)),
      armor: classifiedDefense.armor.filter(id => ordinary(id, /^armor repair unit$/i)),
      hull: classifiedDefense.hull.filter(id => ordinary(id, /^hull repair unit$/i)) };
    // ⚠ AWAITED HERE, AND IT IS THE ONLY FIELD ON THIS OBJECT THAT CAN COST A
    // CALL. It is gated twice over (see `resolveDroneControlRange`): a hull with
    // no drone bay pays nothing, and a fit stat that ever answers short-circuits
    // it. What is left is at most one skill read and one static dogma read per
    // session — the reads are cached OUTSIDE this capability cache, so a refit
    // re-resolves every list above without re-asking a question whose answer a
    // module swap cannot have changed.
    const droneControlRangeM = await resolveDroneControlRange(fit);
    let iceMining: number[] = [];
    let oreMining: number[] = [];
    if ((options.miningOperationID || classifySiteMiners) && mining.length > 0 && fit.slotsError === null) {
      const modules = fit.slots.flatMap(slot => slot.module && slot.module.online && mining.includes(slot.module.itemID) ? [slot.module] : []);
      const facts = await attributesOfTypes(modules.map(module => module.typeID), [77, 182, 183, 184, 1285, 1289, 1290])
        .catch(() => ({} as Readonly<Record<number, Readonly<Record<number, number>>>>));
      iceMining = modules.filter(module => iceMiningType(facts[module.typeID])).map(module => module.itemID);
      oreMining = modules.filter(module => (facts[module.typeID]?.[77] ?? 0) > 0 && !iceMiningType(facts[module.typeID]) &&
        ["Mining Laser", "Strip Miner", "Frequency Mining Laser", "Citizen Mining Laser"].includes(
          store.names.get().resolved[nameKey("typeGroup", module.typeID)] ?? ""))
        .map(module => module.itemID);
    }
    return {
      shipID: fit.activeShipID,
      combatWeaponIDs: fit.slotsError === null ? fit.slots.filter(slot => slot.family === "high" && slot.module?.online &&
        isWeaponModuleGroup(store.names.get().resolved[nameKey("typeGroup", slot.module.typeID)] ?? "") &&
        weaponHasCycle(fit.dogma, slot.module.itemID)).map(slot => slot.module!.itemID) : [],
      mining,
      iceMining,
      oreMining,
      travelPropulsion: fit.slotsError === null ? fittedTravelPropulsion(fit.slots.flatMap(slot => slot.module ? [{
        itemID: slot.module.itemID, typeID: slot.module.typeID, online: slot.module.online,
        effect: store.names.get().resolved[nameKey("propulsionEffect", slot.module.typeID)] ?? null,
      }] : [])) : [],
      salvage: resolveSalvageModuleIDs(),
      combatHardeners: classifiedDefense.hardeners.filter(id => ordinary(id, /^(shield|armor) hardener$/i)),
      defense,
      remoteReps: resolveRemoteRepModuleIDs(),
      maxTargetRangeM: fit.stats.targeting.maxTargetRange.known
        ? fit.stats.targeting.maxTargetRange.value
        : null,
      // ⚠ THE UNKNOWN HALF OF THE `Stat` BECOMES `null`, NEVER 0 — see the
      // field's own comment. `Stat` has exactly two states on purpose so that a
      // caller cannot render a missing value as a zero, and this is the line
      // where that discipline either holds or is thrown away.
      //
      // ⚠ AND THE `Stat` IS NO LONGER THE ONLY SOURCE, BECAUSE IT COULD NEVER
      // ANSWER. It reads dogma 458 off the FIT and no hull carries 458 — drone
      // control range is a CHARACTER number, from skills — so this field was
      // null for every pilot on every tick, the band fell back to its 20 km
      // no-skills guess, and a live run held inside the rats' scram range and
      // lost the ship. `resolveDroneControlRange` keeps the fit stat as the
      // preferred source and computes the pilot's real leash from their skills
      // when (as always) it says nothing, still answering null when neither can
      // be read. See its own comment for the precedence and the costs.
      droneControlRangeM,
      // ⚠ THE SAME `Stat` DISCIPLINE, THIRD TIME: unknown becomes `null`, never
      // 0 and never a plausible guess. The pre-lock rung this feeds does nothing
      // at all while this is null, which is exactly right for a count nobody
      // read — see the field's own comment for what a guess costs.
      maxLockedTargets: fit.stats.targeting.maxLockedTargets.known
        ? fit.stats.targeting.maxLockedTargets.value
        : null,
      unloadedWeaponIDs: resolveUnloadedWeaponIDs(fit, defense.weapons),
    };
  }

  /**
   * The fitted weapons that take a charge and have none loaded, off the fit
   * slice already in hand — no call of its own.
   *
   * ⚠ THREE-STATE, AND ONLY AN EXPLICIT "TAKES A CHARGE" COUNTS. This is the
   * same pair `readCompanionFitFacts` computes and it keeps the same rule:
   * `decodeChargeFits` answers `{}` both for a module that takes no charge and
   * for a fit whose charge data never arrived, so a MISSING fitment is "cannot
   * say" and must not be reported as empty. Getting that backwards silences a
   * working gun for the rest of the run, which is a far worse outcome than the
   * refusal this list exists to avoid.
   *
   * The weapon set is the caller's, because nothing here can tell a turret from
   * any other module that happens to take a charge — that answer comes from the
   * group classifier, exactly as it does for the companion.
   */
  function resolveUnloadedWeaponIDs(
    fit: ReturnType<typeof store.fitting.get>,
    weaponModuleIDs: readonly number[],
  ): readonly number[] {
    if (fit.slotsError !== null || weaponModuleIDs.length === 0) {
      return [];
    }
    const guns = new Set(weaponModuleIDs);
    const empty: number[] = [];
    for (const slot of fit.slots) {
      const module = slot.module;
      if (module === null || !module.online || !guns.has(module.itemID)) {
        continue;
      }
      const fitment = fit.chargeFits[module.typeID];
      if (module.charge === null && (fitment?.groups.length ?? 0) > 0) {
        empty.push(module.itemID);
      }
    }
    return empty;
  }
  // Market orders a bot places rest the retail maximum, so a resting order does
  // not quietly expire under a long-running bot.
  const BOT_ORDER_DURATION_DAYS = 90;

  /**
   * Deliver an "alert me" watch: the store ALWAYS, then a browser notification and
   * a short beep where the surface allows one.
   *
   * ⚠ THE STORE PUSH IS THE LOAD-BEARING HALF and it goes first, unconditionally.
   * This same code runs headless inside the server-bot host (src/botHost.js), where
   * `window`, `Notification` and `AudioContext` do not exist — and where the alert
   * matters MOST, because nobody is looking at a tab. The host folds this slice onto
   * the bot's record, so the alert survives to `/api/bots` and the Server Bots
   * readout. The two browser flourishes are wrapped individually: a browser that
   * denied notification permission must still get the beep, and neither may ever
   * throw into the runner's issue path.
   */
  function deliverAlert(message: string): void {
    store.apply({ type: "custom-bot/alert", message, atMs: Date.now() });
    // A notification needs permission. Ask ONCE, lazily, and only in reply to a
    // real alert — never on load, which is how a site gets its prompt dismissed
    // forever. A denied or pending permission is not an error; it just means the
    // readout is the channel.
    try {
      const N = (globalThis as { Notification?: typeof Notification }).Notification;
      if (typeof N === "function") {
        if (N.permission === "granted") {
          new N("Your EveJS bot", { body: message, tag: "evejs-bot-alert" });
        } else if (N.permission === "default") {
          void N.requestPermission()
            .then((granted) => {
              if (granted === "granted") {
                new N("Your EveJS bot", { body: message, tag: "evejs-bot-alert" });
              }
            })
            .catch(() => {});
        }
      }
    } catch {
      // A notification is a nicety; never let it break the run.
    }
    // The sound: two short WebAudio beeps. No asset to ship, no file to 404, and
    // it works from a page the player has already interacted with (a bot they
    // started by clicking). A suspended audio context just makes no noise.
    try {
      const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
      if (typeof Ctx === "function") {
        const ctx = new Ctx();
        const beep = (atSecond: number): void => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = 880;
          gain.gain.value = 0.08;
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + atSecond);
          osc.stop(ctx.currentTime + atSecond + 0.12);
        };
        beep(0);
        beep(0.2);
        // Let the beeps finish, then release the context (a leaked one per alert
        // would eventually hit the browser's context limit and go silent).
        setTimeout(() => void ctx.close().catch(() => {}), 800);
      }
    } catch {
      // Same rule: no sound is not a failure.
    }
  }

  function unhandledScriptAction(action: never): never {
    throw new Error(`The custom-bot action dispatcher is missing an action: ${String(action)}`);
  }

  /**
   * Move a wreck/can's rows out, each stack to the bay that WANTS it on this
   * hull, and everything with nowhere better to go into the cargo hold.
   *
   * ⚠ EVERY GROUP IS ISSUED INDEPENDENTLY, AND THAT IS THE POINT. The previous
   * shape awaited an ore-hold transfer and then a cargo one, unguarded, so a
   * refusal on the first cancelled the second and the whole wreck was left
   * untouched — including the modules and salvage that would have fitted in
   * cargo perfectly well. Worse, the ore hold was addressed unconditionally:
   * `resolvePlace` (src/server.js) resolves `{shipBay:"ore"}` out of a static
   * table WITHOUT checking the hull has that bay, so a hull with no ore hold
   * got a 0-capacity destination and a NotEnoughCargoSpace every single time.
   * Measured against a live bot: 227 consecutive refusals over twelve hours.
   *
   * So: `planLootTransfers` walks each row's chain of SPECIALISED bays against
   * the hull's own list and their measured room, splitting where only part of a
   * stack fits — and only a haul where something was attempted AND refused is
   * reported as a failure. What fits nowhere stays in the can.
   *
   * Returns how many of the transfers it planned actually landed, which is what a
   * surface reporting to a PERSON needs: fewer than planned is "some of it is
   * aboard", and that is a different sentence from either success or refusal.
   */
  async function transferLootedRows(
    rows: readonly InventoryItemRow[],
    from: { readonly kind: "container"; readonly itemID: number },
    bays: readonly ShipBay[],
    freeFor: (bay: string | null) => number | null,
    claim?: { readonly runID: string; readonly systemID: number },
  ): Promise<{ readonly planned: number; readonly moved: number }> {
    let moved = 0;
    let planned = 0;
    let lastError: unknown = null;
    for (const transfer of planLootTransfers(rows, bays, freeFor)) {
      planned += 1;
      try {
        if (claim && !await api.claimContainer(claim.runID, claim.systemID, from.itemID, true, callOptions)) {
          throw new Error("Container claim was lost before transfer.");
        }
        const result = await api.transferItems(
          transfer.itemIDs,
          from,
          transfer.bay === null ? { kind: "cargo" } : { kind: "shipBay", bay: transfer.bay },
          transfer.qty,
          callOptions,
          claim ? { claimRunID: claim.runID } : undefined,
        );
        if (!result.applied) throw new Error("The container transfer was not confirmed.");
        moved += 1;
      } catch (error) {
        if (isSessionLost(error)) {
          throw error;
        }
        // A scripted claimant cannot treat a later failed/ambiguous move as a
        // successful sweep merely because an earlier stack moved. Keep the
        // lease and let the runner's refusal path reconcile on a fresh tick.
        if (claim) throw error;
        // No spill-to-cargo backstop here any more, and none is needed: the
        // planner already walked this row's whole chain and ENDED at the cargo
        // hold, so a refusal means the destination it measured has less room
        // than it was told — not that a fallback was never tried.
        lastError = error;
      }
    }
    if (moved === 0 && lastError !== null) {
      throw lastError;
    }
    // ⚠ NOTHING PLANNED IS NOT NOTHING TO SAY. If the can had rows and not one
    // of them could go anywhere, the ship has no room for THIS can — which is a
    // different thing from the ship being full, and the deciders cannot tell it
    // apart on their own: their "am I full?" check sums every hold, so a barge
    // with a full ore hold and a half-empty cargo bay reads as having room while
    // a can of pure ore still fits nowhere.
    //
    // Left silent, that is a spin: no call, no refusal, no progress, and the
    // block re-targets the same can for ever. Saying so puts it in the refusal
    // ledger, which backs off and sets that can aside after a few tries, so the
    // block finishes and the script goes on to unload.
    if (moved === 0 && planned === 0) {
      throw new Error(`${NO_ROOM_CODE}: There is no room aboard for what is in that container.`);
    }
    return { planned, moved };
  }

  /**
   * Empty ONE wreck or can into this hull: open it, work out what fits where,
   * and move it.
   *
   * ⚠ THIS IS THE BOT'S OWN LOOT PATH, LIFTED SO A PERSON CAN PRESS IT. It used
   * to sit inside the script runner's closure, which is precisely why the
   * overview had no looting verb to offer: the only way to a wreck's contents
   * was writing a custom bot with a loot-wrecks block. A second copy for the
   * hand-flown case would have been the worst kind of duplication — it would not
   * diverge loudly, it would diverge in the BAY ROUTING, so a hand-flown
   * Retriever would put ore in its cargo hold while the bot put it in the ore
   * hold, and `deliver-ore` would never unload the former.
   *
   * The rows are decoded WITH the route's per-type volumes, and the bay read
   * supplies live free space — between them the transfer can be sized to the
   * room available instead of being offered whole and refused.
   */
  async function lootIntoShip(
    containerID: number,
    bays: readonly ShipBay[],
    shipID: number | null,
    claim?: { readonly runID: string; readonly systemID: number },
  ): Promise<LootOutcome> {
    // Room is asked for BY NAME, and only for the freight bays this hull has —
    // a handful of capacity calls rather than the twenty-seven a full bay read
    // costs. Without it every bay outside the mining-holds route (mineral,
    // salvage, planetary, command-centre) had no measurable room and fell back
    // to offering whole stacks, so the bays the operator asked to be supported
    // were routed to but never actually fitted.
    const keys = bays
      .filter((entry) => entry.present === true && FREIGHT_BAYS.has(entry.key))
      .map((entry) => entry.key);
    const [contents, roomRead] = await Promise.all([
      api.openContainer(containerID, callOptions),
      shipID === null
        ? Promise.resolve(null)
        : api.getShipBays(shipID, callOptions, [...keys, "cargo"]).catch(() => null),
    ]);
    const rows = decodeInventoryRows(contents.list, contents.volumes);
    if (rows.length === 0) {
      // It held nothing — the one answer nobody could have had without flying
      // here. Say so, so the next pilot does not make the same trip.
      reportContainerEmptied(containerID);
      return { stacks: 0, planned: 0, moved: 0 };
    }
    const room = roomRead === null ? [] : decodeShipBays(roomRead.bays);
    // null is "we could not read that bay's room", which the planner treats as
    // "hand it over and let the server judge" — never as "no room".
    const freeFor = (bay: string | null): number | null =>
      holdFreeM3(room.find((entry) => entry.key === (bay ?? "cargo"))?.capacity ?? null);
    // ⚠ A THING NO HOLD OF THIS HULL COULD TAKE EVEN EMPTY IS NOT A FULL SHIP.
    // A 4,000 m3 drop in a wreck used to plan nothing, which reads as "no room"
    // and sent a salvager home to unload and back again for ever. Such rows are
    // left where they are (bayRouting.splitNeverFits); a can holding nothing
    // else is as good as emptied, for this pilot and every one like it.
    const capacityFor = (bay: string | null): number | null =>
      room.find((entry) => entry.key === (bay ?? "cargo"))?.capacity?.capacity ?? null;
    const { rest } = splitNeverFits(rows, bays, capacityFor);
    if (rest.length === 0) {
      reportContainerEmptied(containerID);
      return { stacks: rows.length, planned: 0, moved: 0 };
    }
    const outcome = await transferLootedRows(
      rest,
      { kind: "container", itemID: containerID },
      bays,
      freeFor,
      claim,
    );
    if (claim) {
      // The route keeps its lease until an authoritative post-action read says
      // the container is actually empty. A planned transfer can fit only part
      // of a stack, or leave another stack behind for this or another hull.
      const remaining = await api.openContainer(containerID, callOptions);
      if (splitNeverFits(decodeInventoryRows(remaining.list, remaining.volumes), bays, capacityFor).rest.length > 0) {
        throw new Error("Container still holds cargo after the transfer; retaining its claim for the next observation.");
      }
      reportContainerEmptied(containerID);
      return { stacks: rows.length, planned: outcome.planned, moved: outcome.moved };
    }
    if (outcome.moved >= rest.length) {
      // Every stack it had, this ship took: it is empty NOW, which is the same
      // fact as "it was empty" to every pilot still to come. A PARTIAL move is
      // deliberately silent — what did not fit is a fact about this hull's
      // holds, and a can somebody else has room for must stay on their list.
      reportContainerEmptied(containerID);
    }
    return { stacks: rows.length, planned: outcome.planned, moved: outcome.moved };
  }

  /**
   * Tell the BFF's shared loot memory that a can came up empty (src/lootMemory.js).
   *
   * ⚠ THE ONE THING A COMPANION CANNOT LEARN BY LOOKING. A wreck's contents are
   * unreadable past 2,500 m and the slim item's `isEmpty` -- the field the
   * retail client draws its hollow-wreck bracket from -- rides `DoDestinyUpdate`,
   * the single notification the web gateway suppresses. So "is there anything in
   * that wreck" costs whoever asks it the flight there, every time, and the only
   * way to stop N pilots each paying it is for the first one to say what it
   * found. That is this call.
   *
   * ⚠ FIRE AND FORGET, AND IT MUST STAY THAT WAY. This rides the loot path of a
   * bot that is mid-tick; a slow or failed POST must cost that tick nothing. The
   * consequence of losing one is a wasted approach, which is what the memory was
   * saving in the first place -- never a stuck pilot.
   */
  function reportContainerEmptied(containerID: number): void {
    // ⚠ THE SNAPSHOT FIRST, AND THE FLIGHT STATUS ONLY AS A FALLBACK. Looting
    // happens with a grid read in hand by definition -- the can was a row on it
    // -- whereas the flight slice is filled by a DIFFERENT read that a looting
    // bot need never have made. Asking the flight status alone reported nothing
    // at all on exactly the path this exists for.
    const solarSystemID =
      store.space.get().snapshot?.solarSystemID ??
      store.flight.get().status?.solarSystemID ??
      null;
    if (solarSystemID === null || containerID <= 0) {
      return;
    }
    void api.rememberContainerEmptied(solarSystemID, containerID, callOptions).catch(() => {
      // BFF-local bookkeeping. Nothing in the world changed and nothing here is
      // worth a retry.
    });
  }

  /**
   * The flight recorder's sink (nav/botLog.ts): buffer the runner's lines and
   * ship them to this character's log on the BFF.
   *
   * ⚠ IT MUST NEVER COST THE RUN ANYTHING. Nothing here is awaited by the
   * runner, and the buffer is capped (web/src/app/botLogBuffer.ts) — a
   * recorder that cannot reach the BFF must not grow until the tab dies. A
   * failed flush puts its batch back for exactly ONE retry; a batch that fails
   * twice is dropped, so the log can never become an unbounded queue. A `start`
   * line flushes at once, because it is what rotates the previous run's log and
   * a run that ends badly must not take its own header with it.
   */
  const BOT_LOG_FLUSH_MS = 3000;
  const botLogBuffer = createBotLogBuffer<BotLogDraft>();
  let botLogTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleBotLogFlush(): void {
    if (botLogTimer === null) {
      botLogTimer = setTimeout(() => {
        void flushBotLog();
      }, BOT_LOG_FLUSH_MS);
    }
  }

  async function flushBotLog(): Promise<void> {
    if (botLogTimer !== null) {
      clearTimeout(botLogTimer);
      botLogTimer = null;
    }
    if (botLogBuffer.size === 0) {
      return;
    }
    const batch = botLogBuffer.take();
    try {
      await api.appendBotLog(batch.lines, callOptions);
    } catch {
      // Back to the front for one retry; a second failure drops it.
      botLogBuffer.requeue(batch);
    }
    // More than one route-sized batch, or a retry, is still waiting.
    if (botLogBuffer.size > 0) {
      scheduleBotLogFlush();
    }
  }

  const botLogSink: BotLogSink = {
    write(draft) {
      botLogBuffer.push(draft);
      if (draft.kind === "start" || draft.kind === "end") {
        void flushBotLog();
        return;
      }
      scheduleBotLogFlush();
    },
  };

  function makeScriptRunnerDeps(
    initialCapabilities: ScriptModuleCapabilities,
    startingStationID: number | null,
    home: WorldRef,
    watchedKinds: ReadonlySet<string> = new Set<string>(),
    parking = false,
  ): ScriptRunnerDeps {
    const walletWatched = watchedKinds.has("wallet-below") || watchedKinds.has("wallet-above");
    const cargoWatched = watchedKinds.has("cargo-full");
    // One finder result per run: the found agent does not change under the bot.
    let foundAgentCache: NonNullable<ScriptObservation["foundAgent"]> | null = null;
    let agentSearchFailureCache: string | null = null;
    // The shared belt memory read is gated on the mine-at-belt macro (below),
    // but the runner ticks every ~2s and a belt does not go dry that often —
    // so cache the last read per system name for a short while rather than
    // hitting the BFF on every tick.
    const BELT_MEMORY_CACHE_MS = 10_000;
    let beltMemoryCache: { system: string; at: number; rows: readonly DryBelt[] } | null = null;
    const miningOperationRequired = !parking && typeof options.miningOperationID === "string" && options.miningOperationID.length > 0;
    let miningOperationProbe: "unknown" | "member" | "none" = parking ? "none" : miningOperationRequired ? "member" : "unknown";
    const unavailableMiningTargets = new Map<string, number>();
    const miningSiteBookmarks: Record<string, number> = {};
    const siteBookmarkScope = `${options.miningOperationID}:${Date.now()}`;
    let fleetMinerEpoch = crypto.randomUUID();
    const capabilityCache = createCapabilityCache(
      {
        value: initialCapabilities,
        scope: capabilityScope(initialCapabilities.shipID),
      },
      async () => {
        const value = await resolveScriptModuleCapabilities();
        return { value, scope: capabilityScope(value.shipID) };
      },
    );
    // Which bays THIS hull has — the fact `transferLootedRows` routes on, and
    // the one `resolvePlace` never checks for itself.
    //
    // Cached per hull because the read is expensive: `/bays` costs one
    // GetCapacity per candidate flag (27 of them) plus a ListByFlags, which is
    // far too much to pay on a ~2s tick. What it answers, though, is a property
    // of the HULL, not of the moment — a Retriever has an ore hold whether or
    // not it is full — so one read per hull is all the routing needs. Fill
    // level is deliberately NOT cached or consulted: the server rules on room,
    // and a refused bay spills into cargo.
    let bayCache: { readonly shipID: number; readonly bays: readonly ShipBay[] } | null = null;
    // The drone bay's stack sizes from the last observation, for `launchDrones`
    // in `issue`: the blocks hand over stack ids only. See wholeStackLaunch.
    let droneStackSizesSeen: ReadonlyMap<number, number> = new Map();
    invalidateScriptRecoveryCaches = () => {
      capabilityCache.invalidate(); bayCache = null; droneStackSizesSeen = new Map();
      beltMemoryCache = null; foundAgentCache = null; agentSearchFailureCache = null;
      fleetMinerEpoch = crypto.randomUUID();
    };
    async function activeShipBays(): Promise<readonly ShipBay[]> {
      const shipID = capabilityCache.peek().shipID;
      if (shipID === null) {
        return [];
      }
      if (bayCache !== null && bayCache.shipID === shipID) {
        return bayCache.bays;
      }
      try {
        const bays = decodeShipBays((await api.getShipBays(shipID, callOptions)).bays);
        bayCache = { shipID, bays };
        return bays;
      } catch {
        // Unreadable is not "no bays" — but for ROUTING it has to behave like
        // it, because the only safe destination when the hull is unknown is the
        // cargo hold every hull has. The wrong call here is speculating a bay.
        return [];
      }
    }

    /**
     * Open a container and move out what this hull can actually take.
     *
     * ⚠ THE WORK IS `lootIntoShip`, SHARED WITH THE OVERVIEW'S OWN VERB. What is
     * left here is the only part that is the RUNNER's: its per-hull bay cache
     * and the ship the capability read already resolved. The routing, the room
     * arithmetic and the per-bay transfers are one implementation, so a bot and
     * a player pressing "Take everything" cannot fill different holds.
     */
    const lootFrom = async (containerID: number, claimRunID?: string): Promise<void> => {
      const systemID = store.flight.get().status?.solarSystemID ?? null;
      if (claimRunID && !systemID) throw new Error("Container system is unreadable.");
      await lootIntoShip(
        containerID,
        await activeShipBays(),
        capabilityCache.peek().shipID ?? store.inventory.get().activeShipID,
        claimRunID && systemID ? { runID: claimRunID, systemID } : undefined,
      );
    };
    return {
      travelAssist: { change: async (module, on) => {
        const result = on ? await switchModuleOn(module.itemID, travelPropulsionActivation(module), callOptions)
          : await switchModuleOff(module.itemID, { typeID: module.typeID }, callOptions);
        return on ? result.active === true : result.stopped === true;
      } },
      observe: async (hint) => {
        let sceneReceivedAtMs = NaN;
        const [flightStep, observation, targetsResult, holdsResult] = await Promise.all([
          api.getFlightStatus(callOptions),
          api.getScriptObservation(callOptions).then(value => { sceneReceivedAtMs = Date.now(); return value; }),
          api.getTargets(callOptions),
          api.getMiningHolds(callOptions),
        ]);
        // The scene and drone-space projection belong to this one observation.
        const spaceResult = observation;
        const dronesResult = observation;
        const status = decodeFlightStatus(flightStep.flight);
        void observeFlightStatus(status);
        // The surveyor, for the blocks that work a rock (see SURVEY_MACROS and
        // nav/surveyScan.ts). Gated on the active block for the same reason every
        // other read here is: a hauler on a mission run has no use for a rock's
        // remaining ore, and should not spend a round trip finding it out.
        const snapshot =
          hint.activeMacro !== null && SURVEY_MACROS.has(hint.activeMacro)
            ? await surveyForBot(decodeSpaceSnapshot(spaceResult.space))
            : decodeSpaceSnapshot(spaceResult.space);
        store.apply({
      type: "space/snapshot",
      snapshot,
      gateLinks: gateLinksForSnapshot(snapshot),
    });
        const observedShipID = snapshot?.ship?.itemID ?? status.shipID ?? null;
        const capabilities = await capabilityCache.read(capabilityScope(observedShipID));
        const lockedTargetIDs = decodeTargetIDs(targetsResult.targetIDs);
        store.apply({ type: "targeting/targets", targetIDs: lockedTargetIDs });
        const holds = decodeMiningHolds(holdsResult.holds);
        store.apply({ type: "mining/holds", holds });
        const bay = decodeDroneBay(dronesResult.bay);
        const droneBayItemIDs = bay === null ? null : bay.map((stack) => stack.itemID);
        if (bay !== null) {
          droneStackSizesSeen = droneStackSizes(bay);
        }

        const ship = snapshot?.ship ?? null;
        const droneRoles = await classifyDroneRoles(bay, snapshot, ship?.itemID ?? null);
        const miningDrones = await miningDroneState(dronesResult);
        const hold = destinationHold(holds);
        const capacity = hold?.capacity ?? null;
        const used = capacity?.used ?? null;
        const total = capacity?.capacity ?? null;
        const oreHoldFraction =
          typeof used === "number" && typeof total === "number" && total > 0 ? used / total : null;
        const holdEmpty = holdsEmpty(holds);
        const origin = ship?.position ?? { x: 0, y: 0, z: 0 };
        // ⚠ A BLIND SCENE (inSpace, no ship) IS UNKNOWN, NOT EMPTY -- see the companion
        // observation's `sceneBlind`. `decodeSpaceSnapshot` never returns null, so a dead
        // ballpark's empty list used to read as "no hostile" and "no drones out".
        const sceneBlind = isSceneBlind(status.inSpace, snapshot);
        const hostileOnGrid = snapshot === null || sceneBlind ? null : hostileRows(snapshot, origin).length > 0;
        const dronesOut =
          snapshot === null || sceneBlind
            ? null
            : snapshot.entities.some((entity) => canMyShipOrderDrone(entity, ship?.itemID ?? null));

        // ── Mission reads, gated by the active block (see MISSION_MACROS). Every
        // read is best-effort: a failure lands as null (unreadable, never "no").
        const macro = hint.activeMacro;
        let miningOperation: ScriptObservation["miningOperation"] = null;
        let miningOperationReadError: string | null = null;
        if (miningOperationRequired || (macro !== null && miningOperationProbe !== "none" &&
            (miningOperationProbe === "member" || MINING_OPERATION_MACROS.has(macro)))) {
          try {
            miningOperation = await api.readMiningOperationAssignment(callOptions);
            if (miningOperationRequired && miningOperation?.operationID !== options.miningOperationID) {
              miningOperationReadError = miningOperation === null ? "The hosted operation assignment is unavailable." :
                "The hosted assignment belongs to another operation.";
              miningOperation = null;
            }
            miningOperationProbe = miningOperationRequired ? "member" : miningOperation === null ? "none" : "member";
          } catch (error) {
            miningOperationReadError = error instanceof Error ? error.message : String(error);
            miningOperation = null;
          }
        }
        const operationNow = Date.now();
        for (const [key, retryAt] of unavailableMiningTargets) if (retryAt <= operationNow) unavailableMiningTargets.delete(key);
        const targetGroupNames = await classifyTargetGroups(
          snapshot,
          origin,
          // No script block targets another player's hull; only the fleet
          // companion ranks player hulls.
          false,
          ship?.itemID ?? null,
        );
        // The dogma half of the same question, under the same gate: what each
        // rat type on this grid will DO to us, which no group name can say. Free
        // on an empty grid and one round trip per NEW rat type per session --
        // see `classifyRatThreats`, which carries the whole argument.
        const threatByTypeID = await classifyRatThreats(snapshot, origin);
        // ── The live jam reads. Both come off the store slice the shared
        //    notification drain already fills, so neither costs a call and
        //    neither is gated -- and both are answered from ONE clock read, so a
        //    tick cannot believe a jam is live for one field and expired for the
        //    other. Narrowing and freshness are the READER's job by design
        //    (`isJamLive`'s own header), and this is that reader.
        //
        // ⚠ `jammingSourceIDs` IS EVERY JAM TYPE, NOT ONLY TACKLE. A rat that is
        // webbing, damping or neuting this ship is naming itself on the same
        // wire, and the drone-boat block ranks a demonstrated aggressor above
        // any static guess about its type -- which is the whole reason this is
        // wider than the companion's `tackledBy`.
        //
        // ⚠ `scrammed` IS THE NARROW ONE AND IT IS NOT `tacklersHolding`. Only
        // `warpScramblerMWD` (the SCRAM -- the server's two names are the wrong
        // way round) turns a microwarpdrive off; reading a disruptor as an MWD
        // kill would strip the speed off a ship that still had it.
        const jamNowMs = Date.now();
        const jams = store.space.get().jams;
        const jammingSourceIDs: number[] = [];
        for (const jam of jams) {
          if (isJamLive(jam, jamNowMs) && !jammingSourceIDs.includes(jam.sourceBallID)) {
            jammingSourceIDs.push(jam.sourceBallID);
          }
        }
        const scrammed = scrammedByWarpScrambler(jams, jamNowMs);
        // The fleet's called primary, for a block that asked to follow one. Every
        // failure — no fleet, no call, a stale call, a refused read — lands as
        // null, which reads as "pick for yourself" rather than as a fault: a
        // follower whose fleet has gone quiet is still a working bot.
        let squadPrimaryTargetID: ScriptObservation["squadPrimaryTargetID"] = null;
        // A following WATCH needs the call too — and it is the handler that
        // actually fights in a working bot, since the program is mining or
        // hauling when the rats arrive. It is armed every tick, so it is paired
        // with hostiles being on grid: no rats, no read, no cost.
        if (hint.squadRole === "follow" || (hint.watchSquadRole === "follow" && hostileOnGrid === true)) {
          try {
            squadPrimaryTargetID = (await api.readSquadPrimary(callOptions))?.targetID ?? null;
          } catch {
            squadPrimaryTargetID = null;
          }
        }
        const boardAgentID =
          typeof hint.board["agentID"] === "number" ? (hint.board["agentID"] as number) : null;
        let conversation: ScriptObservation["conversation"] = null;
        let briefing: ScriptObservation["briefing"] = null;
        let journal: ScriptObservation["journal"] = null;
        let cargo: ScriptObservation["cargo"] = null;
        let stationHangar: ScriptObservation["stationHangar"] = null;
        let shipBays: ScriptObservation["shipBays"] = null;
        let haulDivisions: ScriptObservation["haulDivisions"] = null;
        let typeNames: ScriptObservation["typeNames"] = null;
        let foundAgent: ScriptObservation["foundAgent"] = null;
        let agentSearchFailure: string | null = null;
        let jumpsToDropoff: ScriptObservation["jumpsToDropoff"] = null;
        let anomalies: ScriptObservation["anomalies"] = null;
        let savedFittings: ScriptObservation["savedFittings"] = null;
        let colonies: ScriptObservation["colonies"] = null;
        let piLaunches: ScriptObservation["piLaunches"] = null;
        let customsOffices: ScriptObservation["customsOffices"] = null;
        let planetaryHaulerShipIDs: ScriptObservation["planetaryHaulerShipIDs"] = null;
        let damagedItemIDs: ScriptObservation["damagedItemIDs"] = null;
        let scannerOperations: ScriptObservation["scannerOperations"] = null;
        const systemName = store.flight.get().solarSystemName;
        let dryBelts: ScriptObservation["dryBelts"] = null;
        // ⚠ AND NOT IN SITE MODE, WHICH NEVER LOOKS AT A BELT. `mineAtBelt`
        // routes a site step away before the belt regex, the tier ladder and
        // `dryBeltNames` — every line that reads this — and reports a barren
        // grid into the board's own ore-site list rather than into the shared
        // belt memory. The read is the SAME shape of waste as the scanner read
        // the site mode was missing, in the other direction: a call per tick
        // for a list the block cannot use. `needsOreSites` already names
        // exactly that mode (see activeStepToursOreSites), so it gates both.
        if (macro === "mine-at-belt" && hint.needsOreSites !== true && systemName !== null) {
          const cached = beltMemoryCache;
          if (cached !== null && cached.system === systemName && Date.now() - cached.at < BELT_MEMORY_CACHE_MS) {
            dryBelts = cached.rows;
          } else {
            try {
              const rows = await api.readBeltMemory(systemName, callOptions);
              beltMemoryCache = { system: systemName, at: Date.now(), rows };
              dryBelts = rows;
            } catch {
              dryBelts = null;
            }
          }
        }
        if (macro !== null && SCANNER_MACROS.has(macro)) {
          try {
            scannerOperations = await api.loadScannerOperations(callOptions);
          } catch {
            scannerOperations = null;
          }
        }
        if (macro === "repair-ship" && status.docked) {
          try {
            // The shop's own quote decides what is damaged — the same read the
            // station panel's repair button raises. Null (nothing to quote, or
            // the read failed) stays "we cannot say", never "nothing is damaged".
            const quotes = await quoteShipRepair();
            damagedItemIDs = quotes === null ? null : repairTargets(quotes);
          } catch {
            damagedItemIDs = null;
          }
        }
        if (macro === "restart-extractors" || macro === "launch-commodities" || macro === "collect-customs") {
          try {
            const readAt = Date.now();
            const report = decodeColonyReport((await api.getPlanets(callOptions)).planets, readAt);
            // Expiries below are judged against the SERVER clock via the offset.
            colonies = report.colonies.map((colony) => ({
              planetID: colony.planetID,
              planetName: colony.planetName,
              extractors: colony.pins
                .filter((pin) => pin.kind === "extractor-control" || pin.kind === "extractor")
                .map((pin) => ({
                  pinID: pin.pinID,
                  resourceTypeID: pin.program?.resourceTypeID ?? null,
                  headRadius: pin.program?.headRadius ?? null,
                  expiresAtMs:
                    pin.program?.expiresAtMs === null || pin.program?.expiresAtMs === undefined
                      ? null
                      : pin.program.expiresAtMs - report.clockOffsetMs,
                })),
              // Routes still sized for an earlier program, with the retail
              // re-size for each. Only the restart block acts on them.
              reroutes: colony.pins
                .filter((pin) => pin.kind === "extractor-control")
                .map((pin) => extractorReroute(colony, pin.pinID))
                .filter((plan): plan is ExtractorReroute => plan !== null),
              // What the factories here are fed: collect-customs sends only
              // the rest of a launchpad up.
              factoryInputTypeIDs: factoryInputTypeIDs(colony),
              // Every structure, for the blocks that act on a hold. The two
              // volumes are carried across UNCHANGED, nulls included: null is
              // "the server could not say", and a decider that reads it as 0
              // would call an unreadable hold empty (or divide by it).
              pins: colony.pins.map((pin) => ({
                pinID: pin.pinID,
                kind: pin.kind,
                usedM3: pin.usedM3,
                capacityM3: pin.capacityM3,
                contents: pin.contents.map((item) => ({
                  typeID: item.typeID,
                  quantity: item.quantity,
                })),
                // On the SERVER's clock, like the expiries above — a launch
                // cooldown measured against a wrong browser clock would either
                // fire early into a refusal or stall a ready colony.
                lastLaunchAtMs: pin.lastLaunchAtMs === null
                  ? null
                  : pin.lastLaunchAtMs - report.clockOffsetMs,
              })),
            }));
          } catch {
            colonies = null;
          }
        }
        if (macro === "collect-launches") {
          try {
            // The page's own call (bridge/launchReads.ts), as the client's planet service makes it.
            piLaunches = (await readMyLaunches(bridgeAsk)).map((launch) => ({
              launchID: launch.launchID,
              solarSystemID: launch.solarSystemID,
              planetID: launch.planetID,
              itemID: launch.itemID,
              launchedAtMs: filetimeToUnixMs(launch.launchTime),
              x: launch.x,
              y: launch.y,
              z: launch.z,
            }));
          } catch {
            piLaunches = null;
          }
        }
        if (macro === "collect-customs") {
          // ONE CONTAINER READ PER OFFICE IN THE SYSTEM, and only while this
          // block is active — the same bargain board-planetary-hauler strikes
          // when it pays one capacity read per parked ship. An office is a
          // structure: it is never listed as "something to collect" and does not
          // vanish when emptied, so reading it is the only way to know. What it
          // lists is this pilot's own: the server partitions an office's storage
          // by depositor.
          //
          // ⚠ ALL OR NOTHING. One failed read leaves the whole observation null
          // ("nobody looked"), because a partial list would read as "that office
          // is empty" and the hauler would leave full offices behind.
          const officeIDs = (snapshot?.entities ?? [])
            .filter((entity) => entity.groupID === CUSTOMS_OFFICE_GROUP_ID && entity.itemID > 0)
            .map((entity) => entity.itemID);
          try {
            customsOffices = await Promise.all(officeIDs.map(async (officeID) => {
              const reads = await api.openContainer(officeID, callOptions);
              const rows = decodeInventoryRowsChecked(reads.list, reads.volumes);
              if (rows === null) throw new Error("The customs office inventory was unreadable.");
              return {
                officeID,
                stacks: rows.length,
                units: rows.reduce((total, row) => total + row.quantity, 0),
              };
            }));
          } catch {
            customsOffices = null;
          }
        }
        let bookmarks: ScriptObservation["bookmarks"] = null;
        // (The mission block takes its spots from the journal, as the client's bookmark service does: no folder is read for it.)
        if (macro === "warp-to-bookmark" || macro === "salvage-bookmarked-sites") {
          try {
            // The page's own call (bridge/bookmarkReads.ts), as the client's bookmark service makes it. A read
            // that fails leaves them unread, and the step reading: never an empty list of them. On the game port
            // the transport answers each look from what it keeps, and sends nothing for it.
            const active = await readMyActiveBookmarks(bridgeAsk);
            bookmarks = active.bookmarks.map((bm) => ({
              bookmarkID: bm.bookmarkID,
              name: bm.memo,
              folderID: bm.folderID,
              // FILETIME: 100 ns since 1601. A shared bookmark is not warped to by another pilot for its first
              // two minutes (eve.js beyonceService.isBookmarkDelayed), so its age is what a bot needs.
              ageMs: bm.created === null ? null : serverNow() - Number((bm.created - 116444736000000000n) / 10000n),
              solarSystemID: bm.locationID > 0 ? bm.locationID : null,
              position: bm.x !== null && bm.y !== null && bm.z !== null ? { x: bm.x, y: bm.y, z: bm.z } : null,
            }));
          } catch {
            bookmarks = null;
          }
        }
        let bookmarkFolders: ScriptObservation["bookmarkFolders"] = null;
        if (macro === "use-bookmark-folders" || macro === "salvage-bookmarked-sites") {
          try {
            // The folders the pilot knows, and those it administers and may add: both of the client's reads
            // (bridge/bookmarkFolders.ts). A read that fails leaves them unread, never an empty list. The search is
            // not kept by the transport, so it is asked only while a block is still taking its folders up.
            const [active, administered] = await Promise.all([
              readMyActiveBookmarks(bridgeAsk),
              hint.needsFolderSearch === true ? readFoldersWithAdminAccess(bridgeAsk) : Promise.resolve([]),
            ]);
            bookmarkFolders = {
              known: active.folders.map((f) => ({ folderID: f.folderID, name: f.folderName, isPersonal: f.isPersonal, isActive: f.isActive })),
              addable: administered.map((f) => ({ folderID: f.folderID, name: f.folderName, isPersonal: f.isPersonal })),
            };
          } catch {
            bookmarkFolders = null;
          }
        }
        let activeShipID: ScriptObservation["activeShipID"] = null;
        if (macro === "refit-ship") {
          try {
            savedFittings = await loadRefitLibrary();
          } catch {
            savedFittings = null;
          }
        }
        // What the active ship has fitted, so a Startup refit can prove it landed.
        let activeFitting: ScriptObservation["activeFitting"] = null;
        if (macro === "refit-ship") {
          try {
            const reads = await api.loadFitting(callOptions);
            if (reads.activeShipID !== null && reads.errors.slots === null) {
              const modules = buildSlots(reads.slots, reads.shipInfo, reads.online).flatMap((slot) => {
                const flagID = slotFlagOf(slot.family, slot.index);
                return slot.module !== null && flagID !== null ? [{ flagID, typeID: slot.module.typeID }] : [];
              });
              activeFitting = { shipID: reads.activeShipID, modules };
            }
          } catch {
            activeFitting = null;
          }
        }
        // `needsOreSites` is the site-mode mining block asking for the same
        // list. It is a hint rather than a third entry in ANOMALY_MACROS
        // because `mine-at-belt` earns the read only when its belt argument
        // says "site" — pointed at a belt, the same block must not pay for a
        // scanner read it will never look at (see activeStepToursOreSites).
        if (macro !== null && (ANOMALY_MACROS.has(macro) || hint.needsOreSites === true || (macro === "mining-support" || miningOperation?.role === "DEFENDER") &&
            miningOperation?.area.targetClasses.some(family => family === "ORE_ANOMALY" || family === "ICE"))) {
          try {
            const full = await readScanFullState(bridgeAsk);
            // (Kept for a warp to one of them: bridge/movementWrites.ts, warpToScanResult.)
            sitesLastRead = { solarSystemID: status.solarSystemID, anomalies: full.anomalies, structures: full.structures };
            // The whole row is classified here, not just labelled: `targetID` is
            // the handle a warp is issued against, and `scanStrengthAttribute`
            // (with `archetypeID` as its backstop) is what separates a rock
            // field from a pirate den — see scanner/siteKind.ts.
            anomalies = scriptScannerSites(full.anomalies);
          } catch {
            anomalies = null;
          }
        }
        // ── Grid awareness, computed from the snapshot already in hand — no extra
        // call, so these are always available. `isTargetedByPlayer` reads every
        // PLAYER ship's own lock target: one pointing at this hull means trouble.
        // It lives in space/overview.ts beside `isHostile` so the fleet
        // companion answers this question with the SAME code rather than a
        // second copy that could drift.
        // `lowestDroneHealth` is null with no drones out (nothing to judge).
        const myShipID = snapshot?.ship?.itemID ?? null;
        const targetedByPlayer = sceneBlind ? null : isTargetedByPlayer(snapshot, myShipID);
        // ⚠ ONE WALK, TWO ANSWERS, AND THE OLD ONE IS UNCHANGED. `myDrones` is
        // the per-drone list the drone-boat block needs (it decides which drone
        // to pull, not merely whether the rack is hurt); `lowestDroneHealth` is
        // the fold an existing watch is armed on and it keeps its exact former
        // behaviour, including staying null when nothing readable is out. A
        // second pass over the same entities would be a second place for the
        // "can this ship ORDER it" test to drift.
        //
        // ⚠ A DRONE WITH NO READABLE LAYER IS LISTED ANYWAY, and only skips the
        // HEALTH fold. It is out and it can still be recalled, so leaving it off
        // the list would hide a drone from the block that has to bring it home;
        // counting its unreadable layers as zero would be the other, worse
        // mistake, which is why the fold keeps skipping it.
        const myDrones: {
          itemID: number;
          shieldRatio: number | null;
          armorRatio: number | null;
          hullRatio: number | null;
        }[] = [];
        let lowestDroneHealth: number | null = null;
        if (snapshot !== null) {
          for (const entity of snapshot.entities) {
            if (canMyShipOrderDrone(entity, myShipID) !== true) {
              continue;
            }
            myDrones.push({
              itemID: entity.itemID,
              shieldRatio: entity.shieldRatio,
              armorRatio: entity.armorRatio,
              hullRatio: entity.hullRatio,
            });
            const ratios = [entity.shieldRatio, entity.armorRatio, entity.hullRatio].filter(
              (r): r is number => r !== null,
            );
            if (ratios.length === 0) {
              continue;
            }
            const worst = Math.min(...ratios);
            lowestDroneHealth = lowestDroneHealth === null ? worst : Math.min(lowestDroneHealth, worst);
          }
        }
        // The ordinary CARGO hold's fill level — a gateway read, so gated on a
        // cargo-full watch actually being set (a mining bot watches its ore hold,
        // which rides the mining-holds read every tick already).
        let cargoFraction: ScriptObservation["cargoFraction"] = null;
        if (cargoWatched) {
          try {
            const panel = await api.loadInventory(callOptions);
            const cap = decodeCapacity(panel.cargo.capacity);
            cargoFraction =
              cap !== null && typeof cap.used === "number" && typeof cap.capacity === "number" && cap.capacity > 0
                ? cap.used / cap.capacity
                : null;
          } catch {
            cargoFraction = null;
          }
        }
        // The travel reading is a synchronous look at the shared autopilot — no
        // gateway call — so EVERY tick carries it (travel-to-station rides it too).
        const travel: ScriptObservation["travel"] = autopilot
          ? {
              status: autopilot.snapshot().status,
              destinationStationID: store.travel.get().destinationStationID,
              destinationSystemID: store.travel.get().destinationSystemID,
              remainingJumps: autopilot.snapshot().remainingJumps,
              failureReason: autopilot.snapshot().failureReason,
            }
          : null;
        // Own wallet balance — read only when a wallet watch is set (static for
        // the run), since that watch is checked every tick. Best-effort: a failed
        // read stays null (unreadable, never a false "below" that fires a watch).
        let walletBalance: ScriptObservation["walletBalance"] = null;
        if (walletWatched) {
          try {
            // The pilot's own ISK is one call of the wallet service's (walletSvc.py 41), and that is all a watch wants.
            const cash = decodeCashBalance(await walletReads.cash());
            walletBalance = cash === null ? null : Number(cash);
          } catch {
            walletBalance = null;
          }
        }
        // Fleet membership and support authority. Remote reps/cap/orbit may target
        // ONLY character IDs from this fresh bound-fleet roster. A clean
        // FleetNotFound is an authoritative empty roster; partial/failed reads stay
        // null so those blocks wait instead of treating every player hull as a mate.
        let inFleet: ScriptObservation["inFleet"] = null;
        let fleetMemberCharacterIDs: ScriptObservation["fleetMemberCharacterIDs"] = null;
        // Held past the try so fleet-tag-target's canTag verdict below can be
        // answered from the read that ALREADY happened — same reasoning as
        // `makeFleetCompanionDeps`'s own `fleetSnapshot`, which this mirrors. A
        // second roster read to ask "am I a commander" would double this block's
        // one HTTP call to learn something the first read's own rows already say.
        let fleetSnapshot: FleetCenterSnapshot | null = null;
        let fleetSnapshotReceivedAtMs: number | null = null;
        if (
          macro !== null &&
          (FLEET_MANAGEMENT_MACROS.has(macro) || FLEET_SUPPORT_MACROS.has(macro) || macro === "fleet-mine" || macro === "join-support-fleet" || macro === "mining-support")
        ) {
          try {
            fleetSnapshot = decodeFleetCenter(await api.loadBoundFleet(callOptions));
            fleetSnapshotReceivedAtMs = Date.now();
            inFleet =
              fleetSnapshot.availability === "ready"
                ? true
                : fleetSnapshot.availability === "not-in-fleet"
                  ? false
                  : null;
            if (FLEET_SUPPORT_MACROS.has(macro)) {
              fleetMemberCharacterIDs = authoritativeFleetMemberCharacterIDs(fleetSnapshot);
            }
          } catch {
            inFleet = null;
            fleetMemberCharacterIDs = null;
            fleetSnapshot = null;
          }
        }
        // ⚠ THE GATE IS CLIENT-SIDE BECAUSE THE SERVER REFUSES SILENTLY — see
        // bridge/fleetCommand.ts's header and api.ts's setFleetTargetTag warning.
        // Three-state: `null` is "could not look" (own character id unknown, or
        // the roster read above failed/never ran), `false`/`true` are the
        // settled answer off THIS tick's own roster read.
        const ownCharacterID = store.station.get().online?.characterID ?? null;
        let fleetMining: ScriptObservation["fleetMining"];
        if (macro === "fleet-mine" || macro === "join-support-fleet") {
          let supportFleet: MiningSupportFleetObservation | null = null;
          if (miningOperation?.support) {
            try {
              const context = await api.readMiningOperationSupportContext(callOptions);
              if (context.assignment?.operationID !== miningOperation.operationID) throw new Error("Operation support context changed.");
              miningOperation = context.assignment;
              supportFleet = context.fleets.find(row => row.scope.characterID === miningOperation!.support!.characterID) ?? null;
            } catch { miningOperation = { ...miningOperation, supportPolicy: { mode: "PAUSE", reason: "Support context is unavailable." } }; }
          }
          let anchors: MiningSupportAnchorRead | null = null;
          try { anchors = await api.readMiningSupportAnchors(callOptions); } catch { /* unreadable stays unknown */ }
          if (macro === "fleet-mine") await resolveMiningModuleIDs();
          const supportCapabilities = readMiningSupportCapabilities();
          const modules = supportCapabilities.scope.shipID === snapshot?.shipID && supportCapabilities.mining.presence === "present"
            ? supportCapabilities.mining.modules.map(({ itemID, typeID, online }) => ({ itemID, typeID, online })) : null;
          fleetMining = { anchors, modules, supportFleet, sceneReceivedAtMs, nowMs: Date.now(), requirements: { requireMiningBurst: true },
            fleet: ownCharacterID !== null && fleetSnapshot !== null ? { scope: { characterID: ownCharacterID, sessionEpoch: fleetMinerEpoch },
              snapshot: fleetSnapshot, receivedAtMs: fleetSnapshotReceivedAtMs!, join: { inviteKnown: store.fleet.get().pendingInvite !== null, invite: store.fleet.get().pendingInvite, ads: null } } : null };
        }
        const canTag: ScriptObservation["canTag"] =
          ownCharacterID === null ? null : canTagInFleet(fleetSnapshot, ownCharacterID);
        // Fleet target tags + the most recent broadcast, straight off the
        // STORE rather than a read. ⚠ FREE, AND NEVER GATED like the roster
        // read just above — that one costs an HTTP call per macro, so it is
        // gated behind FLEET_MANAGEMENT_MACROS/FLEET_SUPPORT_MACROS; this one
        // costs nothing, and gating it would mean a bot that could have
        // obeyed its fleet simply never looked.
        const fleetSlice = store.fleet.get();
        const fleetTargetTags: ScriptObservation["fleetTargetTags"] = fleetSlice.targetTags;
        // ⚠ TTL APPLIED HERE, AT OBSERVATION BUILD — never in the store's
        // reducer. The store keeps the raw broadcast until the next one
        // replaces it; the freshness question belongs to the reader, same
        // discipline as `src/squadBoard.js` dropping a lapsed call when ASKED
        // rather than on a timer, and the read-time BELT_MEMORY_CACHE_MS check
        // elsewhere in this file. A follower whose call has lapsed falls back
        // to its own ladder, which is a working bot, not a stopped one.
        const fleetBroadcast: ScriptObservation["fleetBroadcast"] =
          fleetSlice.lastBroadcast !== null &&
          isFleetBroadcastFresh(fleetSlice.lastBroadcast, Date.now())
            ? fleetSlice.lastBroadcast
            : null;
        // The fleet finder, for the one block that joins by name. Read only when
        // that block is the active step, and only while this pilot is NOT already
        // fleeted — a fleeted pilot's block is already done, so the listing would
        // be paid for and thrown away. A failed read stays null (the block waits
        // for a clean one); an EMPTY listing is a real "nobody is advertising".
        let fleetAds: ScriptObservation["fleetAds"] = null;
        if (macro !== null && FLEET_FINDER_MACROS.has(macro) && inFleet === false) {
          try {
            // The page's own call (bridge/fleetFinderReads.ts): the adverts alone, for a pilot in no fleet.
            fleetAds = decodeAvailableFleetAds(await readAvailableFleetAds(bridgeAsk))
              .filter((ad) => ad.fleetID !== null && ad.fleetID > 0)
              .map((ad) => ({
                fleetID: ad.fleetID as number,
                fleetName: ad.fleetName,
                numMembers: ad.numMembers,
              }));
          } catch {
            fleetAds = null;
          }
        }
        // The salvager reads its hold only while emptying it at its station, not each tick it waits there for a site.
        const readsHolds = macro !== "salvage-bookmarked-sites" || hint.salvagerUnloading === true;
        if (macro !== null && (MISSION_MACROS.has(macro) || (CARGO_MACROS.has(macro) && readsHolds))) {
          if (MISSION_MACROS.has(macro)) {
            try {
              journal = decodeJournal(await readJournal(bridgeAsk));
              store.apply({ type: "agents/journal", journal });
            } catch {
              journal = null;
            }
          }
          if (boardAgentID !== null && CONVO_MACROS.has(macro)) {
            try {
              // Opening the conversation re-mints the button tokens — read fresh
              // every tick that could press one, never cached (the R35 rule).
              const result = await doAgentAction(bridgeDo, boardAgentID, null);
              conversation = decodeConversation(result);
              store.apply({ type: "agents/conversation", agentID: boardAgentID, conversation });
            } catch {
              conversation = null;
            }
          }
          if (boardAgentID !== null && macro !== "find-distribution-agent" && macro !== "return-to-agent") {
            try {
              const reads = await api.loadBriefing(boardAgentID, callOptions);
              briefing = decodeBriefing(reads.briefing, reads.objective);
            } catch {
              briefing = null;
            }
          }
          if (CARGO_MACROS.has(macro) && readsHolds) {
            try {
              const panel = await api.loadInventory(callOptions);
              // ⚠ THE VOLUMES ARE NOT DECORATION. Per-unit m³ is what lets the
              // load block work out that six of the twenty command centres in
              // this hangar fit the hold and ask for exactly six; without it a
              // transfer is all-or-nothing per stack, so the whole twenty are
              // offered and the server refuses the lot, every tick, for ever.
              cargo = {
                rows: decodeInventoryRows(panel.cargo.list, panel.volumes),
                capacity: decodeCapacity(panel.cargo.capacity),
              };
              stationHangar = status.docked
                ? decodeInventoryRows(panel.hangar.list, panel.volumes)
                : null;
              activeShipID = panel.activeShipID;
            } catch {
              cargo = null;
              stationHangar = null;
            }
          }
          // The ship's specialised bays, for the one block that empties them.
          // Gated hard on that block: the BFF answers `/bays` with a capacity
          // call per candidate flag, which is worth paying once at a drop-off
          // and never worth paying on a mining tick.
          if (BAY_MACROS.has(macro) && readsHolds) {
            try {
              // The hull the fit was resolved against, falling back to the
              // inventory panel's active ship: this block runs DOCKED, where the
              // panel is authoritative and a capability read may not have landed
              // yet. Without the fallback an unread shipID leaves `shipBays`
              // null, and the block would block on a ship that is perfectly fine.
              const observedShip = capabilityCache.peek().shipID ?? store.inventory.get().activeShipID;
              if (observedShip !== null) {
                const bays = decodeShipBays((await api.getShipBays(observedShip, callOptions)).bays);
                shipBays = bays;
                // A fresh read is a better cache entry than the one routing is
                // holding, so let the loot side have it too.
                bayCache = { shipID: observedShip, bays };
              }
            } catch {
              // Unreadable stays null — "we could not look", never "no bays".
              shipBays = null;
            }
          }
          // Which parked hulls have a planetary hold, for the block that boards
          // one. One capacity read per ship, asked BY NAME, and only while that
          // block runs. A known hauler can be boarded despite other failed
          // reads; proving none is parked requires every hull's answer. In space
          // there is no hangar, and the one hull asked is the ship flown: a
          // hauler already out can haul from where it is.
          if (macro === "board-planetary-hauler" && activeShipID !== null) {
            const shipIDs = [...new Set([
              activeShipID,
              ...(stationHangar ?? []).filter((row) => row.categoryID === 6 && row.singleton).map((row) => row.itemID),
            ])];
            const reads = await Promise.all(shipIDs.map(async (shipID) => {
              try {
                const bay = decodeShipBays((await api.getShipBays(shipID, callOptions, ["planetary"])).bays)
                  .find((entry) => entry.key === "planetary");
                return bay === undefined || bay.present === null ? null : { shipID, present: bay.present };
              } catch (error) {
                if (isSessionLost(error)) throw error;
                return null;
              }
            }));
            const answered = reads.filter((read): read is { shipID: number; present: boolean } => read !== null);
            const haulers = answered.filter((read) => read.present).map((read) => read.shipID);
            planetaryHaulerShipIDs = haulers.length === 0 && reads.some((read) => read === null)
              ? null
              : haulers;
          }
          if (macro === "haul-all" || macro === "route-hauler") {
            try {
              const corp = await api.loadCorpHangar(callOptions);
              if (corp.available && corp.stationID === status.stationID) {
                haulDivisions = Object.fromEntries(corp.divisions.map((division) => [division.division,
                  division.error !== null || division.list === null ? null : decodeInventoryRows(division.list, division.volumes)]));
              }
            } catch (error) {
              if (isSessionLost(error)) throw error;
            }
          }
          // Type NAMES, for a block matching items by name pattern — and only
          // for one. Every other block asks the game's own classification, which
          // already rides in on the row; paying for a name lookup on their ticks
          // would be a round trip to answer a question nobody asked.
          //
          // Names are cached in the store, so this is one bulk lookup for types
          // nobody has resolved yet and free on every tick after that. An
          // unresolved type is left out rather than guessed: a pattern that
          // cannot be tested is undecidable, and the matcher leaves such a row
          // in the hangar (bridge/keepAboard.ts).
          if (hint.needsTypeNames === true) {
            const typeIDs = new Set<number>();
            for (const row of Object.values(haulDivisions ?? {}).flatMap((rows) => rows ?? [])) typeIDs.add(row.typeID);
            for (const row of stationHangar ?? []) {
              typeIDs.add(row.typeID);
            }
            for (const row of cargo?.rows ?? []) {
              typeIDs.add(row.typeID);
            }
            for (const bay of shipBays ?? []) {
              for (const row of bay.items ?? []) {
                typeIDs.add(row.typeID);
              }
            }
            if (typeIDs.size > 0) {
              try {
                await resolveNamesNow([...typeIDs].map((id) => ({ kind: "type" as const, id })));
              } catch {
                // A lookup that failed leaves the names unresolved; the block
                // waits rather than loading something it could not identify.
              }
              const resolved = store.names.get().resolved;
              const named: Record<number, string | null> = {};
              for (const id of typeIDs) {
                named[id] = resolved[nameKey("type", id)] ?? null;
              }
              typeNames = named;
            }
          }
          if (macro === "accept-mission" && briefing?.destinationSystemID != null) {
            try {
              const origin = status.solarSystemID;
              if (origin !== null) {
                jumpsToDropoff = (await autopilotDistancesFrom(origin)).get(briefing.destinationSystemID) ?? null;
              }
            } catch {
              jumpsToDropoff = null;
            }
          }
          if ((macro === "find-distribution-agent" || macro === "find-combat-agent") && boardAgentID === null) {
            if (foundAgentCache !== null) {
              foundAgent = foundAgentCache;
            } else if (macro === "find-distribution-agent" && agentSearchFailureCache !== null) {
              agentSearchFailure = agentSearchFailureCache;
            } else if (typeof hint.board["findLevel"] === "number") {
              try {
                const corpID =
                  typeof hint.board["findCorpID"] === "number" ? (hint.board["findCorpID"] as number) : null;
                const maxJumps =
                  typeof hint.board["findMaxJumps"] === "number" ? (hint.board["findMaxJumps"] as number) : null;
                const origin = status.solarSystemID;
                const distances = origin !== null ? await autopilotDistancesFrom(origin) : null;
                const kind = typeof hint.board["findKind"] === "string" ? (hint.board["findKind"] as string) : "courier";
                const preferredLevel = hint.board["findLevel"] as number;
                if (macro === "find-distribution-agent") {
                  if (kind !== "courier") throw new Error("Distribution finder kind is invalid.");
                  const selected = await selectDistributionAgent(
                    { preferredLevel, fallback: hint.board["findFallback"] === 1,
                      corporationID: corpID, maxJumps, originSystemID: origin, distances },
                    (level) => api.findAgents({ kind: "courier", level, limit: 5000 }, callOptions),
                    async (agentID) => {
                      try {
                        return classifyDistributionAgentConversation(
                          decodeConversation(await doAgentAction(bridgeDo, agentID, null)));
                      } catch { return "unavailable"; }
                    },
                  );
                  if (selected.agent !== null && selected.agent.stationID !== null && selected.level !== null) {
                    foundAgentCache = { agentID: selected.agent.agentID, stationID: selected.agent.stationID,
                      name: selected.agent.name, stationName: selected.agent.stationName, level: selected.level };
                    foundAgent = foundAgentCache;
                  } else {
                    agentSearchFailureCache = selected.reason;
                    agentSearchFailure = selected.reason;
                  }
                } else {
                  // Combat finder keeps Farmer's exact-level static selection.
                  const found = await api.findAgents({ kind, level: preferredLevel, limit: 200 }, callOptions);
                  let best: { agent: (typeof found.agents)[number]; jumps: number } | null = null;
                  for (const agent of found.agents) {
                    if (agent.stationID === null || agent.solarSystemID === null ||
                        (corpID !== null && agent.corporationID !== corpID)) continue;
                    const jumps = origin !== null && agent.solarSystemID === origin
                      ? 0 : (distances?.get(agent.solarSystemID) ?? Number.POSITIVE_INFINITY);
                    if (maxJumps !== null && jumps > maxJumps) continue;
                    if (best === null || jumps < best.jumps) best = { agent, jumps };
                  }
                  if (best !== null && best.agent.stationID !== null) {
                    foundAgentCache = { agentID: best.agent.agentID, stationID: best.agent.stationID,
                      name: best.agent.name, stationName: best.agent.stationName };
                    foundAgent = foundAgentCache;
                  }
                }
              } catch {
                if (macro === "find-distribution-agent") {
                  agentSearchFailureCache = "Distribution agent search or access authority could not be read.";
                  agentSearchFailure = agentSearchFailureCache;
                } else foundAgent = null;
              }
            }
          }
        }

        // ⚠ THE ONE READ THAT HAS TO BE TAKEN HERE RATHER THAN IN A MACRO.
        // `decideScriptAction` holds every watch AND every macro while the ship
        // is in warp (its `inWarp === true` guard returns before the program is
        // reached), so a macro is never called on a tick where `inWarp` is true
        // and CANNOT witness a warp for itself. Three blocks used to try —
        // warp-to-anomaly, warp-to-bookmark and fly-to-mission-site all watched
        // for that state to know they had arrived — and from the day the guard
        // landed they never saw it again: each one issued its warp, sat out the
        // flight, resumed on the far side having witnessed nothing, and reported
        // "the warp never started" while the ship sat on the destination grid.
        // The observation is the only layer that sees every tick, so the count
        // is taken here and the macros compare it instead of watching for a
        // state they are structurally prevented from reaching.
        const scriptInWarp = status.shipMode === null ? null : /warp/i.test(status.shipMode);
        return {
          conversation,
          briefing,
          journal,
          cargo,
          shipBays,
          haulDivisions,
          stationHangar,
          typeNames,
          travel,
          foundAgent,
          agentSearchFailure,
          jumpsToDropoff,
          anomalies,
          miningOperation,
          fleetMining,
          miningSupportWork: supportScript?.work,
          miningOperationRequired,
          miningOperationReadError,
          unavailableMiningTargetKeys: [...unavailableMiningTargets.keys()],
          miningSiteBookmarks,
          scannerOperations,
          systemName,
          dryBelts,
          targetedByPlayer,
          lowestDroneHealth,
          // ⚠ `undefined` RATHER THAN `[]` WHEN THE SNAPSHOT DID NOT READ. An
          // empty list is a real answer ("nothing of mine is out") and a block
          // may act on it; absent is "nobody looked", which no block may act on.
          // The walk above cannot tell the two apart on its own -- it produces
          // an empty array either way -- so the distinction is made here, at the
          // one place that knows whether there was a snapshot at all.
          myDrones: snapshot === null || sceneBlind ? undefined : myDrones,
          cargoFraction,
          savedFittings,
          activeFitting,
          activeShipID,
          bookmarks,
          bookmarkFolders,
          colonies,
          piLaunches,
          customsOffices,
          planetaryHaulerShipIDs,
          damagedItemIDs,
          inSpace: status.inSpace,
          docked: status.docked,
          inWarp: scriptInWarp,
          completedWarps: countCompletedWarps(scriptInWarp),
          shieldRatio: ship?.shieldRatio ?? null,
          armorRatio: ship?.armorRatio ?? null,
          hullRatio: ship?.hullRatio ?? null,
          health: lowestHealth(snapshot),
          oreHoldFraction: (miningOperation?.logisticsTarget ?? miningOperation?.currentTarget)?.targetType === "ICE" ||
            (miningOperation?.area.targetClasses.length === 1 && miningOperation.area.targetClasses[0] === "ICE") ||
            hint.minesIce === true
            ? iceHoldFraction(holds) : oreHoldFraction,
          holdEmpty,
          hostileOnGrid,
          dronesOut,
          flightStatus: status,
          snapshot,
          lockedTargetIDs,
          holds,
          droneBayItemIDs,
          miningDrones,
          combatDroneBayItemIDs: droneRoles.bay?.combat ?? null,
          salvageDroneBayItemIDs: droneRoles.bay?.salvage ?? null,
          combatDroneIDs: droneRoles.out?.combat ?? null,
          salvageDroneIDs: droneRoles.out?.salvage ?? null,
          unclassifiedDroneBayItemIDs: droneRoles.bay?.unknown ?? null,
          miningModuleIDs: capabilities.mining,
          iceMiningModuleIDs: capabilities.iceMining,
          oreMiningModuleIDs: capabilities.oreMining,
          travelPropulsionModules: capabilities.travelPropulsion,
          salvageModuleIDs: capabilities.salvage,
          tractorModuleIDs: macro === "salvage-bookmarked-sites" ? resolveTractorModuleIDs() : [],
          shieldRepairerIDs: capabilities.defense.shield,
          armorRepairerIDs: capabilities.defense.armor,
          hullRepairerIDs: capabilities.defense.hull,
          remoteShieldRepairerIDs: capabilities.remoteReps.shield,
          remoteArmorRepairerIDs: capabilities.remoteReps.armor,
          remoteHullRepairerIDs: capabilities.remoteReps.hull,
          remoteCapModuleIDs: capabilities.remoteReps.cap,
          inFleet,
          fleetAds,
          fleetApplication,
          fleetMemberCharacterIDs,
          fleetTargetTags,
          canTag,
          fleetBroadcast,
          targetGroupNames,
          threatByTypeID,
          squadPrimaryTargetID,
          hardenerModuleIDs: hint.activeMacro === "fight-with-drones" ? capabilities.combatHardeners : capabilities.defense.hardeners,
          combatHardenerModuleIDs: capabilities.combatHardeners,
          weaponModuleIDs: hint.activeMacro === "fight-with-drones" ? capabilities.combatWeaponIDs : capabilities.defense.weapons,
          ...await (async () => {
            const facts = hint.needsMobileCombat || hint.activeMacro === "fight-with-drones"
              ? await readCombatLoadout(observedShipID, capabilities.combatWeaponIDs) : null;
            return { combatWeapons: facts?.weapons ?? null, combatUtilities: facts?.utilities ?? null };
          })(),
          maxTargetRangeM: capabilities.maxTargetRangeM,
          // ⚠ THE SECOND LEASH, AND IT IS NEVER THE SAME NUMBER AS THE ONE
          // ABOVE. Lock range says how far this hull can TARGET; control range
          // says how far the drones still ANSWER. They ride the same cache,
          // which is exactly why it would be so easy to let one stand in for the
          // other -- see nav/kiteBand.ts's header for what that costs a pilot
          // who cannot read the second one.
          //
          // ⚠ AND THEY NO LONGER COME FROM THE SAME PLACE. Lock range is a HULL
          // attribute off the fit; control range is a CHARACTER one, off the
          // pilot's drone skills, because no hull carries attribute 458 and the
          // fit read therefore never once answered -- which is how a live run
          // ended up holding inside the rats' scram on the band's 20 km guess.
          droneControlRangeM: capabilities.droneControlRangeM,
          // How many targets this hull holds at once -- the drone boat's
          // pre-lock rung, which fills the SPARE slots so the next primary is
          // already locked when this one dies.
          //
          // ⚠ IT IS THE PLUMBING THAT MAKES THAT RUNG REAL. The rung was written
          // reading this field defensively off the observation and, while it was
          // absent, correctly did nothing at all -- a pre-lock that never fired,
          // on every hull, silently. Null still means "do not", which is the
          // right answer for a count nobody read; what changed is that a fit
          // that DOES report it now reaches the block.
          maxLockedTargets: capabilities.maxLockedTargets,
          // The shared policy's input (nav/propulsion.ts) -- the SAME list the
          // fleet companion's ladder runs on, resolved once by
          // `resolveDefenseModuleIDs` rather than a second time here.
          propulsionModules: capabilities.defense.propulsion,
          unloadedWeaponIDs: capabilities.unloadedWeaponIDs,
          jammingSourceIDs,
          scrammed,
          capacitorRatio: ship?.capacitorRatio ?? null,
          walletBalance,
          startingStationID,
          homeStationID: resolveStationRef(home, startingStationID, hint.board),
          homeDockableKind: home.entity === "structure" ? "structure" : "station",
          myCharacterID: store.station.get().online?.characterID ?? null,
          myCorporationID: store.station.get().online?.corporationID ?? null,
        };
      },
      claims: {
        read: (runID, systemID) => api.readClaimedContainers(runID, systemID, callOptions),
        acquire: (runID, systemID, itemID, renewOnly) => api.claimContainer(runID, systemID, itemID, renewOnly, callOptions),
        release: (runID) => api.releaseContainerClaims(runID, callOptions),
      },
      readOperationAssignment: () => api.readMiningOperationAssignment(callOptions),
      mutationCustody: () => hostedJettisonPending,
      issue: async (action, claimRunID, invocation) => {
        const generation = customBotGeneration;
        const token = callOptions.token, pilotGeneration = recoveryGeneration;
        const characterID = store.station.get().online?.characterID;
        switch (action.kind) {
          case "maintainMiningSupport":
            await maintainOperationSupport(action.relocating);
            return;
          case "stopMiningSupportOperation":
            await api.stopMiningOperationForSupport(callOptions);
            return;
          case "wait":
            return;
          case "undock":
            await orderedStep((flightNow) => undockCall(bridgeDo, flightNow, true));
            return;
          case "warp":
            await warpToThing(action.targetID, MENU_WARP_RANGE_M);
            return;
          case "approach":
            // A bot's approach is a pilot's own: the menu's, at the client's fifty.
            await approachShip(action.targetID, null);
            return;
          case "gotoPoint":
            await flyToPoint(action.position, action.shipID, action.solarSystemID);
            return;
          // Straight to the stop itself (`cutEngines`) and NOT through `flow.stopShip()`: that
          // wrapper also aborts the browser autopilot, which is right for an
          // operator saying "stop" and wrong here — this is one rung of a
          // running block freeing a hull the server will not fly, and the
          // program is meant to carry on afterwards.
          case "stopShip":
            await cutEngines();
            return;
          case "align":
            await alignShip(action.targetID);
            return;
          case "orbit":
            await orbitShip(action.targetID, action.range);
            return;
          case "keepAtRange":
            await keepShipAtRange(action.targetID, action.range);
            return;
          case "setFleetTargetTag":
            // ⚠ THE ACK IS NOT PROOF (api.ts's own warning on this wrapper). The
            // decider that emitted this action has already checked `obs.canTag`
            // before issuing it, and confirms the write landed by reading
            // `fleetTargetTags` on a LATER tick — never by trusting this call's
            // own success.
            await tagFleetTarget(bridgeDo, action.targetID, action.tag);
            return;
          case "dock":
            await dockStep(action.stationID);
            return;
          case "jump":
            await jumpStep(action.fromGateID, action.toGateID);
            return;
          case "lock":
            await lockTargetCall(bridgeDo, action.targetID, null);
            return;
          case "unlock":
            await releaseTarget(action.targetID);
            return;
          case "activate":
            if (action.utility) {
              const shipID = capabilityCache.peek().shipID;
              return issueCombatUtility(action, {
                current: () => characterID != null && store.station.get().online?.characterID === characterID &&
                  token === callOptions.token && pilotGeneration === recoveryGeneration && generation === customBotGeneration &&
                  shipID === capabilityCache.peek().shipID,
                read: async () => (await readCombatLoadout(shipID, []))?.utilities ?? null,
                targetValid: async module => {
                  const [scene, targets] = await Promise.all([api.getSpaceSnapshot(callOptions), api.getTargets(callOptions)]);
                  const fresh = decodeSpaceSnapshot(scene.space), locked = decodeTargetIDs(targets.targetIDs);
                  const target = fresh?.entities.find(row => row.itemID === action.targetID && row.isNpc && row.characterID === null);
                  if (fresh?.ship?.itemID !== shipID || !target || !target.geometryAvailable || !fresh.ship.geometryAvailable ||
                      locked?.includes(action.targetID) !== true || module.rangeM === null || module.rangeM <= 0) return false;
                  const a = fresh.ship.position, b = target.position;
                  return Math.max(0, Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z)-fresh.ship.radius-target.radius) <= module.rangeM;
                },
                activate: () => switchModuleOn(action.moduleID, { typeID: action.typeID,
                  ...(action.targetID > 0 ? { targetID: action.targetID } : {}), repeat: action.repeat ?? -1 }, callOptions),
                sleep: () => new Promise(resolve => setTimeout(resolve, 250)),
              });
            }
            // targetID 0 = a SELF-targeted module (repairer, hardener) — the
            // target key is omitted so the server activates it on the ship.
            requireModuleOutcome(await switchModuleOn(
              action.moduleID,
              action.targetID > 0 ? { typeID: action.typeID, targetID: action.targetID, repeat: -1 } : { typeID: action.typeID, repeat: -1 },
              callOptions,
            ), action.moduleID, "activate");
            return;
          // ⚠ THE typeID IS WHAT MAKES A PROP-MOD STOP ACTUALLY STOP, and its
          // absence here USED TO RETURN SUCCESS AND DO NOTHING. The server stops
          // an afterburner or a microwarpdrive only when the Deactivate names
          // that module's propulsion effect, and the BFF resolves that name from
          // the typeID — so a bare call left the burner cycling while the block
          // that issued it fell through believing the rack now agreed. The
          // fleet companion's own issue path has always passed it; this one
          // never did, which is why a script bot could not switch a burner off
          // at all. An ordinary module (a repairer, a hardener) needs no effect
          // name and behaves identically with the key omitted, which is why the
          // field is optional and the body simply leaves it out.
          case "deactivate": {
            const result = await switchModuleOff(
              action.moduleID,
              action.typeID === undefined ? {} : { typeID: action.typeID },
              callOptions,
            );
            if (action.settlement) return moduleSettlementNote(result, action.moduleID);
            requireModuleOutcome(result, action.moduleID, "deactivate");
            return;
          }
          case "loadCombatAmmo": {
            const shipID = capabilityCache.peek().shipID;
            if (action.utility) return issueUtilityReload(action, {
              current: () => characterID != null && store.station.get().online?.characterID === characterID &&
                token === callOptions.token && pilotGeneration === recoveryGeneration && generation === customBotGeneration &&
                shipID === capabilityCache.peek().shipID,
              read: async () => (await readCombatLoadout(shipID, []))?.utilities ?? null,
              load: () => loadAmmoFrom([action.moduleID], [action.chargeItemID], "cargo"),
              sleep: () => new Promise(resolve => setTimeout(resolve, 750)),
            });
            return issueCombatReload(action, {
              current: () => characterID != null && store.station.get().online?.characterID === characterID &&
                token === callOptions.token && pilotGeneration === recoveryGeneration && generation === customBotGeneration &&
                shipID === capabilityCache.peek().shipID,
              read: () => readCombatWeapons(shipID, [action.moduleID]),
              load: () => loadAmmoFrom([action.moduleID], [action.chargeItemID], "cargo"),
              sleep: () => new Promise(resolve => setTimeout(resolve, 750)),
            });
          }
          case "launchDrones":
            if (action.droneItemIDs.length > 0) {
              const result = await launchedThenRead(wholeStackLaunch(action.droneItemIDs, droneStackSizesSeen));
              const rows = decodeDronesInSpace(result.launched);
              if (rows === null) throw Object.assign(new Error("Drone launch cohort is unconfirmed."), { code: "MODULE_ACTION_UNCERTAIN" });
              return { launchedDroneIDs: rows.filter(row => row.controlled).map(row => row.itemID) };
            }
            return;
          case "engageDrones":
            if (action.droneIDs.length > 0) {
              await engageDronesConfirmed(action.droneIDs, action.targetID);
            }
            return;
          case "mineDrones":
            if (action.droneIDs.length > 0) {
              await mineWithDronesCall(bridgeDo, action.droneIDs, action.targetID);
            }
            return;
          case "recallDrones":
            if (action.droneIDs.length > 0) {
              await returnDronesToBay(bridgeDo, action.droneIDs);
            }
            return;
          case "unloadOre":
            if (action.itemIDs.length > 0) {
              // ⚠ THE RESULT IS READ, NOT DISCARDED. A 200 from this route is
              // not proof anything moved — invbroker declines silently in
              // several branches, which is the whole reason the route re-reads
              // and reports `moved`. The UI path judges that through
              // runMiningAction; the bot path threw the answer away, so a
              // delivery that moved nothing looked exactly like one that
              // worked. Raising here is what puts it in front of the refusal
              // ledger instead of nowhere.
              // Into the pilot's own hangar by the page's own call; a corporation division's delivery and an
              // operation's strict one by the route, which keeps the bot host's custody of them.
              const result = action.division === undefined && action.strictCorp !== true
                ? { ...(await unloadToOwnHangar(action.itemIDs)), fellBack: null }
                : await api.unloadMiningHolds(
                  action.itemIDs,
                  callOptions,
                  action.division ?? null,
                  action.strictCorp === true,
                );
              const moved = result.moved ?? null;
              if (moved !== null && moved.length === 0) {
                throw new Error("Nothing moved to your hangar, and the server gave no reason.");
              }
              // A corporation delivery that landed in the pilot's own hangar
              // instead is NOT a failure — the ore is ashore and the lap goes
              // on — but it is not what the script asked for either, so it is
              // said out loud rather than left for the player to find by
              // opening an empty corporation hangar. A NOTE, not a throw: there
              // is nothing here to retry and no streak to count.
              if (action.division !== undefined && result.fellBack !== null) {
                return `corp division ${action.division} refused (${result.fellBack}); the load went into your own hangar`;
              }
            }
            return;
          case "callPrimary":
            await api.callSquadPrimary(action.targetID, callOptions);
            return;
          case "rememberBeltDry":
            await api.rememberBeltDry(action.systemName, action.beltName, action.groupID, callOptions);
            // The next tick must see this mark, not the cached list from before it.
            beltMemoryCache = null;
            return;
          case "reserveMiningTarget":
            if (!await api.reserveMiningOperationTarget({
              targetType: action.targetType, systemID: action.systemID, systemName: action.systemName,
              targetName: action.targetName, siteIdentity: action.siteIdentity, siteID: action.siteID,
              instanceID: action.instanceID, position: action.position, candidates: action.candidates,
            }, callOptions)) {
              unavailableMiningTargets.set(`${action.targetType}:${action.systemID}:${action.siteIdentity ?? action.targetName}`,
                Date.now() + 35_000);
            }
            return;
          case "bookmarkMiningSite": {
            const assignment = await api.readMiningOperationAssignment(callOptions);
            const target = assignment?.logisticsTarget ?? assignment?.currentTarget;
            const shipID = capabilityCache.peek().shipID;
            if (assignment?.stopRequested || assignment?.role !== "HAULER" || target?.targetKey !== action.targetKey ||
                target.claimedByOperationID !== assignment.operationID || !shipID) {
              throw new Error("SITE_TARGET_AUTHORITY_LOST: logistics return point could not be saved.");
            }
            miningSiteBookmarks[action.targetKey] = await ensureSiteLogisticsBookmark(target, siteBookmarkScope, shipID, {
              read: async () => readMyActiveBookmarks(bridgeAsk),
              // (The page's own call, bridge/bookmarkWrites.ts: the hauler's own ship's place, kept two days.)
              create: async (id, folder, name, note) => { await bookmarkLocationCall(bridgeDo, id, folder, name, note, BOOKMARK_EXPIRY.twoDays); },
            });
            return;
          }
          case "activateMiningTarget":
            await api.activateMiningOperationTarget(action.targetKey, callOptions);
            return;
          case "depleteMiningTarget":
            await api.depleteMiningOperationTarget(action.targetKey, action.evidence, callOptions);
            beltMemoryCache = null;
            return;
          case "miningMemberReady":
            await api.markMiningOperationMemberReady(callOptions);
            return;
          case "miningDrainComplete":
            await api.finishMiningOperationDrain(action.targetKey, callOptions);
            return;
          case "agentButton": {
            // The same call the mission bot presses buttons with; the fresh
            // conversation it answers with lands in the store for the panel.
            const result = await botPresses.during(action.agentID, () =>
              doAgentAction(bridgeDo, action.agentID, action.actionID));
            store.apply({
              type: "agents/conversation",
              agentID: action.agentID,
              conversation: decodeConversation(result),
            });
            return;
          }
          case "startRoute":
            // The SHARED autopilot — same solver, same bounds, multi-system.
            await startRoute(action.stationID);
            return;
          case "loadMissionCargo": {
            // Match on type AND quantity, then the VERIFYING transfer (it
            // re-reads and judges by the source giving something up). A miss is
            // not a crash — the block re-reads and retries within its bound.
            const panel = await api.loadInventory(callOptions);
            const candidates = decodeInventoryRows(panel.hangar.list).filter(
              (row) => row.typeID === action.typeID,
            );
            const item =
              candidates.find((row) => row.quantity === action.quantity) ??
              candidates.find((row) => row.quantity > action.quantity);
            if (item !== undefined) {
              await api.transferItems(
                [item.itemID],
                { kind: "hangar" },
                { kind: "cargo" },
                action.quantity,
                callOptions,
              );
            }
            return;
          }
          case "unloadHolds": {
            // One transfer per SOURCE place — a move names where the items
            // actually are, and a bay's contents are not in the cargo hold.
            // Each group is guarded on its own: a bay the station refuses must
            // not stop the others being landed, exactly as on the loot side.
            let lastError: unknown = null;
            let movedGroups = 0;
            let fellBack = false;
            for (const group of action.groups) {
              if (group.itemIDs.length === 0) {
                continue;
              }
              const from: InventoryPlace = group.bay === null ? { kind: "cargo" } : { kind: "shipBay", bay: group.bay };
              try {
                if (action.division !== undefined) {
                  // ⚠ THE SAME PROMISE deliver-ore AND THE PICKER MAKE: a division
                  // that will not take the load (no office here, no role for it)
                  // lands it in the pilot's own hangar instead, so the lap goes on,
                  // and the run's log says so. A corp move can decline without
                  // raising, which is why `applied` is read, not assumed.
                  const toCorp = await api.transferItems(
                    [...group.itemIDs], from, { kind: "corp", division: action.division }, null, callOptions,
                  ).catch((error: unknown) => {
                    if (isSessionLost(error)) throw error;
                    return null;
                  });
                  if (toCorp !== null && toCorp.applied) {
                    movedGroups += 1;
                    continue;
                  }
                  fellBack = true;
                }
                await api.transferItems([...group.itemIDs], from, { kind: "hangar" }, null, callOptions);
                movedGroups += 1;
              } catch (error) {
                if (isSessionLost(error)) {
                  throw error;
                }
                lastError = error;
              }
            }
            if (movedGroups === 0 && lastError !== null) {
              throw lastError;
            }
            if (fellBack) {
              return `corp division ${action.division} did not take the cargo; it went into your own hangar`;
            }
            return;
          }
          case "loadHolds": {
            // The unload above, run the other way: one transfer per DESTINATION,
            // all out of the station hangar. Each group is guarded on its own
            // for the same reason — a bay that refuses (no room, a type it will
            // not take) must not stop the ones that would have landed, because
            // the block re-reads next tick and a half-loaded ship is a lap that
            // still pays. `qty` rides along for the one stack a hold can only
            // take part of; it is null for a whole-stack move, and the planner
            // guarantees a group carrying one names exactly one stack.
            let lastError: unknown = null;
            let movedGroups = 0;
            for (const group of action.groups) {
              if (group.itemIDs.length === 0) {
                continue;
              }
              try {
                await api.transferItems(
                  [...group.itemIDs],
                  { kind: "hangar" },
                  group.bay === null ? { kind: "cargo" } : { kind: "shipBay", bay: group.bay },
                  group.qty,
                  callOptions,
                );
                movedGroups += 1;
              } catch (error) {
                if (isSessionLost(error)) {
                  throw error;
                }
                lastError = error;
              }
            }
            if (movedGroups === 0 && lastError !== null) {
              throw lastError;
            }
            return;
          }
          case "unloadMissionCargo": {
            if (action.itemIDs.length !== 1 || !Number.isSafeInteger(action.quantity) || action.quantity <= 0) {
              throw new Error("Mission delivery needs one stack and a positive whole quantity.");
            }
            await api.transferItems(
              [...action.itemIDs],
              { kind: "cargo" },
              { kind: "hangar" },
              action.quantity,
              callOptions,
            );
            return;
          }
          case "haulTransfer": {
            const result = await api.transferItems(
              [action.itemID], action.from, action.to, action.quantity, callOptions,
              { haulContract: {
                stationID: action.stationID, locationKind: action.locationKind ?? "station", corporationID: action.corporationID,
                division: action.division, typeID: action.typeID, sourceQuantity: action.sourceQuantity,
              } },
            );
            if (!result.applied || result.declined.length > 0 || result.notFound.length > 0) {
              throw new Error("The route transfer was not confirmed; reconcile both inventories before retrying.");
            }
            return; // The macro also verifies exact quantities on the next tick.
          }
          case "salvageDrones":
            await salvageWithDrones(bridgeDo, action.droneIDs, action.targetID);
            return;
          case "warpScan":
            await warpToSite(action.target);
            return;
          case "warpBookmark":
            await warpToSpot(action.bookmarkID);
            return;
          case "addKnownFolder":
            await addToKnownFolders(bridgeDo, action.folderID, true);
            return;
          case "setFolderActive":
            await updateKnownFolderState(bridgeDo, action.folderID, action.active);
            return;
          case "moveBookmarks":
            await moveBookmarksCall(bridgeDo, action.fromFolderID, action.toFolderID, action.bookmarkIDs);
            return;
          case "salvageBatch": {
            // A salvager's module work for the tick, as a pilot clicks it: each step by itself, the same calls the
            // single actions make. A refused step does not stop the rest; all refused is the batch refused.
            const failed: string[] = [];
            for (const step of action.steps) {
              try {
                if (step.kind === "lock") await lockTargetCall(bridgeDo, step.targetID, null);
                else if (step.kind === "unlock") await releaseTarget(step.targetID);
                else if (step.kind === "activate") requireModuleOutcome(await switchModuleOn(step.moduleID, { targetID: step.targetID, repeat: -1 }, callOptions), step.moduleID, "activate");
                else requireModuleOutcome(await switchModuleOff(step.moduleID, {}, callOptions), step.moduleID, "deactivate");
              } catch (error) {
                if (isSessionLost(error)) throw error;
                failed.push(`${step.kind}: ${String(error)}`);
              }
            }
            if (failed.length === action.steps.length) throw new Error(failed[0]);
            return failed.length > 0 ? `${failed.length} of ${action.steps.length} refused (${failed.join("; ")})` : undefined;
          }
          case "warpLaunch":
            await warpToLaunchPickup(action.launchID);
            return;
          case "warpMissionLocation":
            await warpToMissionSpot(action.agentID, action.locationType, action.locationNumber);
            return;
          case "restartExtractor":
            await restartExtractor(action.planetID, action.pinID, action.resourceTypeID, action.headRadius);
            return;
          case "rerouteExtractor":
            await rerouteExtractor(action.planetID, action.removeRouteIDs, action.create);
            return;
          case "launchCommodities":
            await launchCommodities(action.planetID, action.commandPinID, action.commodities);
            return;
          case "repairItems":
            if (action.itemIDs.length > 0) {
              await repairItemsAtShop(bridgeAsk, bridgeDo, action.itemIDs, await dockedIn());
            }
            return;
          case "boardShip":
            await boardShipNow(action.shipID);
            capabilityCache.invalidate();
            bayCache = null;
            return;
          case "moveItems": {
            const asPlace = (place: string): InventoryPlace =>
              place === "hangar"
                ? { kind: "hangar" }
                : place === "cargo"
                  ? { kind: "cargo" }
                  : { kind: "shipBay", bay: "ore" };
            if (action.itemIDs.length > 0) {
              await api.transferItems(
                [...action.itemIDs],
                asPlace(action.from),
                asPlace(action.to),
                action.qty,
                callOptions,
              );
            }
            return;
          }
          case "applyFitting": {
            const fittingFlight = decodeFlightStatus((await api.getFlightStatus(callOptions)).flight);
            if (fittingFlight.structureID) {
              throw new Error("Scripted fitting at a player structure is not supported by the current fitting contract.");
            }
            // Re-read the library (the pilot's own and the corp's), the hangar and
            // the current fit at issue time (never a stale list), and name the
            // hangar items to fit from, as the retail client does: the server
            // fits a slot only from the ids it is handed. Rigs stay as they are
            // (fitRigs off).
            const library = await loadRefitLibrary();
            const fitting = library.find((f) => f.fittingID === action.fittingID);
            const stationID = fittingFlight.stationID;
            const shipID = fittingFlight.shipID;
            if (fitting === undefined || stationID === null || !shipID) {
              throw new Error("The fitting, the station or the ship could not be read, so nothing was fitted.");
            }
            const panel = await api.loadInventory(callOptions);
            const fitReads = await api.loadFitting(callOptions);
            const fitted = buildSlots(fitReads.slots, fitReads.shipInfo, fitReads.online).flatMap((slot) => {
              const flagID = slotFlagOf(slot.family, slot.index);
              return slot.module !== null && flagID !== null ? [{ flagID, typeID: slot.module.typeID }] : [];
            });
            const plan = planFittingApply(fitting, decodeInventoryRows(panel.hangar.list, panel.volumes), fitted);
            if (Object.keys(plan.modulesByFlag).length > 0) {
              // The client's own call on the ship's own inventory (bridge/fitModule.ts), naming the ship's type as
              // the flight read has it.
              await applyFitting(bridgeDo, { shipID, typeID: fittingFlight.shipTypeID ?? null }, stationID, plan.modulesByFlag, plan.itemsByType);
            }
            capabilityCache.invalidate();
            bayCache = null;
            await loadInventory().catch(() => {});
            return;
          }
          case "reprocessOre":
            if (action.itemIDs.length > 0) {
              // The page goes by the server's own word of what it reprocessed
              // (reprocessNow); the block confirms on its own next-tick read too,
              // so a silent decline just retries within the block's bound
              // instead of being believed.
              await reprocessNow(action.itemIDs);
            }
            return;
          case "lootWreck": {
            // Read the wreck's contents, then move the lot out — each stack to
            // whichever bay this hull wants it in, the rest to cargo
            // (transferLootedRows). The wreck is addressed as a plain
            // container; the transfer route re-reads and even absorbs the
            // loot-raises-after-move server quirk.
            await lootFrom(action.wreckID);
            return;
          }
          case "lootContainer": {
            // Same shape as lootWreck. The server DOES judge a container's
            // loot rights (spaceLootEntitlement: a take without them is theft,
            // a suspect flag in empire space); the deciders choose only cans the
            // pilot may take (nav/lootableContainers.ts), and the claim here is
            // the haulers' lease on a can, not a right to it.
            if (!claimRunID) throw new Error("Container ownership was not confirmed.");
            await lootFrom(action.containerID, claimRunID);
            return;
          }
          case "collectLaunch": {
            // No container claim: a launch container belongs to the pilot who
            // launched it (the server checks loot rights), so there is no
            // other hauler to share it with. lootFrom throws when nothing at
            // all fits, which is what the refusal ledger needs to hear.
            await lootFrom(action.containerID);
            // ⚠ THE RECORD GOES ONLY ONCE THE CONTAINER IS SEEN EMPTY. A partial
            // take (the hold filled) leaves the launch listed for the next lap.
            const left = await api.openContainer(action.containerID, callOptions);
            if (decodeInventoryRows(left.list, left.volumes).length > 0) {
              return "part of the launch did not fit; it stays listed for the next trip";
            }
            // The journal's Remove, as the client makes it (bridge/launchWrites.ts).
            await removeLaunch(bridgeDo, action.launchID);
            return;
          }
          case "exportCustoms": {
            // The office's tax rate asked and the transfer made on the office's own inventory, by the page's own
            // calls as the client's customs window makes them (bridge/customsWrites.ts), in space.
            await exportToCustomsOffice(bridgeAsk, bridgeDo, { dockedAt: dockedNow() }, action.officeID, action.pinID, action.commodities);
            return;
          }
          case "collectCustoms": {
            // No claim and no record to delete. An office's storage is
            // partitioned by depositor server-side, so these rows are this
            // pilot's and no other hauler shares them; and an office is a
            // structure that stays where it is, so the next tick's read of it
            // is what says whether anything is left. lootFrom throws when
            // nothing at all fits, which is what the refusal ledger needs to
            // hear so the block can go and unload.
            await lootFrom(action.officeID);
            return;
          }
          case "placeBuyOrder":
            // A resting order rests the full 90 days, by the page's own call (bridge/marketOrderWrites.ts). The
            // block is one-shot, so a silent decline just means no order — never a double buy.
            // A bot shows no window and names no rate; the game port names the client's.
            await placeBuyOrderCall(bridgeDo, bridgeAsk, {
              stationID: marketPlaceNow(), typeID: action.typeID, price: action.price, quantity: action.quantity, durationDays: BOT_ORDER_DURATION_DAYS, brokersFeeRate: null,
            });
            return;
          case "placeSellOrder":
            // The listed stack leaves the hangar, which is how the block confirms
            // next tick — a decline leaves it, and the block retries within bound.
            await placeSellOrderCall(bridgeDo, bridgeAsk, {
              stationID: marketPlaceNow(), itemID: action.itemID, typeID: action.typeID, price: action.price, quantity: action.quantity, durationDays: BOT_ORDER_DURATION_DAYS, brokersFeeRate: null,
            });
            return;
          case "createFleet":
            // Confirmed by the next bound-fleet read (inFleet flips true). Decided on the bot's own reading
            // that it is in no fleet.
            await formFleetCall(bridgeDo, false);
            return;
          case "inviteToFleet":
            await inviteToFleetCall(bridgeDo, action.charID, onlineCharacterID());
            return;
          case "acceptFleetInvite":
            // A missing invite is treated as a refused attempt; the runner re-reads
            // and retries until inFleet becomes true or the block's wait bound trips.
            // An invitee is not in the fleet yet, so AcceptInvite must bind the
            // fleetID carried by the live OnFleetInvite notification; the Fleet
            // Center slice retains it even when that panel is closed.
            {
              // A block that MINTED the invite by applying names the fleet, and
              // is believed: the notification may not have reached the Fleet
              // Center slice yet on the very next tick, and the server checks
              // the invite really is this character's anyway. Only the
              // invite-waiting block has to ask the store, because only it has
              // no other way to know which fleet invited it.
              const fleetID = action.fleetID ?? store.fleet.get().pendingInvite?.fleetID;
              if (fleetID === undefined) {
                throw new Error("No pending fleet invitation is available.");
              }
              await acceptFleetInviteCall(bridgeDo, fleetID, false);
            }
            return;
          case "applyToJoinFleet": {
            // ⚠ THIS DOES NOT JOIN THE FLEET. On an open advert the server mints
            // an invite and notifies this pilot; the block accepts it on a later
            // tick. The answer says which half of the round trip we are in, and
            // it is the only place that answer exists -- so it is kept rather
            // than discarded, and a throw leaves the previous value alone so a
            // failed apply reads as "no answer yet" and not as somebody else's.
            const outcome = await applyToJoinFleetCall(bridgeDo, action.fleetID, true);
            fleetApplication = { fleetID: action.fleetID, outcome, ...(action.supportOrder ? { supportOrder: action.supportOrder } : {}) };
            return;
          }
          case "stopRoute":
            autopilot?.abort();
            return;
          case "startSystemRoute":
            // The SHARED autopilot again — resolveDestination answers a system id
            // with kind "system", so the plan carries no final dock and the ride
            // ends in space at the destination system.
            await startRoute(action.systemID);
            return;
          case "alert":
            deliverAlert(action.message);
            return;
          case "jettison":
            // ⚠ The items leave the ship into a container in space. The block
            // confirms by re-reading the hold, so a refused jettison retries
            // within its bound instead of being believed. Outside a Mining
            // Operation it is the page's own call (jettisonNow); an operation's
            // hosted bot asks the route, which keeps its can and its custody.
            if (action.itemIDs.length > 0 && !options.miningOperationID && !options.hostedOreJettisonRecovery) {
              await jettisonNow(action.itemIDs);
            } else if (action.itemIDs.length > 0) {
              const owned = options.hostedOreJettisonRecovery;
              if (owned) hostedJettisonPending = true;
              try {
                const receipt = await api.jettisonItems(action.itemIDs, callOptions, owned ? invocation : undefined);
                if (owned && receipt) hostedJettisonPending = !api.recoverableHostedJettison(receipt);
              } catch (error) {
                if (owned && error instanceof api.JettisonCustodyError)
                  hostedJettisonPending = error.notIssued ? false : error.custody ? !api.recoverableHostedJettison(error.custody) : true;
                throw error;
              }
            }
            return;
          case "stackHangar":
            // The hangar read first, as the client's inventory lists before it asks.
            await loadInventory();
            await stackPlaceNow("hangar");
            return;
          case "compressOre":
            // Confirm-gated on the BFF. The answer is deliberately not trusted:
            // the block's next hold read is what tells it whether the stack
            // really changed type, so a refusal costs one attempt on one stack.
            await compressItemInSpace(bridgeDo, action.itemID, action.facilityID);
            return;
          // The scanner's three, as the Scanner window makes them: the page's own calls, by the scanner as it is
          // read now (bridge/scannerWrites.ts). What the client refuses, these refuse.
          case "scannerLaunch":
            await scannerWrites.launch(await api.loadScannerOperations(callOptions));
            return;
          case "scannerAnalyze":
            await scannerWrites.analyze(await api.loadScannerOperations(callOptions));
            return;
          case "scannerRecover":
            await scannerWrites.recover(await api.loadScannerOperations(callOptions), scannerShip());
            return;
        }
        return unhandledScriptAction(action);
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      // The readout goes to the STORE, not a component callback, so it survives
      // dock/undock and the shell switch (the bug the first cut hit).
      onProgress: (snapshot) => {
        store.apply({
          type: "custom-bot/progress",
          status: snapshot.status,
          phase: snapshot.phase,
          why: snapshot.why,
          stepPath: snapshot.stepPath,
          interruptID: snapshot.interruptID,
          pauseReason: snapshot.pauseReason,
          note: snapshot.note,
          refusals: snapshot.refusals,
        });
        if (snapshot.status === "error") {
          stopLiveStream();
          store.apply({ type: "character/offline" });
        }
      },
      isSessionLost,
      // The RAW wire text, code prefix and all — the ledger words it through
      // describeRefusal itself and classifies on the code, so it must not be
      // pre-translated here.
      refusalReason: readRefusalReason,
      registry: SCRIPT_MACROS,
      travelHome: scriptTravelHome,
      log: botLogSink,
    };
  }

  async function startCustomBot(input: BotScript, sourceScriptID: string | null = null): Promise<void> {
    requireCustomControllerSettled();
    requireAutomationReady();
    hostedTransportSuspended = false;
    // Restarting the SAME controller is the one case createShipClaim deliberately
    // does not stop. Cancel it here, then take the structural claim so mining and
    // mission are stopped exhaustively from the shared registry.
    const gen = (customBotGeneration += 1);
    scriptRunner?.stop();
    autopilot?.abort();
    claimShip("custom");
    // COMPOSITION, resolved once here: a bot that includes other saved bots is
    // expanded into one flat program BEFORE the runner ever sees it, so the whole
    // engine keeps reasoning about a single program. A bot that cannot be
    // included is skipped with a plain reason rather than failing the run.
    const doc = await expandSavedSubBots(input, sourceScriptID);
    if (gen !== customBotGeneration) {
      return; // superseded while the included bots were read
    }
    supportScript = options.miningOperationID && doc.program.some(step => step.kind === "macro" && step.macro === "mining-support") ? freshSupportScript() : null;
    classifySiteMiners = scriptMinesScannerSites(doc);
    // Seed the fitted-module cache. The runner refreshes it after a refit or
    // active-hull change; this first read only keeps tick one honest.
    const initialCapabilities = await resolveScriptModuleCapabilities();
    if (options.miningOperationID || classifySiteMiners) {
      const refusal = siteMiningFitRefusal(doc, initialCapabilities.oreMining, initialCapabilities.iceMining,
        { requireOre: !!options.miningOperationID });
      // Without an operation only the ice check refuses Start: an ore site
      // script ran on `mining` before ore lasers were told apart, and still does.
      if (refusal) {
        throw Object.assign(new Error(refusal), { code: refusal.split(":")[0] });
      }
    }
    if (gen !== customBotGeneration) {
      return; // a newer start / a stop / a panic superseded us during the read
    }
    // Resolve "starting station" from a FRESH flight read. If the bot starts in
    // space there is no station it started from, so it stands for the bot's own
    // home when that names a station, else the character's home station
    // (charMgr.GetHomeStation): a run that starts out in space docks there to
    // board, delivers there and comes back there. Only when neither is known
    // does emergency travel pause with an honest refusal instead of claiming
    // the exposed ship is safely docked.
    let startStatus = store.flight.get().status;
    try {
      startStatus = decodeFlightStatus((await api.getFlightStatus(callOptions)).flight);
      void observeFlightStatus(startStatus);
    } catch {
      // Keep the last authoritative status if one exists; null stays unknown.
    }
    if (gen !== customBotGeneration) {
      return;
    }
    let startingStationID = startStatus !== null && startStatus.docked ? startStatus.stationID : null;
    if (startingStationID === null && startStatus !== null) {
      startingStationID = resolveStationRef(doc.home, null);
      if (startingStationID === null) {
        try {
          // The character sheet's own read of it (bridge/characterSheetReads.ts).
          startingStationID = decodeHomeStationID(await bridgeAsk("charMgr", "GetHomeStationRow", []));
        } catch {
          // Unread stays null: the honest pause below, never a guessed station.
        }
      }
      if (gen !== customBotGeneration) {
        return;
      }
    }
    // Which conditions this doc actually tests — decided ONCE, so observe pays only
    // for the per-tick reads a bot really needs (the wallet, the local roster, the
    // cargo hold). See scriptWatchedConditionKinds.
    const watchedKinds = scriptWatchedConditionKinds(doc);
    // Forgotten per RUN: an application belongs to the run that made it, and a
    // fresh run must apply for itself rather than believe an old answer.
    fleetApplication = null;
    store.apply({ type: "custom-bot/started", name: doc.name });
    scriptRunner = createScriptRunner(
      { ...makeScriptRunnerDeps(initialCapabilities, startingStationID, doc.home, watchedKinds), startup: options.hostedStartup },
    );
    scriptRunner.start(doc);
    void scriptRunner.run();
  }

  /**
   * Expand "run one of my saved bots" nodes by pulling those bots off the
   * server and splicing their programs in. Returns the doc unchanged when it
   * asks for none. Every fetched bot goes through the CODEC first (a stored bot
   * is untrusted bytes like any other), and anything that cannot be included is
   * reported on the readout rather than stopping the run.
   */
  async function expandSavedSubBots(
    doc: BotScript,
    sourceScriptID: string | null = null,
  ): Promise<BotScript> {
    if (!hasSubBots(doc)) {
      return doc;
    }
    const byID = new Map<string, BotScript>();
    const idsByName = new Map<string, string[]>();
    try {
      const summaries = await api.listBotScripts(callOptions);
      for (const summary of summaries) {
        const key = summary.name.trim().toLowerCase();
        const ids = idsByName.get(key) ?? [];
        idsByName.set(key, [...ids, summary.scriptID]);
      }
      await Promise.all(
        summaries.map(async (summary) => {
          try {
            const record = await api.getBotScript(summary.scriptID, callOptions);
            if (record === null) {
              return;
            }
            const decoded = decodeScriptValue(record.doc);
            if (decoded.ok) {
              byID.set(summary.scriptID, decoded.doc);
            }
          } catch {
            // One broken/deleted record does not make another exact id ambiguous.
          }
        }),
      );
    } catch {
      // Could not read the library — the resolver reports every reference missing.
    }

    const resolve = (reference: SubBotReference): BotResolution => {
      if (reference.scriptID !== null) {
        const exact = byID.get(reference.scriptID);
        return exact === undefined
          ? { kind: "missing" }
          : { kind: "found", identity: `id:${reference.scriptID}`, doc: exact };
      }
      const key = reference.name?.trim().toLowerCase() ?? "";
      const ids = idsByName.get(key) ?? [];
      if (ids.length > 1) {
        return { kind: "ambiguous" };
      }
      const scriptID = ids[0];
      if (scriptID === undefined) {
        return { kind: "missing" };
      }
      const matched = byID.get(scriptID);
      return matched === undefined
        ? { kind: "missing" }
        : { kind: "found", identity: `id:${scriptID}`, doc: matched };
    };

    const result = expandSubBots(
      doc,
      resolve,
      sourceScriptID === null ? null : `id:${sourceScriptID}`,
    );
    if (result.problems.length > 0) {
      store.apply({
        type: "custom-bot/progress",
        status: "running",
        phase: "Starting",
        why: result.problems.join(" "),
        stepPath: null,
        interruptID: null,
        pauseReason: null,
        note: null,
      });
    }
    return result.doc;
  }

  /**
   * EVERY condition kind the document tests anywhere — interrupts, step and loop
   * `until`s, and branch forks (including branches inside a loop).
   *
   * This is the READ GATE. Several conditions cost a gateway call per tick that no
   * other bot should pay for: the wallet and the inventory. So
   * the whole doc is walked ONCE at start (it cannot change under a run) and the
   * observe function reads only what something actually watches. A kind missing
   * from this set means its reading stays null — and null never fires a watch, which
   * is the safe direction to be wrong in.
   */
  function scriptWatchedConditionKinds(doc: BotScript): ReadonlySet<string> {
    const kinds = new Set<string>();
    for (const row of doc.interrupts) {
      kinds.add(row.when.kind);
    }
    const addUntil = (step: { readonly until?: { readonly kind: string } }): void => {
      if (step.until !== undefined) {
        kinds.add(step.until.kind);
      }
    };
    for (const node of doc.program) {
      if (node.kind === "loop") {
        addUntil(node);
        for (const element of node.body) {
          if (element.kind === "branch") {
            kinds.add(element.when.kind);
            for (const step of [...element.then, ...element.else]) {
              addUntil(step);
            }
          } else {
            addUntil(element);
          }
        }
      } else if (node.kind === "branch") {
        kinds.add(node.when.kind);
        for (const step of [...node.then, ...node.else]) {
          addUntil(step);
        }
      } else if (node.kind === "macro") {
        addUntil(node);
      }
      // A sub-bot node is already expanded by the time this runs, so it has no
      // test of its own to check here.
    }
    return kinds;
  }

  /**
   * The manual escape hatch behind the readout's "Recall drones & dock" button:
   * stop every loop, bring any controllable drones home, and dock at the nearest
   * station/structure on grid. A player can always pull the ship to safety by
   * hand, whatever a bot (or a bug) is doing. Best-effort and bounded — each step
   * is independent, so a failed recall still attempts the dock.
   */
  async function panicRecallAndDock(shouldAbort: () => boolean = () => false): Promise<void> {
    if (shouldAbort()) return;
    customBotGeneration += 1; // cancel any start still mid-await
    scriptRunner?.stop();
    // The player has ended the bot by hand — clear its readout to idle so it
    // does not linger showing the last thing it was doing ("Mining the rock")
    // once we are docked. `stop()` alone leaves the slice at status "stopped"
    // with that stale phase/why still on it.
    store.apply({ type: "custom-bot/cleared" });
    autopilot?.abort();
    miningBot?.stop();
    missionBot?.stop();
    await loadSpaceSnapshot().catch(() => {});
    if (shouldAbort()) return;
    const snapshot = store.space.get().snapshot;
    if (snapshot === null) {
      return;
    }
    // Nearest dockable station/structure on grid (centre-to-centre) — where we head.
    const origin = snapshot.ship?.position ?? null;
    let best: { readonly itemID: number; readonly d: number } | null = null;
    for (const entity of snapshot.entities) {
      if (entity.isSelf || !isDockableKind(entity.kind)) {
        continue;
      }
      const dx = origin ? origin.x - entity.position.x : 0;
      const dy = origin ? origin.y - entity.position.y : 0;
      const dz = origin ? origin.z - entity.position.z : 0;
      const d = dx * dx + dy * dy + dz * dz;
      if (best === null || d < best.d) {
        best = { itemID: entity.itemID, d };
      }
    }

    // Which drones can this hull still order home, from the freshest snapshot.
    const dronesStillOut = (): readonly number[] => {
      const s = store.space.get().snapshot;
      if (s === null) {
        return [];
      }
      const sid = s.ship?.itemID ?? null;
      return s.entities.filter((e) => canMyShipOrderDrone(e, sid) === true).map((e) => e.itemID);
    };

    // The align-out-and-recall move: call the drones home, align toward the exit
    // so the ship is ready to warp, then HOLD until 0 are left in space before we
    // let the dock (which warps) proceed — warping with drones out abandons them.
    // Bounded (~15s) so it can never hang; after that we leave regardless.
    const out = dronesStillOut();
    if (out.length > 0 && !shouldAbort()) {
      await recallDrones(out).catch(() => {});
      if (best !== null && !shouldAbort()) {
        await alignShip(best.itemID).catch(() => {});
      }
      for (let i = 0; i < 10 && !shouldAbort() && dronesStillOut().length > 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await loadSpaceSnapshot().catch(() => {});
      }
    }

    if (best !== null && !shouldAbort()) {
      await dockAt(best.itemID, shouldAbort);
    }
  }

  // R7a — search the static map by name so a player can set a destination
  // without knowing EVE IDs. The static /api/map/find read (login-gated, no
  // bridge session) returns systems + stations; we annotate each with jumps from
  // the current system using the same single BFS the Agent Finder uses (the map
  // graph is already the route solver's, loaded once). Jumps are best-effort:
  // if the origin is unknown or the graph can't load, the row simply has no
  // distance. A hard read failure throws so the caller can surface it.
  async function searchDestinations(
    query: string,
    kind: "system" | "station" | "dockable" | null = null,
  ): Promise<DestinationMatch[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return [];
    }
    const result = await api.findMapLocations(trimmed, kind === "dockable" ? "station" : kind, callOptions);
    const structures = kind === null || kind === "dockable"
      ? await api.findAccessibleStructures(trimmed, callOptions) : [];

    // The origin is the live location if known (in space or docked), else the
    // docked character's system. The jumps are the autopilot's, as the client's
    // own search results count them (entries/universe.py), from one flood.
    const origin =
      store.flight.get().status?.solarSystemID ??
      store.station.get().online?.solarSystemID ??
      null;
    let distances: Map<number, number> | null = null;
    if (origin !== null) {
      try {
        distances = await autopilotDistancesFrom(origin);
      } catch {
        distances = null;
      }
    }

    return [...result.matches, ...structures].map((match) => ({
      ...match,
      jumps:
        distances !== null && match.solarSystemID !== null
          ? distances.get(match.solarSystemID) ?? null
          : null,
    }));
  }

  // --- R7c Names everywhere (batch name cache) -----------------------------

  // The generalized R7a location-name cache: every tab asks for names by
  // (kind, id) and this cache resolves them in ONE batched /api/names round-trip
  // per microtask, caches each outcome (a name, or null for a definitive
  // "unknown" so it never refetches), and pushes them into the store's `names`
  // slice for pure-reader components. A transient network failure is NOT cached
  // (the pending marks are released so a later request retries). Fire-and-forget:
  // requestNames never throws and never blocks a UI interaction — the component
  // shows the raw ID until the name lands. Chunked to the route's server-side cap
  // so a large list is never silently truncated.
  const NAMES_REQUEST_CAP = 500;
  // --- the retail client's words -------------------------------------------
  // The same shape as the names below: a queue filled in a tick, flushed in
  // one request, each label asked for once.
  const wordsAsked = new Set<string>();
  let wordsQueue: string[] = [];
  let wordsFlushScheduled = false;
  let wordsUnavailable = false;
  const WORDS_REQUEST_CAP = 200;

  async function flushWordsQueue(): Promise<void> {
    wordsFlushScheduled = false;
    const batch = wordsQueue;
    wordsQueue = [];
    for (let start = 0; start < batch.length; start += WORDS_REQUEST_CAP) {
      const chunk = batch.slice(start, start + WORDS_REQUEST_CAP);
      if (wordsUnavailable) {
        store.apply({ type: "words/loaded", available: false, templates: Object.fromEntries(chunk.map((label) => [label, null])) });
        continue;
      }
      // A key is a label, or "#" and a message's number, or a dialog's name and which of its two texts (or whether its
      // answer may be kept).
      const numbered = chunk.filter((key) => /^#\d+$/.test(key));
      const named = chunk.filter((key) => dialogOfKey(key) !== null);
      let result: Awaited<ReturnType<typeof api.loadWords>>;
      try {
        result = await api.loadWords(
          chunk.filter((key) => !numbered.includes(key) && !named.includes(key)),
          numbered.map((key) => Number(key.slice(1))),
          // A dialog's title and body are two keys and one dialog.
          [...new Set(named.map((key) => (dialogOfKey(key) as { name: string }).name))],
          callOptions,
        );
      } catch {
        // Not remembered: a later ask tries again.
        for (const label of chunk) {
          wordsAsked.delete(label);
        }
        continue;
      }
      wordsUnavailable = !result.available;
      store.apply({
        type: "words/loaded",
        available: result.available,
        templates: Object.fromEntries(chunk.map((key) => {
          const dialog = dialogOfKey(key);
          if (dialog !== null) {
            return [key, result.dialogs[dialog.name]?.[dialog.part] ?? null];
          }
          return [key, (key.startsWith("#") ? result.messages[key.slice(1)] : result.words[key]) ?? null];
        })),
      });
    }
  }

  // What the store keeps of agents is asked for once: not while an ask for it is on its way, and not
  // while the store holds an answer. Selecting a pilot empties what the store holds of agents, and then
  // it is asked for again; an ask that fails leaves nothing held, so a later one tries again.
  function askOnce<Key extends string | number>(asking: Set<Key>, key: Key, held: boolean, ask: () => Promise<void>): void {
    if (held || asking.has(key)) {
      return;
    }
    asking.add(key);
    void ask().catch(() => {}).finally(() => asking.delete(key));
  }

  // A mission's keywords, asked of its agent once (agents.py PrimeMessageArguments).
  const keywordsAsking = new Set<string>();
  function requestMissionKeywords(agentID: number, contentID: number): void {
    if (!Number.isSafeInteger(agentID) || agentID <= 0 || !Number.isSafeInteger(contentID) || contentID <= 0) {
      return;
    }
    const key = `${agentID}:${contentID}`;
    askOnce(keywordsAsking, key, key in store.agents.get().missionKeywords, async () => {
      const keywords = await api.loadMissionKeywords(agentID, contentID, callOptions);
      store.apply({ type: "agents/mission-keywords", key, keywords: argumentsOf(keywords) });
    });
  }

  // A system's security is static, like a name: asked for once, in one request for all that are wanted at once.
  const securityAsked = new Set<number>();
  let securityQueue: number[] = [];
  function requestSystemSecurity(systemIDs: readonly number[]): void {
    const fresh = [...new Set(systemIDs)].filter((id) => Number.isSafeInteger(id) && id > 0 && !securityAsked.has(id));
    if (fresh.length === 0) {
      return;
    }
    for (const id of fresh) {
      securityAsked.add(id);
    }
    const first = securityQueue.length === 0;
    securityQueue.push(...fresh);
    if (!first) {
      return;
    }
    queueMicrotask(() => {
      const batch = securityQueue;
      securityQueue = [];
      void api.loadSystemSecurity(batch, callOptions).then(
        (security) => {
          store.apply({ type: "names/system-security", security });
        },
        () => {
          // Not remembered: a later ask tries again.
          for (const id of batch) {
            securityAsked.delete(id);
          }
        },
      );
    });
  }

  // What the client's agents service knows of an agent, asked for once (agents.GetAgentByID reads a table
  // the client keeps for the session).
  const agentRecordsAsking = new Set<number>();
  function requestAgentRecord(agentID: number): void {
    if (!Number.isSafeInteger(agentID) || agentID <= 0) {
      return;
    }
    askOnce(agentRecordsAsking, agentID, agentID in store.agents.get().agentRecords, async () => {
      const record = await api.loadAgentRecord(agentID, callOptions);
      store.apply({ type: "agents/record", agentID, record: decodeAgentRecord(record) });
    });
  }

  // Which solar system an agent is in, asked of the server once for each agent
  // (agents.GetSolarSystemOfAgent keeps what agentMgr.GetSolarSystemOfAgent answered).
  const agentSystemsAsking = new Set<number>();
  function requestAgentSolarSystem(agentID: number): void {
    if (!Number.isSafeInteger(agentID) || agentID <= 0) {
      return;
    }
    askOnce(agentSystemsAsking, agentID, agentID in store.agents.get().agentSolarSystems, async () => {
      const solarSystemID = await api.loadAgentSolarSystem(agentID, callOptions);
      store.apply({ type: "agents/solar-system", agentID, solarSystemID });
    });
  }

  function requestWords(labels: readonly string[]): void {
    let queued = false;
    for (const label of labels) {
      if (typeof label !== "string" || label === "" || wordsAsked.has(label)) {
        continue;
      }
      wordsAsked.add(label);
      wordsQueue.push(label);
      queued = true;
    }
    if (queued && !wordsFlushScheduled) {
      wordsFlushScheduled = true;
      queueMicrotask(() => {
        void flushWordsQueue();
      });
    }
  }

  const nameCache = new Map<string, string | null>();
  const namePending = new Set<string>();
  let nameQueue: NameRef[] = [];
  let nameFlushScheduled = false;

  async function flushNameQueue(): Promise<void> {
    nameFlushScheduled = false;
    const batch = nameQueue;
    nameQueue = [];
    for (let start = 0; start < batch.length; start += NAMES_REQUEST_CAP) {
      const chunk = batch.slice(start, start + NAMES_REQUEST_CAP);
      let result: Awaited<ReturnType<typeof api.resolveNames>>;
      try {
        result = await api.resolveNames(chunk, callOptions);
      } catch {
        // Best-effort: release the pending marks so these refs can be retried
        // by a later requestNames (a transient failure must not cache "unknown").
        for (const ref of chunk) {
          namePending.delete(nameKey(ref.kind, ref.id));
        }
        continue;
      }
      // R38 — a key the server could not look up at all (a player structure
      // with no character online, or a gateway error) is released like a
      // transient network failure: pending mark dropped, NOTHING cached, so a
      // later requestNames asks again. Caching it would be the client asserting
      // "this place has no name" on the strength of a question that was never
      // answered.
      const unresolved = new Set(result.unresolved);
      const entries: Record<string, string | null> = {};
      for (const ref of chunk) {
        const key = nameKey(ref.kind, ref.id);
        namePending.delete(key);
        if (unresolved.has(key)) {
          continue;
        }
        const name = key in result.names ? result.names[key] : null;
        nameCache.set(key, name ?? null);
        entries[key] = name ?? null;
      }
      store.apply({ type: "names/resolved", entries });
    }
  }

  function requestNames(refs: readonly NameRef[]): void {
    let queued = false;
    for (const ref of refs) {
      const id = ref.id;
      if (!Number.isSafeInteger(id) || id <= 0) {
        continue;
      }
      const key = nameKey(ref.kind, id);
      if (nameCache.has(key) || namePending.has(key)) {
        continue;
      }
      namePending.add(key);
      nameQueue.push({ kind: ref.kind, id });
      queued = true;
    }
    if (queued && !nameFlushScheduled) {
      nameFlushScheduled = true;
      queueMicrotask(() => {
        void flushNameQueue();
      });
    }
  }

  // --- R6a Agent Finder ----------------------------------------------------

  // The finder pulls a bounded set from the static reference table and sorts it
  // by jumps from the current system. We request a limit that fully covers a
  // single mission-kind level (the largest, courier L1, is ~1531) so choosing a
  // level yields the complete, correctly-nearest-sorted set; the browser then
  // renders only a capped page. Bounded well under the ~11k-agent dataset.
  const FINDER_REQUEST_LIMIT = 2000;

  // Nearest-first; unreachable / unknown-origin agents (jumps === null) sort
  // last, then by level, then by name for a stable order.
  function compareFinderRows(a: AgentFinderRow, b: AgentFinderRow): number {
    if (a.jumps !== b.jumps) {
      if (a.jumps === null) {
        return 1;
      }
      if (b.jumps === null) {
        return -1;
      }
      return a.jumps - b.jumps;
    }
    if ((a.level ?? 0) !== (b.level ?? 0)) {
      return (a.level ?? 0) - (b.level ?? 0);
    }
    return a.name.localeCompare(b.name);
  }

  async function findAgents(
    filters: { kind?: string; level?: number | null; limit?: number } = {},
  ): Promise<void> {
    const kind = filters.kind ?? "courier";
    const level = filters.level ?? null;

    let result: Awaited<ReturnType<typeof api.findAgents>>;
    try {
      result = await api.findAgents(
        { kind, level, limit: filters.limit ?? FINDER_REQUEST_LIMIT },
        callOptions,
      );
    } catch (error) {
      // The finder reads static reference data (web-login only, no bridge
      // session), so a failure is a plain read error surfaced in the slice.
      store.apply({ type: "finder/error", message: `Could not find agents: ${errorWords(error)}` });
      return;
    }

    // The player's current system is the docked character's system (the finder
    // is a docked-station tool). The jumps are the autopilot's, as the client
    // counts them to an agent (agencyUtil.py), from one flood over the map
    // graph — never a route solved per agent.
    const origin = store.station.get().online?.solarSystemID ?? null;
    let distances: Map<number, number> | null = null;
    let distanceNote: string | null = null;
    if (origin !== null) {
      try {
        distances = await autopilotDistancesFrom(origin);
      } catch (error) {
        // The map graph is the same read-only static data the route solver
        // uses; if it can't load, still list the agents (jumps null) and note
        // why rather than failing the whole find.
        distanceNote = `Agents listed without distances (map graph unavailable: ${errorWords(error)}).`;
      }
    }

    const rows: AgentFinderRow[] = result.agents
      .map((agent) => ({
        ...agent,
        jumps:
          distances !== null && agent.solarSystemID !== null
            ? distances.get(agent.solarSystemID) ?? null
            : null,
      }))
      .sort(compareFinderRows);

    store.apply({
      type: "finder/results",
      kind: result.kind,
      level: result.level,
      originSystemID: origin,
      agents: rows,
      total: result.total,
      capped: result.capped,
    });
    // finder/results clears the error; re-apply the soft distance note after it
    // so it survives (a hard find error already returned above).
    if (distanceNote) {
      store.apply({ type: "finder/error", message: distanceNote });
    }
  }

  async function setDestinationToAgent(agentID: number): Promise<void> {
    const agent = store.finder.get().agents.find((row) => row.agentID === agentID);
    if (!agent) {
      store.apply({ type: "finder/error", message: `Agent ${agentID} is not in the current results.` });
      return;
    }
    if (agent.stationID === null) {
      store.apply({ type: "finder/error", message: `Agent ${agent.name} has no station to route to.` });
      return;
    }
    // Record who we're flying to (the panel shows the target), then reuse the
    // R5b route solver + browser autopilot via startRoute(agent.stationID).
    store.apply({
      type: "finder/target",
      target: {
        agentID: agent.agentID,
        name: agent.name,
        level: agent.level,
        stationID: agent.stationID,
        stationName: agent.stationName,
        solarSystemID: agent.solarSystemID,
        solarSystemName: agent.solarSystemName,
        jumps: agent.jumps,
      },
    });
    await startRoute(agent.stationID);
  }

  return {
    droneRecovery: readonlySignal(recoverySignal),
    retryDroneRecovery,
    requireAutomationReady,
    async checkHealth() {
      // One shot, called at boot (main.ts) — never a poll. Any failure resolves
      // to offline inside api.getHealth, so this never throws.
      const { ready } = await api.getHealth(callOptions);
      store.apply({ type: "health/status", status: ready ? "online" : "offline" });
    },

    sessionToken() {
      return callOptions.token ?? null;
    },

    requestOptions() {
      return callOptions;
    },

    async login(username, password) {
      if (sessionClosing) throw new Error("This pilot session is being released.");
      const generation = sessionCloseGeneration;
      // A cancelled sign-in must still receive its newly minted token so it can
      // clean up that exact login without ever selecting a pilot on it.
      const result = await api.login(username, password, { ...callOptions,
        token: callOptions.token ?? null, captureRequestGuard: undefined });
      if (generation !== sessionCloseGeneration || sessionClosing) {
        if (result.sessionToken !== null) {
          try {
            await api.logout({ ...callOptions, token: result.sessionToken, captureRequestGuard: undefined });
          } catch (error) {
            throw new BridgeCallError("CANCELLED_LOGIN_RELEASE_UNVERIFIED",
              "Sign-in was cancelled, but the new session could not be confirmed logged out. Retry releasing that session.",
              error instanceof BridgeCallError ? error.status : 0,
              error instanceof BridgeCallError ? error.diagnosis : null, result.sessionToken);
          }
        }
        throw new Error("This sign-in was cancelled.");
      }
      // Publish only after this sign-in is still current. api.login received an
      // explicit carrier so even legacy flows cannot publish a cancelled token.
      if (options.perSessionToken) {
        callOptions.token = result.sessionToken;
      } else if (result.sessionToken !== null) {
        setSessionToken(result.sessionToken);
      }
      store.apply({
        type: "session/logged-in",
        accountID: result.accountID,
        username: result.username,
        // R2: carried so the character-select screen can welcome a brand-new
        // account (which also arrives with zero characters).
        accountCreated: result.accountCreated,
      });
      // The character list comes from the typed retail reference call, not a
      // bespoke projection (charUnboundMgr.GetCharacterSelectionData).
      const selection = await getCharacterSelectionData(callOptions);
      store.apply({ type: "character/list", characters: selection.characters });
    },

    async createCharacter(request) {
      const created = await api.createCharacter(request, callOptions);
      // Re-read the roster through the SAME reference call login uses rather
      // than splicing a row in locally: the new pilot's name, ship, corp and SP
      // then come from the server's own view of what it just made, and a create
      // that somehow produced nothing shows an unchanged list instead of a
      // phantom character the select would refuse.
      const selection = await getCharacterSelectionData(callOptions);
      store.apply({ type: "character/list", characters: selection.characters });
      return created;
    },

    async selectCharacter(characterID) {
      if (sessionClosing) throw new Error("This pilot session is being released.");
      // A refused switch leaves the previous pilot held. Keep its recovery
      // proof and live state until the server actually selects the new one.
      const result = await api.selectCharacter(characterID, callOptions);
      // accountsvc.ProcessSessionChange: another character, and what the account service kept was the last one's.
      walletReads.forget();
      // skillQueueSvc.ReInitialize: and what the queue service had reckoned of the training slots.
      trainingSlots.forget();
      requestGeneration++;
      recoveryGeneration++;
      recoveryTask = null;
      recoveryIDs.clear();
      confirmedRecoveryIDs.clear();
      recoveryCheckID = null;
      recoverySignal.set({ phase: pilotRecoveryEnabled ? "checking" : "ready", reason: null });
      // A new session numbers its events from the start again.
      pushesTaken.clear();
      store.apply({ type: "character/selected", characterID });
      recoveryCheckID = result.droneRecoveryCheckID;
      store.apply({
        type: "character/online",
        character: result.character,
        station: result.station,
      });
      if (hostedTransportSuspended && scriptRunner?.getStatus() === "paused") {
        if (hostedRecoveryName) store.apply({ type: "custom-bot/started", name: hostedRecoveryName });
        const snapshot = scriptRunner.snapshot();
        store.apply({ type: "custom-bot/progress", status: snapshot.status, phase: snapshot.phase,
          why: snapshot.why, stepPath: snapshot.stepPath, interruptID: snapshot.interruptID,
          pauseReason: snapshot.pauseReason, note: snapshot.note, refusals: snapshot.refusals });
      }
      // Anchor the docked-station sync to where select landed so the first
      // flight read at this station doesn't trigger a redundant relocate; a
      // later dock elsewhere on this session will.
      syncedStationID = result.character.structureID ?? result.character.stationID;
      // R10: the session is live, so open the push channel before the docked
      // reads — anything the reads trigger is then already being observed.
      startLiveStream();
      void retryDroneRecovery();
      void loadCrimewatch().catch(() => {});
      void loadCloneGrade().catch(() => {});
      void loadRedeemTokens().catch(() => {});
      void loadLoginRewards().catch(() => {});
      await refreshStationPanel();
    },

    refreshStationPanel,

    loadInventory,

    async stackContainer(target) {
      await runMutation(() => stackPlaceNow(target));
    },

    async boardShip(shipID) {
      await runMutation(() => boardShipNow(shipID));
      await refreshActiveShipViews();
    },

    async boardCorvette(sure) {
      // The page's own call (bridge/shipWrites.ts), as the client's lobby makes it (station.CreateNewbieShip): the
      // ship, where it is docked and the hull's group are the pilot's flight's, which has them as godma does.
      let declined = false;
      await runMutation(async () => {
        const now = decodeFlightStatus((await api.getFlightStatus(callOptions)).flight);
        declined = !(await boardCorvetteCall(bridgeDo, { shipID: now.shipID, dockedAt: now.stationID ?? now.structureID, groupID: now.shipGroupID ?? null, isCapsule: now.shipIsCapsule }, sure));
        return !declined;
      });
      if (!declined) {
        await refreshActiveShipViews();
      }
    },

    quoteShipRepair,

    async repairShip(quotes) {
      // The page's own call (bridge/repairShop.ts): the station's repair with the quote's cost for its payment,
      // or the structure's, by where the pilot's flight says it is docked now.
      await runMutation(async () => {
        await repairQuoted(bridgeDo, quotes, await dockedIn());
      });
      await refreshActiveShipViews();
    },

    async leaveShip() {
      // The page's own call (bridge/shipWrites.ts), for the ship the pilot is in, as the client's is
      // (station.TryLeaveShip). The panel has that ship once it has loaded; before then the pilot's flight says.
      // The server does nothing with the ship named, but a call that names another, or none, is not the client's.
      await runMutation(async () => {
        const shipID = store.get().inventory.activeShipID
          ?? decodeFlightStatus((await api.getFlightStatus(callOptions)).flight).shipID
          ?? 0;
        await leaveShipCall(bridgeDo, shipID);
      });
      await refreshActiveShipViews();
    },

    // --- R14 inventory depth ---

    toggleSelection(itemID) {
      const selection = store.get().inventory.selection;
      store.apply({
        type: "inventory/selection",
        itemIDs: selection.includes(itemID)
          ? selection.filter((id) => id !== itemID)
          : [...selection, itemID],
      });
    },

    clearSelection() {
      store.apply({ type: "inventory/selection", itemIDs: [] });
    },

    openContainer,
    openShipBays,
    readMiningSupportCapabilities,
    readMiningSupportServices,
    readMiningSupportWork,
    readMiningSupportFleetDiagnostic,
    publishMiningSupportAnchor,
    readMiningSupportFleet,
    readMiningOperationAssignment: () => api.readMiningOperationAssignment(callOptions),
    publishReconciledMiningSupportAnchor,
    readMiningSupportAnchors,
    tickMiningSupportPositioning,

    async lootContainer(containerID) {
      // ⚠ THE SHIP IS ASKED FOR, NOT ASSUMED. Routing needs to know which bays
      // this hull HAS; a read that fails leaves the list empty, which is not
      // "no bays" but behaves like it must — the only destination that is safe
      // to address on an unknown hull is the cargo hold every hull has. The
      // wrong move here is speculating a bay: `resolvePlace` hands out a
      // 0-capacity ore hold for a hull that has none and every transfer to it
      // is refused (see `transferLootedRows`).
      const shipID = store.space.get().snapshot?.ship?.itemID ?? store.inventory.get().activeShipID;
      let bays: readonly ShipBay[] = [];
      if (shipID !== null) {
        try {
          bays = decodeShipBays((await api.getShipBays(shipID, callOptions)).bays);
        } catch {
          bays = [];
        }
      }
      return lootIntoShip(containerID, bays, shipID);
    },

    async transferItems(itemIDs, from, to, qty = null) {
      await runInventoryAction(async () => {
        // Between the hangar, the ship's hold, its bays and a container, the client's own call
        // (bridge/inventoryWrites.ts), judged by the places' rows refreshed, the source's above all: a thing moved can
        // arrive under a new number. A bay is one the page knows the flag of (BAY_FLAGS).
        const pilotsOwn = (place: InventoryPlace): boolean => place.kind === "hangar" || place.kind === "cargo" ||
          place.kind === "container" || (place.kind === "shipBay" && Object.hasOwn(BAY_FLAGS, place.bay)) ||
          place.kind === "corp";
        if (pilotsOwn(from) && pilotsOwn(to)) {
          const present = (rowsAt(from) ?? []).filter((row) => itemIDs.includes(row.itemID));
          if (present.length === 0) {
            throw new Error("Those items are no longer where the panel last saw them; refresh and try again.");
          }
          const [destination, source] = [await inventoryOfPlace(to), await inventoryOfPlace(from)];
          await moveItemsCall(bridgeDo, destination.inventory, to as MovePlace, source.liesIn, present, qty ?? null);
          await refreshOpenPlaces();
          const sourceAfter = new Map((rowsAt(from) ?? []).map((row) => [row.itemID, row]));
          const left = (row: InventoryItemRow) => {
            const after = sourceAfter.get(row.itemID);
            return !after || after.quantity < row.quantity;
          };
          const moved = present.filter(left).map((row) => row.itemID);
          const declined = present.filter((row) => !left(row)).map((row) => row.itemID);
          return {
            applied: moved.length > 0,
            declinedSilently: moved.length === 0 && declined.length > 0,
            message: describeTransfer({ applied: moved.length > 0, moved, declined }, itemIDs.length, qty ?? null),
          };
        }
        const result = await api.transferItems(itemIDs, from, to, qty ?? null, callOptions);
        return {
          applied: result.applied,
          declinedSilently: result.declinedSilently,
          message: describeTransfer(result, itemIDs.length, qty ?? null),
        };
      });
    },

    async mergeStacks(sourceItemID, destinationItemID, place) {
      await runInventoryAction(async () => {
        // The page's own call (bridge/inventoryWrites.ts), of two stacks the panel shows in one place; in the
        // corporation's hangar on the office's inventory, its things lying in the office. (A route did it until
        // 2026-10-14, POST /api/bridge/inventory/merge.)
        const rows = rowsAt(place);
        const source = rows?.find((row) => row.itemID === sourceItemID);
        const destination = rows?.find((row) => row.itemID === destinationItemID);
        if (!source || !destination) {
          throw new Error("Those stacks are no longer where the panel last saw them; refresh and try again.");
        }
        const where = await inventoryOfPlace(place);
        await mergeStacksCall(bridgeDo, where.inventory, where.liesIn, sourceItemID, destinationItemID, source.quantity);
        await refreshOpenPlaces();
        const after = rowsAt(place)?.find((row) => row.itemID === destinationItemID);
        const merged = after ? after.quantity - destination.quantity : 0;
        return {
          applied: merged > 0,
          declinedSilently: merged <= 0,
          message: merged > 0 ? `Merged ${merged} into the stack.` : "The server did not merge those stacks, and gave no reason.",
        };
      });
    },

    async trashItems(itemIDs, place) {
      await runInventoryAction(async () => {
        // The page's own call on the inventory manager of where the pilot is (bridge/inventoryWrites.ts), naming the
        // place as the client names it, and the verdict by the place's rows refreshed.
        const before = rowsAt(place);
        const present = itemIDs.filter((itemID) => before?.some((row) => row.itemID === itemID));
        if (present.length === 0) {
          throw new Error("Those items are no longer where the panel last saw them; refresh and try again.");
        }
        await trashItemsCall(bridgeDo, present, trashedFrom(place));
        await refreshOpenPlaces();
        const left = new Set((rowsAt(place) ?? []).map((row) => row.itemID));
        const destroyed = present.filter((itemID) => !left.has(itemID)).length;
        const survived = present.length - destroyed;
        let message: string;
        if (destroyed > 0 && survived === 0) {
          message = `Destroyed ${destroyed} ${destroyed === 1 ? "item" : "items"}.`;
        } else if (destroyed > 0) {
          message = `Destroyed ${destroyed}; the server refused to destroy ${survived}, and gave no reason.`;
        } else {
          message = "The server destroyed nothing, and gave no reason.";
        }
        return { applied: destroyed > 0, declinedSilently: survived > 0, message };
      });
    },

    loadCorpHangar,
    loadStationOffices,
    quoteStationOffice,
    rentStationOffice,
    giveUpStationOffice,
    setSafetyLevel,
    loadCorpOffices,

    selectCorpDivision(division) {
      store.apply({ type: "inventory/corp-division", division });
    },

    loadFitting,

    loadDogma,

    // A module fitted and unfitted: the page's own calls on an inventory's own object (bridge/fitModule.ts), as
    // the client's dogma location and its fitting slot make them, judged by the page's own read of the slots.
    async fitModule(itemID, source, slot) {
      await runFittingAction(() => fitModuleCall(bridgeDo, fittedNow, ammoSession(), itemID, source, slot));
    },

    async unfitModule(itemID) {
      await runFittingAction(() => unfitModuleCall(bridgeDo, fittedNow, ammoSession(), itemID));
    },

    async setModuleOnline(itemID, online) {
      // ⚠ NOT runFittingAction. That helper decides "declined" from the api
      // verb's `applied` flag, and setModuleOnline returns VOID — so its check
      // was dead code and an online/offline toggle that quietly did nothing
      // reported success. The online state IS in the re-read, so use it.
      const wasOnline = moduleOnlineState(itemID);
      try {
        // The page's own call (bridge/dogmaWrites.ts), as a fitting slot of the client's makes it: the ship the
        // module is in, which is the ship this fitting is of, and the module.
        const shipID = store.fitting.get().activeShipID;
        if (shipID === null) throw new Error("The ship that module is fitted to is not known yet. Reload the fitting and try again.");
        await setModuleOnlineCall(bridgeDo, shipID, itemID, online);
      } catch (error) {
        if (isSessionLost(error)) {
          stopLiveStream();
          store.apply({ type: "character/offline" });
          throw error;
        }
        store.apply({ type: "fitting/action-error", message: errorWords(error) });
        return;
      }
      await loadFitting();
      const nowOnline = moduleOnlineState(itemID);
      // Unknown either side is not a decline — only a module we could read
      // before AND after, that did not move, earns the message.
      if (wasOnline !== null && nowOnline !== null && nowOnline !== online) {
        store.apply({
          type: "fitting/action-error",
          message: online
            ? "The server accepted that and the module is still offline, and gave no reason."
            : "The server accepted that and the module is still online, and gave no reason.",
        });
      }
    },

    async loadAmmo(moduleIDs, chargeItemIDs, source) {
      return runAmmoAction(
        moduleIDs,
        () => loadAmmoFrom(moduleIDs, chargeItemIDs, source),
        // Nothing about what the module holds changed, so nothing was loaded —
        // unless the server queued it: in space the charges land after the
        // module's reload time, and its announcement is the proof.
        (before, after, reloadAnnounced) => before === after && !reloadAnnounced,
        "The server accepted that and loaded nothing, and gave no reason. " +
          "A module only takes certain kinds of charge.",
      );
    },

    async unloadAmmo(moduleIDs, destination) {
      return runAmmoAction(
        moduleIDs,
        async () => unloadAmmoCall(bridgeDo, ammoSession(), moduleIDs, destination),
        // An unload that worked leaves the modules empty.
        (_before, after) => after !== "",
        "The server accepted that and the ammunition is still loaded, and gave no reason.",
      );
    },

    async destroyRig(itemID) {
      // The page's own call on the ship's own inventory (bridge/fitModule.ts: fittingSlotController.Unfit of a rig),
      // judged by the page's own read of the slots. Until 2026-10-14 the BFF's route made it.
      await runFittingAction(() => destroyRigCall(bridgeDo, fittedNow, ammoSession(), itemID));
    },

    loadIndustry,

    // The window's job, as the client's makes and shows it: its time, its materials and what it costs to start are
    // the page's own reckoning (reckonedHere), each null where an input was not had; its runs held to the most it
    // can have, so that no job of more is sent (job.py 395); its places the facility's for the pilot
    // (GetFacilityLocations, kept a minute by the client); its monitor connected once for the job (ConnectJob,
    // industrySvc.py 305 to 307), and what its place has as the monitor answered, or as the server has said since
    // (OnIndustryMaterials, 324). Until 2026-10-14 the BFF's preview route made the job and its monitor.
    async previewIndustryJob(request) {
      const { characterID, own, dump } = await windowsJob(request);
      const as = monitoredAs(dump);
      const kept = industryWindowJob !== null && industryWindowJob !== "installed"
        && industryWindowJob.characterID === characterID && industryWindowJob.monitoredAs === as ? industryWindowJob : null;
      const monitored = kept ? kept.monitored : await connectJob(bridgeDo, dump);
      if (!kept) industryWindowJob = { characterID, monitoredAs: as, blueprintItemID: request.blueprintItemID, monitored };
      // What the server has said of the monitored job's place since its monitor answered.
      const said = store.get().industry.materialsSaid;
      const available = kept && said !== null && said.monitorID === monitored.monitorID ? said.available : monitored.available;
      // (An invention's empty optional place is nothing taken, and is not listed.)
      const listed = own?.materials ? Object.fromEntries(Object.entries(own.materials).filter(([name]) => name !== NO_OPTIONAL_MATERIAL)) : null;
      return { available, timeSeconds: own?.timeSeconds ?? null, fee: own?.fee ?? null, materials: listed, monitorID: monitored.monitorID };
    },

    async loadDecryptors() {
      const terms = decodeInventionTerms(await api.getIndustryInventionTerms(callOptions));
      // A decryptor is listed in the preview with the other materials, by name.
      requestNames([...terms.decryptors.keys()].map((id) => ({ kind: "type" as const, id })));
      return [...terms.decryptors.values()];
    },

    // The window's Start (submitButton.py 221): industrySvc.InstallJob(job), InstallJob(job.dump()) (139 to 144), the
    // job made as the preview makes it. Until 2026-10-14 the BFF's install route made it.
    async installIndustryJob(request) {
      await runIndustryAction(async () => {
        const { characterID, dump } = await windowsJob(request);
        let jobID: number | null;
        try {
          jobID = await installJob(bridgeDo, dump);
        } catch (error) {
          // (142 to 144: a job the server refused, a UserError, has its facility asked for afresh, and the refusal
          // stands. Nothing else lets it go: a call that failed on its way is no refusal.)
          if (error instanceof BridgeCallError && error.code === "CALL_REFUSED") jobReckonerFor(characterID).facilityReloaded();
          throw error;
        }
        // A job the server took: the window has the server's job of it from now on, which is not the one monitored.
        if (jobID !== null && industryWindowJob !== null && industryWindowJob !== "installed" && industryWindowJob.blueprintItemID === request.blueprintItemID) {
          industryWindowJob = "installed";
        }
        return { applied: jobID !== null };
      });
    },

    // industryWnd.Close (107 to 108): industrySvc.DisconnectJob(self.jobData) (311 to 313), which lets the monitor go
    // where the window's job is the one monitored, sends None where the window has no job, and sends nothing for a
    // job that was installed. The window has no job after.
    async industryWindowClosed() {
      const job = industryWindowJob;
      industryWindowJob = null;
      if (job === "installed") return;
      // The window is gone whether or not this is heard: there is nobody to tell of a failure.
      await disconnectJob(bridgeDo, job ? job.monitored.monitorID : null).catch(() => {});
    },

    // The window's job let go while the window stays (industryWnd.OnIndustryRemoveBlueprint: self.jobData = None):
    // the service's hold on the one monitored is a weak one, and nothing is sent. The next job is made anew.
    async industryJobLetGo() {
      industryWindowJob = null;
    },

    // The page's own calls (bridge/industryWrites.ts), each judged by the job the server answers.
    async deliverIndustryJob(jobID) {
      await runIndustryAction(() => deliverIndustryJobCall(bridgeDo, jobAsRead(jobID)));
    },

    async cancelIndustryJob(jobID) {
      await runIndustryAction(() => cancelIndustryJobCall(bridgeDo, jobAsRead(jobID)));
    },
    loadMarket,
    findMarketTypes: (q: string) => api.findMarketTypes(q, callOptions),
    listOreFamilies: () => api.listOreFamilies(callOptions),
    loadMarketGroups: (parentGroupID: number) => api.loadMarketGroups(parentGroupID, callOptions),
    loadMarketGroupTypes: (marketGroupID: number) =>
      api.loadMarketGroupTypes(marketGroupID, callOptions),
    async placeMarketOrder(request) {
      // Buying names a TYPE; selling names a specific STACK. Two different
      // retail calls, each the page's own (bridge/marketOrderWrites.ts), with the
      // wallet read before and after for the verdict, at the station docked in.
      if (request.side === "sell") {
        const itemID = request.itemID ?? 0;
        await runMarketAction("sell", async () => {
          const stationID = marketPlaceNow();
          return {
            ...await placeSellOrderCall(bridgeDo, bridgeAsk, {
              stationID,
              itemID,
              typeID: request.typeID,
              price: request.price,
              quantity: request.quantity,
              durationDays: request.durationDays,
              brokersFeeRate: feeRateShownAt(stationID),
            }),
            ownOrders: null,
          };
        });
        return;
      }
      await runMarketAction("buy", async () => {
        const stationID = marketPlaceNow();
        return {
          ...await placeBuyOrderCall(bridgeDo, bridgeAsk, {
            stationID,
            typeID: request.typeID,
            price: request.price,
            quantity: request.quantity,
            durationDays: request.durationDays,
            brokersFeeRate: feeRateShownAt(stationID),
          }),
          ownOrders: null,
        };
      });
    },
    async cancelMarketOrder(orderID) {
      // The page's own call (bridge/marketOrderWrites.ts), as the client's menu makes it, with the pilot's orders
      // and wallet read before and after for the verdict. The market is read again after any change, as before.
      await runMarketAction("cancel", async () => ({ ...await cancelOrderCall(bridgeDo, bridgeAsk, orderID), ownOrders: null }));
    },
    async modifyMarketOrder(orderID, price) {
      // The page's own call, all but the new price off the order's own row in the pilot's orders, as the client's
      // modify window makes it (bridge/marketOrderWrites.ts).
      await runMarketAction("modify", async () => ({ ...await modifyOrderCall(bridgeDo, bridgeAsk, orderID, price), ownOrders: null }));
    },
    loadActivity,
    loadScanner,
    launchScannerProbes,
    analyzeScannerSignatures,
    recoverScannerProbes,
    reconnectScannerProbes,
    loadFleet,
    formFleet,
    inviteFleetMember,
    formFleetWith,
    acceptFleetInvite,
    declineFleetInvite,
    leaveFleet,
    readFleetFinder,
    applyToJoinFleet,
    flyToPoint,
    restartExtractor,
    rerouteExtractor,
    launchCommodities,
    loadMail,
    refreshMail,
    openMail,
    quotedMailBody,
    loadMailLabels,
    loadMailingLists,
    joinMailingList,
    createMailingList,
    leaveMailingList,
    deleteMailingList,
    nameMailingList: mailingListName,
    readMailingListSettings,
    readMailingListMembers,
    setMailingListMembers,
    setMailingListDefaults,
    setMailingListAccess,
    clearMailingListAccess,
    lookupPlayerOwners,
    readMailingListWelcome,
    saveMailingListWelcome,
    clearMailingListWelcome,
    welcomeToAll,
    keepWelcomeToAll,
    mailSort,
    keepMailSort,
    markMail,
    trashMail,
    restoreMail,
    deleteMail,
    readAllMail,
    trashAllMail,
    readListMail,
    trashListMail,
    restoreAllMail,
    emptyMailTrash,
    createMailLabel,
    renameMailLabel,
    deleteMailLabel,
    assignMailLabel,
    removeMailLabel,
    closeMail,
    findCharacters: (q: string) => api.findCharacters(q, callOptions),
    searchCharacters,
    ownCorporation,
    ownAlliance,
    ownersSearchBy,
    keepOwnersSearchBy,
    mailContacts,
    addressBook,
    primeContactsOnline,
    addOrEditContact,
    deleteContacts,
    blockOwners,
    unblockOwners,
    editContactsRelationship,
    createContactLabel,
    renameContactLabel,
    deleteContactLabel,
    labelContacts,
    contactsLastSelected,
    onlineBuddyOnly,
    keepOnlineBuddyOnly,
    keepContactsLastSelected,
    agentFolders,
    keepAgentFolders,
    contactsSearchSettings,
    keepContactsSearchSettings,
    searchOwners,
    addAgentToAddressBook,
    contactNotifications,
    deleteNotifications,
    notificationsOfGroup,
    markNotificationsRead,
    markNotificationGroupRead,
    markAllNotificationsRead,
    deleteNotificationGroup,
    deleteAllNotifications,
    notificationGroupShown,
    keepNotificationGroupShown,
    dialogYesKept,
    keepDialogYes,
    notificationFormats,
    addressBookTab,
    keepAddressBookTab,
    sendMail,
    loadContracts,
    openContract,
    closeContract,
    acceptContract,
    loadPersonalAssets,
    openAssetStation,
    setDestinationToAssetStation,

    loadAgents,

    openConversation: (agentID) => talkToAgent(agentID),

    async answerQuestion(questionID, answer) {
      try {
        await api.answerClientQuestion(questionID, answer, callOptions);
      } catch (cause) {
        // Already closed (answered elsewhere, or out of time): there is nothing left to answer.
        if (!(cause instanceof BridgeCallError && cause.status === 404)) {
          throw cause;
        }
      }
      store.apply({ type: "live/question-closed", id: questionID });
    },

    async chooseAction(agentID, action) {
      await interactWithAgent(agentID, async () => {
        const decoded = await agentSays(agentID, action.actionID);
        if (decoded === null) {
          return;
        }
        // The briefing and the objectives are read again for this layout, as for every one, and shown
        // by the client's rule (layOutConversation). Completing a mission pays out: pull the Step-12
        // reward reads (wallet / LP / standings). The journal always refreshes so the
        // offered/accepted/cleared state stays truthful.
        await layOutConversation(agentID, decoded);
        //
        // ⚠ PRESSING COMPLETE IS NOT COMPLETING. agentMgr.DoAction answers 200
        // with a conversation on EVERY branch, refusals included. Measured live
        // (R35, agent 3008416, Complete pressed docked at the PICKUP station):
        // HTTP 200, ok:true, an EMPTY available-actions list, and
        // lastActionInfo.missionCompleted === null — not false. The mission was
        // still accepted afterwards and not one ISK had moved. So the outcome is
        // read from lastActionInfo, the one field that only
        // buildCompletedConversation sets, and `=== true` is deliberate: null
        // and false are both "it did not complete".
        //
        // Nor can the journal stand in for this: completeMission DELETES the
        // journal row, and quit / decline / expire delete it identically, so a
        // missing row proves nothing. Only this flag does.
        const completed = decoded.lastActionInfo.missionCompleted === true;
        if (
          (action.buttonType === AGENT_BUTTON.COMPLETE || action.buttonType === AGENT_BUTTON.COMPLETE_REMOTELY) &&
          completed
        ) {
          // Only a mission that actually completed pulls the payout reads. A refused Complete leaves the
          // mission exactly as it was, and the layout above has read it again and keeps showing it.
          await loadRewards();
        }
        await loadJournal();
      });
    },

    loadBriefing,

    loadJournal,

    // missionentry.RemoveOffer: the call and nothing else. The server says the offer is gone
    // (OnAgentMissionChange "offer_removed"), and that is what reads the journal again and closes the
    // agent's window if it is open; an offer that was not removed changes nothing.
    async removeOffer(agentID) {
      await runAgentAction(() => removeOfferFromJournal(bridgeDo, agentID));
    },

    openMissionDetails,

    closeMissionDetails() {
      store.apply({ type: "agents/mission-page", page: null });
    },

    loadRewards,

    loadWallet,
    pilotWealth,
    giveMoney,
    loadRedeemTokens,
    redeemHomeStation,
    redeemTokens,
    loadLoginRewards,
    claimLoginReward,
    claimSeasonalReward,

    loadStandings,

    loadStandingDetail,

    closeStandingDetail,

    loadCharacterSheet,
    loadSkillHistory,
    loadEmploymentHistory,

    async loadPackageIntoShip(cargoTypeID, cargoQuantity) {
      await runAgentAction(async () => {
        // Find the accepted courier's package in the station hangar and move it
        // into the active ship's cargo hold.
        //
        // ⚠ THE FIRST STACK OF THE RIGHT TYPE IS NOT THE PACKAGE. Courier cargo
        // is ordinary tradeable goods — the R35 live run hauled Reports (3814),
        // which any player may already be holding. Picking the first row whose
        // typeID matched would load the player's OWN stack, in the wrong
        // quantity, and leave the actual mission package behind.
        //
        // The mission quantity is the discriminator we actually have: accept
        // stages exactly the mission's quantity as its own stack. So prefer the
        // stack of that exact size, and otherwise take one large enough and
        // split precisely the mission quantity off it. (The server never names
        // the package's itemID anywhere the client can read — not in the
        // objective, not in the journal, not in the OnMissionsUpdated refusal —
        // so a player stack of the identical type AND quantity stays genuinely
        // ambiguous. Nothing available to the browser can resolve that.)
        const wanted = Number.isFinite(cargoQuantity) && cargoQuantity > 0 ? cargoQuantity : 1;
        const panel = await api.loadInventory(callOptions);
        const candidates = decodeInventoryRows(panel.hangar.list).filter(
          (row) => row.typeID === cargoTypeID,
        );
        const item =
          candidates.find((row) => row.quantity === wanted) ??
          candidates.find((row) => row.quantity > wanted);
        if (!item) {
          // runAgentAction's success path clears the action-error, so signal the
          // miss by throwing — its catch surfaces the reason through the store.
          throw new Error(
            `The mission package is not in the station hangar (${wanted} needed).`,
          );
        }

        // ⚠ AND A 200 IS NOT A LOADED PACKAGE. /api/bridge/inventory/move
        // answers {ok:true} without ever re-reading, so it cannot tell a move
        // from a silent decline — and invbroker declines silently in several
        // branches. /transfer does the re-read and judges by the SOURCE giving
        // something up (the R29 new-itemID lesson: a split keeps the source id
        // and shrinks it, so destination membership alone reports a completed
        // move as a failure). Ask it, then believe what it answers.
        const outcome = await api.transferItems(
          [item.itemID],
          { kind: "hangar" },
          { kind: "cargo" },
          wanted,
          callOptions,
        );
        if (!outcome.applied) {
          throw new Error(
            outcome.declinedSilently
              ? "The station refused to load the mission package and gave no reason. It did not move."
              : "The mission package did not move into the ship.",
          );
        }
      });
    },

    async setAutopilotToDropoff(dropoffStationID) {
      // Reuse the R5b route solver + browser autopilot: startRoute resolves the
      // dropoff station -> its solar system and runs the decide-loop.
      await startRoute(dropoffStationID);
    },

    loadFlightStatus,

    async undock() {
      // The retail client's _DoUndockAttempt (ui/station/base.py 488): undock
      // with the contraband warning armed; if the server answers with the
      // warning, ask, and on OK undock again ignoring it. On Cancel the ship
      // stays docked and nothing is reported as having failed.
      // The page's own call (bridge/placeChanges.ts), under the BFF's keeping of the session change.
      requireAutomationReady();
      let first: Promise<FlightStepResult> | null = orderedStep((flightNow) => undockCall(bridgeDo, flightNow, false));
      try {
        await first;
      } catch (error) {
        if (api.isContrabandWarning(error)) {
          // The message is the dialog's own sentence, question and all (src/server.js).
          if (!(await askUser(error.message))) {
            return;
          }
          first = null;
        }
        // Any other refusal is reported by runFlightStep below, from the same promise.
      }
      await runFlightStep("Undock", () => first ?? orderedStep((flightNow) => undockCall(bridgeDo, flightNow, true)));
    },

    async warpTo(destinationID, minRange = null) {
      // The page's own calls (bridge/movementWrites.ts): the autopilot's with no range said, the menu's with one.
      await runFlightStep("Warp", () => orderedStep((flightNow) => (
        minRange === null ? autopilotWarpCall(bridgeDo, flightNow, destinationID) : warpToItemCall(bridgeDo, flightNow, destinationID, minRange))));
    },

    async approach(destinationID, range = null) {
      await runFlightStep("Approach", () => orderedStep((flightNow) => approachCall(bridgeDo, flightNow, destinationID, range)));
    },

    async keepAtRange(targetID, range = null) {
      await runFlightStep("Keep at range", () => orderedStep((flightNow) => keepAtRangeCall(bridgeDo, flightNow, targetID, range)));
    },

    async orbit(targetID, range = null) {
      await runFlightStep("Orbit", () => orderedStep((flightNow) => orbitCall(bridgeDo, flightNow, targetID, range)));
    },

    async alignTo(targetID) {
      await runFlightStep("Align", () => orderedStep((flightNow) => alignToCall(bridgeDo, flightNow, targetID)));
    },

    async stopShip() {
      // Retail's Stop cancels the client-side navigation BEFORE the command and
      // switches the autopilot off after it. Ours is the same order: abort the
      // browser decide-loop first so it cannot issue another move into the stop,
      // then tell the server to cut the engines.
      autopilot?.abort();
      await runFlightStep("Stop", () => orderedStep((flightNow) => stopShipCall(bridgeDo, flightNow)));
    },

    loadSpaceSnapshot,
    loadTargets,
    lockTarget,
    unlockTarget,
    activateModule,
    deactivateModule,
    setModuleOverload,
    repairModule,
    setWeaponBanks,
    loadMiningHolds,
    loadMiningWindow,
    loadDrones,
    launchDrones,
    engageDrones,
    mineWithDrones,
    salvageDrones,
    recallDrones,
    reconnectDrones,
    scoopDrones,
    runGmCommand,
    runSurveyScan,
    loadReprocessingQuote,
    unloadMiningHolds,
    reprocessItems,
    jettisonItems,
    compressOre,
    compressedTypesOf,
    loadSkills,
    loadPlanets,
    selectColony,
    saveSkillQueue,
    pauseSkillTraining,
    applyFreeSkillPoints,

    startSpacePolling,

    stopSpacePolling,

    async jump(fromGateID, toGateID) {
      await runFlightStep("Jump", () => jumpStep(fromGateID, toGateID));
    },
    jumpThrough,

    // R30 slice A. A pure read over the cached graph — it issues no game call
    // and starts nothing, so a panel may ask for it on every system change.
    async nearbyGates(systemID) {
      if (!(systemID > 0)) {
        return [];
      }
      return buildGateLinks(await loadRouteGraph(), systemID);
    },

    async dock(stationID) {
      await runFlightStep("Dock", () => dockStep(stationID));
      // Docking lands a beat later than the command returns; keep reading until
      // the store sees "docked" so the UI switches back to the station shell.
      await settleUntilDocked();
    },
    dockAt,

    findAgents,

    setDestinationToAgent,

    startRoute,

    searchDestinations,

    startFleetCompanion,
    pauseFleetCompanion,
    resumeFleetCompanion,
    stopFleetCompanion,
    startMiningBot,

    pauseMiningBot() {
      miningBot?.pause();
    },

    resumeMiningBot() {
      requireAutomationReady();
      if (miningBot) {
        miningBot.resume();
        void miningBot.run();
      }
    },

    stopMiningBot() {
      stopMiningController();
    },

    startMissionBot,

    pauseMissionBot() {
      missionBot?.pause();
    },

    resumeMissionBot() {
      requireAutomationReady();
      if (missionBot) {
        missionBot.resume();
        void missionBot.run();
      }
    },

    stopMissionBot() {
      stopMissionController();
    },

    startCustomBot,

    pauseCustomBot() {
      scriptRunner?.pause();
    },

    resumeCustomBot() {
      requireAutomationReady();
      if (hostedStopPending) return;
      if (scriptRunner) {
        scriptRunner.resume();
        void scriptRunner.run();
      }
    },

    stopCustomBot() {
      if (scriptRunner?.combatDronesForStop?.() !== null && scriptRunner?.combatDronesForStop?.() !== undefined) {
        void prepareHostedBotStop("script", Date.now() + 180_000).then(stopCustomController).catch(error => {
          store.apply({ type: "custom-bot/start-error", message: `Stop retains pilot control: ${String(error)}` });
        });
        return;
      }
      stopCustomController();
    },

    prepareHostedBotStop,
    suspendHostedSession,
    verifyHostedSessionRecovery,
    resumeHostedSession,
    prepareCustomBotParking,
    parkCustomBot,
    cancelHostedHome,

    headCustomBotHome(reason) {
      if (!scriptRunner) return false;
      if (scriptRunner.resumeHeadHome(reason)) {
        void scriptRunner.run();
        return true;
      }
      return scriptRunner.headHome(reason);
    },

    panicRecallAndDock,

    async listSavedFittings() {
      const library = await loadRefitLibrary();
      // The picker heads each fit with its hull, since fit names often omit it.
      // Hull names are static data; a failed lookup leaves the type id showing.
      const hulls = [...new Set(library.map((f) => f.shipTypeID))].map((id) => ({ kind: "type" as const, id }));
      const names = await api.resolveNames(hulls, callOptions).then((r) => r.names).catch(() => ({}) as Record<string, string | null>);
      return library.map((f) => ({ ...f, shipName: names[nameKey("type", f.shipTypeID)] ?? null }));
    },

    async listBookmarks() {
      const active = await readMyActiveBookmarks(bridgeAsk);
      return active.bookmarks
        .filter((bm) => bm.memo.length > 0)
        .map((bm) => ({ bookmarkID: bm.bookmarkID, name: bm.memo }));
    },

    async listBookmarkFolders() {
      const [active, administered] = await Promise.all([readMyActiveBookmarks(bridgeAsk), readFoldersWithAdminAccess(bridgeAsk)]);
      const byID = new Map<number, string>();
      for (const folder of [...active.folders, ...administered]) byID.set(folder.folderID, folder.folderName);
      return [...byID].map(([folderID, name]) => ({ folderID, name })).sort((a, b) => a.name.localeCompare(b.name) || a.folderID - b.folderID);
    },

    pauseRoute() {
      autopilot?.pause();
    },

    resumeRoute() {
      requireAutomationReady();
      if (autopilot) {
        autopilot.resume();
        void autopilot.run();
      }
    },

    abortRoute() {
      autopilot?.abort();
    },

    loadChat,

    sendChatMessage,

    setChatChannel(channel) {
      store.apply({ type: "chat/active", channel });
    },

    requestNames,
    requestWords,
    requestMissionKeywords,
    requestAgentRecord,
    requestAgentSolarSystem,
    requestSystemSecurity,
    requestAutopilotJumps,
    autopilotSettings,
    setAutopilotRouteType: (routeType) => changeAutopilotSettings((stored) => withRouteType(stored, routeType)),
    setAutopilotPenalty: (penalty) => changeAutopilotSettings((stored) => withPenalty(stored, penalty)),
    clickAutopilotAvoidSystems: () => changeAutopilotSettings(withAvoidSystemsClicked),

    /**
     * R92 multibox — is this the pilot the player is LOOKING at?
     *
     * ⚠ A BACKGROUND PILOT IS STILL WORKING, AND THAT IS THE POINT OF MULTIBOX.
     * Its flow outlives the panel: switch away from a mining pilot and its bot
     * loop keeps ticking every two seconds, which is exactly what was asked for.
     * But the browser's ~6 connections per origin do not multiply with the
     * roster, so a four-pilot tab has four loops drawing on one budget, and the
     * requests that lose are whichever happen to arrive last — usually the click
     * that was just made, because that is the one a person is waiting on.
     *
     * So a background pilot's calls drop to "poll": they still run, they still
     * retry, they simply yield to the pilot on screen. Explicitly separate from
     * `setLivePush` even though App.svelte drives both from the same condition —
     * one is about holding an EventSource, the other about who wins a lane, and
     * a later change to either should not silently move the other.
     */
    setForeground(active) {
      callOptions.priority = foregroundCallPriority(active);
    },

    setLivePush(enabled) {
      if (enabled === livePushEnabled) {
        return;
      }
      livePushEnabled = enabled;
      if (!enabled) {
        stopLiveStream();
        return;
      }
      // Becoming the active pilot with a character online: attach now. The
      // server replays from its cursor when it can; the flow's own
      // snapshot/resync handling covers the gap when it cannot.
      if (store.station.get().online !== null) {
        startLiveStream();
      }
    },

    async releaseSession() {
      requireAutomationReady();
      beginSessionClose();
      try {
        await api.releaseSession(callOptions);
        requestGeneration++;
        recoveryGeneration++;
        recoveryTask = null;
        recoveryIDs.clear();
        confirmedRecoveryIDs.clear();
        recoveryCheckID = null;
        recoverySignal.set({ phase: "checking", reason: null });
        syncedStationID = null;
        stopLiveStream();
        store.apply({ type: "character/offline" });
        store.apply({ type: "character/selected", characterID: null });
      } finally {
        sessionClosing = false;
      }
    },

    async logout() {
      // The server may refuse logout while recovery is pending. In that case
      // the held pilot, recovery check and push stream must stay usable.
      beginSessionClose();
      try {
        // An unopened onboarding slot has no login to release. In particular it
        // must never ask the server to clear the cookie belonging to another slot.
        if (!(options.perSessionToken && callOptions.token === null)) await api.logout(callOptions);
        requestGeneration++;
        recoveryGeneration++;
        recoveryTask = null;
        recoveryIDs.clear();
        confirmedRecoveryIDs.clear();
        recoveryCheckID = null;
        recoverySignal.set({ phase: "checking", reason: null });
        stopLiveStream();
        // R107 — releaseSession keeps its token; a completed logout does not.
        if (options.perSessionToken) callOptions.token = null;
        syncedStationID = null;
        store.apply({ type: "session/logged-out" });
      } finally {
        sessionClosing = false;
      }
    },
  };
}
