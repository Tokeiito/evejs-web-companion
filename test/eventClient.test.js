"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const eventClient = require("../public/eventClient");

const SOURCE = "evejs-web-gateway";

function offlineControl() {
  return {
    online: false,
    controlState: "offline",
    transport: null,
    leaseExpiresAt: null,
  };
}

function browserControl(leaseExpiresAt = "2026-07-15T12:00:00.000Z") {
  return {
    online: true,
    controlState: "browser_pilot",
    transport: "web",
    leaseExpiresAt,
  };
}

function outcome(overrides = {}) {
  return {
    commandID: "command-1",
    commandType: "offline.skill_queue.save",
    success: true,
    errorCode: null,
    admissionStatus: "admitted",
    stateVersion: "state-a:1",
    ...overrides,
  };
}

function snapshot(characterID, epoch, sequence, commandOutcomes = []) {
  return {
    source: SOURCE,
    apiVersion: 1,
    streamVersion: 1,
    type: "snapshot",
    characterID,
    cursor: { epoch, sequence },
    control: offlineControl(),
    stateVersion: `state:${sequence}`,
    commandOutcomes,
  };
}

function eventFrame(characterID, epoch, sequence, event) {
  return {
    source: SOURCE,
    apiVersion: 1,
    streamVersion: 1,
    type: "event",
    characterID,
    cursor: { epoch, sequence },
    event,
  };
}

function settlementEvent(overrides = {}) {
  return {
    kind: "command_settled",
    ...outcome(overrides),
  };
}

function controlEvent(stateVersion = "state-a:2") {
  return {
    kind: "control_changed",
    control: offlineControl(),
    stateVersion,
  };
}

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closeCalls = [];
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  emit(type, value = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) {
      listener(value);
    }
  }

  message(value) {
    this.emit("message", {
      data: typeof value === "string" ? value : JSON.stringify(value),
    });
  }

  close(code, reason) {
    this.closeCalls.push({ code, reason });
  }

  listenerCount() {
    return [...this.listeners.values()]
      .reduce((total, listeners) => total + listeners.size, 0);
  }

  static reset() {
    FakeWebSocket.instances = [];
  }
}

function fakeTimers() {
  let nextID = 1;
  const pending = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextID;
      nextID += 1;
      pending.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    get delays() {
      return [...pending.values()].map((entry) => entry.delay);
    },
    get size() {
      return pending.size;
    },
    runNext() {
      const entry = pending.entries().next().value;
      assert.ok(entry, "expected a pending timer");
      const [id, timer] = entry;
      pending.delete(id);
      timer.callback();
    },
  };
}

function createClient(options = {}) {
  return eventClient.createCharacterEventClient({
    WebSocketImpl: FakeWebSocket,
    location: { href: "https://companion.example/app" },
    ...options,
  });
}

test.beforeEach(() => FakeWebSocket.reset());

