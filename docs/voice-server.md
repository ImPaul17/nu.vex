# Voz Alpha: servidor y señalización

El servidor admite canales `voice` y señalización autenticada para audio WebRTC entre un máximo de **ocho participantes por canal**. El audio viaja directamente entre clientes en una malla; el backend no es un SFU ni retransmite o graba audio. El registro de llamadas es efímero, local a un único proceso Axum y se pierde al reiniciarlo.

Esta entrega conserva el estado **pre-release Alpha**. La paridad con Discord, la moderación de audio del lado de un SFU y la conectividad garantizada desde redes NAT estrictas no están implementadas.

## Canales y migración

La migración `202610260002_voice_channels.sql` amplía la restricción de `channels.kind` a `text` y `voice`. No modifica la migración inicial. `POST /api/v1/communities/{id}/channels` admite `{name,kind?}`; el tipo por defecto sigue siendo `text` y los canales de voz usan categoría `VOZ`. Solo el propietario puede crearlos.

El historial y los envíos de mensajes rechazan los canales de voz. El chat de texto permanece en los canales de texto mientras una llamada esté activa.

## Contrato REST

Todas las rutas tienen el prefijo `/api/v1/channels/{channelId}/voice/`, requieren una sesión vigente, el transporte y Origin admitidos y pertenencia actual a la comunidad. Cada participante tiene un UUID opaco asociado a usuario, sesión y canal. No basta con conocer su identificador para modificarlo.

| Operación POST | JSON | Respuesta |
| --- | --- | --- |
| `join` | `{}` | `{channelId,revision,participant,participants,iceServers,maxParticipants:8}` |
| `state` | `{participantId,muted,deafened}` | 204 |
| `signal` | `{participantId,targetId,signal}` | 204 |
| `leave` | `{participantId}` | 204 |
| `heartbeat` | `{participantId}` | 204 |

Un participante público contiene `{id,userId,displayName,muted,deafened}`. Las listas incluyen al propio participante. `deafened:true` implica `muted:true` en el estado anunciado; los controles de los dispositivos y las pistas de audio se aplican en el cliente.

Una cuenta solo puede ocupar una llamada. Una sesión distinta de esa misma cuenta recibe `409 voice_already_joined`. Repetir `join` desde la misma sesión rota el identificador y sustituye su llamada anterior, incluso al cambiar de canal. Un `leave` tardío del identificador anterior no afecta al nuevo. Salir de un identificador que ya no existe es idempotente.

`signal` admite `{type:"offer",sdp}`, `{type:"answer",sdp}` y `{type:"candidate",candidate}`. El candidato puede ser `null` o un objeto con `candidate`, `sdpMid`, `sdpMLineIndex` y `usernameFragment`. SDP está limitado a 16 KiB; cada cadena de candidato, a 4 KiB. El cuerpo HTTP total conserva el límite de 32 KiB. Se rechazan campos ajenos al formato.

Las señales solo se admiten entre participantes vigentes del mismo canal. Se vuelven a comprobar la sesión y membresía del emisor y del destinatario; las filas de autorización se mantienen bloqueadas para ordenar la operación frente a una revocación concurrente.

## Eventos

El WebSocket autenticado `/api/v1/events` transporta:

- `voice.participants`: `{channelId,participants,revision}`, con la lista completa y ordenada del canal.
- `voice.signal`: `{channelId,fromId,targetId,signal}`, solo para la sesión del destinatario.
- `voice.ended`: `{channelId,participantId,reason}`, solo para la sesión de ese participante.

Cada lista publicada lleva una revisión monotónica del proceso. La respuesta de `join` incluye la revisión de su propia lista; el cliente descarta eventos con una revisión anterior para evitar que un mensaje WebSocket previo, recibido después de la respuesta HTTP, simule una expulsión. Los avisos de fin se identifican por participante.

El hash de sesión utilizado para dirigir el evento es metadato interno y no se serializa en el payload. La revocación de una sesión o membresía retira la llamada y anuncia la nueva lista inmediatamente desde los endpoints correspondientes. Un aviso propio de fin no contiene SDP ni información nueva de la comunidad y puede enviarse al participante expulsado para cerrar sus conexiones.

Cerrar un socket WebSocket no elimina por sí solo una llamada de otra pestaña o sesión. El cliente limpia sus pistas y notifica `leave`; si no consigue hacerlo, el servidor elimina la entrada mediante el tiempo de vida.

## Tiempo de vida y límites

El cliente envía un heartbeat cada 10 segundos. El participante caduca tras 45 segundos sin renovarlo; un barrido cada cinco segundos elimina también sesiones expiradas, membresías retiradas o canales inválidos. Una indisponibilidad de autorización cierra las entradas afectadas en vez de mantener una lista de permisos en caché.

Hay un máximo de 256 participantes en todo el proceso y ocho por canal. Se limitan las solicitudes por cuenta y globalmente, las señales a 240 por participante/minuto y 4096 globales/minuto, y los anuncios de control globales. Las listas y contadores permanecen acotados. Los payloads de señalización no se registran.

## STUN y TURN

Sin configuración, o con una variable vacía, se usa `stun:stun.cloudflare.com:3478`, documentado por [Cloudflare Realtime](https://developers.cloudflare.com/realtime/turn/). Esto ayuda a descubrir candidatos; **no proporciona un relay TURN**.

`NUVEX_VOICE_ICE_SERVERS` permite configurar un array JSON de objetos RTCIceServer. `[]` desactiva explícitamente la lista ICE. Se admiten hasta ocho servidores, 32 URL en total y 16 KiB de configuración. Solo se admiten los protocolos `stun:`, `stuns:`, `turn:` y `turns:`; se rechazan rutas, URLs HTTP, credenciales dentro de la URL y campos desconocidos.

TURN exige `username` y `credential`; `credentialType`, si aparece, debe ser `password`. Estos datos solo se entregan al cliente autorizado que entra en una llamada y no deben registrarse ni publicarse en Git. Su aprovisionamiento, rotación y cuotas son responsabilidad de quien opere TURN. No hay un relay TURN de producción provisionado en esta entrega; las redes que lo requieran pueden fallar.

## Verificación

Los tests Rust de esta entrega ejercitan aislamiento de usuario/sesión/canal, identificadores forjados, rotación y salida tardía, caducidad, cupos, tasas, formato ICE/SDP y retirada con eventos dirigidos. No abren dispositivos de audio ni modifican una base de servicio. La aceptación de audio entre dos navegadores y la revocación mediante HTTP requieren la prueba de integración contra una instancia migrada; su resultado se registra por separado.

## English summary

Alpha voice uses authenticated REST signaling and existing WebSocket events with session-scoped delivery. Media is peer-to-peer audio mesh, limited to eight participants per channel and 256 per process. A participant lease lasts 45 seconds and is refreshed every ten seconds. A same-session rejoin rotates the lease; stale leave requests cannot remove the replacement. Different sessions of the same account cannot join concurrent calls. Voice state is ephemeral and requires a single backend process. STUN is configured by default; a production TURN relay is not provisioned and restrictive networks may fail.
