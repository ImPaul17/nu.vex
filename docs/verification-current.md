# Verificación actual

[Inicio](../README.md) · [Comprobantes anteriores completos](en/original/docs/verification-current.md)

## Rama de interfaz e instancias · 26 de octubre de 2026

| Comprobación | Resultado |
| --- | --- |
| npm run check | Correcto; cero errores y avisos de Svelte |
| npm test | 14 pruebas correctas, node:test mediante tsx |
| npm run test:e2e con Edge | Seis escenarios correctos |
| npm run test:instance con Edge | Ocho escenarios correctos, sin omitir la segunda instancia |
| cargo build --locked del backend actual | Correcto, Rust 1.99.1 |
| npm run web:export | Correcto; exportación Cloudflare, CSP por hash y seis pruebas de inventario de licencias |
| Autenticación y publicación Cloudflare | Pendientes; sin URL propia comprobada todavía |
| Tunnel privado y servicio Workers VPC | Pendientes de provisión y prueba con la cuenta real |
| PostgreSQL de servicio | Creado y migrado, 127.0.0.1:55433, clúster separado con rol de aplicación restringido |
| Escritorio Tauri con esta rama | No ejecutado |
| Copia/restauración PostgreSQL de servicio | Correcta en base separada, con transacción sintética revertida |
| Docker con esta rama | No ejecutado; consultar comprobantes históricos |

El backend se compiló desde las fuentes actuales a un directorio de pruebas separado. Dos procesos independientes usan los puertos 3001 y 3002 y bases PostgreSQL distintas. Estas son bases de pruebas; no se han presentado como la base del servicio central ni se probaron contra datos de producción.

Las pruebas cubren respuestas de historial tardías, cuentas sustituidas, paginación tras reconciliación, recuperación de un borrado perdido, revocación de miembros/sesiones y mensajería bidireccional. El nuevo escenario alterna entre ambos servidores y comprueba ausencia de credenciales en el almacenamiento del navegador.

Durante la preparación se detectó que faltaba Chromium de Playwright; se usó Edge instalado. También se corrigieron los nombres accesibles de los controles de acceso y cierre de sesión. Los resultados finales son de las pruebas ejecutadas después de las correcciones.

Las [capturas](interface.md) muestran escritorio, móvil y los tres temas. Las imágenes revisadas están en `docs/images`; las trazas con credenciales permanecen en el directorio ignorado `test-results`.

## Alcance

El alojamiento anterior de ChatGPT Sites se descarta por decisión del usuario y no se utiliza como evidencia de publicación del nuevo despliegue. La ruta preferida es Cloudflare Workers estático, con dirección workers.dev, y un servicio VPC privado hacia Axum/PostgreSQL en el PC. La autenticación, provisión, URL efectiva y aceptación a través de Cloudflare siguen pendientes. Consulta [despliegue propio](web-deployment.md).

La instalación deberá mantener PostgreSQL de servicio separado de las bases de pruebas. Mientras el backend y la base estén en el PC, su disponibilidad exige que permanezca encendido, conectado y con los procesos necesarios en ejecución. La persistencia y recuperación de ese nuevo destino no se deducen de las pruebas locales anteriores.

No se ha desplegado el servidor central, ni se han implementado privados, voz, archivos compartidos, roles avanzados, proveedores externos, actualización automática o apps móviles nativas. Consulta [preparación de publicación](release-readiness.md).

Las verificaciones de instaladores, TLS nativo, contenedores, copia/restauración y CI de versiones anteriores se conservan en el [registro histórico](en/original/docs/verification-current.md), con sus revisiones exactas. No se atribuyen automáticamente a esta rama.
