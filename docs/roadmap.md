# Hoja de ruta de nu.vex

[Inicio](../README.md) · [English](en/README.md) · [Referencia histórica completa](en/original/docs/roadmap.md)

Dirección de producto: Pablo / ImPaul17. Todas las versiones siguen siendo **pre-release Alpha**. Los estados describen código y pruebas, no fechas prometidas.

## 1. Un lugar sencillo para conversar

Cliente compartido entre web y Tauri: interfaz en español, texto legible, navegación por comunidades y canales, categorías plegables, miembros bajo demanda, búsqueda y modo concentración. Tres temas base, ajustes de acento y densidad, importación/exportación de preferencias sin código ejecutable.

Implementado en esta rama. Aceptación: navegar y enviar mensajes con teclado y móvil, no desbordar a 390 px, mantener legibilidad en bosque/medianoche/luz y conservar la apariencia al recargar. Los resultados se registran en [verificación de interfaz](interface.md).

## 2. Cuentas e instancias independientes

Ya existen registro, inicio/cierre de sesión, comunidades, canales de texto, invitaciones, PostgreSQL y WebSocket. Esta rama añade cambio entre sesiones de distintas instancias en memoria en web. El mediador de escritorio conserva una sola conexión por ventana. No enlaza identidades ni sincroniza servidores entre sí.

Aceptación: dos usuarios intercambian mensajes y conservan historial al recargar; permisos comprobados en el servidor; reconexión sin envíos duplicados. Cambiar de instancia nunca mezcla mensajes ni credenciales y cerrar sesión solo revoca la cuenta actual.

Pendiente: varios inicios de sesión en la misma instancia, recuperación de contraseña, verificación de correo y proveedores OIDC/OAuth. Requieren vinculación de identidades, revocación y pruebas de suplantación; no basta con añadir botones de proveedores.

## 3. Instancia oficial y acceso web

El [cliente Alpha](https://nuvex-alpha.pablomerino2008.workers.dev) está publicado en Cloudflare Workers. Su API Rust y PostgreSQL funcionan en el PC mediante un túnel privado y Workers VPC, con base y copias independientes. La comunidad administrada por Pablo todavía requiere configurar su cuenta y membresías. Una empresa puede operar el mismo servidor en su infraestructura.

Aceptación: HTTPS público, registro de dos personas desde redes distintas, acceso a la comunidad oficial mediante membresía, control administrativo, copia/restauración y reinicio probado. Se registrarán la dirección y el operador. Publicar archivos estáticos del cliente no cumple este hito.

## 4. Amistades, privados y moderación

Solicitudes de amistad con aceptar/rechazar/cancelar, bloqueo y preferencias de contacto. Privados y grupos con membresía explícita. Roles personalizados por comunidad y permisos sobre canales; expulsión, veto, silencios temporales y registro de acciones.

Orden: definir permisos y bloqueo; implementar almacenamiento y comprobación en el servidor; después habilitar la interfaz. Aceptación: pruebas de acceso ilegítimo a conversaciones e historial, revocación inmediata, límites contra spam y auditoría para la administración. Un rótulo de rol en un perfil no concede permisos.

## 5. Archivos y voz

Subida de archivos con cuotas y autorización por conversación; vistas seguras de texto, imágenes y vídeo; descarga con nombre y tipo controlados. Los documentos activos no se ejecutan dentro de la app. El almacenamiento debe admitir limpieza y copias junto con la base de datos.

Voz Alpha implementada: canales de hasta ocho personas con WebRTC, señalización autenticada, micrófono, escucha, selección de dispositivos y volumen global/individual. Las pruebas locales y públicas comprueban audio bidireccional y revocación. La demo mantiene el micrófono apagado. Consulta [voz](voice.md) y [su protocolo](voice-server.md).

Pendiente: relay TURN de producción, SFU para grupos y pruebas en dispositivos y redes físicas distintas. La integración actual requiere volver a entrar al recuperar una conexión perdida. Vídeo, pantalla y sonido compartido son entregables posteriores con permisos explícitos. Pulsar para hablar, actividad de voz y moderación específica de audio requieren implementación propia y aceptación adicional.

## 6. Windows y móvil

Windows: comprobar versiones cuando haya conexión, mostrar un aviso discreto, descargar una actualización firmada, instalar con consentimiento y reabrir conservando los datos. Se usará el actualizador de Tauri; NuGet gestiona paquetes .NET y no es el mecanismo de distribución de esta app Rust/Tauri.

Antes de habilitarlo: clave pública incorporada, clave privada en el gestor de secretos de publicación, metadatos por plataforma y canal Alpha, verificación de firmas y prueba de recuperación ante fallos. Las claves privadas nunca van en el repositorio.

Móvil: primero la web adaptable; después PWA con política de caché de contenido privado y builds Android/iOS. Las tiendas, firma, permisos, notificaciones y pruebas en dispositivos son entregables propios. Una captura con ancho móvil no constituye una app nativa terminada.

## 7. Temas y bots comunitarios

Primero una galería declarativa y validación de formato, autoría, versión y compatibilidad. Después un espacio para subir, revisar, descubrir y reportar temas. Cualquier personalización futura con código requiere aislamiento y permisos; los temas actuales solo admiten JSON.

Bots: identidades separadas de las cuentas personales, permisos mínimos, tokens revocables, límites, eventos versionados y revisión comunitaria. La especificación se discutirá en la comunidad antes de abrir el catálogo.

## 8. Federación

Propuesta independiente del uso de varios servidores desde un cliente. Necesita identidad y direccionamiento, confianza, consistencia, borrado, bloqueo, moderación y protección contra abuso. No se presupone federación en el modelo actual.

Cada entrega tendrá un commit, pruebas ejecutadas, límites conocidos y notas de pre-release. Los comprobantes históricos permanecen accesibles desde [verificación](verification-current.md).
