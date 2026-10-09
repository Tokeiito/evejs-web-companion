// The Travel panel's route settings, drawn. The words are made up; the labels are the client's
// (nav/autopilotSettings.ts).

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const { default: Panel } = (await import("./Travel.svelte")) as { default: unknown };

const CLIENT_WORDS: Record<string, string> = {
  "UI/Map/MapPallet/cbPreferShorter": "<b>Quickest</b>",
  "UI/Map/MapPallet/cbPreferSafer": "Most careful",
  "UI/Map/MapPallet/cbPreferRisky": "Least careful",
  "UI/Map/MapPallet/lblSecurityPenelity": "Carefulness",
  "UI/Map/MapPallet/cbAdvoidSystemsOnList": "Keep clear of my list",
};

function drawn(kept: Record<string, unknown>, clientWords: boolean): string {
  const store = createClientStore();
  store.apply({ type: "character/online", character: { characterID: 140000002, characterName: "Test Two", stationID: 60000004, structureID: null, solarSystemID: 30002780, corporationID: 1000002 }, station: null } as never);
  if (clientWords) {
    store.apply({ type: "words/loaded", available: true, templates: CLIENT_WORDS });
  }
  // Every call the panel makes of the flow is answered with nothing, but the one for the settings.
  const flow = new Proxy({ autopilotSettings: () => kept }, { get: (target, name) => (name in target ? target[name as keyof typeof target] : () => undefined) });
  const body = (render(Panel as never, { props: { store, flow } } as never) as { body: string }).body;
  const from = body.indexOf('<section class="route-settings');
  assert.ok(from >= 0, "the route settings are drawn");
  return body.slice(from, body.indexOf("</section>", from));
}
const text = (html: string): string => html.replace(/<!--.*?-->/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const checked = (html: string): string[] => [...html.matchAll(/<input[^>]*>/g)].map((match) => match[0]).filter((input) => /\schecked(=|\s|>|\/)/.test(input)).map((input) => /value="([^"]*)"/.exec(input)?.[1] ?? /type="([^"]*)"/.exec(input)![1]!);

test("with nothing set: the safer route chosen, the penalty at 50, and avoiding ticked, in the client's words", () => {
  const html = drawn({}, true);
  assert.equal(text(html), "Route settings Quickest Most careful Least careful Carefulness 50 Keep clear of my list");
  assert.deepEqual(checked(html), ["safe", "checkbox"]);
  assert.match(html, /<input[^>]*type="range"[^>]*min="1"[^>]*max="100"[^>]*value="50"/);
});

test("what the pilot has set is what is drawn", () => {
  const html = drawn({ pfRouteType: "shortest", pfPenalty: 12.7, pfAvoidSystems: false }, true);
  assert.deepEqual(checked(html), ["shortest"]);
  assert.match(text(html), /Carefulness 12 Keep clear of my list$/);
  // The slider stands where it was let go, though its label is in whole numbers.
  assert.match(html, /<input[^>]*type="range"[^>]*value="12.7"/);
  assert.deepEqual(checked(drawn({ pfRouteType: "unsafe", pfAvoidSystems: true }, true)), ["unsafe", "checkbox"]);
  // A route type the panel does not offer is none of its three.
  assert.deepEqual(checked(drawn({ pfRouteType: "unsafe + zerosec" }, true)), ["checkbox"]);
});

test("without the client's words the settings are in this page's own", () => {
  assert.equal(text(drawn({}, false)), "Route settings Prefer shorter Prefer safer Prefer less secure Security penalty 50 Avoid the systems on the list");
});
