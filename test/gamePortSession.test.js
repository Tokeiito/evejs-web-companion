"use strict";

// The game-port session against a conversation with a REAL eve.js server.
//
// test/fixtures/gamePortFrames.json is a recording (scripts/capture-game-frames.js)
// of one whole docked session in both directions: the queue check, the login,
// a character select, an inventory bind and a keep-alive. The server's half is
// what a real server wrote. The client's half is what this session wrote, and
// the real server accepted every frame of it.
//
// Three kinds of test, in this order:
//   1. the recording itself decodes
//   2. the session, replayed against the server's half, sends its half again
//      byte for byte and ends in the same state
//   3. each frame of the client's half says what the retail client says there
//      (docs/game-port-client-reference.md is the list being checked)
// and then behaviour a recording cannot trigger, with frames built here.

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { marshalDecode, marshalDecodeExact, marshalEncode } = require("../src/gameProtocol/marshal");
const { GamePortSession, GamePortError } = require("../src/gamePort/session");
const { TYPE, buildPacket, clientAddress, nodeAddress, parsePacket, text, dictGet } = require("../src/gamePort/packets");
const { caseFold, cryptoHash, passwordHash } = require("../src/gamePort/placebo");
const { converse, recordingSessionOptions } = require("../scripts/capture-game-frames");
const fixture = require("./fixtures/gamePortFrames.json");
const oracle = require("./fixtures/py27Oracle.json");

const frames = fixture.frames.map((frame) => ({ ...frame, bytes: Buffer.from(frame.hex, "hex") }));
const serverFrames = frames.filter((frame) => frame.from === "server");
const clientFrames = frames.filter((frame) => frame.from === "client");
/** How many client frames the login takes: everything up to and including the clock sync. */
const LOGIN_CLIENT_FRAMES = clientFrames.filter((frame) => frame.during === "login").length;

const inflated = (bytes) => (bytes[0] === 0x7e ? bytes : zlib.inflateSync(bytes));
const decoded = (frame) => marshalDecodeExact(inflated(frame.bytes));
const settle = () => new Promise((resolve) => setImmediate(resolve));

// The stock encoder writes an integer beyond 32 bits as an int64, and the stock
// decoder reads an int64 back as a BigInt even when the server had sent the
// same value in the variable-length form that reads as a number. Same integer.
function integersByValue(value) {
  if (typeof value === "number") return Number.isInteger(value) ? BigInt(value) : value;
  if (Array.isArray(value)) return value.map(integersByValue);
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, integersByValue(entry)]));
  }
  return value;
}

/**
 * A transport that plays the recording's server half: each frame once the
 * session has sent as many frames as the real client had when it arrived.
 * `limit` stops the replay after that many client frames, so a test can take
 * over from a known point.
 */
function replayTransport({ limit = Infinity, rewrite = (frame) => frame.bytes } = {}) {
  const transport = { sent: [], closed: false, onClose: null };
  let next = 0;
  let handler = null;
  const flush = () => {
    while (handler && next < serverFrames.length && serverFrames[next].afterClientFrames <= Math.min(transport.sent.length, limit)) {
      const frame = serverFrames[next];
      next += 1;
      handler(rewrite(frame, next - 1));
    }
  };
  Object.defineProperty(transport, "onFrame", {
    get: () => handler,
    set: (value) => {
      handler = value;
      setImmediate(flush);
    },
  });
  transport.send = (payload) => {
    transport.sent.push(Buffer.from(payload));
    setImmediate(flush);
  };
  transport.close = () => { transport.closed = true; };
  /** Hand the session a frame the recording does not hold. */
  transport.deliver = (payload) => handler(payload);
  return transport;
}

/** setTimeout by hand: time moves only when a test says so. */
function manualTime() {
  let now = 0;
  let sequence = 0;
  const pending = new Map();
  return {
    now: () => now,
    timers: {
      setTimeout: (action, delay) => {
        sequence += 1;
        pending.set(sequence, { at: now + delay, action });
        return sequence;
      },
      clearTimeout: (id) => pending.delete(id),
    },
    pending,
    async advance(milliseconds) {
      const target = now + milliseconds;
      for (;;) {
        const due = [...pending.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].action();
        await settle();
        await settle();
      }
      now = target;
    },
  };
}

