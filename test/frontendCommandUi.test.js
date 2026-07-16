"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicRoot = path.resolve(__dirname, "..", "public");
const appSource = fs.readFileSync(path.join(publicRoot, "app.js"), "utf8");
const commandSource = fs.readFileSync(path.join(publicRoot, "commandClient.js"), "utf8");
const eventClientSource = fs.readFileSync(path.join(publicRoot, "eventClient.js"), "utf8");
const mutationScopeSource = fs.readFileSync(path.join(publicRoot, "mutationScope.js"), "utf8");
const indexSource = fs.readFileSync(path.join(publicRoot, "index.html"), "utf8");

test("the browser loads the retained command transport before the app", () => {
  const commandIndex = indexSource.indexOf('<script src="/commandClient.js"></script>');
  const mutationScopeIndex = indexSource.indexOf('<script src="/mutationScope.js"></script>');
  const eventClientIndex = indexSource.indexOf('<script src="/eventClient.js"></script>');
  const appIndex = indexSource.indexOf('<script src="/app.js"></script>');
  assert.ok(commandIndex >= 0);
  assert.ok(mutationScopeIndex > commandIndex);
  assert.ok(eventClientIndex > mutationScopeIndex);
  assert.ok(appIndex > eventClientIndex);
});

test("browser command code contains no backend authority or credential fields", () => {
  const browserCommandCode = `${commandSource}\n${mutationScopeSource}\n${eventClientSource}\n${appSource}`;
  for (const forbidden of [
    "controllerID",
    "leaseID",
    "leaseSecret",
    "EVEJS_WEB_GATEWAY_TOKEN",
    "x-evejs-web-token",
  ]) {
    assert.equal(browserCommandCode.includes(forbidden), false);
  }
});

test("the selected character owns one strict generation-guarded event stream", () => {
  assert.match(eventClientSource, /source: "evejs-web-gateway"/);
  assert.match(eventClientSource, /apiVersion: 1/);
  assert.match(eventClientSource, /streamVersion: 1/);
  assert.match(eventClientSource, /searchParams\.set\("epoch", cursor\.epoch\)/);
  assert.match(eventClientSource, /searchParams\.set\("sequence", String\(cursor\.sequence\)\)/);
  assert.match(eventClientSource, /frame\.cursor\.sequence !== previous\.sequence \+ 1/);
  assert.match(eventClientSource, /forceSnapshot = true/);
  assert.match(appSource, /characterGeneration: 0/);
  assert.match(appSource, /isCurrent: isCharacterEventSelectionCurrent/);
  assert.match(appSource, /characterEventClient\.stop\(\)/);
  assert.match(appSource, /characterEventClient\.dispose\(\)/);
});

test("initial page failures stop unauthenticated bootstrap sockets but retain logged-in recovery", () => {
  const loadMeStart = appSource.indexOf("async function loadMe()");
  const loginStart = appSource.indexOf(
    'elements.loginForm.addEventListener("submit"',
    loadMeStart,
  );
  const logoutStart = appSource.indexOf(
    'elements.logoutButton.addEventListener("click"',
    loginStart,
  );
  assert.ok(loadMeStart >= 0 && loginStart > loadMeStart && logoutStart > loginStart);

  const loadMeSource = appSource.slice(loadMeStart, loginStart);
  const loginSource = appSource.slice(loginStart, logoutStart);
  assert.ok(
    loadMeSource.indexOf("await loadPage()") <
      loadMeSource.indexOf("startCharacterEventStream()"),
  );
  assert.ok(
    loginSource.indexOf("startCharacterEventStream()") <
      loginSource.indexOf("await loadPage()"),
  );
  assert.match(
    loadMeSource,
    /catch \(error\)[\s\S]+characterEventClient\.stop\(\);[\s\S]+state\.characterGeneration \+= 1;/,
  );
});

