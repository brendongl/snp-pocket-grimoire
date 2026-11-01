# Sip n Play fork — what we changed and why

This is a fork of [Skateside/pocket-grimoire](https://github.com/Skateside/pocket-grimoire)
(GPL-3.0). It stays GPL-3.0, and the source stays public.

The goal is to keep the diff **small and mergeable**, so `git merge upstream/main` keeps
working. Everything we add lives in new files where possible, and touches upstream files
only where there is no alternative.

## Why a fork rather than building it into snp-site

We tried the other way first and abandoned it. Pocket Grimoire is GPL-3.0, so bundling its
client code into snp-site would arguably make snp-site a derivative work; a separately
hosted fork has no such problem. Building a clean-room equivalent inside snp-site was the
alternative, and it was too much surface to test for the value.

## Upstream merges

```bash
git fetch upstream
git merge upstream/main
```

Conflict risk is concentrated in the files listed below. Nothing else upstream is touched.

## Our changes

| File | New? | Why |
|---|---|---|
| `Dockerfile` | new | Upstream ships no image for the app — its `docker-compose.yml` only provisions a Postgres box for local dev. |
| `docker/entrypoint.sh` | new | Waits for Postgres, warms cache, migrates, then imports reference data. |
| `docker-compose.snp.yml` | new | Deployment stack. Kept separate from upstream's `docker-compose.yml` **on purpose** — editing that file would conflict on almost every merge. |
| `.env.snp.example` | new | Deployment env template. `.env.snp` itself is gitignored. |
| `.dockerignore` | new | Keeps the build context small. |
| `SNP-FORK.md` | new | This file. |
| `.gitignore` | edited | One appended block for `/.env.snp`. Minimal, unlikely to conflict. |
| `src/Command/ImportCommand.php` | edited | One-line fix: `getTeam()` fell over with a fatal `TypeError` when called without a `name`, which the character importer always does. See below. |

Upstream's `webpack.config.js` enables `postcss-loader` without committing a PostCSS
config, and `postcss` is only present as an unmet peer dependency. That looks broken but
is not — verified by building both with and without a `postcss.config.js`; the loader runs
unconfigured either way and `yarn build` exits 0. No config file added, so the diff stays
smaller.

## Upstream problems we hit

Worth knowing, because they are invisible until you try to deploy this yourself.

**1. The migrations are MySQL; the config says Postgres.**
`migrations/` is full of `AUTO_INCREMENT`, `utf8mb4` and `ENGINE = InnoDB`, but both `.env`
and `docker-compose.yml` point at PostgreSQL. Following their config gets you
`syntax error at or near "AUTO_INCREMENT"` and no schema at all. We run MySQL 8, which is
what the migrations actually target, so future upstream migrations keep applying.

**2. `public/.htaccess` force-redirects to `https://www.`**
Correct for pocketgrimoire.co.uk, fatal for a plain-HTTP LAN box — every request 301s to
an HTTPS host that is not listening. Patched at **build time** in the Dockerfile (with a
`grep` guard that fails the build if the rule ever stops matching) so the file itself stays
byte-identical to upstream and never conflicts on merge.

**3. `pocket-grimoire:import` cannot bootstrap an empty database.**
It is for *updating* an already-populated one. On an empty database it dies immediately:
`getEdition()` has no create path and returns `null` into a non-nullable return type. Its
`--type` and `--locale` options also appear not to filter — the progress bar reads 249
regardless, which is the locale count, not the character count.

The real bootstrap is the `populate-*` commands, one data file each, in dependency order —
teams and editions before roles, because roles reference both. That is what the entrypoint
runs.

**4. `populate-jinxes` fails on upstream's own data.**
`JinxRepository::getByTargetTrick()` gets a `null` target from `assets/data/jinx.json`. The
entrypoint logs a warning and carries on, so the app still starts with a full character
list; only the Jinxes panel is empty. Not yet fixed.

**5. `getTeam()` fatals when the character importer calls it.**
The character pass calls `getTeam(['id' => $data['team']])` with no `name` key, and
`getTeam` then does `setName($data['name'])` — a fatal `TypeError` on any team that does not
already exist. Our one-line fix falls back to the identifier. Not strictly needed now that
we bootstrap with `populate-*`, but it turns a crash into a sensible default and is worth
carrying (and reporting upstream).

## Role icons are NOT in the repo

`assets/img/roles/` is **gitignored** upstream — the artwork is The Pandemonium Institute's,
used with permission on the official site and not redistributed. `pocket-grimoire:update-images`
only writes a filename into the database; it downloads nothing.

So a self-hosted instance serves **no character icons** until they are supplied by hand
(`assets/img/roles/*.webp`, picked up by the Encore `copyFiles` rule into
`public/build/img/roles/`). The app is fully usable without them — names and abilities all
render — the tokens are just blank.

> [!warning] This is a licensing decision, not a technical one
> Sip n Play is a commercial venue. Copying TPI's artwork onto a cafe's own deployment is a
> different question from a fan running it at home, and it should be answered deliberately
> rather than by quietly downloading the files. **Sip n Play runs this with TPI's
> permission and owns the physical game.**

### Fetching them

```bash
bash docker/fetch-role-icons.sh
docker compose -f docker-compose.snp.yml --env-file .env.snp up -d --build
```

Pulls `Icon_<id>.png` from the official wiki, converts to WebP and writes
`assets/img/roles/<id>_<g|e>.webp` — the exact names the app's own `characters.json`
asks for. Everything runs in a throwaway Alpine container, so Docker is the only
dependency. Idempotent: files already present are skipped.

Coverage is **180 of 181**; `bigwig` has no icon on the wiki.

Only `/build/img/roles/` is fetched. The other 68 characters point at
`/build/img/icons/<team>/`, which upstream **does** commit (247 files) — fetching those
would overwrite shipped artwork.

The icons stay gitignored here exactly as upstream leaves them, so re-run this after a
fresh clone.

## Deploying

```bash
cp .env.snp.example .env.snp     # then fill in APP_SECRET and POSTGRES_PASSWORD
docker compose -f docker-compose.snp.yml --env-file .env.snp up -d --build
```

Reachable at `http://<box-lan-ip>:${PORT}` (default 8088).

> [!warning] LAN only — no authentication
> The grimoire has no login of its own. It must not be put behind a public reverse proxy
> or port-forwarded. The published port is intended to be reachable on the shop LAN and
> nowhere else.

After the first successful boot, set `PG_SKIP_IMPORT=1` in `.env.snp` to skip the
reference-data import on restart. Re-run it by hand at any time:

```bash
docker exec snp-pocket-grimoire php bin/console pocket-grimoire:import
```

## Notes on the stack

- PHP 8.2 + Symfony 5.4 LTS. Not PHP 8.3+ — this app still uses `doctrine/annotations`
  and `sensio/framework-extra-bundle`, which get noisy on newer PHP.
- Node 20 for the asset build. Webpack Encore 1.x against Node 22+ can hit
  `ERR_OSSL_EVP_UNSUPPORTED`.
- The database holds **reference data only** — teams, editions, roles, jinxes. Game state
  lives in each device's `localStorage`, which is why the app is single-device and has no
  co-storyteller sync.

## Planned Sip n Play features

Not yet built:

1. **Link players to signed-up customers** — replace the free-text "Name yourself" field
   on the draw with a picker backed by that night's RSVPs from snp-site.
2. **Auto-report the score** — an end-of-game screen (winner + confirm) that POSTs the
   seats to snp-site, which records them via the existing `BotcDbService.createGame()`
   path that already powers the manual console.

Both talk to snp-site over an API key. Upstream has no concept of a game ending or a
winner, so (2) is genuinely new UI rather than a hook into something existing.

## Final-board report picture

`assets/js/snp/snapshot.js` uses pinned `html-to-image` to capture the full pad
(characters, reminders, shrouds and player names). End Game & Report previews the
PNG and warns that it will be public with the finished game. Board changes
invalidate the preview; an explicit checkbox permits reporting without a picture.
The PHP bridge forwards `grimoireImage` with the report, keeping its API key private.

Deploy snp-site's nullable `grimoire_image_hash` migration and image-capable bridge
before this fork. The site validates/re-encodes PNGs and stores them on its persistent
volume; the browser never uploads SVG or arbitrary image URLs.

Capture regression checks must inspect the image: computed implicit CSS grid tracks
and auto margins otherwise displace token overlays and night-order numbers. The
snapshot helper fixes these only in the captured copy. `regenerator-runtime` is
imported explicitly for Encore's async transpilation.

Run `php tools/test-snp-snapshot.php` for the isolated PHP proxy contract test.
The corresponding snp-site browser test drives this fork locally, intercepts report
requests and compares the preview pixels with the live pad in Chromium/WebKit.