/** A session that has just finished the recorded login, and its transport. */
async function loggedIn(context, options = {}) {
  const transport = replayTransport({ limit: LOGIN_CLIENT_FRAMES, ...options.replay });
  const session = new GamePortSession({ transport, ...recordingSessionOptions(), ...options.session });
  context.after(() => session.close());
  await session.login(fixture.accountName, "");
  return { session, transport };
}

/** The last call the session sent, read back off the wire. */
function lastCall(transport) {
  const packet = parsePacket(marshalDecodeExact(inflated(transport.sent.at(-1))));
  const [flag, pickle] = packet.body[0];
  const [target, method, args, kwargs] = pickle.value;
  return { packet, flag, target: text(target) ?? target, method: text(method), args, kwargs };
}

const callResponse = (callID, result) => marshalEncode(buildPacket(TYPE.CALL_RSP, {
  source: nodeAddress(65450, "test"),
  destination: clientAddress(2065450, callID),
  userID: 2,
  body: [{ type: "substream", value: result }],
}));

// ── 1. the recording ─────────────────────────────────────────────────────────

test("the recording is one whole docked session", () => {
  assert.equal(typeof fixture.accountName, "string");
  assert.ok(Number.isSafeInteger(fixture.characterID), "it selected a character");
  assert.ok(serverFrames.length >= 20 && clientFrames.length >= 15);
  for (const step of ["login", "charUnboundMgr.SelectCharacterID", "invbroker bind", "GetInventory", "account.GetKeyMap", "corporationSvc.GetAllCorpMedals", "pingService.Ping"]) {
    assert.ok(frames.some((frame) => frame.during === step), step);
  }
});

test("every frame a real server sent decodes with no bytes left over", () => {
  for (const [index, frame] of serverFrames.entries()) {
    assert.doesNotThrow(() => decoded(frame), `server frame ${index} (${frame.during})`);
  }
});

test("a real frame cut short is refused, not half-read", () => {
  for (const [index, frame] of serverFrames.entries()) {
    const bytes = inflated(frame.bytes);
    assert.throws(() => marshalDecodeExact(bytes.subarray(0, bytes.length - 1)), `server frame ${index} (${frame.during})`);
  }
});

test("a real frame survives decode, encode, decode", () => {
  for (const [index, frame] of serverFrames.entries()) {
    const value = decoded(frame);
    const again = marshalDecodeExact(marshalEncode(value));
    assert.deepEqual(integersByValue(again), integersByValue(value), `server frame ${index} (${frame.during})`);
  }
});

// ── 2. the session, replayed ─────────────────────────────────────────────────