test("event data triggers coalesced page and status reads without applying broad snapshots", () => {
  assert.match(appSource, /createCoalescedTask\(\s*runEventDrivenRefresh/);
  assert.match(
    appSource,
    /async function runEventDrivenRefresh[\s\S]+await loadPage\(\{[\s\S]+preserveSkillDraft/,
  );
  assert.match(
    appSource,
    /handleCharacterEventSnapshot[\s\S]+frame\.commandOutcomes[\s\S]+scheduleEventDrivenRefresh/,
  );
  assert.doesNotMatch(appSource, /state\.data\s*=\s*frame/);
  assert.doesNotMatch(appSource, /state\.characterOnline\s*=\s*frame\.control/);
});

test("settlement events and snapshots reconcile exact skill and PI command IDs", () => {
  assert.match(appSource, /"offline\.skill_queue\.save": "skill-queue"/);
  assert.match(appSource, /"offline\.pi\.extractors\.restart": "pi-restart"/);
  assert.match(
    appSource,
    /reconcileRetainedCommandSettlement\(\s*state\.commandRequests,\s*key,\s*outcome/,
  );
  assert.match(
    appSource,
    /resolveCommandErrorWithSettlement\([\s\S]+record\.authoritativeSettlement[\s\S]+record\.request\.commandID/,
  );
  assert.match(
    appSource,
    /outcome\.success === true[\s\S]+canonicalSkillDraftKey\(state\.skillQueueDraft\)[\s\S]+canonicalSkillDraftKey\(record\.entries\)[\s\S]+state\.skillQueueDirty = false/,
  );
  assert.match(
    appSource,
    /authoritativeSettlement\.success === true[\s\S]+reconcileSuccessfulMutation\("skill-queue", origin\)/,
  );
  assert.match(
    appSource,
    /authoritativeSettlement\.success === true[\s\S]+reconcileSuccessfulMutation\("pi-restart", origin\)/,
  );
});

test("Header Refresh cannot clear a genuinely uncertain retained request", () => {
  const start = appSource.indexOf("async function loadPage(options = {})");
  const end = appSource.indexOf("async function loadMe()", start);
  assert.ok(start >= 0 && end > start);
  const loadPageSource = appSource.slice(start, end);
  assert.equal(loadPageSource.includes("commandRequests.clear"), false);
  assert.match(
    appSource,
    /refreshButton\.addEventListener\("click", \(\) => \{\s*loadPage\(\)/,
  );
});

test("version mismatch reloads current data while explicitly preserving the skill draft", () => {
  assert.match(
    appSource,
    /CHARACTER_STATE_VERSION_MISMATCH[\s\S]+loadPage\(\{ preserveSkillDraft: true \}\)/,
  );
  assert.match(
    appSource,
    /const preserveSkillDraft = page === "skills"[\s\S]+options\.preserveSkillDraft === true[\s\S]+state\.skillQueueDraft = preservedSkillDraft/,
  );
  assert.match(appSource, /your unsaved queue is preserved/i);
});

test("retained command state is cleared across authentication boundaries", () => {
  assert.match(appSource, /function beginAuthBoundary\(\)[\s\S]+state\.authGeneration \+= 1;[\s\S]+state\.commandRequests\.clear\(\)/);
  const boundaries = appSource.match(/beginAuthBoundary\(\)/g) || [];
  assert.ok(boundaries.length >= 4);
});

test("skill and PI completion paths validate DTOs and reconcile captured mutation origins", () => {
  assert.match(
    appSource,
    /captureMutationOrigin\(state, \{\s*expectedPage: "skills",\s*draftProperty: "skillQueueDraft"/,
  );
  assert.match(
    appSource,
    /captureMutationOrigin\(state, \{\s*expectedPage: "pi"/,
  );
  assert.match(appSource, /\/api\/characters\/\$\{origin\.characterID\}\/skills\/queue/);
  assert.match(appSource, /\/api\/characters\/\$\{origin\.characterID\}\/pi\/restart/);
  assert.match(appSource, /validateSuccess: \(candidate\) => mutationScope\.validateMutationDashboardPayload/);
  assert.match(appSource, /expectedStateVersion: record\.request\.expectedStateVersion/);
  assert.match(mutationScopeSource, /dashboard\.stateVersion !== payload\.stateVersion/);
  const classifications = appSource.match(/classifyMutationOrigin\(state, origin\)/g) || [];
  assert.ok(classifications.length >= 6);
  assert.match(appSource, /SAME_VIEW_STALE[\s\S]+reconcileSuccessfulMutation\("skill-queue", origin\)/);
  assert.match(appSource, /SAME_VIEW_STALE[\s\S]+reconcileSuccessfulMutation\("pi-restart", origin\)/);
  const definitiveReconciliations = appSource.match(/shouldReconcileDefinitiveCommandError\(/g) || [];
  assert.ok(definitiveReconciliations.length >= 2);
});

test("command settlement and page loads use identity and generation guards", () => {
  const compareDeletes = appSource.match(/deleteMapEntryIfRecordMatches\(state\.commandRequests, key, record\)/g) || [];
  assert.ok(compareDeletes.length >= 2);
  assert.match(appSource, /const context = mutationScope\.beginViewLoad\(state\)/);
  const loadGuards = appSource.match(/isViewLoadCurrent\(state, context\)/g) || [];
  assert.ok(loadGuards.length >= 3);
});

test("logout keeps login unavailable until the cookie-clearing response settles", () => {
  assert.match(appSource, /loginForm\.addEventListener[\s\S]+if \(state\.authTransitionPending\) \{\s*return;/);
  assert.match(
    appSource,
    /await mutationScope\.runPendingAuthTransition\([\s\S]+setView\("auth-pending"\)[\s\S]+\);[\s\S]+setView\("login"\)/,
  );
});
