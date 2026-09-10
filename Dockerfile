# =========================================================
# WIDGETS KOMMO - nginx estático
# Cada carpeta de este repo es un widget de Kommo (HTML)
# que se sirve como iframe desde Kommo Dashboard.
# =========================================================

FROM nginx:1.27-alpine

COPY nginx/default.conf /etc/nginx/conf.d/default.conf

COPY . /usr/share/nginx/html

RUN rm -rf /usr/share/nginx/html/nginx

EXPOSE 80