test("the parser enforces the exact versioned snapshot and event schemas", () => {
  const parsedSnapshot = eventClient.parseCharacterEventFrame(
    JSON.stringify(snapshot(7, "epoch_A", 0, [outcome()])),
    7,
  );
  assert.equal(parsedSnapshot.type, "snapshot");
  assert.deepEqual(parsedSnapshot.cursor, { epoch: "epoch_A", sequence: 0 });
  assert.equal(Object.isFrozen(parsedSnapshot), true);
  assert.equal(Object.isFrozen(parsedSnapshot.commandOutcomes), true);

  const parsedSettlement = eventClient.parseCharacterEventFrame(
    JSON.stringify(eventFrame(7, "epoch_A", 1, settlementEvent())),
    7,
  );
  assert.equal(parsedSettlement.event.kind, "command_settled");

  const parsedControl = eventClient.parseCharacterEventFrame(
    JSON.stringify(eventFrame(7, "epoch_A", 2, controlEvent())),
    7,
  );
  assert.equal(parsedControl.event.kind, "control_changed");
  const repeatedOutcomes = eventClient.parseCharacterEventFrame(
    JSON.stringify(snapshot(7, "epoch_A", 2, [outcome(), outcome()])),
    7,
  );
  assert.equal(repeatedOutcomes.commandOutcomes.length, 2);
  const browserSnapshot = snapshot(7, "epoch_A", 2);
  browserSnapshot.control = browserControl();
  assert.equal(
    eventClient.parseCharacterEventFrame(JSON.stringify(browserSnapshot), 7).control.controlState,
    "browser_pilot",
  );

  const malformed = [
    { ...snapshot(7, "epoch_A", 0), source: "evejs" },
    { ...snapshot(7, "epoch_A", 0), apiVersion: "1" },
    { ...snapshot(7, "epoch_A", 0), streamVersion: 2 },
    { ...snapshot(7, "epoch_A", 0), characterID: "7" },
    { ...snapshot(7, "bad epoch", 0) },
    { ...snapshot(7, "epoch_A", 0), unexpected: true },
    snapshot(7, "epoch_A", 0, [{ ...outcome(), hidden: true }]),
    snapshot(7, "epoch_A", 0, [outcome({ success: false, errorCode: null })]),
    snapshot(7, "epoch_A", 0, [outcome({ success: false, errorCode: "bad-code" })]),
    snapshot(7, "epoch_A", 0, [outcome({ admissionStatus: "rejected" })]),
    snapshot(7, "epoch_A", 0, Array.from({ length: 65 }, (_, index) => outcome({
      commandID: `command-${index}`,
    }))),
    eventFrame(7, "epoch_A", 1, { ...settlementEvent(), rawError: "secret" }),
    eventFrame(7, "epoch_A", 1, { ...controlEvent(), control: { ...offlineControl(), online: true } }),
    eventFrame(7, "epoch_A", 1, {
      ...controlEvent(),
      control: browserControl("2026-07-15T08:00:00-04:00"),
    }),
  ];
  for (const value of malformed) {
    assert.throws(
      () => eventClient.parseCharacterEventFrame(JSON.stringify(value), 7),
      (error) => error.code === "CHARACTER_EVENT_PROTOCOL_INVALID",
    );
  }
  assert.throws(
    () => eventClient.parseCharacterEventFrame(JSON.stringify(snapshot(8, "epoch_A", 0)), 7),
    /envelope/i,
  );
  assert.throws(
    () => eventClient.parseCharacterEventFrame("x".repeat(64 * 1024 + 1), 7),
    /size/i,
  );
});

test("cursor persistence stores only the safe epoch and sequence for each identity pair", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  const first = eventClient.createCursorStore(storage);
  first.set(4, 7, { epoch: "epoch_A", sequence: 12 });
  assert.equal(values.size, 1);
  assert.deepEqual(JSON.parse([...values.values()][0]), {
    epoch: "epoch_A",
    sequence: 12,
  });

  const second = eventClient.createCursorStore(storage);
  assert.deepEqual(second.get(4, 7), { epoch: "epoch_A", sequence: 12 });
  assert.equal(second.get(4, 8), null);

  values.set("evejs-web:event-cursor:4:8", JSON.stringify({
    epoch: "epoch_A",
    sequence: 13,
    unexpected: true,
  }));
  assert.equal(second.get(4, 8), null);
  assert.equal(values.has("evejs-web:event-cursor:4:8"), false);
});

test("cursors are isolated per account and character and resume with only epoch and sequence", () => {
  const snapshots = [];
  const client = createClient({ onSnapshot: (frame) => snapshots.push(frame) });

  client.select({
    accountID: 4,
    characterID: 7,
    authGeneration: 1,
    characterGeneration: 1,
  });
  assert.equal(FakeWebSocket.instances.length, 1);
  let url = new URL(FakeWebSocket.instances[0].url);
  assert.equal(url.protocol, "wss:");
  assert.equal(url.pathname, "/api/characters/7/events");
  assert.equal(url.search, "");
  FakeWebSocket.instances[0].message(snapshot(7, "epoch_A", 3));

  client.select({
    accountID: 4,
    characterID: 8,
    authGeneration: 1,
    characterGeneration: 2,
  });
  url = new URL(FakeWebSocket.instances[1].url);
  assert.equal(url.pathname, "/api/characters/8/events");
  assert.equal(url.search, "");
  FakeWebSocket.instances[1].message(snapshot(8, "epoch_B", 9));

  client.select({
    accountID: 5,
    characterID: 7,
    authGeneration: 2,
    characterGeneration: 3,
  });
  assert.equal(new URL(FakeWebSocket.instances[2].url).search, "");
  FakeWebSocket.instances[2].message(snapshot(7, "epoch_C", 1));

  client.select({
    accountID: 4,
    characterID: 7,
    authGeneration: 3,
    characterGeneration: 4,
  });
  url = new URL(FakeWebSocket.instances[3].url);
  assert.equal(url.searchParams.get("epoch"), "epoch_A");
  assert.equal(url.searchParams.get("sequence"), "3");
  assert.deepEqual(client.getCursor(4, 7), { epoch: "epoch_A", sequence: 3 });
  assert.deepEqual(client.getCursor(4, 8), { epoch: "epoch_B", sequence: 9 });
  assert.deepEqual(client.getCursor(5, 7), { epoch: "epoch_C", sequence: 1 });
  assert.equal(snapshots.length, 3);

  client.dispose();
});

