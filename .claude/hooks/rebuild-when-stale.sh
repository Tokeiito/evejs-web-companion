#!/usr/bin/env bash
# Put what was just written into the container that is actually serving it —
# but never while a bot is flying.
#
# WHY THIS EXISTS. In docker mode the running BFF serves an IMAGE, not the
# working tree: editing web/src and then looking at localhost:26500 shows the
# code from whenever the container was last built. Every "it is merged, why is
# it not there" in this project has been that. Remembering to rebuild is not a
# mechanism, so this is the mechanism.
#
# It is the other half of guard-live-bot.sh, and they share their one world
# condition (live-bot-pilots.sh). The guard refuses a restart somebody asked
# for while a pilot is mid-site; this one declines to TAKE a restart nobody
# asked for, for the same reason and on the same evidence. When a bot is flying
# it says so and leaves the container alone: the stale image is a wasted minute,
# the restart is a pilot stopped in the middle of a site.
#
# ⚠ IT ONLY FIRES WHEN SOMETHING THE IMAGE CONTAINS HAS CHANGED. The inputs are
# the .dockerignore allowlist — package.json, package-lock.json, tsconfig.json,
# vite.config.ts, src/, scripts/, web/ — plus the Dockerfile and compose.yaml
# that decide how they are assembled. Editing docs, or test/ (which is not even
# in the build context), leaves the image correct and this hook silent. That is
# what keeps a ~60-second rebuild off the end of turns that did not earn one.
#
# ⚠ AND ONLY WHEN THE CONTAINER IS ALREADY RUNNING. Nothing here ever STARTS the
# stack: `npm start` on the host is a fully supported setup, and a hook that
# brought up docker under someone running the BFF on the host would be taking a
# decision that is not its to take.
#
# It fails open and quiet, like the guard: no docker, no container, no readable
# mtimes — every one of those simply exits.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CONTAINER="evejs-web-poc-bff-1"

command -v docker >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0

say() {
  jq -n --arg m "$1" '{systemMessage: $m}'
}

# Running, not merely existing: a stopped container is not serving anything
# stale, and bringing it up is not this hook's call.
running="$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" || exit 0
[ "$running" = "true" ] || exit 0

started="$(docker inspect -f '{{.State.StartedAt}}' "$CONTAINER" 2>/dev/null)" || exit 0
started_epoch="$(date -d "$started" +%s 2>/dev/null)" || exit 0
[ -n "$started_epoch" ] || exit 0

# The newest build input. `%T@` is a float; the integer part is all that is
# needed, and cutting it avoids a shell that cannot compare floats.
newest="$(cd "$ROOT" && find \
  package.json package-lock.json tsconfig.json vite.config.ts Dockerfile compose.yaml \
  src scripts web \
  -name node_modules -prune -o -type f -printf '%T@\n' 2>/dev/null \
  | sort -n | tail -1)"
newest="${newest%%.*}"
[ -n "$newest" ] || exit 0

# A file written while the container was starting is not in the image it built
# from, so this is >= rather than >. The cost of being wrong in this direction
# is one extra rebuild; the other direction is the stale image this exists to
# prevent.
[ "$newest" -ge "$started_epoch" ] || exit 0

# THE WORLD CONDITION, asked exactly as the guard asks it.
live="$(bash "$HERE/live-bot-pilots.sh")" || exit 0
if [ -n "$live" ]; then
  pilots="$(printf '%s' "$live" | tr '\n' ' ')"
  say "The running BFF is older than the working tree, but a bot is still flying (character ${pilots%% }), so it was NOT rebuilt - a recreate ends every held session and the pilot stops mid-site. What is on localhost:26500 is the code from before these edits. Rebuild with \`docker compose up --build --detach\` once the pilots are docked."
  exit 0
fi

if out="$(cd "$ROOT" && docker compose up --build --detach 2>&1)"; then
  say "The BFF container was older than the working tree and no bot was flying, so it was rebuilt: what is on localhost:26500 is now this code. Any pilot who was signed in has to sign in again."
else
  # A failed rebuild is the one outcome that must never be quiet: the container
  # is still up and still serving the OLD image, which looks exactly like a
  # working rebuild from the outside.
  say "The BFF container is older than the working tree and the automatic rebuild FAILED - localhost:26500 is still serving the previous image. Last lines: $(printf '%s' "$out" | tail -5 | tr '\n' ' ')"
fi
exit 0
