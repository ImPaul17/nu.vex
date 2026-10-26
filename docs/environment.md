# Entorno y dependencias

[Inicio](../README.md) · [Decisiones históricas completas](en/original/docs/environment.md)

El proyecto usa npm workspaces, TypeScript estricto, SvelteKit/Svelte 5, Vite y Tauri 2. Rust/Axum y el transporte nativo tienen manifiestos y archivos Cargo.lock independientes.

## JavaScript

Usa Node.js 22.14+ en la línea 22 o 24+. Instala con npm 11.21.1 mediante `npx --yes npm@11.21.1 ci`. El rango admitido es `>=11.18 <12`; versiones anteriores pueden perder overrides al resolver enlaces entre workspaces.

Las dependencias directas se fijan junto con el archivo de bloqueo. El override temporal de `cookie` se mantiene hasta una revisión específica; no regeneres el árbol con un gestor distinto.

## Rust y PostgreSQL

El entorno preparado y los flujos existentes usan Rust 1.99.1. El backend declara 1.89 como mínimo de dependencias, sin verificación separada de ese mínimo. PostgreSQL 17 es la referencia de desarrollo. No hay sustituto SQLite.

Las [herramientas locales](toolchain-local.md) describen el entorno Windows. Los requisitos de compilación de Tauri varían por plataforma. Un build web no demuestra que se pueda compilar un instalador.

No introduzcas librerías para capacidades que todavía no se implementan. Los archivos originales de licencia y procedencia de cada dependencia se preservan. Para resultados ejecutados consulta [verificación](verification-current.md).
