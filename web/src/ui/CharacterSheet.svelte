<script lang="ts">
  // Character Sheet page (goal R56): who this character is — name, security
  // status, corporation, alliance, home station, bio and the active clone's
  // implants. A pure reader of the store; the read lives in app/flow.ts
  // (loadCharacterSheet) and the BFF holds the session.
  //
  // ⚠ R7d is the whole point. Every id is turned into a NAME by resolvedName,
  // which NEVER returns the raw number: corporationID / allianceID / home
  // stationID / implant typeIDs all resolve through /api/names, and an id static
  // data cannot name (a PLAYER corporation — Farmer's own corp does exactly this)
  // degrades to a plain "Unknown …" label, not the id. securityStatus is a float
  // shown as-is; bloodline / race / ancestry have no name path and are not read
  // at all.
  //
  // ⚠ empty vs failed, per section. Each field is null while unread OR when its
  // read FAILED (the reason rides in the matching *Error); an empty bio ("") and
  // a clean clone (no implants) are REAL answers shown honestly, not failures.
  //
  // The skill history is the client's History panel's skills tab (bridge/skillHistoryPanel.ts): the date, the
  // skill, what happened and the level, the newest first, in the client's own words where the player's install
  // has them.
  import { onMount } from "svelte";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import { formatSecurityStatus } from "../bridge/characterSheet.ts";
  import { formatTemplate } from "../bridge/clientWords.ts";
  import {
    SKILL_HISTORY_DATE_LABEL,
    SKILL_HISTORY_HEADER_LABELS,
    SKILL_HISTORY_WORD_LABELS,
    skillHistoryActionLabel,
  } from "../bridge/skillHistoryPanel.ts";
  import { resolvedName } from "../store/names.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const sheet = store.characterSheet;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const words = store.words;

  let busy = $state(false);
  let error = $state("");

  async function run(action: () => Promise<void> | void): Promise<void> {
    busy = true;
    error = "";
    try {
      await action();
    } catch (cause) {
      if (isSessionLost(cause)) {
        return;
      }
      error =
        panelErrorWords(cause);
    } finally {
      busy = false;
    }
  }

  function refresh(): void {
    void run(async () => {
      await Promise.all([flow.loadCharacterSheet(), flow.loadSkillHistory()]);
    });
  }

  onMount(() => {
    flow.requestWords(SKILL_HISTORY_WORD_LABELS);
    refresh();
  });

  /** The client's word for a label, from the player's install; the page's own where there is none to read. */
  function word(label: string, own: string): string {
    const template = $words.templates[label];
    return typeof template === "string" ? template : own;
  }

  // The page's own words for what happened, where the client's are not to be read.
  const OWN_ACTION_WORDS: Readonly<Record<number, string>> = {
    24: "Gift",
    34: "Clone penalty",
    36: "Training started",
    37: "Training complete",
    38: "Training stopped",
    39: "Given by a GM",
    53: "Training complete",
    307: "Free skill points applied",
    431: "Skill level extracted",
  };

  /** FmtDate(logDate, 'ls'): the client's label with the date in it; the game's date and time plainly without it. */
  function historyDate(logDate: string): string {
    return formatTemplate(word(SKILL_HISTORY_DATE_LABEL, "{[datetime]datetime}"), { datetime: logDate }, {
      nameOf: (kind, id) => resolvedName($names.resolved, kind, id, ""),
    });
  }

  // The security-status colour band, matching the retail scale: positive is
  // lawful (good), negative is an outlaw (bad), exactly 0 is neutral.
  function securityTone(status: number): "good" | "bad" | "neutral" {
    if (status > 0) {
      return "good";
    }
    if (status < 0) {
      return "bad";
    }
    return "neutral";
  }
</script>

