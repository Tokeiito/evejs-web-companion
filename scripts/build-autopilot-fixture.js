"use strict";

// Record what the retail client's own pathfinder answers over made-up maps, as the
// fixture web/src/nav/autopilotRoute.ts is tested against.
//
//   node scripts/build-autopilot-fixture.js "<client bin64 folder>" [python3 command]
//
// The client plots its autopilot's route with a native module (pyEvePathfinder,
// bin64/_pyevepathfinder.dll). This writes a Python 2.7 snippet that loads that
// module inside the client's python27.dll (scripts/py27-oracle.py), gives it each
// map below the way the client's own script does (evePathfinder/eveMapWrapper.py,
// core.py), and saves its jump counts to test/fixtures/autopilotRoute.json.
//
// Nothing in the fixture is the client's or the game's: the maps are made up here,
// and every count is the module's own answer. Where two routes cost the module the
// same and differ in jumps, its answer goes by the order it was told of the map's
// jumps in. So each map is put to it several times, as written, back to front and
// with its jumps shuffled; a pair whose count changes with the order is left out,
// and how many were left out is recorded.

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const WEB_ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(WEB_ROOT, "test", "fixtures", "autopilotRoute.json");
const BASE = 30000000;
/** How many orders each map is put to the module in. */
const ORDERS = 8;

// A fixed linear congruential generator: the cases are the same on every run.
function generator(seed) {
  let state = seed >>> 0;
  return (limit) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 4294967296) * limit);
  };
}

/** A map by hand: systems as {id: security}, jumps as [a, b] (each goes both ways). */
function chain(ids, security, from) {
  const systems = {};
  const jumps = [];
  let last = from;
  for (const id of ids) {
    systems[id] = security;
    jumps.push([last, id]);
    last = id;
  }
  return { systems, jumps, last };
}

/** Start - one system of `middle` security - end, against a way round of `n` safe systems. */
function detour(name, middle, n, options = {}) {
  const start = BASE + 1;
  const end = BASE + 3;
  const round = chain(Array.from({ length: n }, (_, i) => BASE + 100 + i), 1.0, start);
  return {
    name,
    penalty: options.penalty ?? 50,
    avoid: options.avoid ?? [],
    systems: { [start]: options.start ?? 1.0, [BASE + 2]: middle, [end]: options.end ?? 1.0, ...round.systems },
    jumps: [[start, BASE + 2], [BASE + 2, end], ...round.jumps, ...(n > 0 ? [[round.last, end]] : [])],
    pairs: [[start, end], [end, start], [start, BASE + 2]],
  };
}

/** `before` safe systems, then two low systems against one null-security system, then two safe systems. */
function lowsAgainstNull(before, penalty) {
  const start = BASE + 1;
  const lead = chain(Array.from({ length: before }, (_, i) => BASE + 100 + i), 1.0, start);
  const fork = lead.last;
  const join = BASE + 70;
  const tail = chain([BASE + 200, BASE + 201], 1.0, join);
  return {
    name: `two low systems against one null-security system, ${before} safe systems before, penalty ${penalty}`,
    penalty,
    avoid: [],
    systems: { [start]: 1.0, ...lead.systems, [BASE + 50]: 0.3, [BASE + 51]: 0.3, [BASE + 60]: -0.5, [join]: 1.0, ...tail.systems },
    jumps: [...lead.jumps, [fork, BASE + 50], [BASE + 50, BASE + 51], [BASE + 51, join], [fork, BASE + 60], [BASE + 60, join], ...tail.jumps],
    pairs: [[start, tail.last]],
  };
}

const LEVELS = [1.0, 1.0, 0.9, 0.7, 0.5, 0.45, 0.4499999, 0.4, 0.3, 0.1, 0.05, 0.0, -0.1, -0.5, -1.0];

/** A made-up map of `count` systems: a spanning tree, some more jumps across it, and an island. */
function scattered(seed, count, penalty, avoiding) {
  const next = generator(seed);
  const ids = Array.from({ length: count }, (_, i) => BASE + 1000 + i * 7);
  const systems = {};
  for (const id of ids) systems[id] = LEVELS[next(LEVELS.length)];
  const jumps = [];
  const seen = new Set();
  const join = (a, b) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (a !== b && !seen.has(key)) {
      seen.add(key);
      jumps.push([a, b]);
    }
  };
  const island = Math.max(2, Math.floor(count / 12));
  for (let i = 1; i < count - island; i += 1) join(ids[i], ids[next(i)]);
  for (let i = count - island + 1; i < count; i += 1) join(ids[i], ids[count - island + next(i - (count - island))]);
  for (let extra = Math.floor(count / 3); extra > 0; extra -= 1) join(ids[next(count - island)], ids[next(count - island)]);
  const avoid = avoiding ? Array.from({ length: 1 + next(4) }, () => ids[next(count)]) : [];
  const pairs = [];
  for (let wanted = 60; wanted > 0; wanted -= 1) pairs.push([ids[next(count)], ids[next(count)]]);
  // Each avoided system is gone to, and left, at least once.
  for (const id of avoid) pairs.push([ids[next(count)], id], [id, ids[next(count)]]);
  return { name: `a made-up map of ${count} systems (seed ${seed}), penalty ${penalty}, ${avoid.length} avoided`, penalty, avoid: [...new Set(avoid)], systems, jumps, pairs };
}

