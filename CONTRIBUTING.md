# Contribuir y desarrollar nu.vex

[English reference](docs/en/original/CONTRIBUTING.md)

Pablo / ImPaul17 mantiene el repositorio principal. Durante la Alpha no se aceptan contribuciones externas de código; se pueden desarrollar forks independientes bajo Apache-2.0. Los problemas de seguridad se comunican por [el canal privado](SECURITY.md).

## Trabajar en el código

Lee [arquitectura](docs/architecture.md) y [hoja de ruta](docs/roadmap.md). Usa una rama de trabajo; nunca hagas commits directamente en `main`. Conserva los cambios existentes y los archivos originales de marca.

El texto de producto y la documentación empiezan en español; las guías secundarias están en `docs/en`. El nombre de producto es **nu.vex**; los identificadores técnicos pueden usar `nuvex`.

Instala con `npx --yes npm@11.21.1 ci`. Mantén el gestor, versiones directas y archivo de dependencias bloqueadas. No añadas librerías, tareas o servicios sin una necesidad demostrada. No subas credenciales, `.env`, dependencias instaladas, compilaciones ni datos reales.

TypeScript es estricto; Svelte usa runas. La lógica compartida vive en `packages/core`; los temas, en `packages/tokens`. Los accesos a servidor se concentran en `InstanceApi`; los permisos se comprueban en Rust. Los temas son datos, nunca scripts o CSS arbitrario.

## Verificación

```sh
npm run check
npm test
npm run build
npm run test:e2e
```

Para cambios de cuentas/mensajería, ejecuta también `npm run test:instance` contra una base de pruebas. La suite unitaria usa **node:test mediante tsx**, no Vitest. Consulta [pruebas](docs/testing.md).

Comprueba escritorio y móvil, teclado, foco al cerrar diálogos, mensajes largos, errores de importación y los tres temas. Adjunta capturas a las revisiones de interfaz. Un build web no demuestra que los instaladores o Docker funcionen.

## Commits y revisiones

Usa mensajes convencionales: `feat:`, `fix:`, `docs:`, `refactor:` o `chore:`. Separa cambios funcionales de traducciones y mantenimiento. Explica el problema concreto, la conducta final, las pruebas y sus límites; enlaza documentación y capturas.

Todas las versiones siguen como pre-release y usan `v0.x.x-alpha.y`. No marques una publicación estable. No describas una simulación o datos locales como una función de servidor.

Conserva LICENSE, NOTICE y avisos aplicables de dependencias y recursos. No incluyas código o material de terceros sin derechos y procedencia.