test("replayed against the real server's half, the session sends its own half again byte for byte", { timeout: 10_000 }, async (context) => {
  const transport = replayTransport();
  const session = new GamePortSession({ transport, ...recordingSessionOptions() });
  context.after(() => session.close());
  const notifications = [];
  const sessionChanges = [];
  session.onNotification((notification) => notifications.push(notification));
  session.onSessionChange((changes) => sessionChanges.push(Object.keys(changes)));

  const results = await converse(session, { accountName: fixture.accountName, characterID: fixture.characterID, settleMs: 0 });
  await settle();

  assert.equal(transport.sent.length, clientFrames.length, "the same number of frames");
  for (const [index, frame] of clientFrames.entries()) {
    assert.equal(transport.sent[index].toString("hex"), frame.hex, `client frame ${index} (${frame.during})`);
  }

  // What the login told us.
  assert.equal(session.logonQueuePosition, 0);
  assert.ok(Number.isSafeInteger(session.userID) && session.userID > 0);
  assert.ok(Number.isSafeInteger(session.proxyNodeID) && session.proxyNodeID > 0);
  assert.equal(session.unknownHandshakeFunction, null, "the server's login function is one we can answer");
  assert.equal(session.serviceInfo.type, "dict");
  assert.ok(session.serviceInfo.entries.length > 100, "GetServiceInfo names the server's services");

  // What the calls answered.
  assert.ok(Array.isArray(results.selection) && results.selection.length === 4, "character selection's four parts");
  assert.match(results.broker.objectID, /^N=\d+:\d+$/);
  assert.equal(results.broker.nodeID, session.proxyNodeID);
  assert.equal(results.hangar.type, "substruct", "GetInventory answers a bound inventory");

  // Cached answers come back as the answer, not as the wrapper around it.
  // GetKeyMap's is carried inline. GetAllCorpMedals' is a reference: the session
  // fetched it from objectCaching the first time and reused it the second.
  assert.equal(results.keyMap.type, "list", "an inline cached answer, unwrapped");
  assert.ok(results.keyMap.items.length > 0);
  assert.ok(Array.isArray(results.medals) && results.medals.length === 2, "a fetched cached answer: the medals and their graphics");
  assert.equal(results.medalsAgain, results.medals, "the second answer is the object already held");
  assert.equal(session.cachedObjects.size, 1);

  // What the server pushed: the session change of a character select, and its
  // notification. Both arrive on their own, between calls.
  assert.equal(Number(session.attributes.charid), fixture.characterID);
  assert.ok(Number(session.attributes.stationid) > 0 && Number(session.attributes.solarsystemid2) > 0);
  assert.ok(sessionChanges.some((names) => names.includes("charid") && names.includes("stationid")));
  const skills = notifications.find((notification) => notification.method === "OnServerSkillsChanged");
  assert.ok(skills, "OnServerSkillsChanged was read");
  assert.equal(skills.idtype, "charid");
  assert.ok(Array.isArray(skills.args), "a broadcast's arguments are a tuple");

  assert.equal(session.counters.unknownPackets, 0, "every packet the server sent was understood");
  assert.equal(session.pending.size, 0);
});

// ── 3. the client's half, frame by frame ─────────────────────────────────────

test("the queue check and the version reply are the retail client's", () => {
  const [versionReply, queueCheck, secondVersionReply] = clientFrames.map(decoded);
  // (secret, macho.version, 0, boot.version, boot.build, codename@region)
  for (const reply of [versionReply, secondVersionReply]) {
    assert.deepEqual(reply.slice(0, 5), [170472, 496, 0, 24.01, 3396210]);
    assert.equal(text(reply[5]), "V24.01@ccp");
    assert.equal(reply.length, 6);
  }
  assert.equal(queueCheck[0], null);
  assert.equal(text(queueCheck[1]), "QC");
});

test("the login frames carry Placebo's values and the client's dict order", () => {
  const [, , , vipKey, cryptoRequest, login, challengeResponse] = clientFrames.map(decoded);
  assert.equal(text(vipKey[1]), "VK");
  // The name is typed into an edit box, so the client hashes a unicode object.
  // Hashing the same letters as a byte string gives a different number.
  const unicodeName = { type: "wstring", value: caseFold(fixture.accountName) };
  assert.equal(text(vipKey[2]), cryptoHash(unicodeName));
  assert.notEqual(cryptoHash(unicodeName), cryptoHash(caseFold(fixture.accountName)));
  assert.equal(text(cryptoRequest[0]), "placebo");
  assert.deepEqual(cryptoRequest[1], { type: "dict", entries: [] });

  const [challenge, credentials] = login;
  assert.equal(text(challenge), "\u0000".repeat(64));
  // The order the client's own interpreter gives this dict literal.
  const order = oracle.dicts[0].literal.map((tagged) => tagged.slice(2));
  assert.deepEqual(credentials.entries.map(([key]) => text(key)), order);
  const field = (name) => dictGet(credentials, name);
  assert.deepEqual(field("user_name"), { type: "wstring", value: fixture.accountName }, "a unicode object, not a byte string");
  assert.equal(field("user_password"), null);
  assert.deepEqual(Buffer.from(text(field("user_password_hash")), "latin1"), passwordHash(fixture.accountName, ""));
  assert.equal(text(field("user_languageid")), "EN");
  assert.equal(field("user_affiliateid"), 0);
  assert.equal(field("user_sso_token"), null);
  assert.deepEqual([field("macho_version"), field("boot_version"), field("boot_build")], [496, 24.01, 3396210]);
  assert.deepEqual([text(field("boot_codename")), text(field("boot_region"))], ["V24.01", "ccp"]);

  // (CryptoHash(serverChallenge), what the login function printed, its result)
  assert.equal(text(challengeResponse[0]), "44596");
  assert.equal(text(challengeResponse[1]), "TIDI_HANDLER:OK\nPORTRAIT_UPLOAD_HANDLER:OK\nSKILL_EXTRACTOR_ACCESS_TOKEN:OK\n");
  assert.equal(text(challengeResponse[1]).length, 75, "the length eve.js logged for the retail client");
  assert.equal(challengeResponse[2], null);
});

