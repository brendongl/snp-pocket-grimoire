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

Upstream's `webpack.config.js` enables `postcss-loader` without committing a PostCSS
config, and `postcss` is only present as an unmet peer dependency. That looks broken but
is not — verified by building both with and without a `postcss.config.js`; the loader runs
unconfigured either way and `yarn build` exits 0. No config file added, so the diff stays
smaller.

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