function cases() {
  const list = [
    { name: "a line of six safe systems", penalty: 50, avoid: [], systems: Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [BASE + i, 1.0])), jumps: [1, 2, 3, 4, 5].map((i) => [BASE + i, BASE + i + 1]), pairs: [[BASE + 1, BASE + 6], [BASE + 6, BASE + 1], [BASE + 2, BASE + 4], [BASE + 3, BASE + 3]] },
    { name: "two systems and no jump between them", penalty: 50, avoid: [], systems: { [BASE + 1]: 1.0, [BASE + 2]: 1.0 }, jumps: [], pairs: [[BASE + 1, BASE + 2]] },
  ];
  // What a system outside the limits costs, by the penalty: the way round is taken until it is longer.
  for (const [penalty, lengths] of [[0, [1, 2, 3]], [5, [1, 2, 3, 4]], [10, [3, 4, 5, 6]], [15, [8, 9, 10, 11]], [20, [20, 21, 22, 23]], [25, [45, 46, 47, 48]], [50, [3, 40]]]) {
    for (const n of lengths) list.push(detour(`one low system (0.3) against ${n} safe on the way round, penalty ${penalty}`, 0.3, n, { penalty }));
  }
  for (const n of [43, 44, 45, 46, 90, 91, 92, 93]) list.push(detour(`one null-security system (-0.5) against ${n} safe on the way round, penalty 20`, -0.5, n, { penalty: 20 }));
  // Where the limits lie.
  for (const middle of [0.5, 0.46, 0.4500001, 0.45, 0.4499999, 0.449, 0.05, 0.0, -0.3]) {
    for (const n of [3, 12, 30]) list.push(detour(`the middle at ${middle} against ${n} safe on the way round, penalty 15`, middle, n, { penalty: 15 }));
  }
  // The ends cost the same whichever way is taken.
  for (const [start, end] of [[0.3, 1.0], [1.0, 0.3], [0.3, 0.3], [-0.5, -0.5]]) {
    for (const n of [3, 12]) list.push(detour(`from ${start} to ${end}, a low middle against ${n} safe on the way round, penalty 15`, 0.3, n, { penalty: 15, start, end }));
  }
  // Avoided systems.
  for (const n of [0, 1, 6]) {
    list.push(detour(`the safe middle avoided, ${n} on the way round`, 1.0, n, { avoid: [BASE + 2] }));
    list.push(detour(`the low middle avoided, ${n} on the way round`, 0.3, n, { avoid: [BASE + 2] }));
  }
  list.push(detour("the end avoided", 1.0, 3, { avoid: [BASE + 3] }));
  list.push(detour("the start avoided", 1.0, 3, { avoid: [BASE + 1] }));
  list.push(detour("both ends and the middle avoided", 1.0, 3, { avoid: [BASE + 1, BASE + 2, BASE + 3] }));
  // Sums kept in single precision: at the penalty as it comes, which way wins goes by how the sums round.
  for (let before = 0; before <= 12; before += 1) list.push(lowsAgainstNull(before, 50));
  for (const before of [0, 4, 9]) list.push(lowsAgainstNull(before, 10));
  let seed = 20261009;
  for (const count of [12, 30, 60, 90, 140, 200]) {
    for (const [penalty, avoiding] of [[50, false], [50, true], [10, true], [0, false], [35.5, true], [100, false]]) {
      list.push(scattered(seed, count, penalty, avoiding));
      seed += 1;
    }
  }
  return list;
}