test("every call is addressed, numbered and wrapped as the retail client does it", () => {
  const calls = clientFrames.slice(7).map((frame) => {
    const value = decoded(frame);
    const packet = parsePacket(value);
    const [flag, pickle] = packet.body[0];
    const [target, method, args, kwargs] = pickle.value;
    return { state: value.args, packet, flag, target: text(target) ?? target, method: text(method), args, kwargs };
  });
  const proxyNode = 65450;

  for (const [index, call] of calls.entries()) {
    const label = `call ${index + 1} ${call.method}`;
    assert.equal(call.packet.command, TYPE.CALL_REQ, label);
    assert.equal(call.state.length, 14, `${label}: a packet's state is fourteen fields`);
    // machoNet._BlockingCall: MachoAddress(clientID=0, callID=callID), counted from 1.
    assert.deepEqual(call.packet.source, { kind: "client", clientID: 0, callID: index + 1, service: null }, label);
    assert.equal(call.packet.oob, null, label);
    assert.equal(call.state[6], null, `${label}: no contextKey`);
    assert.equal(text(call.state[7]), recordingSessionOptions().journeyID, `${label}: journeyID`);
    assert.deepEqual(call.state.slice(8), [null, null, null, null, null, null], `${label}: no trace context`);
    // Every call's keywords carry machoVersion.
    assert.deepEqual(call.kwargs.entries.map(([key, value]) => [text(key), value]), [["machoVersion", 1]], label);
  }

  const summary = calls.map((call) => [call.method, call.packet.destination.kind, call.packet.destination.service, call.flag]);
  assert.deepEqual(summary, [
    // machoNet.ConnectToServer's first call, to our proxy node.
    ["GetServiceInfo", "node", "machoNet", 0],
    // connectionService.SynchronizeClock, through sm.ProxySvc.
    ...Array(5).fill(["GetTime", "node", "machoNet", 0]),
    // sm.RemoteSvc: to any node.
    ["GetCharacterSelectionData", "any", "charUnboundMgr", 0],
    ["SelectCharacterID", "any", "charUnboundMgr", 0],
    // A Moniker: resolve on any node, then bind on the node it names.
    ["MachoResolveObject", "any", "invbroker", 0],
    ["MachoBindObject", "node", "invbroker", 0],
    // A bound object's call: to its node, no service, flag 1, the object's ID first.
    ["GetInventory", "node", null, 1],
    ["GetKeyMap", "any", "account", 0],
    // A cached answer that is a reference: the client fetches it from
    // objectCaching through its proxy node, once.
    ["GetAllCorpMedals", "any", "corporationSvc", 0],
    ["GetCachableObject", "node", "objectCaching", 0],
    ["GetAllCorpMedals", "any", "corporationSvc", 0],
    ["Ping", "node", "pingService", 0],
  ]);
  const fetch = calls.find((call) => call.method === "GetCachableObject");
  // (shared, objectID, objectVersion, nodeID)
  assert.equal(fetch.args.length, 4);
  assert.equal(fetch.args[0], 1, "a shared object");
  assert.equal(fetch.args[3], proxyNode);
  for (const call of calls.filter((entry) => entry.packet.destination.kind === "node")) {
    assert.equal(call.packet.destination.nodeID, proxyNode, call.method);
  }
  // On the wire, the things the client holds as Python longs are longs (0x2f),
  // which the decoded packets above cannot show: the call ID, and a bound
  // object's node ID. Each call's source address is the 4-tuple
  // (2, 0, callID, None): 14 04 | 06 02 | 08 | 2f 01 <id> | 01.
  const sent = clientFrames.slice(7).map((frame) => inflated(frame.bytes).toString("hex"));
  for (const [index, hex] of sent.entries()) {
    const callID = (index + 1).toString(16).padStart(2, "0");
    assert.ok(hex.includes(`14040602082f01${callID}01`), `call ${index + 1}: its call ID is a long`);
  }
  // A bound call's destination is (1, long(nodeID), None, None): 14 04 | 09 |
  // 2f 03 aa ff 00 | 01 | 01. As a long, 65450 needs a third byte for its sign.
  assert.ok(sent[10].includes("1404092f03aaff000101"), "a bound object's node ID is a long");
  // A proxy service's is (1, proxyNodeID, service, None), with the int the login gave us.
  assert.ok(sent[0].includes("14040904aaff0000"), "the proxy node ID stays an int");

  const [resolve, bind, bound] = calls.slice(8, 11);
  assert.equal(resolve.target, 1, "a service call's first field is 1");
  assert.equal(resolve.args.length, 1, "MachoResolveObject takes the bind parameters alone");
  assert.deepEqual(bind.args[0], resolve.args[0], "and MachoBindObject is given the same ones");
  assert.equal(bind.args[1], null, "with no call to carry along");
  assert.match(bound.target, /^N=65450:\d+$/);
});

