# Verificación actual

[Inicio](../README.md) · [Comprobantes anteriores completos](en/original/docs/verification-current.md)

## Rama de interfaz e instancias · 26 de octubre de 2026

| Comprobación | Resultado |
| --- | --- |
| npm run check | Correcto; cero errores y avisos de Svelte |
| npm test | 14 pruebas correctas, node:test mediante tsx |
| npm run test:e2e con Edge | Seis escenarios correctos |
| npm run test:instance local con Edge | Ocho escenarios correctos, sin omitir la segunda instancia; regresión adicional del 401 correcta después de la corrección |
| cargo build --locked del backend actual | Correcto, Rust 1.99.1 |
| npm run web:export | Correcto; exportación Cloudflare, CSP por hash y seis pruebas de inventario de licencias |
| npm run test:cloudflare | Ocho pruebas correctas del proxy |
| actionlint 1.7.12 | Correcto para los workflows modificados de CI y Release Drafter; sin ShellCheck/Pyflakes |
| Autenticación y publicación Cloudflare | Correctas; Worker `nuvex-alpha`, URL propia workers.dev |
| Túnel privado y servicio Workers VPC | Creados, vinculados y disponibles; recorrido público comprobado |
| Playwright contra la URL pública, con Edge | Cuatro escenarios correctos en 17,2 s después de corregir el acceso prematuro al registro |
| Reinicio real de Axum a través de Cloudflare | Misma cookie de sesión, membresía e historial recuperados después de reiniciar el proceso |
| PostgreSQL de servicio | Creado y migrado, 127.0.0.1:55433, clúster separado con rol de aplicación restringido |
| Escritorio Tauri con esta rama | No ejecutado |
| Copia/restauración PostgreSQL de servicio | Correcta en base separada con cuatro cuentas y cuatro mensajes sintéticos persistidos por la API pública; origen sin modificar |
| Docker con esta rama | No ejecutado; consultar comprobantes históricos |

El backend se compiló desde las fuentes actuales a un directorio de pruebas separado. Dos procesos independientes usan los puertos 3001 y 3002 y bases PostgreSQL distintas. Estas son bases de pruebas; no se han presentado como la base del servicio central ni se probaron contra datos de producción.

Las pruebas cubren respuestas de historial tardías, cuentas sustituidas, paginación tras reconciliación, recuperación de un borrado perdido, revocación de miembros/sesiones y mensajería bidireccional. El nuevo escenario alterna entre ambos servidores y comprueba ausencia de credenciales en el almacenamiento del navegador.

Durante la preparación se detectó que faltaba Chromium de Playwright; se usó Edge instalado. También se corrigieron los nombres accesibles de los controles de acceso y cierre de sesión. Los resultados finales son de las pruebas ejecutadas después de las correcciones.

La primera aceptación pública detectó una condición de carrera: el acceso a registro aparecía antes de terminar la restauración de sesión y un 401 tardío cambiaba la vista. El commit `2367978` espera esa restauración. Su regresión retiene un 401 auténtico: falla antes de la corrección y pasa después. La pasada pública final incluye esta regresión, recuperación del historial, revocación de miembros/sesiones y el registro, invitación y mensajería bidireccional de dos cuentas.

Las [capturas](interface.md) muestran escritorio, móvil y los tres temas. Las imágenes revisadas están en `docs/images`; las trazas con credenciales permanecen en el directorio ignorado `test-results`.

## Alcance

Despliegue comprobado: [nuvex-alpha.pablomerino2008.workers.dev](https://nuvex-alpha.pablomerino2008.workers.dev). Worker `nuvex-alpha`, versión Cloudflare `dda0f992-3690-4022-8fd9-bb96da3d502c`; servicio `nuvex-central-api` enlazado como `NUVEX_API` mediante el túnel privado `nuvex-central-pc`. `/health/ready` y `/api/v1/instance` respondieron 200. Consulta [despliegue propio](web-deployment.md).

PostgreSQL de servicio está separado de las bases de pruebas. La restauración en `nuvexcentral_restore_20261026_9b76e3f230fb` conservó esquema y recuentos de cuatro cuentas y cuatro mensajes sintéticos; comprobó una transacción adicional y la revirtió. Se guardó otra copia antes de retirar las 13 cuentas de aceptación y sus recursos, identificados por los patrones exactos de estas ejecuciones y con comprobación de ausencia de relaciones con usuarios ajenos. La entrega quedó con cero cuentas y cero mensajes. Los recibos y archivos privados permanecen fuera de Git.

Mientras el backend y la base estén en el PC, su disponibilidad exige que permanezca encendido, conectado y con los procesos necesarios en ejecución. Los scripts de inicio están documentados; no se ha instalado un servicio Windows ni configurado inicio automático al arrancar el equipo.

El servicio central Alpha está desplegado. La cuenta y comunidad oficial de Pablo aún deben configurarse con su acceso real. No se han implementado privados, voz, archivos compartidos, roles avanzados, proveedores externos, actualización automática o apps móviles nativas. Las pruebas públicas se ejecutaron con contextos separados en un mismo equipo, no desde dos redes físicas distintas. Consulta [preparación de publicación](release-readiness.md).

Las verificaciones de instaladores, TLS nativo, contenedores, copia/restauración y CI de versiones anteriores se conservan en el [registro histórico](en/original/docs/verification-current.md), con sus revisiones exactas. No se atribuyen automáticamente a esta rama.