function snippet(dll, list) {
  const lines = [
    "import imp, math",
    // No random module in the client's interpreter without its library: a generator of this snippet's own.
    "state = [20261009]",
    "def below(limit):",
    "    state[0] = (state[0] * 1664525 + 1013904223) % 4294967296",
    "    return state[0] * limit // 4294967296",
    "def shuffled(items):",
    "    items = list(items)",
    "    for i in range(len(items) - 1, 0, -1):",
    "        j = below(i + 1)",
    "        items[i], items[j] = items[j], items[i]",
    "    return items",
    `pf = imp.load_dynamic('_pyevepathfinder', ${JSON.stringify(dll)})`,
    "def answers(systems, jumps, penalty, avoid, pairs):",
    "    m = pf.EveMap()",
    "    m.CreateRegion(10000001)",
    "    m.CreateConstellation(20000001, 10000001)",
    "    for sid, level in systems:",
    "        m.CreateSolarSystem(sid, 20000001, level)",
    "    for a, b in jumps:",
    "        m.AddJump(a, b, 0)",
    "    m.Finalize()",
    "    goal = pf.EveStandardFloodFillGoal()",
    "    cache = pf.EveMapPathfinderCache()",
    "    cache.Initialize(m)",
    "    counts = []",
    "    for a, b in pairs:",
    // The "safe" route type's limits, and the penalty as AutopilotPathfinderInterface.GetSecurityPenalty works it out.
    "        goal.AvoidSystemsOutsideSecurityLimits(0.45, 1.0, math.exp(0.15 * penalty))",
    "        goal.ClearOrigins()",
    "        goal.AddOrigin(m, a)",
    "        goal.ClearGoalSystems()",
    "        goal.AddGoalSystem(m, b)",
    "        goal.ClearAvoidSystems()",
    "        for each in avoid:",
    "            goal.AddAvoidSystem(m, each)",
    "        cache.Clear()",
    "        pf.FindRoute(m, goal, cache)",
    "        counts.append(str(cache.GetJumpCountTo(m, b)))",
    "    return ' '.join(counts)",
  ];
  for (const each of list) {
    const systems = Object.entries(each.systems).map(([id, level]) => `(${id},${JSON.stringify(level)})`);
    // Each jump goes both ways, and each way is a jump of its own to the module.
    const jumps = each.jumps.flatMap(([a, b]) => [`(${a},${b})`, `(${b},${a})`]);
    const pairs = each.pairs.map(([a, b]) => `(${a},${b})`).join(",");
    const rest = `${JSON.stringify(each.penalty)}, [${each.avoid.join(",")}], [${pairs}]`;
    lines.push(`S = [${systems.join(",")}]`, `J = [${jumps.join(",")}]`);
    lines.push(`out(answers(S, J, ${rest}))`);
    lines.push(`out(answers(S[::-1], J[::-1], ${rest}))`);
    for (let order = 2; order < ORDERS; order += 1) lines.push(`out(answers(shuffled(S), shuffled(J), ${rest}))`);
  }
  return `${lines.join("\n")}\n`;
}

function main(argv = process.argv.slice(2)) {
  const [bin, python = "python"] = argv;
  if (!bin) {
    console.error('Usage: node scripts/build-autopilot-fixture.js "<client bin64 folder>" [python3 command]');
    return 2;
  }
  const dll = path.join(bin, "_pyevepathfinder.dll").replace(/\\/g, "/");
  if (!fs.existsSync(dll)) {
    console.error(`The client has no pathfinder at ${dll}.`);
    return 2;
  }
  const list = cases();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-fixture-")), "snippet.py");
  fs.writeFileSync(file, snippet(dll, list), "latin1");
  const ran = childProcess.spawnSync(python, [path.join(__dirname, "py27-oracle.py"), bin, file], { encoding: "utf8", maxBuffer: 1 << 28 });
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
  if (ran.status !== 0) {
    console.error(`The client's pathfinder could not be run:\n${ran.stderr}`);
    return 1;
  }
  const answered = ran.stdout.split(/\r?\n/).filter((line) => line.trim() !== "").map((line) => line.trim().split(" ").map(Number));
  if (answered.length !== list.length * ORDERS) {
    console.error(`Expected ${list.length * ORDERS} lines of answers and read ${answered.length}.`);
    return 1;
  }
  let kept = 0;
  let leftOut = 0;
  const recorded = list.map((each, index) => {
    const asWritten = answered[index * ORDERS];
    const others = answered.slice(index * ORDERS + 1, (index + 1) * ORDERS);
    const pairs = [];
    each.pairs.forEach(([from, to], at) => {
      if (others.some((answers) => answers[at] !== asWritten[at])) {
        leftOut += 1;
        return;
      }
      kept += 1;
      // The module answers -1 where there is no route.
      pairs.push([from, to, asWritten[at] === -1 ? null : asWritten[at]]);
    });
    return { name: each.name, penalty: each.penalty, avoid: each.avoid, systems: Object.entries(each.systems).map(([id, level]) => [Number(id), level]), jumps: each.jumps, pairs };
  });
  const fixture = {
    source: "The retail client's own pathfinder (pyEvePathfinder) run over made-up maps by scripts/build-autopilot-fixture.js. Every count is its answer; null is no route.",
    routeType: "safe",
    ordersEachMapWasPutIn: ORDERS,
    leftOutForChangingWithTheOrderOfTheMap: leftOut,
    cases: recorded,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(fixture)}\n`);
  console.log(`${recorded.length} maps, ${kept} pairs recorded, ${leftOut} left out for changing with the order of the map; ${fs.statSync(OUTPUT).size} bytes at ${path.relative(WEB_ROOT, OUTPUT)}`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { cases, main };
