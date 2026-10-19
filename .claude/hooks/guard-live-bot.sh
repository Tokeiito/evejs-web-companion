#!/usr/bin/env bash
# Refuse to stop, restart or recreate the EveJS stack while a bot is flying.
#
# WHY THIS EXISTS. `docker compose up --build` recreates the BFF container, which
# ends every held session: a bot that is mid-site simply stops, wherever it
# happens to be, and the pilot has to sign in again. On 2026-09-14 that happened
# four times in one debugging session, the last one while a pilot was in the
# middle of clearing an anomaly. Announcing the restart beforehand was not
# enough — the rule has to be enforced somewhere that is not a good intention.
#
# It reads the flight recorder, which is the only thing that actually knows: the
# BFF writes one JSONL line per change to /app/data/bot-logs/<characterID>.jsonl,
# and a run that has finished ends with a line of kind "end".
#
# ⚠ IT FAILS OPEN, DELIBERATELY. No docker, no container, no logs, no jq — every
# one of those answers "allow". A guard that blocks work when it cannot see is a
# guard that gets deleted, and the thing being protected is a test run, not a
# production system. It only ever refuses on POSITIVE evidence that a bot is
# mid-flight.

set -uo pipefail

payload="$(cat)"

command -v jq >/dev/null 2>&1 || exit 0
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null)" || exit 0
[ -n "$cmd" ] || exit 0

# Only the verbs that actually end sessions. `docker build` on its own is fine —
# it produces an image and touches nothing that is running, which is what makes
# "build now, restart when the pilot is docked" a workable habit rather than a
# blanket ban.
#
# ⚠ IT MATCHES AN INVOCATION, NOT A MENTION, and the first draft did not. A plain
# substring test blocks `grep "docker compose" docs/`, a heredoc that quotes the
# command, and the very echo used to test this hook — it denied its own test on
# the first run. So the command is split on the shell's own separators and each
# SEGMENT is checked for docker in first position, after the prefixes that
# legitimately sit in front of it (cd, sudo, env, nohup, time, timeout N).
# Anything quoted inside an echo or a grep pattern is then just an argument to
# some other program, which is exactly what it is.
#
# The SUBCOMMAND is read the same way, for the same reason — see the parse below.
# Getting the binary right and then substring-matching the verb was the second
# version of the first mistake, and it cost two refusals in the middle of real
# work before anyone noticed. `.claude/hooks/guard-live-bot.test.sh` is the case
# table that now holds both halves down.
invokes_docker=0
while IFS= read -r segment; do
  case "$segment" in
    *docker*) ;;
    *) continue ;;
  esac
  stripped="$(printf '%s' "$segment" | sed -E \
    -e 's/^[[:space:]]*//' \
    -e 's/^(sudo|nohup|time|env)[[:space:]]+//' \
    -e 's/^timeout[[:space:]]+[0-9]+m?[[:space:]]+//' \
    -e 's/^cd[[:space:]]+[^[:space:]]+[[:space:]]*//')"
  # ⚠ THE VERB IS A POSITION, NOT A SUBSTRING, and the globs this replaces did
  # not know that. `docker[[:space:]]*rm*` is "docker, a space, anything, rm,
  # anything" — so it fired on `docker ps --format ...` because `--format`
  # contains "rm", and `docker[[:space:]]*stop*` fired on any command whose
  # arguments merely mentioned a stop. Both were denied while five pilots were
  # mining, which is how a guard teaches people to switch it off.
  #
  # So the segment is split into words and READ: the binary, then docker's own
  # global options (the ones that take a value are stepped over WITH it, or the
  # value would be mistaken for the subcommand), then the subcommand itself. A
  # verb appearing anywhere else is an argument to some other program, which is
  # exactly what it is — `docker exec c sh -c '... compose up ...'` parses as
  # `exec` and is allowed, because it is.
  set -f                 # a bare * in the command must not glob the cwd
  # shellcheck disable=SC2086
  set -- $stripped
  set +f
  bin="${1:-}"
  [ $# -gt 0 ] && shift
  compose=0
  case "$bin" in
    docker) ;;
    docker-compose) compose=1 ;;
    *) continue ;;
  esac

  # Step over the binary's own options to reach the subcommand. An option that
  # takes a VALUE is stepped over WITH it — otherwise `--context prod stop` reads
  # `prod` as the verb, and worse, `-H unix://... rm` reads the socket.
  while [ $# -gt 0 ]; do
    case "$1" in
      -H|--host|-c|--context|--config|--log-level|\
      --tlscacert|--tlscert|--tlskey|\
      -f|--file|-p|--project-name|--project-directory|--profile|--env-file)
        shift; [ $# -gt 0 ] && shift ;;
      -*) shift ;;
      *) break ;;
    esac
  done

  # `docker compose` has a second layer: its own options, then the real verb.
  if [ "$compose" = "0" ] && [ "${1:-}" = "compose" ]; then
    compose=1
    shift
    while [ $# -gt 0 ]; do
      case "$1" in
        -f|--file|-p|--project-name|--project-directory|--profile|--env-file)
          shift; [ $# -gt 0 ] && shift ;;
        -*) shift ;;
        *) break ;;
      esac
    done
  fi
  verb="${1:-}"

  # `docker up` is not a command, so plain-docker never blocks on it; the rest
  # end containers either way. Anything not listed here — build, ps, exec, logs,
  # inspect — touches nothing that is running and is none of this hook's business.
  case "$compose:$verb" in
    1:up|1:down|1:restart|1:stop|1:kill|1:rm|\
    0:restart|0:stop|0:kill|0:rm)
      invokes_docker=1
      break
      ;;
  esac
done <<EOF
$(printf '%s' "$cmd" | sed -E 's/(\&\&|\|\||;|\|)/\n/g')
EOF

[ "$invokes_docker" = "1" ] || exit 0

# Whether a bot is flying is one question with one answer, and it lives in
# live-bot-pilots.sh so the Stop-hook rebuild asks it exactly the same way. It
# fails open (prints nothing) on every way of being unable to look.
live="$(bash "$(dirname "$0")/live-bot-pilots.sh")" || exit 0

[ -n "$live" ] || exit 0

pilots="$(printf '%s' "$live" | tr '\n' ' ')"
reason="A bot is still flying (character ${pilots%% }) - its log was written in the last two minutes and does not end with a finished run. This command would recreate or stop the BFF container, which ends every held session: the pilot stops wherever it is, mid-site, and has to sign in again. Ask before taking the restart, and batch whatever else is pending into the same one. \`docker build --target web-build\` is not blocked and compiles without touching anything that is running."

jq -n --arg r "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $r
  }
}'
