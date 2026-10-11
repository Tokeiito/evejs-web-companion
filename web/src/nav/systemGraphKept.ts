// The map's graph, read once for a page.
//
// The graph is the client's own static data: every system and every gate, the same for whoever asks. The page has
// none of it and asks the BFF's copy (GET /api/map/graph: 745,066 bytes an answer, measured 2026-10-11). Until
// then each flow read and kept one of its own, and the Industry manager another for as long as it was mounted: a
// tab with two pilots read it twice, and a BFF with ten hosted bots ten times.
//
// It is kept here by WHAT IT WAS ASKED WITH: the fetch an asker makes its requests with. The flows of a page ask
// with the page's one fetch (app/pageFetch.ts) and so read it once between them. An asker handed a fetch of its
// own keeps its own: a hosted bot's flow, and a test's, whose map is whatever that test stands in.

import { buildSystemGraph, type SystemGraph, type SystemGraphData } from "./routeSolver.ts";

const reads = new WeakMap<object, Promise<SystemGraph>>();

/**
 * The map's graph as `read` answers it, built, and kept for `askedWith`. Whoever asks with the same reads it
 * once: those who ask while it is on its way wait for the one read, and those who ask after have what it built.
 * A read that fails is not kept, and fails those who were waiting on it: the next to ask reads again.
 */
export function systemGraphOnce(askedWith: object, read: () => Promise<SystemGraphData>): Promise<SystemGraph> {
  const kept = reads.get(askedWith);
  if (kept !== undefined) return kept;
  const reading = read().then(buildSystemGraph);
  reads.set(askedWith, reading);
  // (Said before anyone waiting hears of the failure: by then it is kept no more, and whoever asks next reads.)
  reading.catch(() => {
    reads.delete(askedWith);
  });
  return reading;
}