test("duplicates are not applied and malformed or gapped frames force a cursorless snapshot reconnect", () => {
  const timers = fakeTimers();
  const events = [];
  const errors = [];
  const client = createClient({
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    baseReconnectDelayMs: 10,
    maxReconnectDelayMs: 40,
    onEvent: (frame) => events.push(frame),
    onProtocolError: (error) => errors.push(error),
  });
  client.select({ accountID: 4, characterID: 7, authGeneration: 1, characterGeneration: 1 });
  const first = FakeWebSocket.instances[0];
  first.message(snapshot(7, "epoch_A", 2));
  first.message(eventFrame(7, "epoch_A", 3, controlEvent("state:3")));
  first.message(eventFrame(7, "epoch_A", 3, controlEvent("state:3")));
  assert.equal(events.length, 1);
  assert.deepEqual(client.getCursor(4, 7), { epoch: "epoch_A", sequence: 3 });

  first.message(eventFrame(7, "epoch_A", 5, settlementEvent()));
  assert.equal(errors.length, 1);
  assert.deepEqual(client.getCursor(4, 7), { epoch: "epoch_A", sequence: 3 });
  assert.deepEqual(first.closeCalls.map((entry) => entry.code), [1002]);
  assert.deepEqual(timers.delays, [10]);

  timers.runNext();
  const second = FakeWebSocket.instances[1];
  assert.equal(new URL(second.url).search, "");
  second.message(eventFrame(7, "epoch_A", 4, controlEvent("state:4")));
  assert.equal(errors.length, 2);
  assert.deepEqual(client.getCursor(4, 7), { epoch: "epoch_A", sequence: 3 });

  timers.runNext();
  const third = FakeWebSocket.instances[2];
  third.message(snapshot(7, "epoch_A", 5, [outcome()]));
  third.message(eventFrame(7, "epoch_A", 6, settlementEvent({ commandID: "command-2" })));
  assert.deepEqual(client.getCursor(4, 7), { epoch: "epoch_A", sequence: 6 });
  assert.equal(events.length, 2);

  const malformed = eventFrame(7, "epoch_A", 7, controlEvent("state:7"));
  malformed.extra = true;
  third.message(malformed);
  assert.equal(errors.length, 3);
  assert.deepEqual(client.getCursor(4, 7), { epoch: "epoch_A", sequence: 6 });
  client.dispose();
  assert.equal(timers.size, 0);
});

test("a proxy protocol close forces the next reconnect to request a snapshot", () => {
  const timers = fakeTimers();
  const client = createClient({
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    baseReconnectDelayMs: 5,
  });
  client.select({ accountID: 4, characterID: 7, authGeneration: 1, characterGeneration: 1 });
  const first = FakeWebSocket.instances[0];
  first.message(snapshot(7, "epoch_A", 4));
  assert.deepEqual(client.getCursor(4, 7), { epoch: "epoch_A", sequence: 4 });

  first.emit("close", { code: 1002, reason: "Invalid upstream frame" });
  assert.deepEqual(timers.delays, [5]);
  timers.runNext();
  assert.equal(new URL(FakeWebSocket.instances[1].url).search, "");
  client.dispose();
});

test("auth and character generations make callbacks from stale sockets inert", () => {
  let authGeneration = 1;
  let characterGeneration = 1;
  let selectedCharacterID = 7;
  const applied = [];
  const client = createClient({
    isCurrent(selection) {
      return selection.authGeneration === authGeneration &&
        selection.characterGeneration === characterGeneration &&
        selection.characterID === selectedCharacterID;
    },
    onSnapshot(frame) {
      applied.push(frame.characterID);
    },
  });

  client.select({ accountID: 4, characterID: 7, authGeneration, characterGeneration });
  const first = FakeWebSocket.instances[0];
  const staleMessage = [...first.listeners.get("message")][0];

  selectedCharacterID = 8;
  characterGeneration += 1;
  client.select({ accountID: 4, characterID: 8, authGeneration, characterGeneration });
  staleMessage({ data: JSON.stringify(snapshot(7, "epoch_A", 0)) });
  first.message(snapshot(7, "epoch_A", 0));
  assert.deepEqual(applied, []);
  assert.equal(client.getCursor(4, 7), null);

  FakeWebSocket.instances[1].message(snapshot(8, "epoch_B", 0));
  assert.deepEqual(applied, [8]);
  authGeneration += 1;
  FakeWebSocket.instances[1].message(eventFrame(8, "epoch_B", 1, controlEvent()));
  assert.deepEqual(client.getCursor(4, 8), { epoch: "epoch_B", sequence: 0 });

  client.stop();
  assert.equal(FakeWebSocket.instances[1].listenerCount(), 0);
});

