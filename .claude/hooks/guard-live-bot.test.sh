#!/usr/bin/env bash
# Cases for guard-live-bot.sh. Run it directly: bash .claude/hooks/guard-live-bot.test.sh
#
# ⚠ THIS EXISTS BECAUSE THE MATCHER HAD NO TEST AND WAS WRONG TWICE. The first
# draft blocked its own test command; the second blocked `docker ps --format ...`
# because "--format" contains "rm", and `docker exec ... stopShipEntity` because
# the argument contains "stop". Both were refused in the middle of real work,
# which is how a guard gets switched off and stops protecting anything.
#
# It is HERMETIC: `docker` is stubbed on PATH to report one flying pilot, so the
# deny cases do not depend on anything actually being in space right now.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/guard-live-bot.sh"

STUB="$(mktemp -d)"
trap 'rm -rf "$STUB"' EXIT
# Any `docker exec ...` answers with a live pilot; nothing else is called.
# The id is ESI's own documented example character, so nothing here can be
# mistaken for somebody's actual pilot.
printf '#!/usr/bin/env bash\n[ "${1:-}" = "exec" ] && echo 90000001\nexit 0\n' > "$STUB/docker"
chmod +x "$STUB/docker"
PATH="$STUB:$PATH"

FAILED=0
check() {
  local expect="$1" cmd="$2" got
  got="$(jq -n --arg c "$cmd" '{tool_input:{command:$c}}' \
        | bash "$HOOK" \
        | jq -r '.hookSpecificOutput.permissionDecision // "allow"' 2>/dev/null)"
  [ -z "$got" ] && got="allow"
  if [ "$got" = "$expect" ]; then
    printf 'ok   %-5s  %s\n' "$got" "$cmd"
  else
    printf 'FAIL want=%s got=%s  %s\n' "$expect" "$got" "$cmd"
    FAILED=1
  fi
}

# --- refused: every one of these ends held sessions -------------------------
check deny 'docker compose up --build --detach'
check deny 'docker compose down'
check deny 'docker compose restart bff'
check deny 'docker compose stop'
check deny 'docker-compose up -d'
check deny 'docker restart evejs-web-poc-bff-1'
check deny 'docker stop evejs-web-poc-bff-1'
check deny 'docker kill evejs-web-poc-bff-1'
check deny 'docker rm -f evejs-web-poc-bff-1'
check deny 'sudo docker stop evejs-web-poc-bff-1'
check deny 'cd /d/eveoffline && docker compose up --build'
check deny 'docker compose -f compose.yml -p evejs up'
# The value of a global option must not be read as the verb.
check deny 'docker --context prod stop evejs-web-poc-bff-1'
check deny 'timeout 30 docker compose restart'

# --- allowed: the verb is a POSITION, not a substring -----------------------
check allow 'docker ps --format "table {{.Names}}\t{{.Status}}"'
check allow "docker exec evejs-server-1 sh -c 'grep -rn stopShipEntity /app'"
check allow 'docker build --target web-build -t x .'
check allow 'docker logs evejs-server-1 --since 30m'
check allow 'docker compose logs -f bff'
check allow 'docker inspect evejs-web-poc-bff-1'
check allow 'docker stats --no-stream'
check allow 'docker image ls'
check allow 'docker volume ls'
# A mention is not an invocation.
check allow 'grep -r "docker compose up" docs/'
check allow 'echo "never run docker stop while flying"'
# Inside a container is not this stack.
check allow "docker exec c sh -c 'docker compose up'"

# --- and it fails OPEN when it cannot see ----------------------------------
# ⚠ DELIBERATE, AND THE HOOK SAYS SO: no container, no logs, nothing readable
# answers "allow". A guard that blocks work when it is blind is one that gets
# deleted, and what is protected here is a test run, not a production system.
# (The stub is REPLACED rather than taken off PATH — a real docker is installed
# on this machine, so an unstubbed run would ask the live stack and prove
# nothing about the hook.)
printf '#!/usr/bin/env bash\nexit 0\n' > "$STUB/docker"   # answers nothing
check allow 'docker compose up --build --detach'

[ "$FAILED" = "0" ] && echo "all cases passed"
exit $FAILED
