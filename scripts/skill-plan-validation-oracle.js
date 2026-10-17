"use strict";

// web/src/bridge/skillPlanValidation.ts run against the client's own validation: the decompiled
// skills/skillplan/skillPlanValidation.py itself, run inside the client's python27.dll (scripts/py27-oracle.py), on
// the same plans, with the client's own prerequisites (the requiredSkillsForTypes table read by the client's loader,
// scripts/client-built-data.py, in the order its dicts iterate). Each plan's list after ValidateSkillPlan and what
// it says it changed are compared; a plan the client's raises on must throw in the port too.
//
//   node scripts/skill-plan-validation-oracle.js <decompiled client tree> <client root> [cases]
//
// What the client's module imports beyond Python's builtins is stood in for: blue.pyos.BeNice and
// telemetry.ZONE_FUNCTION do nothing, logging's warnings are dropped, collections' Counter and OrderedDict are
// written out (a dict counting in the order first seen; a dict keeping the order set). Which skills are valid
// (_IsSkillInvalid) is the client's data's: the skill types given are those the table names as needs that its types
// table has published and its typeDogma has not obsolete (attributeSkillIsObsolete, 2450); evetypes.IsPublished then
// says yes and dogma's obsolete attribute no to each. (Two skills need themselves, 9955 and 19430, both unpublished:
// the client's validation would walk them for ever, and drops them first.)

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const STANDINS = String.raw`
import sys
def _module(name):
    module = type(sys)(name)
    sys.modules[name] = module
    return module
class _Pyos(object):
    def BeNice(self):
        pass
_module('blue').pyos = _Pyos()
_module('telemetry').ZONE_FUNCTION = lambda function: function
class _Logger(object):
    def warn(self, *args):
        pass
    info = debug = warning = error = exception = warn
_module('logging').getLogger = lambda name=None: _Logger()
class Counter(dict):
    def __init__(self, iterable=()):
        dict.__init__(self)
        for item in iterable:
            self[item] = self.get(item, 0) + 1
class OrderedDict(dict):
    def __init__(self):
        dict.__init__(self)
        self._order = []
    def __setitem__(self, key, value):
        if key not in self:
            self._order.append(key)
        dict.__setitem__(self, key, value)
    def iteritems(self):
        return iter([(key, self[key]) for key in self._order])
    def iterkeys(self):
        return iter(list(self._order))
    def keys(self):
        return list(self._order)
_collections = _module('collections')
_collections.Counter = Counter
_collections.OrderedDict = OrderedDict
_evetypes = _module('evetypes')
_evetypes.IsPublished = lambda typeID: True
_evetypes.GetTypeIDsByCategory = lambda categoryID: []
class _DogmaData(object):
    def get_type_attribute(self, typeID, attributeID, default=None):
        return default
_module('dogma').data = _DogmaData()
_module('eve')
_module('eve.common')
_lib = _module('eve.common.lib')
_appConst = _module('eve.common.lib.appConst')
_appConst.attributeSkillIsObsolete = 2450
_lib.appConst = _appConst
_module('inventorycommon')
_module('inventorycommon.const').categorySkill = 16
class _Needs(object):
    def __init__(self, pairs):
        self._pairs = list(pairs)
    def iteritems(self):
        return iter(list(self._pairs))
    def iterkeys(self):
        return iter([key for key, value in self._pairs])
    def keys(self):
        return [key for key, value in self._pairs]
`;

function readTable(clientRoot, resource, loader, ...rest) {
  const index = fs.readFileSync(path.join(clientRoot, "tq", "resfileindex.txt"), "utf8");
  const line = index.split(/\r?\n/).find((row) => row.toLowerCase().startsWith(resource + ","));
  if (!line) throw new Error("The client's index has no " + resource + ".");
  return childProcess.execFileSync("python", [
    path.join(__dirname, "client-built-data.py"),
    path.join(clientRoot, "tq", "bin64"),
    loader,
    path.join(clientRoot, "ResFiles", line.split(",")[1]),
    ...rest,
  ], { maxBuffer: 256 * 1024 * 1024 }).toString("utf8");
}

/** The skills of these whose types record is published and whose dogma has no obsolete flag. */
function validSkills(clientRoot, skills) {
  const keys = "keys=" + skills.join(",");
  const published = JSON.parse(readTable(clientRoot, "res:/staticdata/types.fsdbinary", "typesLoader", "published", keys));
  const dogma = JSON.parse(readTable(clientRoot, "res:/staticdata/typedogma.fsdbinary", "typeDogmaLoader", keys));
  return new Set(skills.filter((skill) => {
    if (!published[String(skill)]) return false;
    const attributes = (dogma[String(skill)] && dogma[String(skill)].dogmaAttributes) || [];
    return !attributes.some((attribute) => attribute.attributeID === 2450 && attribute.value);
  }));
}

function readNeeds(clientRoot) {
  const printed = readTable(clientRoot, "res:/staticdata/requiredskillsfortypes.fsdbinary", "requiredSkillsForTypesLoader");
  // Whole-number keys would be put in rising order by JSON.parse; marked, they keep the order printed.
  const table = JSON.parse(printed.replace(/"(\d+)":/g, '"#$1":'));
  const needs = new Map();
  for (const [typeKey, row] of Object.entries(table)) {
    needs.set(Number(typeKey.slice(1)), Object.entries(row).map(([skillKey, level]) => [Number(skillKey.slice(1)), Number(level)]));
  }
  return needs;
}

