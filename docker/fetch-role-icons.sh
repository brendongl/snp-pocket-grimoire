#!/usr/bin/env bash
#
# Fetch the role icons from the official Blood on the Clocktower wiki.
#
#   bash docker/fetch-role-icons.sh
#
# Run from anywhere. Writes assets/img/roles/*.webp, which the Encore copyFiles rule
# then bundles into public/build/img/roles/ on the next image build.
#
# WHY THIS EXISTS
# ---------------
# assets/img/roles/ is gitignored upstream: the artwork belongs to The Pandemonium
# Institute and is not redistributed with the source. A self-hosted instance therefore
# starts with blank character tokens until the files are supplied, and
# pocket-grimoire:update-images only writes a filename into the database — it downloads
# nothing. This makes the step reproducible instead of a folder someone once copied from
# somewhere.
#
# The icons are NOT committed here either, for the same reason they are not committed
# upstream. Re-run this after a fresh clone.
#
# LICENSING
# ---------
# This is TPI's artwork. Run this only if you have the right to use it. Sip n Play runs
# it with TPI's permission and owns the physical game.
#
# The real work is in fetch-role-icons.inner.sh, which runs inside a throwaway Alpine
# container (so Docker is the only dependency here). Keeping it in its own file rather
# than a `sh -c` string means its quoting only has to survive one shell.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f assets/data/characters.json ]; then
    echo "error: assets/data/characters.json not found — is this the repository root?" >&2
    exit 1
fi

mkdir -p assets/img/roles

echo "Fetching role icons into assets/img/roles/ ..."

docker run --rm \
    -v "$REPO_ROOT:/repo" \
    -w /repo \
    alpine:3.20 sh /repo/docker/fetch-role-icons.inner.sh

count=$(find assets/img/roles -name '*.webp' | wc -l)
echo "assets/img/roles now holds ${count} webp files"
echo "Rebuild to bundle them: docker compose -f docker-compose.snp.yml --env-file .env.snp up -d --build"
