#!/bin/bash
# usage: pickloop.sh PICKFILE  -- cherry-picks every listed commit not yet applied
# (tracked by $PICKFILE.done), stopping at the first conflict.
F="$1"; D="$F.done"; touch "$D"
while read c; do
  grep -qx "$c" "$D" && continue
  if git cherry-pick "$c" >/dev/null 2>&1; then
    echo "$c" >> "$D"; echo "ok ${c:0:7} $(git log -1 --format=%s $c | cut -c1-90)"
  else
    if git diff --cached --quiet && git diff --quiet && [ -z "$(git status --short | grep -E '^(UU|DU|UD|AU|UA|DD|AA)')" ]; then
      git cherry-pick --skip >/dev/null 2>&1; echo "$c" >> "$D"; echo "EMPTY-skip ${c:0:7}"; continue
    fi
    echo "CONFLICT at ${c:0:7}: $(git log -1 --format=%s $c)"; git status --short | grep -E '^(UU|DU|UD|AU|UA|DD|AA)'; exit 1
  fi
done < "$F"
echo ALL-DONE
