// Time dilation as the page shows it (timeDilation.ts): the client's rule for when, and its own label for the hint.
import test from "node:test";
import assert from "node:assert/strict";
import { TIDI_SHOWN_BELOW, TIDI_TOOLTIP_LABEL, TIDI_WORD_LABELS, tidiHint, tidiPercent } from "./timeDilation.ts";

test("the indicator is on show while the clock's pace is under 0.98, as a whole percentage cut short", () => {
  assert.equal(TIDI_SHOWN_BELOW, 0.98);
  assert.deepEqual([tidiPercent(0.5), tidiPercent(0.1), tidiPercent(0.979), tidiPercent(0.756), tidiPercent(0.999 * 0.3)], [50, 10, 97, 75, 29]);
  // At 0.98 and above there is nothing to show; nor for a pace that is not one.
  assert.deepEqual([tidiPercent(0.98), tidiPercent(1), tidiPercent(null), tidiPercent(undefined), tidiPercent(0), tidiPercent(-0.5), tidiPercent(Number.NaN)], [null, null, null, null, null, null, null]);
});

test("the hint is the client's label with the percentage in it, and words of our own without it", () => {
  assert.deepEqual(TIDI_WORD_LABELS, [TIDI_TOOLTIP_LABEL]);
  assert.equal(TIDI_TOOLTIP_LABEL, "UI/Neocom/TidiTooltip");
  // Made-up text in the label's shape: one argument, tidiAmount, and the client's markup around it.
  const templates = { [TIDI_TOOLTIP_LABEL]: "<b>Slow going</b><br>The clock here ticks at {tidiAmount}% " };
  assert.equal(tidiHint(35, templates), "Slow going\nThe clock here ticks at 35%");
  assert.equal(tidiHint(35, {}), "Time is running at 35% of its usual pace here.");
  assert.equal(tidiHint(35, { [TIDI_TOOLTIP_LABEL]: null }), "Time is running at 35% of its usual pace here.");
});
