<script lang="ts">
  // The client's standings graph above a pilot's standing history (standings/standingsGraph.py StandingsGraph): the
  // standing as it stood before each change and after the last (GetGraphData), its area, its line and its points, each
  // point coloured by whether it rose (StandingsPointGraph: the first neutral), with its hint. The last 25 points where
  // there are more (MAX_POINTS: the client pans to the rest). A point hovered and a history row hovered light each
  // other (OnStandingsGraphHoverStateChange, OnStandingHistoryEntryMouseEnter).
  interface Props {
    /** The points' standings, oldest first. */
    values: readonly number[];
    /** Each point's hint, written out. */
    hints: readonly string[];
    /** The point lit, by its place (a history row hovered), or null. */
    lit?: number | null;
    /** A point hovered, by its place, or null when none is. */
    onHover?: (index: number | null) => void;
  }

  let { values, hints, lit = null, onHover = () => {} }: Props = $props();

  const MAX_POINTS = 25;
  const WIDTH = 600;
  const HEIGHT = 150;
  /** MARGINS_VERTICAL and MARGINS_HORIZONTAL. */
  const MARGIN_V = 0.05;
  const MARGIN_H = 0.005;
  /** standingUIConst COLOR_GOOD, COLOR_BAD and COLOR_NEUTRAL; Color.GRAY2 the line's. */
  const COLOR_GOOD = "rgb(68, 140, 180)";
  const COLOR_BAD = "rgb(153, 52, 40)";
  const COLOR_NEUTRAL = "rgb(128, 128, 128)";
  const GRAY2 = "rgb(51, 51, 51)";

  const shown = $derived.by(() => {
    const first = Math.max(0, values.length - MAX_POINTS);
    return { first, values: values.slice(first) };
  });
  const scale = $derived.by(() => {
    const min = Math.min(...shown.values);
    const max = Math.max(...shown.values);
    const span = max - min;
    const y = (value: number): number =>
      span === 0 ? HEIGHT / 2 : HEIGHT * (1 - MARGIN_V - ((value - min) / span) * (1 - 2 * MARGIN_V));
    const count = shown.values.length;
    const x = (index: number): number =>
      count <= 1 ? WIDTH / 2 : WIDTH * (MARGIN_H + (index / (count - 1)) * (1 - 2 * MARGIN_H));
    return { x, y };
  });
  const points = $derived(shown.values.map((value, at) => ({ x: scale.x(at), y: scale.y(value), index: shown.first + at })));
  const line = $derived(points.map((point) => `${point.x},${point.y}`).join(" "));
  const area = $derived(points.length > 0 ? `${points[0]!.x},${HEIGHT} ${line} ${points[points.length - 1]!.x},${HEIGHT}` : "");
  /** _GetPointColor. */
  function pointColor(index: number): string {
    if (index === 0 || index >= values.length) return COLOR_NEUTRAL;
    return values[index]! - values[index - 1]! > 0 ? COLOR_GOOD : COLOR_BAD;
  }
</script>

<svg class="standings-graph" viewBox="0 0 {WIDTH} {HEIGHT}" preserveAspectRatio="none" role="img" aria-label="The standing over time">
  <line x1="0" y1="0.5" x2={WIDTH} y2="0.5" class="edge" />
  <line x1="0" y1={HEIGHT - 0.5} x2={WIDTH} y2={HEIGHT - 0.5} class="edge" />
  <polygon points={area} class="area" />
  <polyline points={line} fill="none" stroke={GRAY2} stroke-width="1" vector-effect="non-scaling-stroke" />
  {#each points as point (point.index)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <g onmouseenter={() => onHover(point.index)} onmouseleave={() => onHover(null)}>
      <title>{hints[point.index] ?? ""}</title>
      <rect x={point.x - 6} y={point.y - 6} width="12" height="12" fill="transparent" />
      <rect x={point.x - 2.5} y={point.y - 2.5} width="5" height="5" fill={pointColor(point.index)} class:lit={lit === point.index} />
    </g>
  {/each}
</svg>

<style>
  .standings-graph {
    display: block;
    width: 100%;
    height: 150px;
    margin: 3px 0;
  }
  .edge {
    stroke: currentColor;
    stroke-opacity: 0.05;
  }
  .area {
    fill: rgb(77, 77, 77);
    fill-opacity: 0.35;
  }
  rect.lit {
    stroke: white;
    stroke-width: 1.5;
  }
</style>