// ── behaviour a recording cannot trigger ─────────────────────────────────────

test("a login the server answers with the wrong challenge hash is abandoned", { timeout: 5000 }, async () => {
  const transport = replayTransport({
    rewrite: (frame) => {
      const value = decoded(frame);
      if (!Array.isArray(value) || value.length !== 4 || !dictGet(value[3], "challenge_responsehash")) return frame.bytes;
      const response = { type: "dict", entries: value[3].entries.map(([key, entry]) => (text(key) === "challenge_responsehash" ? [key, "12345"] : [key, entry])) };
      return marshalEncode([value[0], value[1], value[2], response]);
    },
  });
  const session = new GamePortSession({ transport, ...recordingSessionOptions() });
  await assert.rejects(session.login(fixture.accountName, ""), (error) => error instanceof GamePortError && error.code === "BAD_SERVER_SIGNATURE");
  assert.equal(transport.closed, true);
  assert.equal(session.closed, true);
});

test("a server of another build, release or region is refused before anything is sent to it", { timeout: 5000 }, async () => {
  for (const [change, code] of [
    [(tuple) => { tuple[4] = 3396211; }, "HANDSHAKE_INCOMPATIBLEBUILD"],
    [(tuple) => { tuple[3] = 24.02; }, "HANDSHAKE_INCOMPATIBLEVERSION"],
    [(tuple) => { tuple[1] = 497; }, "HANDSHAKE_INCOMPATIBLEPROTOCOL"],
    [(tuple) => { tuple[5] = "V24.01@elsewhere"; }, "HANDSHAKE_INCOMPATIBLEREGION"],
    [(tuple) => { tuple[5] = "V25.00@ccp"; }, "HANDSHAKE_INCOMPATIBLERELEASE"],
  ]) {
    const transport = replayTransport({
      rewrite: (frame, index) => {
        if (index !== 0) return frame.bytes;
        const tuple = [...decoded(frame)];
        change(tuple);
        return marshalEncode(tuple);
      },
    });
    const session = new GamePortSession({ transport, ...recordingSessionOptions() });
    await assert.rejects(session.login(fixture.accountName, ""), (error) => error.code === code, code);
    assert.equal(transport.sent.length, 0, `${code}: nothing was sent`);
    assert.equal(transport.closed, true);
  }
});

