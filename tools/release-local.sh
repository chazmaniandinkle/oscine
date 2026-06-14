#!/bin/sh
# Update the locally-installed Oscine plugin from this repo's marketplace.
#
# Run this after a release is merged to main (or against your local working
# copy if you added the marketplace by path). It refreshes the marketplace
# cache and updates the installed plugin in place, so you don't have to
# re-upload a .plugin file through Settings.
#
# Prereq (one-time): install Oscine from this repo as a marketplace instead
# of via "My Uploads". See plugin/README.md > Installing & updating locally.
#
# Usage: npm run release:local   (or: sh tools/release-local.sh)
set -e

if ! command -v claude >/dev/null 2>&1; then
  echo "error: the 'claude' CLI is not on PATH; install Claude Code or open a shell where 'claude' is available." >&2
  exit 1
fi

echo "Refreshing the oscine marketplace…"
claude plugin marketplace refresh oscine

echo "Updating the installed oscine plugin…"
claude plugin update oscine

echo
echo "Done. Restart Claude (or run /reload-plugins) so the new sidecar + app load."
echo "Then close any old Oscine tabs and reopen via the plugin."
