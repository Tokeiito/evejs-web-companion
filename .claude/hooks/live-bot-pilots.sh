#!/usr/bin/env bash
# Prints the characterID of every bot that appears to be MID-FLIGHT, one per
# line. Empty output means "no evidence of a flying bot" — which includes every
# way of being unable to look.
#
# ⚠ THIS IS THE ONE DEFINITION, SHARED ON PURPOSE. It started inside
# guard-live-bot.sh; it moved out here when a second caller needed it
# (rebuild-when-stale.sh), because the 1800-second window below is a safety
# bound reasoned from measurements, and two copies of a bound like that drift.
# The thing they both protect is the same thing: a container recreate ends every
# held session, and a pilot mid-site simply stops.
#
# ⚠ IT FAILS OPEN, DELIBERATELY. No docker, no container, no logs — every one of
# those prints nothing, which every caller reads as "go ahead". A guard that
# blocks work when it cannot see is a guard that gets deleted, and the thing
# being protected is a test run, not a production system. It only ever speaks up
# on POSITIVE evidence.
#
# It reads the flight recorder, which is the only thing that actually knows: the
# BFF writes one JSONL line per change to /app/data/bot-logs/<characterID>.jsonl,
# and a run that has finished ends with a line of kind "end".
#
# A log touched RECENTLY whose final line is not an "end" is a run that is still
# going. The window has to be generous, because the runner writes one line per
# CHANGE, not per tick, and a bot doing something repetitive changes nothing for
# a long time.
#
# ⚠ TWO MINUTES WAS WRONG, AND IT WAS WRONG IN THE DIRECTION THAT COSTS SHIPS.
# It was picked with a warp in mind. Mining is the case that matters: on
# 2026-09-14 three mining runs were sampled by the server ORBITING with three
# lasers cycling — unambiguously flying — while their logs had been untouched for
# eleven to sixteen minutes, because a full belt cycle simply produces no new
# decision to record. The guard would have failed open and allowed the restart
# that killed all five pilots, which is the exact thing it exists to prevent.
#
# Measured over those runs, the largest quiet gap inside a live mining log was
# ~830s (the runner-up gaps, ~340-510s, are the same cycle seen shorter); a
# ratting log's largest was 63s. THIRTY MINUTES is a shade over twice the worst
# observed, which is the right kind of margin for a bound whose failure mode is
# a dead pilot rather than a wasted minute.
#
# It stays cheap because it is not the only test: a run that finished writes an
# "end" line and is skipped no matter how recent it is, so widening this window
# does not hold up a restart after an ordinary stop. The only thing it delays is
# a restart following a run that died WITHOUT writing its end line — a crash —
# and waiting out half an hour, or saying so and being asked again, is a far
# cheaper mistake than the one above.

set -uo pipefail

command -v docker >/dev/null 2>&1 || exit 0

docker exec evejs-web-poc-bff-1 sh -c '
  now=$(date +%s)
  for f in /app/data/bot-logs/*.jsonl; do
    [ -f "$f" ] || continue
    case "$f" in *.prev.jsonl) continue ;; esac
    m=$(stat -c %Y "$f" 2>/dev/null) || continue
    [ $((now - m)) -le 1800 ] || continue
    last=$(tail -1 "$f" 2>/dev/null)
    case "$last" in
      *\"kind\":\"end\"*) ;;
      *\"status\":\"running\"*) basename "$f" .jsonl ;;
      *\"kind\":\"decide\"*|*\"kind\":\"issue\"*|*\"kind\":\"start\"*) basename "$f" .jsonl ;;
    esac
  done' 2>/dev/null || exit 0
