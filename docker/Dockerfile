# syntax=docker/dockerfile:1
# Opcional: o mesmo site estático (scripts/montar-site.mjs) servido por nginx, para Coolify ou
# qualquer servidor com Docker. Na Vercel NÃO é usado (ela roda o script e publica dist/).
# No Coolify: Dockerfile em /docker/Dockerfile, contexto = raiz do repositório, porta = PORT.
FROM node:22-alpine AS montador
WORKDIR /repo
COPY . .
RUN node scripts/montar-site.mjs

FROM nginx:alpine
RUN rm -f /etc/nginx/conf.d/default.conf
COPY docker/nginx.conf /etc/nginx/templates/site.conf.template
COPY --from=montador /repo/dist/ /usr/share/nginx/html/
ENV PORT=8090
EXPOSE 8090
CMD ["nginx", "-g", "daemon off;"]
