#!/usr/bin/env bash
#
# Fetch the role icons from the official Blood on the Clocktower wiki.
#
#   bash docker/fetch-role-icons.sh
#
# Run from the repository root. Writes assets/img/roles/*.webp, which the Encore
# copyFiles rule then bundles into public/build/img/roles/ on the next image build.
#
# WHY THIS EXISTS
# ---------------
# assets/img/roles/ is gitignored upstream: the artwork belongs to The Pandemonium
# Institute and is not redistributed with the source. A self-hosted instance therefore
# starts with blank character tokens until the files are supplied. This fetches them
# from the official wiki so the step is reproducible instead of a folder someone once
# copied from somewhere.
#
# The icons are NOT committed here either, for the same reason they are not committed
# upstream. Re-run this after a fresh clone.
#
# LICENSING
# ---------
# This is TPI's artwork. Run this only if you have the right to use it. Sip n Play runs
# it with TPI's permission and owns the physical game.
#
# Needs curl, jq and cwebp. Rather than require them on the host, everything runs in a
# throwaway Alpine container, so the only real dependency is Docker.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f assets/data/characters.json ]; then
    echo "error: run me from the repository root (assets/data/characters.json not found)" >&2
    exit 1
fi

mkdir -p assets/img/roles

echo "Fetching role icons into assets/img/roles/ ..."

docker run --rm \
    -v "$REPO_ROOT:/repo" \
    -w /repo \
    alpine:3.20 sh -eu -c '
        apk add --no-cache --quiet curl jq libwebp-tools >/dev/null

        # What the app asks for, taken from its own data rather than guessed:
        #   "image": "/build/img/roles/acrobat_g.webp"  ->  acrobat<TAB>acrobat_g
        #
        # ONLY /build/img/roles/. The other 68 characters point at
        # /build/img/icons/<team>/, which upstream does ship in the repo — fetching
        # those would overwrite committed artwork with wiki versions.
        jq -r ".[]
               | select(.image != null)
               | select(.image | startswith(\"/build/img/roles/\"))
               | [.id, (.image | split(\"/\") | last | rtrimstr(\".webp\"))]
               | @tsv" assets/data/characters.json > /tmp/needed.tsv

        needed=$(wc -l < /tmp/needed.tsv)
        echo "  app needs ${needed} icons"

        # Every Icon_*.png the wiki has, paginated.
        : > /tmp/wiki.tsv
        cont=""
        while : ; do
            url="https://wiki.bloodontheclocktower.com/api.php?action=query&list=allimages&ailimit=500&aiprefix=Icon&format=json"
            [ -n "$cont" ] && url="${url}&aicontinue=${cont}"
            body=$(curl -sS --max-time 60 -A "Mozilla/5.0" "$url")
            echo "$body" | jq -r ".query.allimages[] | [(.name | ascii_downcase | ltrimstr(\"icon_\") | rtrimstr(\".png\")), .url] | @tsv" >> /tmp/wiki.tsv
            cont=$(echo "$body" | jq -r ".continue.aicontinue // empty")
            [ -z "$cont" ] && break
        done
        echo "  wiki has $(wc -l < /tmp/wiki.tsv) icons"

        ok=0; miss=0; fail=0
        while IFS="$(printf "\t")" read -r id target; do
            [ -z "${id:-}" ] && continue
            out="assets/img/roles/${target}.webp"
            if [ -s "$out" ]; then ok=$((ok+1)); continue; fi

            url=$(awk -F"\t" -v k="$(echo "$id" | tr "[:upper:]" "[:lower:]")" "\$1==k {print \$2; exit}" /tmp/wiki.tsv)
            if [ -z "$url" ]; then
                echo "  MISSING on wiki: ${id}"
                miss=$((miss+1))
                continue
            fi

            if curl -sSfL --max-time 60 -A "Mozilla/5.0" "$url" -o /tmp/icon.png 2>/dev/null \
               && cwebp -quiet -q 90 /tmp/icon.png -o "$out" 2>/dev/null; then
                ok=$((ok+1))
            else
                echo "  FAILED: ${id}"
                fail=$((fail+1))
                rm -f "$out"
            fi
        done < /tmp/needed.tsv

        echo
        echo "  converted: ${ok}   missing-on-wiki: ${miss}   failed: ${fail}"
    '

count=$(find assets/img/roles -name '*.webp' 2>/dev/null | wc -l)
echo "assets/img/roles now holds ${count} webp files"
echo "Rebuild the image to bundle them: docker compose -f docker-compose.snp.yml --env-file .env.snp up -d --build"
