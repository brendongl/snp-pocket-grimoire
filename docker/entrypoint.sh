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
# The character list comes from the DATABASE, not the built assets, so a container that
# skips this comes up looking fine and then offers no characters to pick.
#
# Use the populate-* commands, NOT pocket-grimoire:import. `import` is for updating an
# already-populated database with translations: on an empty one it dies on the first
# character, because getEdition() has no create path and returns null. The populate
# commands each read one data file and are the actual bootstrap.
#
# Order matters — roles reference both teams and editions.
#
# Set PG_SKIP_IMPORT=1 to skip on restart once the data is in. Re-running is safe
# (every command is find-or-create), just slow.
if [ "${PG_SKIP_IMPORT:-0}" = "1" ]; then
    log "PG_SKIP_IMPORT=1 — skipping reference data bootstrap"
else
    log "populating reference data..."
    populate() {
        label="$1"; shift
        if php bin/console "$@" --no-interaction >/dev/null 2>&1; then
            log "  ok: ${label}"
        else
            # Never fatal. A missing jinx table is a worse outcome than no app at all,
            # and every one of these is independently re-runnable by hand.
            log "  WARNING: ${label} failed — re-run by hand if needed"
        fi
    }

    populate "teams"     pocket-grimoire:populate-teams    --file=assets/data/teams.json
    populate "editions"  pocket-grimoire:populate-editions --file=assets/data/editions.json
    populate "roles"     pocket-grimoire:populate-roles    --file=assets/data/characters.json
    # pocket-grimoire:jinxes, NOT populate-jinxes. jinx.json is nested
    # ({id, jinx:[{id, reason}]}) and only this command reads that shape; populate-jinxes
    # wants a flat {target, trick, reason}, so on jinx.json every target is null and it
    # dies in JinxRepository::getByTargetTrick(). Jinxes also have to come after roles,
    # since each one links two of them.
    populate "jinxes"    pocket-grimoire:jinxes            --file=assets/data/jinx.json
    populate "night order" pocket-grimoire:order-roles     --file=assets/data/night-order.json

    roles="$(php bin/console dbal:run-sql 'SELECT COUNT(*) AS c FROM roles' --no-interaction 2>/dev/null | grep -oE '[0-9]+' | tail -1 || echo '?')"
    log "reference data ready — ${roles} roles"
fi

chown -R www-data:www-data var || true

log "starting: $*"
exec "$@"
