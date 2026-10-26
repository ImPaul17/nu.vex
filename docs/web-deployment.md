# Despliegue propio en Cloudflare

[Inicio](../README.md) · [English](en/README.md)

**Estado: pendiente de autenticación, provisión y publicación en la cuenta propia de Cloudflare.** Todavía no hay una URL de Cloudflare comprobada para esta entrega.

Por decisión del usuario, se descarta el alojamiento anterior de ChatGPT Sites. Su dirección y configuración no representan el despliegue de nu.vex y no se usarán para continuar la publicación.

## Ruta preferida

El cliente estático de `apps/web` se alojará en **Cloudflare Workers Static Assets**, con la dirección `workers.dev` que asigne la cuenta. No es necesario comprar un dominio para esta primera Alpha. El servidor **Rust/Axum** y **PostgreSQL** se ejecutarán en el PC autorizado.

Un Worker atenderá las rutas de API y salud y las enviará a un **VPC Service HTTP** a través de un **Cloudflare Tunnel privado**. Los demás recursos se servirán como archivos estáticos, con el comportamiento de aplicación de una sola página para abrir `/demo` y las demás rutas del cliente. Esta es la arquitectura elegida; aún requiere su implementación y prueba en la cuenta real. [Static Assets](https://developers.cloudflare.com/workers/static-assets/), [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [Workers VPC](https://developers.cloudflare.com/workers-vpc/get-started/).

El túnel privado permite alcanzar la API sin publicar PostgreSQL ni abrir un puerto entrante del router. La base seguirá siendo PostgreSQL: no se sustituirá por D1 ni se reescribirá el servidor para esta migración. Workers VPC está en beta; su disponibilidad y los permisos de la cuenta se comprobarán durante la provisión. [Servicios VPC](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/).

## Base de datos del servicio

La instancia accesible desde Cloudflare necesita **una base y una cuenta PostgreSQL propias, separadas de las bases de desarrollo y de las pruebas automáticas**. No se publicará el clúster de pruebas como si fuera la comunidad central.

El arranque debe aplicar las migraciones al destino de servicio, usar credenciales independientes y mantener la escucha de PostgreSQL en la máquina local. Los secretos permanecerán en configuración local protegida o en el gestor de secretos correspondiente; no deben introducirse en el cliente, en variables públicas de compilación, en registros ni en Git.

Antes de admitir datos reales se comprobarán una copia y su restauración en un destino separado. La cuenta administradora de Pablo se establecerá mediante un flujo real de acceso; no se documentará como creada hasta verificarlo.

## Disponibilidad del PC

Mientras Axum y PostgreSQL estén en este PC, las cuentas y conversaciones dependen de que **el ordenador permanezca encendido, conectado a Internet y con PostgreSQL, Axum y `cloudflared` en ejecución**. Si se apaga o suspende, los archivos del cliente seguirán alojados en Cloudflare, pero su API dejará de estar disponible.

Esta primera instalación no equivale a un servicio independiente del ordenador ni a operación continua verificada. Más adelante puede trasladarse el mismo servidor y su base a una máquina siempre disponible sin cambiar el modelo de instancias.

## Preparación y publicación

El flujo previsto es:

1. Autenticar Wrangler en la cuenta propia de Cloudflare y confirmar la cuenta de destino.
2. Compilar y verificar el cliente, conservando fuentes y avisos legales.
3. Preparar la base PostgreSQL de servicio y ejecutar el backend con la configuración de producción.
4. Crear el túnel privado, registrar su servicio HTTP y vincularlo al Worker.
5. Publicar los recursos estáticos y el proxy con Wrangler en la dirección asignada.
6. Comprobar la web, el registro y la mensajería desde redes externas antes de registrar la publicación como operativa.

No se fijan aquí nombres de recursos, identificadores ni URL inventadas. El archivo de configuración del despliegue y el comprobante final deberán conservar los valores que devuelva Cloudflare. [Configuración de Wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/).

El backend debe aceptar el origen exacto del cliente en `NUVEX_ALLOWED_ORIGIN` y usar `NUVEX_INSECURE_DEV=false`. El proxy debe preservar las reglas de Origin, cookies y autenticación del servidor; no debe reemplazar un Origin inválido por uno permitido. Las conexiones WebSocket y su revocación deben comprobarse a través del proxy real.

## Qué no constituye una publicación permanente

Un Quick Tunnel puede exponer un servicio local con una dirección aleatoria `trycloudflare.com`, sin dominio propio, pero es una herramienta de desarrollo: cambia de hostname al recrearlo y se detiene al terminar el proceso. No se presentará como la dirección permanente de la comunidad. Un túnel público con hostname estable requiere un dominio en Cloudflare; la ruta privada VPC evita necesitar ese hostname público para el backend. [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/), [túnel público](https://developers.cloudflare.com/tunnel/get-started/).

## Aceptación pendiente

La publicación solo se dará por comprobada después de registrar:

- URL HTTPS efectiva y revisión publicada.
- Dos cuentas desde redes distintas unidas a la comunidad oficial.
- Mensajes bidireccionales y WebSocket a través de Cloudflare.
- Historial conservado tras reiniciar el servicio.
- Revocación de sesión y de acceso sin exposición de datos ajenos.
- Copia y restauración de la base de servicio en otro destino.

Todas las entregas continúan como **pre-release Alpha**. El estado y los resultados se actualizarán en [verificación](verification-current.md).
