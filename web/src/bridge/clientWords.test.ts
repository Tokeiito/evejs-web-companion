// The client's message templates, parsed and filled.
//
// The grammar is the client's own tokenizer's (localization/parser.py,
// _Tokenize). The templates below are made up, but written with the tags the
// client's real texts carry for the labels the server sends (seen with
// scripts/client-words.js): {[datetime]when}, {[item]skillID.name},
// {[numeric]skillLevel}, {[numeric]rpAmount}, {[character]player.name}.

import test from "node:test";
import assert from "node:assert/strict";

import { formatTemplate, parseTag, parseTemplate, templateNameRefs } from "./clientWords.ts";
import type { NameKind } from "../store/names.ts";

const NAMES: Record<string, string> = {
  "type:11448": "Electromagnetic Physics",
  "type:20424": "Datacore - Electronic Engineering",
  "type:34": "Tritanium",
  "owner:140000002": "Test Two",
  "owner:1000043": "Corporate Police Force",
  "station:60000004": "Muvolailen X - Moon 3 - CBD Corporation Storage",
  "system:30002780": "Muvolailen",
  "region:10000002": "The Forge",
  "structure:1030000000001": "A Citadel",
};
const nameOf = (kind: NameKind, id: number): string => NAMES[`${kind}:${id}`] ?? `${kind} ${id}`;
const context = { nameOf, playerID: 140000002 };
const fill = (template: string, args: Record<string, unknown> = {}) => formatTemplate(template, args as never, context);

// ── the grammar ──────────────────────────────────────────────────────────────

test("a tag is read as the client's tokenizer reads it", () => {
  assert.deepEqual(parseTag("{name}"), { raw: "{name}", type: "generic", name: "name", property: null, conditionals: [], modifiers: [], settings: {} });
  assert.deepEqual(parseTag("{[item]skillID.name}"), { raw: "{[item]skillID.name}", type: "item", name: "skillID", property: "name", conditionals: [], modifiers: [], settings: {} });
  assert.deepEqual(parseTag("{[numeric]amount, useGrouping, decimalPlaces=2}"), {
    raw: "{[numeric]amount, useGrouping, decimalPlaces=2}", type: "numeric", name: "amount", property: null, conditionals: [], modifiers: ["useGrouping"], settings: { decimalPlaces: "2" },
  });
  assert.deepEqual(parseTag('{[numeric]count.quantity -> "item", "items"}'), {
    raw: '{[numeric]count.quantity -> "item", "items"}', type: "numeric", name: "count", property: "quantity", conditionals: ["item", "items"], modifiers: [], settings: {},
  });
  assert.deepEqual(parseTag('{[datetime]when, date="short", time=none}')?.settings, { date: "short", time: "none" });
  // The kind's name is taken without regard to case, as the client's table is.
  assert.equal(parseTag("{[npcOrganization]corp.name}")?.type, "npcorganization");
  // An empty word among the choices is a choice.
  assert.deepEqual(parseTag('{[character]who.gender -> "", "x"}')?.conditionals, ["", "x"]);
});

test("what the client's tokenizer would refuse is not a tag", () => {
  for (const wrong of ["{}", "{ }", "{[item}", "{[item]}", "{[]name}", "{9lives}", "{name.}", "{name.9}", "{[item.name}", '{a -> b}', '{a -> "x" "y"}', '{a -> "x" : "y"}', "{a, b=}", "{a b}", "{a = b}"]) {
    assert.equal(parseTag(wrong), null, wrong);
  }
});

test("a template is its text and its tags in order, and a brace run that is no tag stays text", () => {
  const parts = parseTemplate("Before {[item]thing.name} between {count} after {not a tag} end");
  assert.deepEqual(parts.map((part) => (typeof part === "string" ? part : `<${part.type}:${part.name}>`)), [
    "Before ", "<item:thing>", " between ", "<generic:count>", " after ", "{not a tag}", " end",
  ]);
  assert.deepEqual(parseTemplate("no tags at all"), ["no tags at all"]);
  assert.deepEqual(parseTemplate(""), []);
  // A doubled brace does not start a tag; the one after it does, as in the client's own pattern.
  const doubled = parseTemplate("{{literal}");
  assert.equal(doubled.length, 2);
  assert.equal(doubled[0], "{");
  assert.equal(typeof doubled[1] === "string" ? null : doubled[1]?.name, "literal");
});

// ── filling ──────────────────────────────────────────────────────────────────

test("an item, a character, an organisation and a place are filled by name", () => {
  assert.equal(fill("{[item]skillID.name} level {[numeric]skillLevel}", { skillID: 11448, skillLevel: 2 }), "Electromagnetic Physics level 2");
  assert.equal(fill("Greetings, {[character]who.name}.", { who: 140000002 }), "Greetings, Test Two.");
  assert.equal(fill("{[npcOrganization]corp.name}", { corp: 1000043 }), "Corporate Police Force");
  // A place is looked up as what its ID says it is.
  assert.equal(fill("{[location]a.name} / {[location]b.name} / {[location]c.name} / {[location]d.name}", { a: 60000004, b: 30002780, c: 10000002, d: 1030000000001 }),
    "Muvolailen X - Moon 3 - CBD Corporation Storage / Muvolailen / The Forge / A Citadel");
  // With no property at all the name is still what is shown.
  assert.equal(fill("{[item]t}", { t: 34 }), "Tritanium");
  assert.equal(fill("{[item]t.nameWithArticle} and {[item]e.nameWithArticle}", { t: 34, e: 11448 }), "a Tritanium and an Electromagnetic Physics");
  // A name the page does not have yet is the stand-in the page gives, not a blank.
  assert.equal(fill("{[item]t.name}", { t: 999 }), "type 999");
});

