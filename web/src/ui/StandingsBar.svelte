<script lang="ts">
  // The standings bar across the top of the client's standings panel (standings/standingsBar.py StandingsBar,
  // UpdateWithStandings and Animate): -10 to 10, the selected owner's standing drawn out from the middle, and where the
  // standing an owner is dealt by is another's and above nought (GetStandingUsed: an agent's or an NPC corporation's
  // derived standing) that one too, after it. Each with its hint (StandingsBarHint, StandingsBarHintToCorp). Its axis
  // labels beneath it.
  //
  // Above it its threshold icons (UpdateThresholdIcons, ui/standingsThresholds.ts), each over its standing with the
  // dashed line down to the bar, a second at one standing below the bar instead; lit in the standing's colour where
  // the standing dealt by reaches it (GetColorAndOpacity), each with its tooltip, and opening what the client opens.
  // Not here: an increase bar the panel never has (its Update gives no increase).
  import { clientTexture } from "./skillGroupIcons.ts";
  import type { ThresholdIcon } from "./standingsThresholds.ts";

  interface Props {
    /** GetStanding2To1: the selected owner's standing toward the panel's owner. */
    standing: number;
    /** GetStandingUsed's standing. */
    usedStanding: number;
    /** The bar's hint and the second bar's, filled. */
    hint: string;
    derivedHint: string;
    /** The threshold icons, and whether the axis's nought is hidden. */
    icons?: readonly ThresholdIcon[];
    hideZeroLabel?: boolean;
    /** An icon's tooltip, written out. */
    iconHint?: (icon: ThresholdIcon) => string;
    /** What an icon opens, where it opens anything. */
    iconClick?: (icon: ThresholdIcon) => (() => void) | null;
  }

  let { standing, usedStanding, hint, derivedHint, icons = [], hideZeroLabel = false, iconHint = () => "", iconClick = () => null }: Props = $props();
  const line = `url(${clientTexture("res:/UI/Texture/Classes/Standings/thresholdLine.png")})`;

  /** standingUIConst COLOR_GOOD and COLOR_BAD by GetStandingColor (THRESHOLD_BAD nought), and Color.GRAY5. */
  const COLOR_GOOD = "rgb(68, 140, 180)";
  const COLOR_BAD = "rgb(153, 52, 40)";
  const GRAY5 = "rgb(128, 128, 128)";
  const standingColor = (value: number): string => (value < 0.0 ? COLOR_BAD : COLOR_GOOD);

  /** GetBarLeftWidth: as shares of the bar's width. */
  const main = $derived.by(() => {
    let width = standing / 20.0;
    width = width !== 0.0 ? Math.abs(width) : 1e-17;
    return { left: standing > 0.0 ? 0.5 : 0.5 - width, width };
  });
  /** The second bar, shown where the standing dealt by differs and is above nought; it follows the first. */
  const second = $derived.by(() => {
    if (!(usedStanding !== standing && usedStanding > 0.0)) return null;
    // GetSecondaryBarWidth.
    const width = standing < 0.0 ? (usedStanding + 10.0) / 40.0 : (usedStanding - standing) / 20.0;
    return { left: main.left + main.width, width: Math.max(0, width) };
  });
  /** GetBarColor: grey where the second bar is above it. */
  const mainColor = $derived(usedStanding && usedStanding > standing ? GRAY5 : standingColor(standing));

  const arrows = `url(${clientTexture("res:/UI/Texture/Classes/Standings/arrows_20.png")})`;
  const backgroundArrows = `url(${clientTexture("res:/UI/Texture/Classes/Standings/barArrowBG.png")})`;
</script>

<div class="standings-bar">
  {#each icons as icon (icon.key)}
    {@const open = iconClick(icon)}
    <!-- ThresholdIcon: at its standing; its colour lit (GetStandingColor), else white and faint. -->
    <button
      type="button"
      class="standings-threshold"
      class:duplicate={icon.duplicate}
      title={iconHint(icon)}
      style:left="calc({((icon.threshold + 10.0) / 20.0) * 100}% - 16px)"
      style:opacity={icon.unlocked ? 1.0 : 0.2}
      onclick={() => open?.()}
    >
      <span class="standings-threshold-icon" style:background-color={icon.unlocked ? standingColor(usedStanding) : "white"} style:mask-image="url({clientTexture(icon.texture)})" style:-webkit-mask-image="url({clientTexture(icon.texture)})"></span>
      {#if !icon.duplicate}<span class="standings-threshold-line" style:background-image={line}></span>{/if}
    </button>
  {/each}
  <div class="standings-bar-track">
    <span class="standings-bar-bg left" style:background-image={backgroundArrows}></span>
    <span class="standings-bar-bg right" style:background-image={backgroundArrows}></span>
    <span
      class="standings-bar-fill"
      class:reverse={!(standing > 0.0)}
      title={hint}
      style:left="{main.left * 100}%"
      style:width="{main.width * 100}%"
      style:background-color={mainColor}
      style:--arrows={arrows}
    ></span>
    {#if second !== null}
      <span
        class="standings-bar-fill"
        title={derivedHint}
        style:left="{second.left * 100}%"
        style:width="{second.width * 100}%"
        style:background-color={standingColor(usedStanding)}
        style:--arrows={arrows}
      ></span>
    {/if}
  </div>
  <!-- ConstructAxisLabels. -->
  <div class="standings-bar-axis"><span>-10.0</span><span class:hidden={hideZeroLabel}>0.0</span><span>10.0</span></div>
</div>

<style>
  /* The bar's 72 pixels: the icons over the top 26, the track at 26 for 20, the axis labels under it. */
  .standings-bar {
    position: relative;
    height: 72px;
    margin: 0.25rem 16px 0.75rem;
  }
  .standings-threshold {
    position: absolute;
    top: 0;
    width: 32px;
    height: 46px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    z-index: 1;
  }
  .standings-threshold.duplicate {
    top: 45px;
    height: 32px;
  }
  .standings-threshold-icon {
    display: block;
    width: 32px;
    height: 32px;
    mask-size: contain;
    -webkit-mask-size: contain;
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
  }
  .standings-threshold-line {
    position: absolute;
    left: 14px;
    top: 26px;
    width: 3px;
    height: 20px;
    opacity: 0.7;
    background-repeat: no-repeat;
  }
  .standings-bar-track {
    position: absolute;
    top: 26px;
    left: 0;
    right: 0;
    height: 20px;
    overflow: hidden;
    background: var(--color-panel-2);
  }
  .standings-bar-bg {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 50%;
    opacity: 0.15;
    background-repeat: repeat-x;
  }
  .standings-bar-bg.left {
    left: 0;
  }
  .standings-bar-bg.right {
    right: 0;
    transform: rotate(180deg);
  }
  .standings-bar-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    opacity: 0.5;
  }
  .standings-bar-fill::after {
    content: "";
    position: absolute;
    inset: 0;
    opacity: 0.3;
    background-image: var(--arrows);
    background-repeat: repeat-x;
  }
  .standings-bar-fill.reverse::after {
    transform: rotate(180deg);
  }
  .standings-bar-axis {
    position: absolute;
    top: 47px;
    left: 0;
    right: 0;
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    opacity: 0.6;
  }
  .standings-bar-axis .hidden {
    visibility: hidden;
  }
</style>
