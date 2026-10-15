#!/usr/bin/env bash
# Cases for rebuild-when-stale.sh. Run it directly:
#   bash .claude/hooks/rebuild-when-stale.test.sh
#
# ⚠ THE CASE THAT MATTERS IS "STALE AND FLYING". This hook is the only thing in
# the repo that takes a container recreate WITHOUT anyone asking for it, so the
# test asserts the negative directly: `docker compose` must not be reached. A
# stub that fails loudly if it is called is the assertion.
#
# HERMETIC: `docker` is stubbed on PATH, so nothing here depends on what is
# actually running or flying right now. The character id is ESI's own documented
# example, so nothing in this file can be mistaken for somebody's real pilot.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/rebuild-when-stale.sh"

STUB="$(mktemp -d)"
trap 'rm -rf "$STUB"' EXIT
PATH="$STUB:$PATH"
export PATH

# $1 running   "true"/"false"
# $2 startedAt an RFC3339 stamp — old = the tree is newer = stale
# $3 flying    a character id, or empty for nobody
stub_docker() {
  cat > "$STUB/docker" <<EOF
#!/usr/bin/env bash
case "\${1:-}" in
  inspect)
    case "\$*" in
      *State.Running*) echo "$1" ;;
      *StartedAt*) echo "$2" ;;
    esac ;;
  exec) [ -n "$3" ] && echo "$3" ;;
  compose) echo "COMPOSE-WAS-CALLED" >> "$STUB/calls"; ;;
esac
exit 0
EOF
  chmod +x "$STUB/docker"
  rm -f "$STUB/calls"
}

FAILED=0
# $1 a label, $2 expect "rebuilt" | "held" | "quiet"
run_case() {
  local label="$1" expect="$2" out got composed
  out="$(echo '{}' | bash "$HOOK" 2>/dev/null)"
  composed="$([ -f "$STUB/calls" ] && echo yes || echo no)"
  if [ -z "$out" ]; then
    got="quiet"
  elif [ "$composed" = "yes" ]; then
    got="rebuilt"
  else
    got="held"
  fi
  if [ "$got" = "$expect" ]; then
    printf 'ok   %-8s %s\n' "$got" "$label"
  else
    printf 'FAIL want=%s got=%s  %s\n' "$expect" "$got" "$label"
    FAILED=1
  fi
}

OLD="2020-01-01T00:00:00.000000000Z"   # older than any file in the tree
FUTURE="2999-01-01T00:00:00.000000000Z" # newer than any file in the tree

# Nothing running: this hook never STARTS the stack — `npm start` on the host is
# a supported setup and bringing docker up is not its decision.
stub_docker false "$OLD" ""
run_case "container not running" quiet

# Running and newer than every input: nothing to do, and silently.
stub_docker true "$FUTURE" ""
run_case "container newer than the tree" quiet

# ⚠ The safety case. Stale, but a bot is mid-flight: say so, touch nothing.
stub_docker true "$OLD" 90000001
run_case "stale while a bot is flying" held

# Stale and nobody flying: take the rebuild.
stub_docker true "$OLD" ""
run_case "stale with nobody flying" rebuilt

[ "$FAILED" = "0" ] && echo "all cases passed"
exit $FAILED
