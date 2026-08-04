#!/bin/sh
#
# Runs INSIDE the Alpine container started by fetch-role-icons.sh, with the repository
# mounted at /repo. A separate file on purpose: this used to be embedded in a
# `docker run sh -c '...'` string, and every quote had to survive two shells, which it
# eventually did not.
#
# Needs: curl, jq, cwebp (installed by the caller).

set -eu

cd /repo

apk add --no-cache --quiet curl jq libwebp-tools >/dev/null

# --- what the app asks for ---------------------------------------------------------
#   "image": "/build/img/roles/acrobat_g.webp"  ->  acrobat<TAB>acrobat_g
#
# ONLY /build/img/roles/. The other characters point at /build/img/icons/<team>/, which
# upstream does commit; writing those into roles/ would misfile them.
jq -r '.[] | select(.image != null) | [.id, .image] | @tsv' assets/data/characters.json \
    | grep -F '/build/img/roles/' \
    | awk -F'\t' '{ n = $2; sub(/^.*\//, "", n); sub(/\.webp$/, "", n); print $1 "\t" n }' \
    > /tmp/needed.tsv

echo "  app needs $(wc -l < /tmp/needed.tsv) icons"

# --- what the wiki has -------------------------------------------------------------
# Keyed on the id with every non-alphanumeric stripped: the wiki is not always spelled
# the way the app is (Icon_big_wig.png is the app's "bigwig"), and an exact match
# silently drops those.
: > /tmp/wiki.tsv
cont=""
while : ; do
    url="https://wiki.bloodontheclocktower.com/api.php?action=query&list=allimages&ailimit=500&aiprefix=Icon&format=json"
    if [ -n "$cont" ]; then
        url="${url}&aicontinue=${cont}"
    fi

    body=$(curl -sS --max-time 60 -A "Mozilla/5.0" "$url")

    echo "$body" | jq -r '.query.allimages[]
        | [(.name | ascii_downcase | ltrimstr("icon_") | rtrimstr(".png") | gsub("[^a-z0-9]"; "")), .url]
        | @tsv' >> /tmp/wiki.tsv

    cont=$(echo "$body" | jq -r '.continue.aicontinue // empty')
    if [ -z "$cont" ]; then
        break
    fi
done

echo "  wiki has $(wc -l < /tmp/wiki.tsv) icons"

# --- download and convert ----------------------------------------------------------
ok=0
missing=0
failed=0

while IFS="$(printf '\t')" read -r id target; do

    [ -z "${id:-}" ] && continue

    out="assets/img/roles/${target}.webp"
    if [ -s "$out" ]; then
        ok=$((ok + 1))
        continue
    fi

    key=$(echo "$id" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')
    url=$(awk -F'\t' -v k="$key" '$1 == k { print $2; exit }' /tmp/wiki.tsv)

    if [ -z "$url" ]; then
        echo "  MISSING on wiki: ${id}"
        missing=$((missing + 1))
        continue
    fi

    if curl -sSfL --max-time 60 -A "Mozilla/5.0" "$url" -o /tmp/icon.png 2>/dev/null \
       && cwebp -quiet -q 90 /tmp/icon.png -o "$out" 2>/dev/null; then
        ok=$((ok + 1))
    else
        echo "  FAILED: ${id}"
        failed=$((failed + 1))
        rm -f "$out"
    fi

done < /tmp/needed.tsv

echo
echo "  converted: ${ok}   missing-on-wiki: ${missing}   failed: ${failed}"
