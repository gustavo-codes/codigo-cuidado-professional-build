# syntax=docker/dockerfile:1
# Mesmo Dockerfile nos 3 builds (paciente, profissional, combinado). Roda na Vercel,
# no Coolify ou em qualquer servidor com Docker.
#
# Fonte editavel: index_.html. O index.html e GERADO aqui — nao editar na mao.
#
# COMPRESSAO (variavel de ambiente, lida quando o container sobe):
#   plano (padrao) — os .br da Unity vao DESCOMPRIMIDOS, com o mesmo nome. Obrigatorio na
#                    Vercel: o proxy dela comprime de novo por cima do Content-Encoding de
#                    origem e corrompia os .br. Funciona em qualquer servidor; o download so
#                    fica pequeno se o proxy comprimir (Vercel/Cloudflare/gzip do Coolify).
#   br             — Coolify/servidor proprio: manda o .br original (Content-Encoding: br,
#                    download ~3x menor) para quem pede br. Navegador so pede br em HTTPS;
#                    em http:// simples recebe a versao descomprimida em vez de quebrar.
#
# Barra de carregamento: o nginx manda X-Expected-Length = tamanho REAL (descomprimido) de
# cada arquivo, e o loader da Unity e ajustado para usar esse numero antes de qualquer
# chute (sem isso ele chuta 2x o comprimido e a barra dispara e depois trava; e sem
# Content-Length — Vercel/proxy comprimindo — ela pulava direto para 90%).
FROM alpine:3 AS calculadora
RUN apk add --no-cache brotli
# O site inteiro e montado aqui e copiado UMA vez para a imagem final (sem .br duplicado em camadas).
COPY . /site
RUN set -e; \
    cd /site/Build; \
    NOME=$(basename "$(ls *.loader.js | head -1)" .loader.js); \
    mkdir -p /site/_br/Build /tmp/nginx; \
    : > /tmp/nginx/arquivos-unity.inc; \
    for f in *.br; do \
        mv "$f" "/site/_br/Build/$f"; \
        brotli -d "/site/_br/Build/$f" -o "$f"; \
        case "$f" in \
            *.wasm.br) TIPO=application/wasm ;; \
            *.js.br)   TIPO=application/javascript ;; \
            *)         TIPO=application/octet-stream ;; \
        esac; \
        printf 'location = /Build/%s { types { } default_type %s; add_header X-Expected-Length %s; add_header Content-Encoding $unity_ce; add_header Vary Accept-Encoding; add_header Cache-Control "public, max-age=31536000, immutable"; try_files $unity_dir/Build/%s =404; }\n' \
            "$f" "$TIPO" "$(stat -c %s "$f")" "$f" >> /tmp/nginx/arquivos-unity.inc; \
    done; \
    sed -e 's#d=void 0!==a.headers.get("Content-Length")#d=void 0!==a.headers.get("Content-Length")||void 0!==a.headers.get("X-Expected-Length")#' \
        -e 's#if(!t)return 0;#var x=parseInt(e.headers.get("X-Expected-Length"));if(x>0)return x;if(!t)return 0;#' \
        -i "$NOME.loader.js"; \
    grep -q 'if(x>0)return x;' "$NOME.loader.js"; \
    grep -q '||void 0!==a.headers.get("X-Expected-Length")' "$NOME.loader.js"; \
    V=$(( $(stat -c %s "/site/_br/Build/$NOME.data.br") + $(stat -c %s "$NOME.loader.js") )); \
    sed -e "s|\"/$NOME.loader.js\"|\"/$NOME.loader.js?v=$V\"|g" \
        -e "s|\"/$NOME.data.br\"|\"/$NOME.data.br?v=$V\"|g" \
        -e "s|\"/$NOME.framework.js.br\"|\"/$NOME.framework.js.br?v=$V\"|g" \
        -e "s|\"/$NOME.wasm.br\"|\"/$NOME.wasm.br?v=$V\"|g" \
        -e "s/?v=[0-9]*/?v=$V/g" \
        /site/index_.html > /site/index.html; \
    grep -q "?v=$V" /site/index.html; \
    cp /site/ServiceWorker.canonical.js /site/ServiceWorker.js; \
    cat /tmp/nginx/arquivos-unity.inc

FROM nginx:alpine
# Sem o default.conf da imagem base: ele virava o server padrao e recebia o trafego.
RUN rm -f /etc/nginx/conf.d/default.conf
# Template: o entrypoint da imagem roda envsubst (so nas variaveis definidas: PORT e
# COMPRESSAO) e gera /etc/nginx/conf.d/nginx.conf.
COPY nginx.conf /etc/nginx/templates/nginx.conf.template
# Site pronto: .br descomprimidos (mesmo nome), loader ajustado, .br originais em /_br
# (modo br), index.html gerado e ServiceWorker.js canonico.
COPY --from=calculadora /site/ /usr/share/nginx/html/
COPY --from=calculadora /tmp/nginx/arquivos-unity.inc /etc/nginx/arquivos-unity.inc
# PORT: a Vercel injeta em runtime; fora dela vale este padrao (ou defina no Coolify).
ENV PORT=8090
ENV COMPRESSAO=plano
EXPOSE 8090
CMD ["nginx", "-g", "daemon off;"]
