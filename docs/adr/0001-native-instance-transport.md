# ADR 0001: Transporte nativo de instancias restringido en Rust

Estado: aceptado e implementado en la Alpha anterior. Fecha original: 19 de octubre de 2026. [Decisión completa y comprobantes en inglés](../en/original/docs/adr/0001-native-instance-transport.md).

## Contexto

El cliente Svelte de escritorio debe poder seleccionar instancias independientes sin descargar código ejecutable desde esos servidores. Abrir todas las conexiones HTTPS/WSS del webview expondría las credenciales a JavaScript y ampliaría sus capacidades. Una lista fija de orígenes exigiría reconstruir el cliente para cada instalación.

## Decisión

Tauri permite únicamente IPC con un mediador Rust. El mediador valida origen, métodos, rutas e identificadores; comprueba TLS, no sigue redirecciones y limita cuerpos y eventos. Los tokens permanecen en memoria Rust y se eliminan de las respuestas que recibe JavaScript.

Hay **una conexión seleccionada por ventana**, identificada por un handle opaco. Un nonce por documento, un orden de selección y generaciones de sesión invalidan trabajo de documentos destruidos y conexiones sustituidas. Reiniciar o recargar borra el estado nativo local; solo un cierre de sesión correcto revoca la sesión en el servidor.

Los seis comandos autorizados son nuvex_document, nuvex_connect, nuvex_request, nuvex_events, nuvex_events_control y nuvex_dispose. El webview no recibe permisos generales de archivos, shell o red. El servidor exige Bearer explícito para transporte sin Origin/Cookie y tickets de WebSocket de un solo uso.

## Consecuencias

Cambiar de instancia en escritorio exige autenticarse otra vez. Las varias sesiones en memoria añadidas al navegador no se trasladan automáticamente a este mediador. Ampliarlo requerirá un modelo de propiedad de handles, límites y revocación, y pruebas nativas de aislamiento.

La implementación no incluye almacén permanente de credenciales, compatibilidad con proxies corporativos ni nuevas capacidades del sistema. La [decisión original](../en/original/docs/adr/0001-native-instance-transport.md) conserva escenarios, revisiones y resultados de Windows/Linux/TLS; no verifica cambios posteriores.
