<script module lang="ts">
  let topZ = $state(40);
</script>
<script lang="ts">
  // pvptradewnd37-178: two 64px portraits, own/other inventory and money,
  // offer indicators, and the native Accept / Cancel / Offer Money actions.
  import { onMount, untrack } from "svelte";
  import type { Session } from "../app/sessions.ts";
  import { tradeAccepted, type DirectTradeWindow } from "../app/directTrades.ts";
  import { readRowField, type JsonValue } from "../bridge/wire.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { formatNumeric } from "../bridge/pyNumbers.ts";
  import { resolvedName } from "../store/names.ts";
  import { showOwnerInfo } from "./ownerInfo.ts";
  import { portraitUrl, portraitDefaultPath } from "./ownerImages.ts";
  import { clientTexture } from "./skillGroupIcons.ts";
  import { notify } from "./notices.ts";
  import DesktopWindow from "./DesktopWindow.svelte";
  import OwnerPicture from "./OwnerPicture.svelte";
  let { session, trade, inFront }: { session: Session; trade: DirectTradeWindow; inFront: boolean } = $props();
  // svelte-ignore state_referenced_locally
  const words = session.store.words, names = session.store.names, station = session.store.station, images = session.flow.imageServer;
  // svelte-ignore state_referenced_locally
  let geometry = $state({ x: (session.store.station.get().online?.characterID ?? 0) % 2 ? 40 : 540,
    y: 100, w: 460, h: 500, z: ++topZ, minimized: false });
  let busy = $state(false), split = $state(50);
  const myID = $derived($station.online?.characterID ?? 0), otherID = $derived(trade.state.traders.find(id => id !== myID)!);
  const indexes = $derived([trade.state.traders.indexOf(myID), trade.state.traders.indexOf(otherID)]);
  const word = (label: string, fallback: string) => plainText($words.templates[label] ?? fallback);
  const name = (id: number) => resolvedName($names.resolved, "owner", id, String(id));
  const caption = $derived(plainText(formatTemplate($words.templates["UI/PVPTrade/TradeWith"] ?? "Trade with {otherParty}", { otherParty: otherID }, { nameOf: (_kind, id) => name(id) })));
  let lastRaised = 0;
  $effect(() => { const raised = trade.raised; if (raised !== lastRaised) { lastRaised = raised; untrack(() => geometry = { ...geometry, minimized: false, z: ++topZ }); } });
  $effect(() => { session.flow.requestNames(trade.state.items.map(row => ({ kind: "type" as const, id: Number(readRowField(row, "typeID")) }))); });
  function itemName(row: JsonValue): string {
    const item = Number(readRowField(row, "itemID")), type = Number(readRowField(row, "typeID"));
    return resolvedName($names.resolved, "evelocation", item, resolvedName($names.resolved, "type", type, String(type)));
  }
  function quantity(row: JsonValue): number { const quantity = Number(readRowField(row, "quantity")); return quantity < 0 ? 1 : quantity; }
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return; busy = true;
    try { await action(); }
    catch (cause) { session.flow.directTrades.report(cause); }
    finally { busy = false; }
  }
  function info(id: number): void { void showOwnerInfo(session.flow, id).catch(cause => notify({ kind: "danger", title: "Show Info", detail: String(cause) })); }
  function resizeSplit(event: PointerEvent): void {
    if (event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement, parent = handle.parentElement!;
    handle.setPointerCapture(event.pointerId);
    const move = (ev: PointerEvent) => { const rect = parent.getBoundingClientRect(); split = Math.max(35, Math.min(65, (ev.clientY - rect.top) / rect.height * 100)); };
    const end = () => { handle.releasePointerCapture(event.pointerId); handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", end); };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", end);
  }
  onMount(() => session.flow.loadImageServer());
</script>
<DesktopWindow win={{ ...geometry, id: trade.state.containerID }} title={caption} focused={geometry.z === topZ}
  onFocus={() => geometry = { ...geometry, z: ++topZ }} onClose={() => void run(() => session.flow.directTrades.cancel(trade.state.containerID))}
  onToggleMinimize={() => geometry = { ...geometry, minimized: !geometry.minimized }}
  onMove={(x, y) => geometry = { ...geometry, x, y }} onResize={(w, h) => geometry = { ...geometry, w: Math.max(300, w), h: Math.max(410, h) }}>
  <div class="trade-content" data-trade-container={trade.state.containerID}>
    {#if !inFront}<p class="for-pilot">For {name(myID)}</p>{/if}
    <div class="sides">
      {#each [myID, otherID] as ownerID, side}
        {@const index = indexes[side]!}
        {@const amount = trade.state.money[index]!}
        <section aria-label={name(ownerID)} style:flex-basis={side === 0 ? `${split}%` : undefined}>
          <div class="owner">
            <button class="portrait" type="button" title={name(ownerID)} onclick={() => info(ownerID)}><OwnerPicture name={name(ownerID)} urls={[portraitUrl($images, ownerID, 64), clientTexture(portraitDefaultPath(64))].filter((url): url is string => url !== null)} size={64} /></button>
            <div class="offer"><button type="button" class="owner-name" onclick={() => info(ownerID)}>{name(ownerID)}</button>
              <span class="accepted" aria-label={plainText(formatTemplate($words.templates["UI/PVPTrade/AcceptedHint"] ?? "Accepted by {name}", { name: name(ownerID) }, { nameOf: () => "" }))} style:visibility={tradeAccepted(trade.state.offers[index]!) ? "visible" : "hidden"}>✓</span>
              <span class:paying={side === 0 && amount > 0} class:receiving={side === 1 && amount > 0}>{plainText(formatTemplate($words.templates[side === 0 ? "UI/PVPTrade/MyCharacterOffers" : "UI/PVPTrade/OtherCharacterOffers"] ?? "Offers {formattedAmount}", { formattedAmount: `${formatNumeric(amount, { useGrouping: true, decimalPlaces: 0 })} ${word("UI/Common/ISK", "ISK")}` }, { nameOf: () => "" }))}</span>
            </div>
            {#if side === 0}<button class="money" type="button" disabled={busy || !trade.abortOnClose} onclick={() => void run(() => session.flow.directTrades.offerMoney(trade.state.containerID))}>{word("UI/PVPTrade/OfferMoney", "Offer Money")}</button>{/if}
          </div>
          <div class="inventory"><table><thead><tr><th>{word("UI/Common/Name", "Name")}</th><th>{word("UI/Common/Quantity", "Quantity")}</th></tr></thead><tbody>
            {#each trade.state.items.filter(row => Number(readRowField(row, "ownerID")) === ownerID) as row (Number(readRowField(row, "itemID")))}
              <tr><td>{itemName(row)}</td><td>{quantity(row).toLocaleString()}</td></tr>
            {/each}
          </tbody></table></div>
        </section>
        {#if side === 0}<div class="splitter" role="separator" aria-label="Trade panel divider" aria-orientation="horizontal" onpointerdown={resizeSplit}></div>{/if}
      {/each}
    </div>
    <div class="answers"><button type="button" disabled={busy || !trade.acceptEnabled || !trade.abortOnClose} onclick={() => void run(() => session.flow.directTrades.accept(trade.state.containerID))}>{word("UI/PVPTrade/Accept", "Accept")}</button><button type="button" disabled={busy || !trade.abortOnClose} onclick={() => void run(() => session.flow.directTrades.cancel(trade.state.containerID))}>{word("UI/Common/Buttons/Cancel", "Cancel")}</button></div>
  </div>
</DesktopWindow>
{#if geometry.minimized}<button class="restore-trade" type="button" onclick={() => geometry = { ...geometry, minimized: false, z: ++topZ }}>{caption}</button>{/if}
<style>
  .trade-content { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 8px; }
  .for-pilot { margin: 0; color: var(--color-accent); }
  .sides { display: flex; flex-direction: column; flex: 1; min-height: 0; }
  section { display: flex; flex-direction: column; min-height: 0; } section:last-child { flex: 1; }
  .owner { display: flex; gap: 8px; height: 64px; flex-shrink: 0; margin-bottom: 8px; }
  .portrait { padding: 0; border: 0; background: transparent; } .offer { display: flex; flex-direction: column; align-items: flex-start; flex: 1; min-width: 0; }
  .owner-name { border: 0; padding: 0; min-height: 0; height: 22px; flex-shrink: 0; line-height: 22px; font-size: 1rem; background: transparent; } .accepted { color: #6ed9a1; height: 22px; flex-shrink: 0; line-height: 22px; }
  .offer > span:last-child { white-space: nowrap; font-size: .8rem; line-height: 20px; } .paying { color: #ef7474; } .receiving { color: #6ed9a1; }
  .money { align-self: flex-start; font-size: .75rem; } .inventory { overflow: auto; flex: 1; min-height: 0; border: 1px solid var(--color-border); }
  table { width: 100%; font-size: .8rem; border-collapse: collapse; } th, td { text-align: left; padding: 4px 6px; } th:last-child, td:last-child { text-align: right; }
  thead { position: sticky; top: 0; background: var(--color-bg); }
  .splitter { height: 8px; flex-shrink: 0; cursor: row-resize; touch-action: none; border-top: 1px solid var(--color-border); margin-top: 4px; }
  .answers { display: flex; gap: 8px; padding-top: 8px; } .answers button { flex: 1; }
  .restore-trade { position: fixed; left: 1rem; bottom: 3rem; pointer-events: auto; }
</style>
