# Seguridad

[English reference](docs/en/original/SECURITY.md)

nu.vex está en pre-release Alpha. No hay una versión estable con soporte de producción ni una auditoría de seguridad completada. La demo local no es un canal duradero o privado. No se afirma que exista cifrado de extremo a extremo.

## Comunicar una vulnerabilidad

Usa el [formulario privado del repositorio](https://github.com/ImPaul17/nu.vex/security/advisories/new), también accesible desde **Security → Report a vulnerability**. Si no está disponible, solicita al mantenedor un canal privado sin publicar la explotación.

Incluye versión o commit, entorno, impacto y una reproducción mínima con datos sintéticos. No publiques credenciales, conversaciones reales ni copias de bases de datos en incidencias. No se publica una dirección de correo de seguridad ni se prometen plazos de respuesta.

## Criterios de implementación

- Valida temas, mensajes, archivos y direcciones como entradas no confiables.
- No ejecutes scripts ni HTML aportado por usuarios.
- Comprueba cada operación y evento con los permisos vigentes del servidor.
- Mantén mínimas las capacidades nativas y las redes de proxy de confianza.
- Conserva contraseñas y tokens fuera de Git, registros, URL y almacenamiento de preferencias.
- Usa HTTPS en despliegues reales y prueba revocación, límites y restauración.

El cambio entre instancias invalida solicitudes anteriores y limpia la vista antes de mostrar datos del destino. Cada sesión remota se conserva solo en memoria. Los [resultados funcionales](docs/verification-current.md) no sustituyen una auditoría de seguridad.
