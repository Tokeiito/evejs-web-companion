#!/usr/bin/env bash
# Cases for live-bot-pilots.sh. Run it directly: bash .claude/hooks/live-bot-pilots.test.sh
#
# ⚠ THIS EXISTS BECAUSE THE CONDITION MISSED A WHOLE KIND OF PILOT. It read only
# the hosted bots' flight recorder, so three companions fighting in a fleet were
# "nobody flying" and the BFF was rebuilt under them (2026-10-10 20:47).
#
# It is HERMETIC: `docker` is stubbed on PATH. Each case says what the BFF's bot
# logs, its session journal and the server's heartbeat would show. The ids are
# ESI's own documented example characters, so nothing here is anybody's pilot.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/live-bot-pilots.sh"

STUB="$(mktemp -d)"
trap 'rm -rf "$STUB"' EXIT
cat > "$STUB/docker" <<'STUB'
#!/usr/bin/env bash
# docker exec <bff> sh -c '<script>': the bot-log sweep or the journal read, told apart by what the script reads.
if [ "${1:-}" = "exec" ]; then
  case "${5:-}" in
    *bridge-sessions.json*) printf '%s' "${JOURNAL:-}" ;;
    *bot-logs*) printf '%s' "${BOTLOGS:-}" ;;
  esac
  exit 0
fi
# docker logs ... evejs-server-1: the container's output arrives on stderr.
if [ "${1:-}" = "logs" ]; then
  printf '%s' "${HEARTBEAT:-}" >&2
  exit 0
fi
exit 0
STUB
chmod +x "$STUB/docker"
PATH="$STUB:$PATH"

journal() {
  local rows="" id
  for id in "$@"; do rows="$rows{\"bridgeSessionID\":\"gp:x$id\",\"accountID\":1,\"characterID\": $id},"; done
  printf '{\n  "version": 1,\n  "sessions": [%s]\n}\n' "${rows%,}"
}
inspace() { printf '[skillWhileDoing] sample char=%s scene=solar-system:30000142 sim=10000ms mode=FOLLOW warp=no speed=300m/s modules(0)=none drones(0)=none\n' "$1"; }
docked() { printf '[skillWhileDoing] sample char=%s docked station=60003760 wall=10000ms modules(0)=none\n' "$1"; }

FAILED=0
check() {
  local want="$1" why="$2" got
  got="$(bash "$SCRIPT" | tr '\n' ' ')"
  got="${got% }"
  if [ "$got" = "$want" ]; then
    printf 'ok   [%s]  %s\n' "$got" "$why"
  else
    printf 'FAIL want=[%s] got=[%s]  %s\n' "$want" "$got" "$why"
    FAILED=1
  fi
}

# --- the bridge's pilots -----------------------------------------------------
JOURNAL="$(journal 90000001 90000002)" HEARTBEAT="$(inspace 90000001; docked 90000002; inspace 90000003)" BOTLOGS="" \
  check "90000001" "a held pilot in space counts; held but docked does not; in space but not the bridge's does not"
export JOURNAL="$(journal 90000001 90000001)" HEARTBEAT="$(inspace 90000001; inspace 90000001)" BOTLOGS=""
check "90000001" "a pilot the journal holds twice, sampled twice, is one pilot"
unset JOURNAL HEARTBEAT BOTLOGS

# --- the hosted bots, as before, and both at once ---------------------------
BOTLOGS="90000009"$'\n' check "90000009" "a running hosted bot still counts with no bridge pilots at all"
JOURNAL="$(journal 90000001)" HEARTBEAT="$(inspace 90000001)" BOTLOGS="90000009"$'\n' \
  check "90000001 90000009" "both kinds together, each once"

# --- nothing to see is nobody flying ----------------------------------------
check "" "no bot logs, no journal, no heartbeat"
JOURNAL="$(journal 90000001)" HEARTBEAT="" check "" "a held pilot the server has not sampled is not flying"

exit "$FAILED"