test("an authenticated selected stream survives an unrelated initial page failure", async () => {
  const applied = [];
  const client = createClient({
    onSnapshot(frame) {
      applied.push(frame.cursor.sequence);
    },
  });
  client.select({
    accountID: 4,
    characterID: 7,
    authGeneration: 1,
    characterGeneration: 1,
  });
  const socket = FakeWebSocket.instances[0];

  await assert.rejects(
    Promise.reject(new Error("initial page unavailable")),
    /initial page unavailable/,
  );
  assert.equal(socket.closeCalls.length, 0);
  assert.ok(socket.listenerCount() > 0);
  socket.message(snapshot(7, "epoch_A", 0));
  assert.deepEqual(applied, [0]);
  assert.deepEqual(client.getCursor(4, 7), { epoch: "epoch_A", sequence: 0 });
  client.dispose();
});

test("a callback failure does not acknowledge the frame and requests an authoritative snapshot", () => {
  const timers = fakeTimers();
  const errors = [];
  const client = createClient({
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    baseReconnectDelayMs: 5,
    onSnapshot() {
      throw new Error("application failed");
    },
    onProtocolError(error) {
      errors.push(error);
    },
  });
  client.select({ accountID: 4, characterID: 7, authGeneration: 1, characterGeneration: 1 });
  FakeWebSocket.instances[0].message(snapshot(7, "epoch_A", 4));
  assert.equal(client.getCursor(4, 7), null);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /could not be applied/i);

  timers.runNext();
  assert.equal(new URL(FakeWebSocket.instances[1].url).search, "");
  client.dispose();
});

test("reconnect delay is bounded exponential, resets after valid data, and fully cleans up", () => {
  const timers = fakeTimers();
  const client = createClient({
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    baseReconnectDelayMs: 5,
    maxReconnectDelayMs: 20,
  });
  client.select({ accountID: 4, characterID: 7, authGeneration: 1, characterGeneration: 1 });
  const first = FakeWebSocket.instances[0];
  first.emit("close");
  assert.deepEqual(timers.delays, [5]);

  timers.runNext();
  const second = FakeWebSocket.instances[1];
  second.emit("close");
  assert.deepEqual(timers.delays, [10]);
  timers.runNext();
  const third = FakeWebSocket.instances[2];
  third.emit("close");
  assert.deepEqual(timers.delays, [20]);
  timers.runNext();
  const fourth = FakeWebSocket.instances[3];
  fourth.message(snapshot(7, "epoch_A", 0));
  fourth.emit("close");
  assert.deepEqual(timers.delays, [5]);

  client.stop();
  assert.equal(timers.size, 0);
  for (const socket of FakeWebSocket.instances) {
    assert.equal(socket.listenerCount(), 0);
  }
});

test("coalesced tasks collapse bursts and run at most one follow-up after an in-flight refresh", async () => {
  const timers = fakeTimers();
  const runs = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const task = eventClient.createCoalescedTask(async (value) => {
    runs.push(value);
    if (runs.length === 1) {
      await firstGate;
    }
  }, {
    delayMs: 25,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  task.schedule("first");
  task.schedule("second");
  task.schedule("latest-before-run");
  assert.deepEqual(timers.delays, [25]);
  timers.runNext();
  await Promise.resolve();
  assert.deepEqual(runs, ["latest-before-run"]);

  task.schedule("during-1");
  task.schedule("during-latest");
  assert.equal(timers.size, 0);
  releaseFirst();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(timers.delays, [25]);
  timers.runNext();
  await Promise.resolve();
  assert.deepEqual(runs, ["latest-before-run", "during-latest"]);

  task.schedule("cancelled");
  task.cancel();
  assert.equal(timers.size, 0);
  task.dispose();
  assert.equal(task.schedule("ignored"), false);
});
