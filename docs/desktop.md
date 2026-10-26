# Escritorio y actualizaciones

[Inicio](../README.md) · [Guía completa en inglés](en/original/docs/desktop.md)

Tauri 2 ejecuta el mismo cliente que la web. El escritorio se conecta a servidores; no inicia PostgreSQL ni una instancia automáticamente.

## Ejecutar

Necesitas Rust/Cargo y los requisitos nativos de Tauri para tu sistema. En Windows se requieren herramientas de compilación compatibles y WebView2. El entorno local preparado y sus límites están en [herramientas locales](toolchain-local.md).

```sh
npm run desktop:dev
npm run desktop:build
```

El transporte Rust mantiene tokens en memoria y permite solo operaciones/destinos conocidos. La CSP y los permisos de la ventana no conceden acceso general al sistema. Consulta [ADR 0001](adr/0001-native-instance-transport.md).

## Descargas Alpha

[GitHub Releases](https://github.com/ImPaul17/nu.vex/releases) distribuye instaladores de Windows x64, Linux x64 y macOS Apple Silicon. Verifica `SHA256SUMS.txt` y lee las notas. Los paquetes Alpha actuales no están firmados. macOS Intel, AppImage y verificación interactiva de macOS tienen hitos propios.

Esta rama modifica el cliente compartido. No se debe afirmar que el instalador publicado ya incluye estos cambios hasta generar y comprobar un nuevo paquete Alpha.

## Actualización dentro de la app

Todavía no está habilitada. La implementación prevista usa el actualizador firmado de Tauri: detección discreta al recuperar conexión, notas de versión, descarga con progreso, instalación consentida y reinicio conservando preferencias/cuentas. No requiere NuGet.

Antes de activarlo faltan clave pública incorporada, clave privada protegida en CI, endpoint y metadatos por plataforma, selección correcta de pre-releases y pruebas de instalación, fallo y recuperación. No se usará la primera URL de un instalador remoto como sustituto de la verificación de firma.

La sesión de una instancia externa se mantiene en memoria por diseño; tras reiniciar puede exigir volver a iniciar sesión. Mantener credenciales entre reinicios necesita un almacén seguro propio y un hito de revocación.

## Publicar paquetes

El flujo existente prepara recursos legales nativos, compila, empaqueta y verifica contenido de los instaladores. Conserva fuentes originales de iconos, LICENSE, NOTICE, fuentes y avisos de dependencias. No alteres la política de pre-release.

Los pasos exactos de empaquetado Alpha, pruebas WebDriver de Windows/Linux, TLS y límites por plataforma están en la [referencia técnica](en/original/docs/desktop.md). El [registro de verificación](verification-current.md) distingue pruebas históricas de las ejecutadas en esta rama.
