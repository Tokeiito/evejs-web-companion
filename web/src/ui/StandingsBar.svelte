<script lang="ts">
  // The standings bar across the top of the client's standings panel (standings/standingsBar.py StandingsBar,
  // UpdateWithStandings and Animate): -10 to 10, the selected owner's standing drawn out from the middle, and where the
  // standing an owner is dealt by is another's and above nought (GetStandingUsed: an agent's or an NPC corporation's
  // derived standing) that one too, after it. Each with its hint (StandingsBarHint, StandingsBarHintToCorp). Its axis
  // labels beneath it.
  //
  // Not here yet: the threshold icons above it (UpdateThresholdIcons). An increase bar the panel never has (its Update
  // gives no increase).
  import { clientTexture } from "./skillGroupIcons.ts";

  interface Props {
    /** GetStanding2To1: the selected owner's standing toward the panel's owner. */
    standing: number;
    /** GetStandingUsed's standing. */
    usedStanding: number;
    /** The bar's hint and the second bar's, filled. */
    hint: string;
    derivedHint: string;
  }

  let { standing, usedStanding, hint, derivedHint }: Props = $props();

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
  <div class="standings-bar-axis"><span>-10.0</span><span>0.0</span><span>10.0</span></div>
</div>

<style>
  .standings-bar {
    margin: 0.25rem 0 0.75rem;
  }
  .standings-bar-track {
    position: relative;
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
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    opacity: 0.6;
  }
</style>
