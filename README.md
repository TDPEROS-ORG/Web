# Energia: web de operadores

API activa: `https://backend-production-2dca.up.railway.app`. La imagen Docker ya incluye esta URL como `API_UPSTREAM` predeterminado; el navegador mantiene sus llamadas a `/api` mediante nginx. Si Railway ya tiene otra variable `API_UPSTREAM`, actualizala o eliminala: una variable del servicio prevalece sobre el valor de la imagen. Se necesita redesplegar Web para aplicar este cambio.

Consola existente de operadores, empaquetada con esbuild y servida con nginx. API y base de datos estan en [Backend](https://github.com/TDPEROS-ORG/Backend); los clientes usan [Mobile](https://github.com/TDPEROS-ORG/Mobile).

**REQUIERE CODIGO:** empaquetado y proxy para Railway o Netlify incluidos. **FUNCIONAL:** conectar este repo al proveedor elegido y configurar el dominio.

## Netlify

Sitio: `https://operator-profile.netlify.app/`.

1. Conecta el repositorio `TDPEROS-ORG/Web`, rama `main`, con este directorio como raiz.
2. Usa la configuracion versionada `netlify.toml`: compilacion `npm run build:netlify`, publicacion `netlify-dist` y Node 22.
3. Redespliega desde el ultimo commit. No publiques la raiz del repositorio ni solo `index.html`: la compilacion genera HTML, JS, CSS e imagen en `/operador/assets/`.
4. Comprueba `/`, `/operador`, `/operador/assets/app.js`, `/operador/assets/app.css` y `/api/ready`.

Netlify reenvia `/api/*` a la API de Railway. El navegador mantiene el mismo origen, las cookies seguras y CSRF; no necesita una URL absoluta ni cambios de CORS. El acceso admite usuario o correo; la creacion habitual de cuentas sigue requiriendo correo en la API.

Para un despliegue manual, ejecuta `npm ci` y `npm run build:netlify`, y publica el contenido completo de `netlify-dist`. El archivo `_redirects` debe quedar junto a `index.html`, no dentro de `operador/assets`, para conservar el proxy aunque no se use una integracion Git.

## Railway

1. Despliega primero MySQL y la API siguiendo [la guia completa](https://github.com/TDPEROS-ORG/Backend/blob/main/PASO_A_PASO_RAILWAY.md).
2. Crea un servicio **energia-web** desde este repositorio, rama `main`, raiz `/`, usando el Dockerfile incluido. Conserva el inicio predeterminado de nginx.
3. Define `API_UPSTREAM=https://TU-API.up.railway.app` con la URL real de la API. Sin `/api` ni barra final; usa HTTPS en produccion. No es un secreto.
4. nginx lee `PORT` de Railway; usa 8080 si no existe. Healthcheck: `/healthz`.
5. Genera un dominio HTTPS y entra en `/operador`. En la API establece `CORS_ORIGINS` con el origen exacto de esta web.
6. Activa autodeploy y **Wait for CI** en Railway. GitHub Actions construye y comprueba la imagen; no necesita claves de Railway.

El navegador llama a `/api` en su propio dominio; nginx hace el proxy. No cambies `credentials: same-origin`: permite cookies HttpOnly/Secure y CSRF manteniendo `SameSite=Strict`. No sirve desplegar estos archivos en GitHub Pages sin un proxy equivalente.

El operador se crea por CLI en Backend, no hay una contrasena predeterminada. Desde la web podra crear clientes/hogares y registrar dispositivos. No guardes sus claves en GitHub.

## Comprobacion local

```powershell
docker build -t energia-web .
docker run --rm --name energia-web-local -p 127.0.0.1:8082:8080 -e API_UPSTREAM=https://TU-API.up.railway.app energia-web
```

Sustituye el upstream antes de ejecutar. Si 8082 esta ocupado, elige otro puerto. Abre `http://127.0.0.1:8082/operador`. El ejemplo local no sustituye la verificacion HTTPS/cookies de produccion.

## Validacion de la entrega

Imagen Linux construida y prueba HTTP integrada con Backend temporal: HTML, JS, CSS, imagen, readiness, login de operador, cookie HttpOnly y rechazo sin CSRF, seguido de escritura autorizada. No se ha desplegado en Railway desde esta entrega.

No se versionan `node_modules`, `dist`, `netlify-dist`, `.netlify`, `.env` ni secretos. Ambos empaquetados construyen los recursos desde fuentes y lockfile.