<section class="panel">
  <!-- ⚠ REFRESH LIVES IN THE STRIP, NOT AT THE BOTTOM OF THE PAGE. It used
       to be a bare <p><button> after the last section, so this window put its
       one action somewhere no other window puts one — below content of
       unpredictable length, which on a full read meant scrolling past
       everything to reach it. Nothing was added or taken away; the control
       moved to the band every other window keeps its controls in. -->
  <header class="panel-head">
    <h2 class="panel-title">Character Sheet</h2>
    <span class="controls">
      <button type="button" disabled={busy} onclick={refresh}>Refresh</button>
    </span>
  </header>

  {#if error}
    <p class="error">Could not read your character sheet: {error}</p>
  {/if}

  <!-- Identity: name, corporation, alliance, security status. -->
  {#if $sheet.identityError}
    <p class="error">{$sheet.identityError}</p>
  {:else if $sheet.identity === null}
    <p class="empty">Reading your character…</p>
  {:else}
    <h3 class="name">{$sheet.identity.characterName}</h3>
    <dl class="facts">
      <div>
        <dt>Corporation</dt>
        <dd>
          {resolvedName(
            $names.resolved,
            "corporation",
            $sheet.identity.corporationID,
            "Unknown corporation",
          )}
        </dd>
      </div>
      {#if $sheet.identity.allianceID !== null}
        <div>
          <dt>Alliance</dt>
          <dd>
            {resolvedName(
              $names.resolved,
              "alliance",
              $sheet.identity.allianceID,
              "Unknown alliance",
            )}
          </dd>
        </div>
      {/if}
      <div>
        <dt>Security status</dt>
        <dd class="value {securityTone($sheet.identity.securityStatus)}">
          {formatSecurityStatus($sheet.identity.securityStatus)}
        </dd>
      </div>
    </dl>
  {/if}

  <!-- Home station (the medical-clone home), by name. -->
  <h3>Home station</h3>
  {#if $sheet.homeStationError}
    <p class="error">{$sheet.homeStationError}</p>
  {:else if $sheet.homeStationID === null}
    <p class="empty">Reading your home station…</p>
  {:else}
    <p>{resolvedName($names.resolved, "station", $sheet.homeStationID, "Unknown station")}</p>
  {/if}

  <!-- Bio. An empty bio is a real answer, not a failure. -->
  <h3>Bio</h3>
  {#if $sheet.descriptionError}
    <p class="error">{$sheet.descriptionError}</p>
  {:else if $sheet.description === null}
    <p class="empty">Reading your bio…</p>
  {:else if $sheet.description.trim() === ""}
    <p class="empty">You have not written a bio.</p>
  {:else}
    <p class="bio">{$sheet.description}</p>
  {/if}

  <!-- Active clone's implants, by name. A clean clone is a real answer. -->
  <h3>Implants</h3>
  {#if $sheet.cloneError}
    <p class="error">{$sheet.cloneError}</p>
  {:else if $sheet.clone === null}
    <p class="empty">Reading your clone…</p>
  {:else if $sheet.clone.implants.length === 0}
    <p class="empty">Your active clone has no implants.</p>
  {:else}
    <ul class="implants">
      {#each $sheet.clone.implants as implant (implant.typeID)}
        <li>{resolvedName($names.resolved, "type", implant.typeID, "Unknown implant")}</li>
      {/each}
    </ul>
  {/if}

  <!-- The skill history, as the client's History panel's skills tab lists it. No rows is a real answer. -->
  <h3>Skill history</h3>
  {#if $sheet.skillHistoryError}
    <p class="error">{$sheet.skillHistoryError}</p>
  {:else if $sheet.skillHistory === null}
    <p class="empty">Reading your skill history…</p>
  {:else if $sheet.skillHistory.length === 0}
    <p class="empty">{word(SKILL_HISTORY_HEADER_LABELS.none, "No records found.")}</p>
  {:else}
    <div class="table-wrap overflow-x-auto">
      <table class="guests reflow skill-history">
        <thead>
          <tr>
            <th>{word(SKILL_HISTORY_HEADER_LABELS.date, "Date")}</th>
            <th>{word(SKILL_HISTORY_HEADER_LABELS.skill, "Skill")}</th>
            <th>{word(SKILL_HISTORY_HEADER_LABELS.action, "Action")}</th>
            <th>{word(SKILL_HISTORY_HEADER_LABELS.level, "Level")}</th>
          </tr>
        </thead>
        <tbody>
          {#each $sheet.skillHistory as line, place (place)}
            <tr>
              <td class="value">{historyDate(line.logDate)}</td>
              <td>{resolvedName($names.resolved, "type", line.skillTypeID, "Unknown skill")}</td>
              <td>{word(skillHistoryActionLabel(line.eventTypeID), OWN_ACTION_WORDS[line.eventTypeID] ?? "Unknown")}</td>
              <td class="value">{line.level}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

</section>

<style>
  .name {
    margin-bottom: 0.25rem;
  }
  dl.facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25rem 1rem;
    margin: 0 0 0.75rem 0;
  }
  dl.facts > div {
    display: contents;
  }
  dl.facts dt {
    color: rgba(128, 128, 128, 0.9);
  }
  dl.facts dd {
    margin: 0;
  }
  .value {
    font-variant-numeric: tabular-nums;
  }
  .bio {
    white-space: pre-wrap;
    max-width: 48rem;
  }
  ul.implants {
    list-style: none;
    margin: 0 0 0.75rem 0;
    padding: 0;
  }
  ul.implants li {
    padding: 0.35rem 0.5rem;
    min-height: 40px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid rgba(128, 128, 128, 0.25);
  }
  .empty {
    color: rgba(128, 128, 128, 0.9);
  }
  /* ⚠ NO LOCAL `button` RULE HERE. It set `min-height: 40px` — which is
     exactly what the shared button already is (R8's touch minimum, 2.5rem in
     styles.css), so it changed nothing a player could see. What it did do,
     being a component-scoped rule, was outrank the layered stylesheet: this
     panel's Refresh ignored the strip's own sizing and left the Character
     Sheet window standing 10px taller than every other window's strip. A
     per-panel restatement of a shared rule costs nothing until the shared
     rule changes, and then it is the one panel that does not follow. */
  .good {
    color: #2e7d32;
  }
  .bad {
    color: #c62828;
  }
  @media (prefers-color-scheme: dark) {
    .good {
      color: #7fce82;
    }
    .bad {
      color: #ef8a8a;
    }
  }
</style>
