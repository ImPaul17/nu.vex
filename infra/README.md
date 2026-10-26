# Infraestructura

[Autoalojamiento](../docs/self-hosting.md) · [Referencia en inglés](../docs/en/original/infra/README.md)

`compose.yaml` conecta PostgreSQL privado, migraciones explícitas, backend y web con proxy Nginx. El registro está cerrado y el modo inseguro desactivado por defecto. Los secretos y el origen no tienen valores utilizables de producción.

- Dockerfile.web y Dockerfile.server construyen cliente y servidor.
- nginx.conf y los fragmentos preservan Origin y restringen conexiones.
- Caddyfile.example prepara terminación HTTPS en un dominio controlado por el operador.
- write-csp.mjs y connect-origins.mjs generan la política de conexiones permitidas.
- backup-db.mjs y restore-db.mjs incluyen comprobación de integridad y salvaguardas del destino.

```sh
node --test infra/infra.test.mjs
```

Estas pruebas no ejecutan Docker, pg_dump o Nginx; la aceptación del despliegue se registra por separado. No publiques el resultado expandido de Compose cuando contenga secretos.

Para APIs externas, define `NUVEX_CONNECT_ORIGINS` y reconstruye web. Usa orígenes exactos HTTPS; HTTP solo local. También debes configurar el origen permitido en cada backend. Consulta la [guía de autoalojamiento](../docs/self-hosting.md).

`cloudflare/worker.mjs` sirve el cliente mediante Static Assets y dirige la API a un único servicio privado Workers VPC. La configuración está en `wrangler.jsonc`; `npm run test:cloudflare` comprueba el proxy. La operación del despliegue actual se describe en [Cloudflare](../docs/web-deployment.md) y en [la instancia del PC](../docs/local-instance.md).
