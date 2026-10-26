# Instancia local de servicio

[Inicio](../README.md) · [Despliegue Cloudflare](web-deployment.md)

Ejecuta los scripts con **PowerShell 7 (`pwsh`)**, no con Windows PowerShell 5.1. La instancia de servicio usa un clúster PostgreSQL independiente de las pruebas:

| Recurso | Destino |
| --- | --- |
| Datos | `.cache/central-instance/data` |
| PostgreSQL | `127.0.0.1:55433` |
| Base de servicio | `nuvexcentral` |
| Rol de aplicación | `nuvex_app`, sin superusuario ni permiso para crear bases o roles |
| Backend | `127.0.0.1:3003`, origen HTTPS del Worker configurado |
| Configuración privada | `.cache/central-instance/connection.json` |

El directorio privado tiene herencia de permisos desactivada y acceso solo para la identidad Windows que lo prepara. Las claves administrativas y de aplicación se generan por separado con un generador criptográfico. No muestres ni copies el archivo de conexión a conversaciones, registros, variables públicas o Git.

## Preparar o reutilizar

Desde la raíz del repositorio, con PostgreSQL portable y el servidor actual ya compilados:

```powershell
./scripts/instance/init-central.ps1
```

El script inicia el clúster dedicado y aplica las migraciones con el binario de `.cache/ui-server/debug/nuvex-server.exe`. No inicia la API. Reutiliza los datos existentes y no cambia sus claves; rechaza un directorio incompleto, una configuración ajena o un puerto ocupado por otro proceso. Las inicializaciones concurrentes se excluyen mediante un bloqueo local.

La configuración temporal usada para aplicar migraciones no representa una publicación: aún hace falta la URL real del Worker para iniciar el servicio.

## Iniciar la API cuando exista la URL

Sustituye el origen por la dirección HTTPS real devuelta por Cloudflare, sin ruta ni barra final. La apertura de registro debe indicarse explícitamente:

```powershell
./scripts/instance/start-central.ps1 -AllowedOrigin 'https://WORKER.CUENTA.workers.dev' -RegistrationOpen $false
```

En el despliegue actual se usa `https://nuvex-alpha.pablomerino2008.workers.dev` y `-RegistrationOpen $true`. El proceso de servicio se ha iniciado y verificado a través de Cloudflare. Tras reiniciar el PC, ejecuta de nuevo el inicio de la API con esos valores y después `start-tunnel.ps1`; no hay un servicio Windows ni inicio automático instalado.

El proceso se inicia oculto, con modo inseguro desactivado, escucha local y confianza de proxy limitada a `127.0.0.1/32`. Su PID, configuración no secreta y rutas de registro se guardan en el directorio privado. El script comprueba la disponibilidad local; no sustituye una prueba a través de Cloudflare.

Si ya hay un proceso en 3003, solo se reutiliza cuando coinciden PID, ejecutable, dirección y configuración registradas. No se detiene un proceso ajeno ni se cambia silenciosamente su origen. Para una nueva configuración hay que revisar y detener explícitamente el PID de la instancia anterior.

## Copia y prueba de restauración

```powershell
$nuvexBackup = ./scripts/instance/backup-central.ps1 | ConvertFrom-Json
./scripts/instance/test-restore-central.ps1 -Archive $nuvexBackup.archive
```

La copia usa formato PostgreSQL personalizado, un nombre nuevo y una suma SHA-256. El archivo y sus metadatos quedan bajo `.cache/central-instance/backups`, fuera de Git y con la misma protección de acceso. Conserva ambos.

La prueba solo crea destinos nuevos con prefijo `nuvexcentral_restore_`; nunca restaura sobre `nuvexcentral`, sobre una base de pruebas anterior ni sobre una base existente. Compara esquema, migraciones y recuentos de las tablas, y comprueba una cuenta y un mensaje sintéticos dentro de una transacción que se revierte. La copia debe haberse tomado sin cambios en esos recuentos/esquema para que la comparación sea concluyente; si cambian, el script pide repetir la comprobación sin escrituras.

El destino restaurado se conserva para inspección. Los scripts no borran bases ni carpetas de datos. El comprobante contiene solo metadatos y queda en el directorio privado. Las comprobaciones iniciales de una base vacía no prueban todavía recuperación de conversaciones reales en producción.

Mientras la API y PostgreSQL estén en el PC, este debe permanecer encendido y conectado, con PostgreSQL, Axum y el túnel en ejecución. La base no se publica directamente en Internet.

## Iniciar el conector de Cloudflare

Cuando se haya creado el túnel de la cuenta, su credencial debe estar en el archivo privado `.cache/central-instance/tunnel.token`, con acceso exclusivo de la identidad Windows que administra la instancia. No la pegues en argumentos, variables de entorno, registros, documentación ni conversaciones.

```powershell
./scripts/instance/start-tunnel.ps1
```

El script utiliza el ejecutable portable `cloudflared` 2026.10.3 y verifica su SHA-256 antes de iniciarlo. Valida las rutas sin enlaces, el formato y los permisos de la credencial. El proceso se abre oculto mediante `--token-file`, sin colocar su contenido en la línea de comandos. Se desactiva la actualización automática del conector y se usan registros de nivel `warn` dentro del directorio privado.

Las métricas escuchan únicamente en `127.0.0.1:20263`. El script consulta `/ready` durante un máximo aproximado de 45 segundos; `-ReadyTimeoutSeconds` admite entre 5 y 120 segundos. La respuesta JSON indica `ready`, el PID y un diagnóstico sin claves. La disponibilidad del conector confirma conexiones con Cloudflare; no sustituye la prueba de cuentas y WebSocket a través del Worker.

`tunnel.json`, `tunnel.pid` y los registros se conservan en el directorio privado. Un segundo inicio solo reutiliza el proceso registrado cuando coinciden ejecutable, momento de creación, túnel, ruta de credencial y dirección de métricas. Si el puerto está ocupado por otro proceso, el script falla sin detenerlo. Si el conector no alcanza disponibilidad, conserva el proceso y su diagnóstico para revisión y devuelve un código de salida distinto de cero; no lo reinicia ni borra datos.

Para rotar la credencial o cambiar la configuración, revisa primero el proceso registrado. El script no detiene procesos ni sustituye automáticamente una configuración de túnel diferente.