test("a login function nobody has recorded an answer for gets an empty answer, and says so", { timeout: 5000 }, async (context) => {
  const { session, transport } = await loggedIn(context, { session: { handshakeFunctions: new Map() } });
  assert.match(session.unknownHandshakeFunction, /^[0-9a-f]{64}$/);
  const challengeResponse = marshalDecodeExact(transport.sent[6]);
  assert.equal(text(challengeResponse[0]), "44596");
  assert.equal(text(challengeResponse[1]) ?? "", "");
});

test("a server ping is answered with its times and our turnaround", { timeout: 5000 }, async (context) => {
  const { session, transport } = await loggedIn(context);
  const before = transport.sent.length;
  const stamp = { type: "long", value: 134358883852740000n };
  transport.deliver(marshalEncode(buildPacket(TYPE.PING_REQ, {
    source: nodeAddress(65450, null, 77),
    destination: clientAddress(2065450),
    userID: 2,
    body: [{ type: "list", items: [[stamp, stamp, "proxy::start"]] }],
  })));
  assert.equal(transport.sent.length, before + 1);
  const reply = parsePacket(marshalDecodeExact(inflated(transport.sent.at(-1))));
  assert.equal(reply.command, TYPE.PING_RSP);
  // The reply goes back where the request came from.
  assert.deepEqual(reply.destination, { kind: "node", nodeID: 65450, service: null, callID: 77 });
  assert.equal(reply.source.kind, "client");
  const times = reply.body[0].items;
  assert.deepEqual(times.map((entry) => text(entry[2])), ["proxy::start", "client::turnaround"]);
  assert.equal(session.counters.unknownPackets, 0);
});

test("a compressed frame from the server is read like any other", { timeout: 5000 }, async (context) => {
  const { session, transport } = await loggedIn(context);
  const answer = session.call("config", "Anything");
  const { packet } = lastCall(transport);
  transport.deliver(zlib.deflateSync(callResponse(packet.source.callID, ["compressed", 42])));
  const result = await answer;
  assert.equal(text(result[0]), "compressed");
  assert.equal(session.counters.compressedReceived, 1);
});

test("a refusal rejects its own call with the server's words, and no other", { timeout: 5000 }, async (context) => {
  const { session, transport } = await loggedIn(context);
  const first = session.call("config", "First");
  const firstID = lastCall(transport).packet.source.callID;
  const second = session.call("config", "Second");
  const secondID = lastCall(transport).packet.source.callID;
  assert.equal(secondID, firstID + 1);
  transport.deliver(marshalEncode(buildPacket(TYPE.ERROR_RESPONSE, {
    source: nodeAddress(65450, "config"),
    destination: clientAddress(2065450, secondID),
    userID: 2,
    body: [TYPE.CALL_REQ, 2, [{ type: "substream", value: "TaxChanged" }]],
  })));
  await assert.rejects(second, (error) => error.code === "GAME_CALL_REFUSED" && /config\.Second .*TaxChanged/.test(error.message));
  transport.deliver(callResponse(firstID, "fine"));
  assert.equal(text(await first), "fine");
  assert.equal(session.pending.size, 0);
});

test("a call's keywords go out in the client's order, which differs between a service and a bound object", { timeout: 5000 }, async (context) => {
  const { session, transport } = await loggedIn(context);
  // A case the client's own interpreter orders differently on its two call paths.
  const sample = oracle.keywords.find(({ written, viaFunction, viaObject }) => written.length <= 3 && viaFunction.join() !== viaObject[0].join());
  assert.ok(sample, "the oracle holds such a case");
  const kwargs = Object.fromEntries(sample.written.map((name, index) => [name, index + 10]));
  const sentKeywords = () => lastCall(transport).kwargs.entries.map(([name, value]) => [text(name), value]);
  const expected = (order) => order.map((name) => [name, name === "machoVersion" ? 1 : kwargs[name]]);

  session.call("config", "WithKeywords", [], kwargs).catch(() => {});
  assert.deepEqual(sentKeywords(), expected(sample.viaFunction), "a service's method is a plain function");
  session.callBound("N=65450:9", "WithKeywords", [], kwargs).catch(() => {});
  assert.deepEqual(sentKeywords(), expected(sample.viaObject[0]), "a bound object's method is an object with __call__");
  session.proxyCall("machoNet", "WithKeywords", [], { type: "dict", entries: Object.entries(kwargs) }).catch(() => {});
  assert.deepEqual(sentKeywords(), expected(sample.viaFunction), "keywords given as a dict are treated the same");
});

