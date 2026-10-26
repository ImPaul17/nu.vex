# Preparación de publicación

[Inicio](../README.md) · [Comprobantes históricos detallados](en/original/docs/release-readiness.md)

**Todas las versiones siguen siendo pre-release Alpha.** Referencia publicada: v0.2.0-alpha.6. Esta rama requiere su propia revisión y no cambia el estado de las releases anteriores.

| Área | Estado y condición de salida |
| --- | --- |
| Cliente web | Fuentes compartidas, build estático y pruebas de navegador |
| Cambio de instancia | Verificar sesiones independientes, respuestas tardías y cierre de una sola cuenta |
| Servidor | PostgreSQL, cuentas, invitaciones, mensajes, permisos y WebSocket |
| Cliente alojado | URL provisional y exportación reproducible; no incluye el servidor |
| Instancia oficial | Pendiente infraestructura persistente, HTTPS, copias y operación |
| Escritorio | Instaladores Alpha previos; estos cambios aún no están empaquetados |
| Actualización automática | Pendiente firma, metadatos y prueba de actualización/recuperación |
| Android/iOS | Pendiente; existe web adaptable |
| Privados, voz y archivos | Pendientes según hoja de ruta |
| Roles avanzados, bots y galería | Pendientes; permisos básicos no equivalen al sistema final |

## Antes de cada Alpha

1. Registrar revisión y versión exactas; conservar el sufijo Alpha.
2. Ejecutar tipos, pruebas y build; comprobar cuentas reales cuando cambien.
3. Revisar capturas de escritorio/móvil y los tres temas.
4. Incluir README y notas en español con referencia secundaria en inglés.
5. Incluir LICENSE, NOTICE y avisos de dependencias.
6. Verificar instaladores, sumas, firma cuando exista y contenido legal.
7. Mantener separadas las evidencias de web, servidor, contenedores y escritorio.

Un despliegue web o una captura no sustituyen la aceptación multiusuario. Una publicación sin firma no activa actualización automática. Los resultados ejecutados están en [verificación](verification-current.md). La [hoja de ruta](roadmap.md) fija lo que falta.
