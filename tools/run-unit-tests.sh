#!/bin/sh
# Run every node unit test (not e2e); print one line each.
cd "$(dirname "$0")/.." || exit 1
fail=0
for t in test/*.mjs; do
  case $t in *e2e*|*fake*) continue;; esac
  out=$(node "$t" 2>&1); code=$?
  [ $code -ne 0 ] && fail=1
  echo "$t exit=$code $(printf '%s\n' "$out" | grep -cE '^ *(ok|  ok)') ok, last: $(printf '%s\n' "$out" | tail -1)"
done
exit $fail