test("a cached object is fetched again only when its checksum changed and ours is older", { timeout: 5000 }, async (context) => {
  // The recorded answer to GetAllCorpMedals: a CachedMethodCallResult holding a
  // reference whose version is (timestamp, checksum).
  const recorded = serverFrames.filter((frame) => frame.during === "corporationSvc.GetAllCorpMedals").map(decoded);
  const [referenceAnswer, objectAnswer] = recorded;
  const reference = referenceAnswer.args[4][0].value;
  const [stamp, checksum] = reference.args[1].args[2];
  const withVersion = (callID, newStamp, newChecksum) => {
    const cachedObject = { ...reference.args[1], args: [reference.args[1].args[0], reference.args[1].args[1], [newStamp, newChecksum]] };
    return callResponse(callID, { ...reference, args: [reference.args[0], cachedObject, reference.args[2]] });
  };
  const fetched = (callID) => callResponse(callID, objectAnswer.args[4][0].value);
  const later = BigInt(stamp) + 600_000_000n;
  const earlier = BigInt(stamp) - 600_000_000n;

  const { session, transport } = await loggedIn(context);
  const ask = async (answerStamp, answerChecksum) => {
    const before = transport.sent.length;
    const answer = session.call("corporationSvc", "GetAllCorpMedals", [1000035]);
    transport.deliver(withVersion(lastCall(transport).packet.source.callID, answerStamp, answerChecksum));
    await settle();
    const asked = lastCall(transport);
    const fetchedAgain = asked.method === "GetCachableObject";
    if (fetchedAgain) transport.deliver(fetched(asked.packet.source.callID));
    await answer;
    return { fetchedAgain, sent: transport.sent.length - before };
  };

  assert.deepEqual(await ask(stamp, checksum), { fetchedAgain: true, sent: 2 }, "nothing held yet");
  assert.deepEqual(await ask(later, checksum), { fetchedAgain: false, sent: 1 }, "a new timestamp alone is not a new version");
  assert.deepEqual(await ask(earlier, Number(checksum) + 1), { fetchedAgain: false, sent: 1 }, "a different checksum that is OLDER than ours is not fetched");
  assert.deepEqual(await ask(later, Number(checksum) + 1), { fetchedAgain: true, sent: 2 }, "a different checksum that is newer is");
});

test("closing rejects every unanswered call and stops the background work", { timeout: 5000 }, async (context) => {
  const time = manualTime();
  const { session, transport } = await loggedIn(context, { session: { now: time.now, timers: time.timers } });
  assert.ok(time.pending.size >= 2, "the clock sync and the keep-alive are scheduled");
  const unanswered = session.call("config", "Never");
  let told = null;
  session.onClose((error) => { told = error; });
  session.close();
  await assert.rejects(unanswered, (error) => error.code === "CONNECTION_CLOSED");
  assert.equal(told.code, "CONNECTION_CLOSED");
  assert.equal(transport.closed, true);
  assert.equal(time.pending.size, 0, "no timer outlives the session");
  await assert.rejects(session.call("config", "After"), (error) => error.code === "NOT_CONNECTED");
});

test("a lost connection is reported once, with the reason", { timeout: 5000 }, async (context) => {
  const { session, transport } = await loggedIn(context);
  const reasons = [];
  session.onClose((error) => reasons.push(error.message));
  const unanswered = session.call("config", "Never");
  transport.onClose(new Error("read ECONNRESET"));
  transport.onClose(new Error("again"));
  // LOST, not CLOSED: we did not ask for this. A takeover of the character looks
  // exactly like it; eve.js drops the old connection without a word (seen live).
  await assert.rejects(unanswered, (error) => error.code === "CONNECTION_LOST" && /ECONNRESET/.test(error.message));
  assert.deepEqual(reasons, ["read ECONNRESET"]);
  assert.equal(session.closeReason.code, "CONNECTION_LOST");
});

