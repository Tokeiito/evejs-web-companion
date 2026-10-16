// The character's settings that the client keeps at the server, as its character settings service has them
// (eve/client/script/ui/services/characterSettingsSvc.py), and a setting kept as the client's CharacterSettingsObject
// keeps one (characterSettingsStorage/characterSettingsObject.py).
//
// THE SERVICE: charMgr.GetCharacterSettings(), asked once and kept (31 to 34; the transport keeps it the same way and
// answers the page from it); Get reads one by its key (36 to 42). Save (44 to 50): an empty value is deleted instead;
// otherwise SaveCharacterSetting(key, value), and the value is kept. Delete (52 to 58): DeleteCharacterSetting(key) for
// a setting it keeps. The transport works each into what it keeps.
//
// THE OBJECT: a setting's text is YAML for {lists: {...}, singleValues: {...}} (UploadSettingsFromYamlString, 23 to
// 31), nothing standing for both empty; GetSingleValue and SetSingleValue read and set one of its singleValues; it
// goes back to the server as yaml.safe_dump of the whole (GetYamlStringForServer, 33 to 35).

import type { Ask } from "./ask.ts";
import { descriptionMapping } from "./walletJournal.ts";
import { readKeyVal, type JsonValue } from "./wire.ts";

/**
 * characterSettingsSvc.Get(settingKey): the setting's text; null where the character has none. The settings come as a
 * utillib.KeyVal (Tranquility's answer, and EveJS's), which the page's readKeyVal, for util.KeyVal alone, does not read.
 */
export async function readCharacterSetting(ask: Ask, settingKey: string): Promise<string | null> {
  const settings = await ask("charMgr", "GetCharacterSettings", []);
  const args = settings !== null && typeof settings === "object" && !Array.isArray(settings) && (settings as { type?: unknown }).type === "object"
    ? (settings as { args?: unknown }).args
    : null;
  const entries = args !== null && typeof args === "object" && Array.isArray((args as { entries?: unknown }).entries) ? (args as { entries: unknown[] }).entries : [];
  const found = entries.find((entry) => Array.isArray(entry) && entry[0] === settingKey) as [string, JsonValue] | undefined;
  const value = found ? found[1] : readKeyVal(settings, settingKey);
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object" && !Array.isArray(value) && typeof (value as { value?: unknown }).value === "string") {
    return (value as { value: string }).value;
  }
  return null;
}

/** characterSettingsSvc.Save(settingKey, value): an empty value deleted instead, as the service does. */
export async function saveCharacterSetting(act: Ask, settingKey: string, value: string | null): Promise<void> {
  if (value === null || value === "") {
    await act("charMgr", "DeleteCharacterSetting", [settingKey]);
    return;
  }
  if (value.length > 102_400) throw new Error("That setting is too long to keep at the server.");
  await act("charMgr", "SaveCharacterSetting", [settingKey, value]);
}

type Scalar = string | number | boolean | null;
type Value = Scalar | readonly Value[] | { readonly [key: string]: Value };

/** CharacterSettingsObject: the setting's lists and single values. */
export interface CharacterSettingsObject {
  readonly lists: Readonly<Record<string, Value>>;
  readonly singleValues: Readonly<Record<string, Value>>;
}

/** UploadSettingsFromYamlString: the setting's text read, both parts there; nothing, or text that is no mapping, both empty. */
export function characterSettingsObject(yamlString: string | null): CharacterSettingsObject {
  const mapping = yamlString ? descriptionMapping(yamlString) : null;
  const part = (name: string): Record<string, Value> => {
    const value = mapping?.[name];
    return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, Value>) } : {};
  };
  return { lists: part("lists"), singleValues: part("singleValues") };
}

/** PyYAML's plain scalar, quoted where it could be read as something else. */
function scalarText(value: Scalar): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
  const plain = /^[A-Za-z_][A-Za-z0-9_ .\/-]*$/.test(value) && !/^(true|false|yes|no|on|off|null|~)$/i.test(value) && !/\s$/.test(value);
  return plain ? value : `'${value.replace(/'/g, "''")}'`;
}

const isScalar = (value: Value): value is Scalar => value === null || typeof value !== "object";

/** A value in flow style, as PyYAML writes a collection of scalars. */
function flowText(value: Value): string {
  if (isScalar(value)) return scalarText(value);
  if (Array.isArray(value)) return `[${value.map(flowText).join(", ")}]`;
  const entries = Object.keys(value).sort().map((key) => `${scalarText(key)}: ${flowText((value as Record<string, Value>)[key]!)}`);
  return `{${entries.join(", ")}}`;
}

/** Whether PyYAML (default_flow_style None) writes a collection in flow style: it holds no collection. */
function allScalars(value: Value): boolean {
  if (isScalar(value)) return true;
  const items = Array.isArray(value) ? value : Object.values(value as Record<string, Value>);
  return items.every(isScalar);
}

function blockText(value: Record<string, Value>, indent: string): string {
  return Object.keys(value).sort().map((key) => {
    const item = value[key]!;
    if (isScalar(item) || allScalars(item)) return `${indent}${scalarText(key)}: ${flowText(item)}\n`;
    if (Array.isArray(item)) return `${indent}${scalarText(key)}:\n${item.map((each) => `${indent}- ${flowText(each)}\n`).join("")}`;
    return `${indent}${scalarText(key)}:\n${blockText(item as Record<string, Value>, `${indent}  `)}`;
  }).join("");
}

/** GetYamlStringForServer: yaml.safe_dump of the whole, its keys in order, a collection of scalars in flow style. */
export function characterSettingsYaml(settings: CharacterSettingsObject): string {
  return blockText({ lists: settings.lists, singleValues: settings.singleValues }, "");
}

/** GetSingleValue(settingKey, defaultValue). */
export function singleValue<T extends Value>(settings: CharacterSettingsObject, settingKey: string, defaultValue: T): Value {
  return Object.hasOwn(settings.singleValues, settingKey) ? settings.singleValues[settingKey]! : defaultValue;
}

/** SetSingleValue(settingKey, newValue), as a new object. */
export function withSingleValue(settings: CharacterSettingsObject, settingKey: string, value: Value): CharacterSettingsObject {
  return { lists: settings.lists, singleValues: { ...settings.singleValues, [settingKey]: value } };
}

