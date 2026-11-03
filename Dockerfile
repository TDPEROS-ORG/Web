FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM nginx:1.28-alpine
ENV PORT=8080
ENV API_UPSTREAM=https://backend-production-2dca.up.railway.app
ENV NGINX_ENVSUBST_FILTER="^(PORT|API_UPSTREAM)$"
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY index.html /usr/share/nginx/html/operador/index.html
COPY --from=build /app/dist/ /usr/share/nginx/html/operador/assets/
COPY public/ /usr/share/nginx/html/operador/assets/
EXPOSE 8080