async function main() {
  const [tree, clientRoot, casesArg] = process.argv.slice(2);
  if (!tree || !clientRoot) {
    console.error("node scripts/skill-plan-validation-oracle.js <decompiled client tree> <client root> [cases]");
    process.exit(2);
  }
  const caseCount = Number(casesArg) || 400;
  const needs = readNeeds(clientRoot);
  // The skills: every type the table names as a need, and theirs in turn.
  const skills = new Set();
  for (const row of needs.values()) for (const [skill] of row) skills.add(skill);
  const skillList = [...skills].sort((a, b) => a - b);
  const prerequisites = (typeID) => needs.get(typeID) ?? [];
  const valid = validSkills(clientRoot, skillList);
  const { validateSkillPlan } = await import(pathToFileURL(path.join(__dirname, "..", "web", "src", "bridge", "skillPlanValidation.ts")).href);
  const facts = { isValidSkill: (typeID) => valid.has(typeID), prerequisites };

  // Plans: seeded, so a run can be repeated. Some levels missing, doubled, out of order; some not skills at all.
  let seed = 271828;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const notSkills = [587, 34, 11399];
  const cases = [];
  for (let n = 0; n < caseCount; n += 1) {
    const list = [];
    const length = 1 + Math.floor(random() * 10);
    for (let i = 0; i < length; i += 1) {
      const roll = random();
      if (roll < 0.04) list.push([pick(notSkills), 1 + Math.floor(random() * 5)]);
      else if (roll < 0.2 && list.length > 0) list.push([pick(list)[0], 1 + Math.floor(random() * 5)]);
      else list.push([pick(skillList), 1 + Math.floor(random() * 5)]);
    }
    cases.push(list);
  }
  // And plans that are valid already (each of a third of those above as the port leaves it: the client should call
  // them unchanged), and the same shuffled (the ordering passes then have work to do).
  for (const list of cases.slice(0, Math.floor(caseCount / 3))) {
    const settled = list.map((pair) => [...pair]);
    try {
      validateSkillPlan(settled, facts);
    } catch {
      continue;
    }
    cases.push(settled);
    const shuffled = settled.map((pair) => [...pair]);
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    cases.push(shuffled);
  }

  const sourcePath = path.join(tree, "skills", "skillplan", "skillPlanValidation.py");
  const source = fs.readFileSync(sourcePath, "utf8").split(/\r?\n/).filter((line) => line.trimEnd() !== "return").join("\n");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "skill-plan-validation-"));
  const reached = new Set();
  const walk = (typeID) => {
    if (reached.has(typeID)) return;
    reached.add(typeID);
    for (const [need] of prerequisites(typeID)) walk(need);
  };
  for (const list of cases) for (const [typeID] of list) if (valid.has(typeID)) walk(typeID);
  const needsLiteral = `{${[...reached].map((typeID) => `${typeID}: _Needs([${prerequisites(typeID).map(([s, l]) => `(${s}, ${l})`).join(", ")}])`).join(", ")}}`;
  const casesLiteral = `[${cases.map((list) => `[${list.map(([s, l]) => `(${s}, ${l})`).join(", ")}]`).join(",\n")}]`;
  fs.writeFileSync(path.join(work, "module.py"), source, "latin1");
  fs.writeFileSync(path.join(work, "cases.py"), `NEEDS = ${needsLiteral}\nVALID = [${[...valid].join(", ")}]\nCASES = ${casesLiteral}\n`, "latin1");
  const snippet = `${STANDINS}
__ns = {'__name__': 'skillPlanValidation'}
exec compile(open(${JSON.stringify(path.join(work, "module.py").replace(/\\/g, "/"))}).read(), 'skillPlanValidation.py', 'exec') in __ns
__data = {'_Needs': _Needs}
exec open(${JSON.stringify(path.join(work, "cases.py").replace(/\\/g, "/"))}).read() in __data
__skills = set(__data['VALID'])
for __list in __data['CASES']:
    __copy = list(__list)
    try:
        __changed = __ns['ValidateSkillPlan'](__copy, __skills, __data['NEEDS'])
        out('%s %r' % ('Y' if __changed else 'N', [list(pair) for pair in __copy]))
    except Exception, e:
        out('ERR %s: %s' % (type(e).__name__, ' '.join(str(e).split())))
`;
  fs.writeFileSync(path.join(work, "snippet.py"), snippet, "latin1");
  const printed = childProcess.execFileSync("python", [
    path.join(__dirname, "py27-oracle.py"),
    path.join(clientRoot, "tq", "bin64"),
    path.join(work, "snippet.py"),
  ], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8").split(/\r?\n/).filter((line) => line !== "");
  fs.rmSync(work, { recursive: true, force: true });

  {
    let same = 0;
    let changedCount = 0;
    let errors = 0;
    const differ = [];
    cases.forEach((list, at) => {
      const copy = list.map((pair) => [...pair]);
      let mine;
      try {
        const changed = validateSkillPlan(copy, facts);
        mine = `${changed ? "Y" : "N"} ${JSON.stringify(copy).replace(/,/g, ", ")}`;
      } catch {
        mine = "ERR ValueError";
      }
      const theirs = printed[at] && printed[at].startsWith("ERR ") ? printed[at].split(":")[0] : printed[at];
      if (mine === theirs) same += 1;
      else differ.push({ at, list, mine, theirs });
      if (theirs && theirs.startsWith("Y")) changedCount += 1;
      if (theirs && theirs.startsWith("ERR")) errors += 1;
    });
    console.log(`${cases.length} plans, ${same} the same (the client's said changed for ${changedCount}, raised for ${errors}); ${reached.size} skills' needs`);
    for (const one of differ.slice(0, 5)) {
      console.log(`plan ${one.at} ${JSON.stringify(one.list)}\n  client ${one.theirs}\n  port   ${one.mine}`);
    }
    if (differ.length > 0 || printed.length !== cases.length) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
