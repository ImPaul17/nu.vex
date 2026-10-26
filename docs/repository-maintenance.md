# Mantenimiento del repositorio

[Inicio](../README.md) · [Registro histórico completo](en/original/docs/repository-maintenance.md)

Pablo / ImPaul17 dirige el proyecto y mantiene el repositorio principal. Durante la Alpha no se aceptan contribuciones externas de código. La licencia permite crear forks; los informes de seguridad usan [el canal privado](../SECURITY.md).

Los cambios se hacen en ramas de trabajo y se revisan antes de integrar en `main`. Usa commits convencionales y conserva una revisión comprobable de cada entrega. No subas secretos, trazas de autenticación ni bases de datos.

El flujo `checks.yml` verifica cliente, instancia real y contenedores; los flujos de escritorio, TLS y publicación tienen objetivos separados. Sus comprobantes no certifican automáticamente commits posteriores. El registro histórico conserva las protecciones y accesos verificados en su momento; no es una lectura en vivo de la configuración de GitHub.

Español es el idioma de entrada, con índice secundario en `docs/en`. Las pre-releases conservan el formato `v0.x.x-alpha.y`. Cualquier apertura futura a temas/bots o contribuciones necesita normas de comunidad, moderación y revisión antes de recibir publicaciones de terceros.
