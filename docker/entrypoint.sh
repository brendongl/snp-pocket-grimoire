#!/bin/sh
#
# Container start-up for the self-hosted Pocket Grimoire.
#
# The app's database holds reference data — teams, editions, roles, jinxes — not game
# state (that stays in each device's localStorage). So a fresh container has to migrate
# AND import, or it comes up with an empty character list and no obvious reason why.

set -eu

log() { echo "[entrypoint] $*"; }

# --- wait for Postgres -------------------------------------------------------------
# Compose's depends_on only waits for the container, not for Postgres to accept
# connections, so the first migrate would race it on a cold start.
if [ -n "${DATABASE_URL:-}" ]; then
    log "waiting for the database..."
    i=0
    until php -r '
        $url = getenv("DATABASE_URL");
        $p = parse_url($url);
        if (!$p || !isset($p["host"])) { exit(1); }
        $port = $p["port"] ?? 5432;
        $fp = @fsockopen($p["host"], $port, $errno, $errstr, 2);
        if (!$fp) { exit(1); }
        fclose($fp);
        exit(0);
    ' 2>/dev/null; do
        i=$((i + 1))
        if [ "$i" -ge 60 ]; then
            log "database did not become reachable in time — giving up"
            exit 1
        fi
        sleep 2
    done
    log "database is up"
fi

# --- warm the cache ----------------------------------------------------------------
# Skipped at build time because it needs the full source tree and the runtime env.
log "warming the cache..."
php bin/console cache:clear --no-interaction
php bin/console cache:warmup --no-interaction

# --- schema ------------------------------------------------------------------------
log "running migrations..."
php bin/console doctrine:migrations:migrate \
    --no-interaction \
    --allow-no-migration

# --- reference data ----------------------------------------------------------------
# pocket-grimoire:import is the single entry point; it handles teams, then characters,
# then jinxes, in that order (the order matters and the command enforces it).
#
# Set PG_SKIP_IMPORT=1 to skip on restart once the data is in — it is safe to re-run,
# just slow, and it reaches out to the upstream script-tool data.
if [ "${PG_SKIP_IMPORT:-0}" = "1" ]; then
    log "PG_SKIP_IMPORT=1 — skipping reference data import"
else
    log "importing reference data (teams -> characters -> jinxes)..."
    if ! php bin/console pocket-grimoire:import --no-interaction; then
        # A failed import leaves a usable app with an empty character list, which is
        # far better than a container that will not start at all.
        log "WARNING: import failed — the app will start but characters may be missing."
        log "         re-run manually: docker exec <container> php bin/console pocket-grimoire:import"
    fi
fi

chown -R www-data:www-data var || true

log "starting: $*"
exec "$@"