// The shape eve.js gives the notice (handshake.js buildGPSTransportClosedPayload).
const transportClosed = (reason, reasonCode) => marshalEncode({
  type: "objectex1",
  header: [{ type: "token", value: "carbon.common.script.net.GPSExceptions.GPSTransportClosed" }, [reason, reasonCode, { type: "dict", entries: [] }]],
  list: [],
  dict: [],
});

test("the server saying why it is hanging up ends the session with its reason", { timeout: 5000 }, async (context) => {
  const { session, transport } = await loggedIn(context);
  const unanswered = session.call("config", "Never");
  transport.deliver(transportClosed("The cluster is shutting down", "CLUSTER_SHUTDOWN"));
  await assert.rejects(unanswered, (error) => error.code === "TRANSPORT_CLOSED" && /CLUSTER_SHUTDOWN/.test(error.message));
  assert.equal(session.closed, true);
  assert.equal(session.closeReason.detail.reason, "The cluster is shutting down");
  assert.equal(session.counters.unknownPackets, 0, "it was understood, not skipped");
});

test("a login the server refuses with a reason fails with that reason", { timeout: 5000 }, async () => {
  // In place of the password-version frame, as eve.js answers a refused login.
  const transport = replayTransport({
    rewrite: (frame) => (decoded(frame) === 2 ? transportClosed("LoginAuthFailed", "ACCOUNTBANNED") : frame.bytes),
  });
  const session = new GamePortSession({ transport, ...recordingSessionOptions() });
  await assert.rejects(session.login(fixture.accountName, ""), (error) => error.code === "TRANSPORT_CLOSED" && /ACCOUNTBANNED/.test(error.message));
  assert.equal(transport.closed, true);
});

test("after a minute with nothing sent, the session pings; activity puts it off", { timeout: 5000 }, async (context) => {
  const time = manualTime();
  const { session, transport } = await loggedIn(context, { session: { now: time.now, timers: time.timers } });
  const sentAfterLogin = transport.sent.length;

  await time.advance(59_000);
  assert.equal(transport.sent.length, sentAfterLogin, "not yet");
  await time.advance(1_000);
  assert.equal(transport.sent.length, sentAfterLogin + 1, "one keep-alive at sixty seconds");
  const ping = lastCall(transport);
  assert.deepEqual([ping.method, ping.packet.destination.kind, ping.packet.destination.service], ["Ping", "node", "pingService"]);
  transport.deliver(callResponse(ping.packet.source.callID, null));

  // A call at +30s is activity: the next ping is sixty seconds after THAT.
  await time.advance(30_000);
  const call = session.call("config", "Busy");
  transport.deliver(callResponse(lastCall(transport).packet.source.callID, null));
  await call;
  const sentAfterCall = transport.sent.length;
  await time.advance(59_000);
  assert.equal(transport.sent.length, sentAfterCall, "the earlier deadline no longer applies");
  await time.advance(1_000);
  assert.equal(lastCall(transport).method, "Ping");
  assert.equal(transport.sent.length, sentAfterCall + 1);
});

test("the clock sync stops after three readings that each beat the last", { timeout: 5000 }, async (context) => {
  // Each GetTime takes 30, 20, then 10 of our clock's units: three improving
  // readings, so the client's loop ends there instead of running all five.
  const durations = [30, 20, 10, 5, 1];
  let clock = 0;
  let step = 0;
  const { session, transport } = await loggedIn(context);
  session.now = () => clock;
  const before = transport.sent.length;
  const syncing = session.synchronizeClock();
  for (let answered = 0; answered < 3; answered += 1) {
    await settle();
    clock += durations[step];
    step += 1;
    transport.deliver(callResponse(lastCall(transport).packet.source.callID, { type: "long", value: 134358883852740000n }));
  }
  await syncing;
  assert.equal(transport.sent.length - before, 3);
  assert.equal(lastCall(transport).method, "GetTime");
});
