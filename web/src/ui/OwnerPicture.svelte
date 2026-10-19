<script lang="ts">
  // An owner's picture as the client's lists draw one (eveIcon.GetOwnerLogo, standingEntry.UpdateIcon): the pictures
  // it is given, tried in turn (the image server's, then the client's own default behind it: a portrait's silhouette),
  // and the owner's letters where none can be had. A fixed square, so a row keeps its height while a picture loads.
  import { iconInitials } from "./typeIcons.ts";

  interface Props {
    /** The owner's resolved name: its letters stand where no picture can be had. */
    name: string;
    /** The pictures to try, in turn. */
    urls: readonly string[];
    /** The square's side, in pixels. */
    size?: number;
  }

  let { name, urls, size = 32 }: Props = $props();

  /** The pictures already watched fail, by address, so a square reused for another owner tries that one's afresh. */
  let failed = $state<readonly string[]>([]);
  const src = $derived(urls.find((url) => !failed.includes(url)) ?? null);
</script>

<span class="owner-picture" style:width="{size}px" style:height="{size}px">
  {#if src !== null}
    <img
      {src}
      alt=""
      width={size}
      height={size}
      decoding="async"
      onerror={() => {
        if (src !== null) failed = [...failed, src];
      }}
    />
  {:else}
    <span class="owner-picture-tile" aria-hidden="true">{iconInitials(name)}</span>
  {/if}
</span>

<style>
  .owner-picture {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: var(--color-cell);
  }
  .owner-picture img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .owner-picture-tile {
    font-size: 11px;
    color: var(--color-muted);
  }
</style>
