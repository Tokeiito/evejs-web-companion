// Socket faces (goal R21): the local icon URL and the text fallback.

import test from "node:test";
import assert from "node:assert/strict";

import { abbreviate, typeIconUrl } from "./fittingIcons.ts";

test("icons come from the LOCAL cache and never an external host", () => {
  const url = typeIconUrl(3634)!;
  assert.equal(url, "/icon-cache/types/64/icon/3634.png");
  // Same-origin, relative: no scheme, no host, nothing to leak.
  assert.ok(url.startsWith("/"));
  assert.doesNotMatch(url, /^https?:|\/\/|evetech|images\./);
});

test("a nonsense type has no icon rather than a broken URL", () => {
  assert.equal(typeIconUrl(0), null);
  assert.equal(typeIconUrl(-1), null);
  assert.equal(typeIconUrl(1.5), null);
  assert.equal(typeIconUrl(Number.NaN), null);
});

test("a short name is left exactly as it is", () => {
  assert.equal(abbreviate("Gyrostabilizer"), "Gyrostabilizer");
  assert.equal(abbreviate("Rifter"), "Rifter");
  assert.equal(abbreviate(""), "");
  assert.equal(abbreviate("   "), "");
});

test("a long name shortens to something a player still recognises", () => {
  assert.equal(abbreviate("425mm AutoCannon II"), "425mm AC II");
  assert.equal(abbreviate("Damage Control II"), "Damage Ctrl II");
  assert.equal(abbreviate("Large Shield Extender II"), "Lg Shield Ext II");
});

test("the tier marker always survives, so I and II never look alike", () => {
  const one = abbreviate("Multispectrum Shield Hardener I");
  const two = abbreviate("Multispectrum Shield Hardener II");
  assert.notEqual(one, two);
  assert.ok(one.endsWith(" I"), `${one} should keep its tier`);
  assert.ok(two.endsWith(" II"), `${two} should keep its tier`);
});

test("nothing ever gets long enough to burst the socket", () => {
  const names = [
    "Modulated Deep Core Strip Miner II",
    "Republic Fleet Large Shield Extender",
    "Domination Multispectrum Shield Hardener",
    "Ammatar Navy Medium Armor Repairer",
    "425mm Prototype Gauss Gun",
  ];
  for (const name of names) {
    const short = abbreviate(name);
    assert.ok(short.length <= 16, `"${name}" -> "${short}" is ${short.length} chars`);
    assert.ok(short.length > 0);
  }
});
