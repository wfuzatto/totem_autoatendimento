FROM php:8.3-apache-bookworm

LABEL org.opencontainers.image.title="Totem Autoatendimento V2" \
      org.opencontainers.image.description="Totem de autoatendimento PHP/Apache autocontido em Docker" \
      org.opencontainers.image.source="https://github.com/wfuzatto/totem_autoatendimento"

ENV TZ=America/Sao_Paulo \
    APACHE_DOCUMENT_ROOT=/var/www/html

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        libonig-dev \
        libsqlite3-dev \
        poppler-utils \
        tesseract-ocr \
        tesseract-ocr-eng \
        tesseract-ocr-por \
        tzdata \
    && docker-php-ext-install -j"$(nproc)" mbstring pdo_sqlite \
    && a2enmod rewrite headers \
    && rm -rf /var/lib/apt/lists/*

COPY docker/apache/totem.conf /etc/apache2/conf-available/totem.conf
COPY docker/php/totem.ini /usr/local/etc/php/conf.d/99-totem.ini
RUN a2enconf totem

WORKDIR /var/www/html
COPY PROJETO_PHP/ /var/www/html/

RUN mkdir -p /var/www/html/data /var/www/html/uploads /var/www/html/branding \
    && chown -R www-data:www-data /var/www/html \
    && chmod 0775 /var/www/html/data /var/www/html/uploads /var/www/html/branding \
    && php -r 'foreach(["pdo_sqlite","mbstring","fileinfo","openssl"] as $e){if(!extension_loaded($e)){fwrite(STDERR,"Missing PHP extension: $e\n");exit(1);}}' \
    && tesseract --list-langs 2>/dev/null | grep -qx por \
    && tesseract --list-langs 2>/dev/null | grep -qx eng \
    && command -v pdftoppm >/dev/null \
    && apache2ctl -t

COPY docker/entrypoint.sh /usr/local/bin/totem-entrypoint
RUN chmod +x /usr/local/bin/totem-entrypoint

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -fsS 'http://127.0.0.1/api.php?action=health' | grep -q '"ok":true' || exit 1

ENTRYPOINT ["totem-entrypoint"]
CMD ["apache2-foreground"]
