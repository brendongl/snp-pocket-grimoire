# Pocket Grimoire — self-hosted container for Sip n Play.
#
# Upstream ships a docker-compose.yml that provisions only a Postgres box for local
# development; there is no image for the app itself. This builds one.
#
# Two stages: Webpack Encore needs Node and produces public/build/, which the PHP image
# then serves as static files. Node has no business being in the runtime image.

# ---------------------------------------------------------------------------
# Stage 1 — front-end assets
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS assets

WORKDIR /app

# yarn.lock is the lockfile upstream keeps in step (there is no package-lock.json), so
# the build must use yarn or it will silently resolve different dependency versions.
COPY package.json yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile

# webpack.config.js reads from ./assets and writes to ./public/build. No PostCSS config
# is needed despite .enablePostCssLoader() — postcss-loader runs unconfigured, verified
# by building with and without one.
COPY webpack.config.js ./
COPY assets ./assets

RUN yarn build

# ---------------------------------------------------------------------------
# Stage 2 — PHP runtime
# ---------------------------------------------------------------------------
# Symfony 5.4 supports PHP 8.1/8.2. Staying on 8.2 rather than 8.3+ because this app
# still uses doctrine/annotations and sensio/framework-extra-bundle, both of which get
# noisy-to-broken on newer PHP.
FROM php:8.2-apache-bookworm AS runtime

# intl is required by symfony/intl; pdo_pgsql by Doctrine against Postgres; zip is for
# composer's dist installs; opcache is the single biggest production win.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libicu-dev \
        libpq-dev \
        libzip-dev \
        unzip \
        git \
        curl \
    && docker-php-ext-configure intl \
    && docker-php-ext-install -j"$(nproc)" intl pdo pdo_pgsql zip opcache \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN printf '%s\n' \
    'opcache.memory_consumption=128' \
    'opcache.max_accelerated_files=20000' \
    'opcache.validate_timestamps=0' \
    > /usr/local/etc/php/conf.d/opcache.ini \
 && printf '%s\n' \
    'memory_limit=256M' \
    > /usr/local/etc/php/conf.d/app.ini

# Symfony serves everything through public/index.php.
ENV APACHE_DOCUMENT_ROOT=/var/www/html/public
RUN sed -ri 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' \
        /etc/apache2/sites-available/*.conf \
        /etc/apache2/apache2.conf \
 && a2enmod rewrite headers

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# Dependencies first, so application edits don't invalidate the composer layer.
# Scripts are skipped here because auto-scripts runs cache:clear, which needs the full
# source tree and the env that only exists once everything below is copied.
COPY composer.json composer.lock symfony.lock ./
RUN composer install \
        --no-dev \
        --no-scripts \
        --no-autoloader \
        --prefer-dist \
        --no-interaction \
        --no-progress

COPY . .
COPY --from=assets /app/public/build ./public/build

RUN composer dump-autoload --classmap-authoritative --no-dev \
 && mkdir -p var/cache var/log \
 && chown -R www-data:www-data var public/build

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV APP_ENV=prod \
    APP_DEBUG=0

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS http://localhost/ >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["apache2-foreground"]
