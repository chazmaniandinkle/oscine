#!/bin/bash
# Snapshot GitHub metadata (stars, last push, license) for every candidate repo.
# Usage: scripts/gh-repos.sh repos.txt > evidence/github-repos.tsv
while read -r r; do
  [ -z "$r" ] && continue
  gh api "repos/$r" --jq '[.full_name, .stargazers_count, .pushed_at[0:10], .created_at[0:10], (.license.spdx_id // "none"), (.description // "" | .[0:140])] | @tsv' 2>/dev/null || printf '%s\tNOT_FOUND\n' "$r"
done < "$1"
