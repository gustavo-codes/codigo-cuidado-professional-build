FROM nginx:alpine
COPY . /usr/share/nginx/html
RUN printf 'events {}\n\
http {\n\
    include /etc/nginx/mime.types;\n\
    map $uri $unity_type {\n\
        default                 application/octet-stream;\n\
        ~\\.wasm\\.br$           application/wasm;\n\
        ~\\.framework\\.js\\.br$  application/javascript;\n\
        ~\\.loader\\.js\\.br$     application/javascript;\n\
    }\n\
    server {\n\
        listen 8090;\n\
        location ~ \\.br$ {\n\
            root /usr/share/nginx/html;\n\
            default_type $unity_type;\n\
            add_header Content-Encoding br;\n\
        }\n\
        location / {\n\
            root /usr/share/nginx/html;\n\
            index index.html;\n\
        }\n\
    }\n\
}\n' > /etc/nginx/nginx.conf
EXPOSE 8090
CMD ["nginx", "-g", "daemon off;"]