test("the player is the character the page is flying, unless the message names another", () => {
  assert.equal(fill("Greetings, {[character]player.name}."), "Greetings, Test Two.");
  assert.equal(fill("Greetings, {[character]player.name}.", { player: 1000043 }), "Greetings, Corporate Police Force.");
  assert.equal(formatTemplate("Greetings, {[character]player.name}.", {}, { nameOf }), "Greetings, .");
});

test("a number is plain unless the template asks for grouping, and takes the decimal places it asks for", () => {
  assert.equal(fill("{[numeric]rp} RP + {[numeric]isk} ISK", { rp: 100, isk: 10000 }), "100 RP + 10000 ISK");
  assert.equal(fill("{[numeric]isk, useGrouping}", { isk: 1234567 }), "1,234,567");
  assert.equal(fill("{[numeric]isk, useGrouping, decimalPlaces=2}", { isk: 1234567.5 }), "1,234,567.50");
  assert.equal(fill("{[numeric]x, decimalPlaces=1}", { x: 2.25 }), "2.3");
  // However the bridge spelled it.
  assert.equal(fill("{[numeric]a} {[numeric]b}", { a: "42", b: { type: "long", value: "9000000000" } }), "42 9000000000");
  assert.equal(fill("{[numeric]x}", { x: "many" }), "");
});

test("a time is the game's own form, in its own clock", () => {
  // 2026-10-08 11:30:15 UTC as the server writes a time: 100 ns ticks since 1601.
  const when = { type: "long", value: String((BigInt(Date.UTC(2026, 9, 8, 11, 30, 15)) + 11644473600000n) * 10000n) };
  assert.equal(fill("before {[datetime]when} you", { when }), "before 2026.10.08 11:30 you");
  assert.equal(fill("{[datetime]when, time=none}", { when }), "2026.10.08");
  assert.equal(fill("{[datetime]when, date=none}", { when }), "11:30");
  assert.equal(fill("{[formattedtime]when}", { when }), "2026.10.08 11:30");
  assert.equal(fill("{[datetime]when}", { when: "soon" }), "");
  // A length of time, in the same ticks.
  assert.equal(fill("{[timeinterval]t}", { t: 10_000_000 * (86_400 + 2 * 3_600 + 5 * 60 + 7) }), "1d 2h 5m 7s");
  assert.equal(fill("{[timeinterval]t}", { t: 10_000_000 * 3_600 }), "1h");
  assert.equal(fill("{[timeinterval]t}", { t: 0 }), "0s");
});

test("a word chosen by a count takes the first for one and the last for any other", () => {
  const template = '{[numeric]n} {[numeric]n.quantity -> "datacore", "datacores"}';
  assert.equal(fill(template, { n: 1 }), "1 datacore");
  assert.equal(fill(template, { n: 3 }), "3 datacores");
  assert.equal(fill(template, { n: 0 }), "0 datacores");
  // Chosen by gender, which the page does not know: the first.
  assert.equal(fill('{[character]who.gender -> "his", "her"} ship', { who: 140000002 }), "his ship");
});

test("the modifiers change the case, and linkify changes nothing here", () => {
  assert.equal(fill("{[item]t.name, uppercase} {[item]t.name, lowercase} {word, capitalize} {phrase, titlecase} {[item]t.name, linkify}", { t: 34, word: "hello there", phrase: "the forge" }),
    "TRITANIUM tritanium Hello there The Forge Tritanium");
});

test("a plain value is shown as it is; one that was not sent, or is of a kind not done, shows nothing", () => {
  assert.equal(fill("{who} has {count}", { who: "Someone", count: 7 }), "Someone has 7");
  assert.equal(fill("[{missing}] [{[item]missing.name}] [{[characterlist]them}] [{[messageid]m}]", { them: [1, 2], m: 5 }), "[] [] [] []");
  assert.equal(fill("{flag}", { flag: true }), "");
  // What is not a tag is left exactly as written.
  assert.equal(fill("keep {this one} and {}", {}), "keep {this one} and {}");
});

// ── the names a template needs ───────────────────────────────────────────────

test("the names a template needs are asked for under the kinds they are shown by", () => {
  const key = (template: string, args: Record<string, unknown>, ctx = {}) => templateNameRefs(template, args as never, ctx).map((ref) => `${ref.kind}:${ref.id}`);
  assert.deepEqual(key("{[item]skillID.name} {[numeric]skillLevel} {[location]where.name} {[npcOrganization]corp.name}", { skillID: 11448, skillLevel: 2, where: 60000004, corp: 1000043 }),
    ["type:11448", "station:60000004", "owner:1000043"]);
  assert.deepEqual(key("{[character]player.name}", {}, { playerID: 140000002 }), ["owner:140000002"]);
  assert.deepEqual(key("{[character]player.name}", {}), []);
  // Nothing for a value that was not sent, is not an ID, or only chooses a word.
  assert.deepEqual(key('{[item]a.name} {[item]b.name} {[character]c.gender -> "x", "y"} {plain}', { b: "x", c: 140000002, plain: 5 }), []);
});
