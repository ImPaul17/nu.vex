# Investigación de voz de Discord con REA

Fecha: 26 de octubre de 2026. Objetivo: obtener requisitos para una implementación propia de voz en Nuvex. Esta investigación inspecciona artefactos instalados y documentación oficial; no demuestra todas las funciones de Discord ni una llamada de audio en ejecución.

## Alcance y método

Se aplicaron la habilidad `reverse-engineer-anything` versión 37 y su referencia `javascript-applications.md`, utilizando el servidor REA ya instalado (`rea-agents` 6.4.0). No fue necesario instalar motores ni configurar proveedores. El [repositorio oficial de REA](https://github.com/morluto/rea) describe el análisis local y la separación entre pruebas y limitaciones. Su [guía de JavaScript](https://github.com/morluto/rea/blob/main/.agents/skills/reverse-engineer-anything/references/javascript-applications.md) establece que las relaciones estáticas no prueban ejecución.

El objetivo se resolvió a los archivos de aplicación de `Discord/app-1.0.9261`, dentro de `%LOCALAPPDATA%`. Se enumeraron también directorios de versiones anteriores para elegir la más reciente. No se leyó `UserData`, caché de sesiones, credenciales, mensajes, registros privados ni el cargador externo encontrado. No se ejecutó Discord, no se llamó a sus servicios y no se copió su código al producto.

La primera llamada fue `analyze_javascript_application` con `format: "asar"` y `detail: "summary"`. Después se analizó el directorio del módulo instalado `modules/discord_voice-2/discord_voice`, también como resumen, con 1.024 MiB de heap y 60.000 ms de límite por fuente. Se inspeccionaron vistas de módulos por sus identificadores; los hechos funcionales se contrastaron con rangos concretos del `index.js` distribuido. Se intentó además el análisis nativo con REA y se obtuvo ensamblado acotado mediante GNU objdump ya instalado, como se detalla más adelante.

## Identidad de los artefactos

Las rutas siguientes son relativas a `%LOCALAPPDATA%/Discord/app-1.0.9261/`.

| Artefacto | Tamaño | SHA-256 | Uso en esta investigación |
| --- | ---: | --- | --- |
| `resources/app.asar` | 219 bytes | `600e18f52d61c83968f7cdbd62c32c492a324cb9c0aa8a8a241cdc60285c525b` | Analizado por REA: cargador modificado. |
| `resources/_app.asar` | 3.619.342 bytes | `535bcb3de917fa65289519e399ea82ab93d9e4df35f7b437ae8433e5ca9d39ca` | Inventariado y hash; contenido no analizado. |
| `modules/discord_desktop_core-1/discord_desktop_core/core.asar` | 1.736.075 bytes | `396088f647b3084fc3b6efedd7c5e50eb4d7b9575b817e9b689ff739a54e0c04` | Inventariado y hash; contenido no analizado. |
| `modules/discord_voice-2/discord_voice/index.js` | 22.447 bytes | `1c12139ccbf818a992fb813b4954a68b1d64b4e96b0f6a97e12862ca5eef764a` | Envoltorio JavaScript de voz: 471 líneas físicas. |
| `modules/discord_voice-2/discord_voice/discord_voice.node` | 22.147.000 bytes | `d85ef7059a7dd28732f23d157a8fdf965f8c6e394decd2a5293fbe62e3d4a0bc` | PE x86-64; exportaciones e instrucciones de tres rangos examinadas con objdump. |

El digest del inventario del directorio de voz devuelto por REA es `c23628975926bdc86a842c2cc4e870912717331a60b55a2864daca24e34efa8b`; es una identidad de ese conjunto de archivos, no el hash de `index.js`.

## Registro de evidencias

| Referencia | Identificador REA | Qué respalda |
| --- | --- | --- |
| E1 | `ev_7595102f7548f00a6912800fe5893db904a3eb36f9a4e194a4db70a6b572cfc0` | Análisis completo retenido de `app.asar`. |
| E2 | `ev_85ccceb493358d7965eb0f8f8a850dfa6a38996ccc101d205ad870842712b6ed` | Resumen de E1: dos archivos relevantes, un JavaScript analizado. |
| E3 | `ev_3f349a5fc56b1e24113618366631bed284bc41e5d6e034b6a630093a8c5529ea` | Referencia `require` a un parche externo de Vencord en el cargador. |
| E4 | `ev_a695abf2049327c142c4acaeb2c6022f04ed6f59f7df9c136f6208908477da40` | Análisis retenido del directorio de voz; cobertura parcial. |
| E5 | `ev_3f2aa8564b9c90f63da1a1ef7b1dd942951a3da6da36e45dec5cf1c62f57476f` | Resumen de E4 y sus límites de recursos. |
| E6 | `ev_9c52299ff587cd2f52e2ad9ba3a2f51e17f37f0a96b26ff94286d4f179e38b66` | Módulo fuente `index.js`, rango 1:0–472:0, CommonJS. |
| E7 | `ev_5d69a90150093292c21016092dbeaa4d1f47b0939beaab47b786aa90a6a5b250` | Identidad exacta de los bytes de `index.js` y análisis sintáctico completo de ese archivo. |
| E8 | `ev_0e2009430b17c9adb9b5f1e1c6a96d2c22a62d456b1bc820d76d9a70c01ba786` | Inspección REA del PE32+: sin directorio de recursos; no implica análisis de funciones. |

El nodo fuente de E6 es `jag_node_0c37ca5523c6c82ab5ec24aa4d809fa878b8a789a542bc2deee9c9c6ce6d53cc`. El nodo de bytes de E7 es `jag_node_9cd21db51f76f18afe7df1264079cc161ccb41e96e11c4a9323aad8d6245542e`. Distinguirlos evita confundir el archivo con sus referencias o exportaciones.

Las copias locales de evidencia están excluidas de Git bajo `.cache/rea-discord-voice/`: `evidence-initial.json` contiene el paquete exportado de las primeras observaciones; `selected-evidence.json` conserva el resumen de voz y las dos vistas de módulo utilizadas. Este último no es una exportación de todo el grafo del directorio. E4 se conservó como `complete-record` en la sesión REA; eso significa retención del resultado producido, no cobertura semántica completa. Los identificadores son referencias de procedencia de esa sesión; las vistas guardadas permiten revisar los hechos concretos después de cerrarla.

## Observaciones verificadas y límites

**O1. El punto de entrada instalado está modificado.** E1–E3 observan un `require` a Vencord fuera del paquete de Discord. No se siguió esa ruta. No se atribuyen al Discord original los comportamientos de ese cargador ni se presupone que `_app.asar` sea una copia oficial intacta solo por su nombre.

**O2. El envoltorio de voz separa los controles propios y los locales.** En el `index.js` identificado por E6–E7, líneas 122–158, existen delegaciones llamadas `setSelfMute`, `setSelfDeafen`, `setLocalVolume` y `setLocalMute`. Las dos últimas reciben un identificador de usuario. La observación prueba la superficie declarada; no prueba sus efectos dentro del motor nativo.

**O3. Hay superficies distintas para conexión y actividad de voz.** El mismo rango declara destrucción de conexión, usuarios, reintento UDP, configuración de reintentos, callbacks de fallo, actividad al hablar, hablar mientras está silenciado, ping y expiración de ping. Las líneas 195–205 envuelven la creación de una conexión. No se recuperó una máquina de estados completa ni se midieron sus tiempos reales.

**O4. El módulo declara capacidades de dispositivos y audio avanzado.** Las líneas 384–412 declaran dispositivos multimedia, selección de audio por ID, loopback, varias conexiones, paneo, sonido compartido y otros marcadores. La línea 175 delega un control de pulsar para hablar. Las líneas 373–381 referencian rutas de módulos de procesamiento de audio. Una declaración de capacidad no demuestra disponibilidad en todos los sistemas, valor predeterminado ni funcionamiento de una función.

**O5. Hay superficies de vídeo, pantalla y cifrado.** Las líneas 130–140 declaran operaciones relacionadas con MLS y fotogramas seguros; 160–188 exponen operaciones de vídeo, pantalla y estadísticas. No se inspeccionó la implementación criptográfica, los códecs, la captura ni sus permisos efectivos. Nuvex no debe anunciar equivalencia con esas funciones a partir de este inventario.

**O6. La frontera nativa está examinada de forma acotada.** Las líneas 8–13 referencian `discord_voice.node` con una alternativa de host multimedia. La inspección PE y el ensamblado descritos abajo confirman exportaciones e instrucciones concretas. No recuperan sus algoritmos completos, garantías de seguridad, comportamiento en ejecución ni calidad de audio.

E4 incluye 480 archivos relevantes, 406 fuentes JavaScript analizadas, una incidencia de análisis sintáctico y 1.755 hallazgos. El grafo de aplicación tiene cobertura parcial; el semántico es parcial y truncado por presupuestos de heap/resultados y dependencias. REA registró 686 incógnitas de aplicación y 12.518 semánticas. Los hechos positivos del archivo seleccionado siguen siendo útiles; las ausencias en ese grafo no prueban que Discord carezca de una función.

## Intento nativo y ensamblado obtenido

`open_binary` aceptó `discord_voice.node` como PE x86-64 y confirmó el hash de la tabla. La llamada posterior `binary_overview` falló con `provider_unavailable` en la operación interna `current_document`. El estado de REA confirmó estos motivos:

- Ghidra: `not_configured`; falta `GHIDRA_INSTALL_DIR`, no se encontró `analyzeHeadless` ni el descompilador correspondiente. Java 23.0.2 sí estaba disponible.
- Hopper: `unsupported_host`; su integración no admite `win32`.
- IDA: `not_configured`; falta una configuración `REA_IDA_MCP_CONFIG` y no se probó una conexión viva.

En ese estado, `analyze_function`, `procedure_assembly` y `procedure_pseudo_code` informaron `provider_missing`. No se instalaron motores ni se modificó configuración. El rechazo y el estado se guardaron en `native-attempt.json`; no se interpretó el éxito de abrir metadatos como éxito del desensamblado profundo.

Se utilizó entonces `.cache/toolchains/winlibs/mingw64/bin/objdump.exe`, que ya existía para el toolchain del proyecto: GNU objdump 2.47.20260726, SHA-256 `31e0217183b137c154df9fb87e0a1e18c85cac3d61cc3ca71083ca70d965cc8c`. El comando `objdump -p` identificó 268 entradas exportadas con nombre y direcciones, base de imagen `0x180000000` y dependencias importadas, entre ellas `WS2_32.dll`, `qwave.dll` y `avrt.dll`. Los imports son dependencias declaradas; no prueban llamadas ejecutadas ni un protocolo de red concreto.

Para cada entrada siguiente se ejecutó `objdump -d -M intel --start-address=<inicio> --stop-address=<fin> <binario>` sin cargar ni ejecutar la DLL:

| Exportación PE observada | Ordinal | RVA | Rango de direcciones solicitado, fin exclusivo | Evidencia local |
| --- | ---: | --- | --- | --- |
| `MuteUser` de `discord::voice::Connection`, nombre C++ decorado | 134 | `0x187100` | `0x180187100`–`0x180187200` | `native-mute-user.asm.txt` |
| `FastUdpReconnect` de la misma clase, nombre C++ decorado | 101 | `0x187640` | `0x180187640`–`0x180187740` | `native-fast-udp-reconnect.asm.txt` |
| `napi_register_module_v1` | 267 | `0x1a850` | `0x18001a850`–`0x18001a950` | `native-napi-register.asm.txt` |

Las tres salidas contienen ensamblado x86-64 real. La entrada N-API empieza con un salto a `0x180013a90`; las otras dos empiezan con preparación de registros y pila. Los nombres se enlazaron por índice entre la tabla de nombres y la de direcciones PE, no por adivinar un símbolo a partir de una cadena. Se observaron también exportaciones llamadas `GetUserMuteState`, `GetDevices` y `SetDeviceChangeCallback`.

Estos rangos de 256 bytes no son una declaración de cuerpos completos: pueden terminar en mitad de una función o incluir alineación u otra función. No se construyó el grafo de llamadas, no se descompiló a pseudocódigo y no se estableció una equivalencia entre cada método JavaScript y una función nativa. El hash del objetivo se comprobó antes y después y coincidió.

`native-headers.txt` conserva la salida PE; `native-exports.json`, la tabla derivada de 268 nombres y RVA; `native-receipt.json`, hashes de herramienta, objetivo y archivos resultantes. Son evidencia privada local ignorada por Git. No se incorporó ensamblado, código de Discord ni binarios al producto.

## Contraste con fuentes oficiales

Estas fuentes complementan el artefacto local; no representan pruebas de ejecución de la instalación.

| Área | Hecho documentado | Fuente primaria |
| --- | --- | --- |
| Estados | El estado de voz diferencia canal y sesión, mute/deaf del servidor, mute/deaf propios y supresión de la capacidad de hablar. | [Voice State Object](https://docs.discord.com/developers/resources/voice#voice-state-object) |
| Permisos | Conectar, hablar, silenciar, ensordecer, mover miembros y usar detección de voz son permisos diferentes; hay roles y excepciones por canal. | [Permissions](https://docs.discord.com/developers/topics/permissions) |
| Dispositivos | La ayuda contempla entrada y salida, modo de entrada y volumen; distingue restricciones del administrador de los controles propios. | [Voice and Video Troubleshooting](https://support.discord.com/hc/en-us/articles/360045138471-Discord-Voice-and-Video-Troubleshooting-Guide) |
| Prueba de micrófono | La prueba reproduce el micrófono por la salida elegida; si se usa durante un canal, la ayuda documenta silenciar voz y escucha hasta terminarla. | [Mic Testing](https://support.discord.com/hc/en-us/articles/360020641332-Mic-Testing) |
| Red | El protocolo publicado separa señalización WebSocket y medios UDP, con latidos y reanudación. No se deduce que Nuvex deba implementar ese protocolo. | [Voice Connections](https://docs.discord.com/developers/topics/voice-connections) |

## Requisitos propuestos para una implementación propia

Son decisiones de diseño para Nuvex, inferidas de las necesidades del usuario y de los problemas observados; no son código recuperado ni promesas de funciones ya entregadas.

1. **Entrada intencional:** mostrar canales de voz identificables, participantes y una acción de entrar. Solicitar permiso de micrófono al realizar esa acción. Si se deniega, explicar cómo reintentar sin bloquear el chat escrito.
2. **Controles esenciales visibles:** micrófono, escucha y salir, con etiqueta accesible y estado persistente durante la llamada. Separar silenciarme de silenciar a otra persona solo para mí. Mantener el volumen por participante como ajuste secundario.
3. **Estado honesto:** distinguir solicitando permiso, conectando, conectado, recuperando conexión, desconectado y error. La presencia en la sala no basta para afirmar que circula audio. Exponer un fallo por participante cuando falle solo un enlace.
4. **Ciclo de vida acotado:** liberar micrófono y conexiones al salir, cerrar sesión, cambiar de instancia o perder la autorización. Vincular la presencia a una sesión autenticada y expirar participantes abandonados. Evitar que una sesión sustituya la identidad de otra.
5. **Dispositivos progresivos:** empezar por entrada del sistema, añadir selección de micrófono y mostrar el cambio o pérdida de dispositivo. Ofrecer selector de salida solo si la plataforma lo soporta; mantener una alternativa comprensible. Una futura prueba de micrófono debe aislar el audio de la conversación y finalizar limpiamente.
6. **Autorización explícita:** verificar comunidad, acceso al canal y sesión en servidor antes de entrar o intercambiar señalización. Ampliar después a permisos separados de conectar, hablar y moderar. El estado propio no puede levantar una restricción del moderador.
7. **Compatibilidad medida:** probar audio entre dos clientes, mute, escucha, salida y reconexión. Probar también navegador/móvil, auriculares Bluetooth, permisos denegados, revocación de sesión y redes distintas. La red central de Cloudflare para la API no acredita por sí sola conectividad de los medios de voz.
8. **Escala y privacidad documentadas:** elegir y explicar el transporte de medios y sus límites. Si la primera versión usa una malla WebRTC, indicar el aforo y la dependencia de conectividad ICE/TURN; una prueba en un solo equipo no equivale a disponibilidad entre redes. Las referencias para la implementación propia son la [configuración ICE de WebRTC](https://www.w3.org/TR/webrtc/#dom-rtcconfiguration-iceservers) y el [ciclo de vida de las pistas de captura](https://www.w3.org/TR/mediacapture-streams/#dom-mediastreamtrack-stop). No anunciar cifrado de extremo a extremo o paridad con Discord sin un diseño y validación propios.

## Inventario funcional acotado

| Función | Evidencia disponible | Estado de investigación |
| --- | --- | --- |
| Mute/deafen propios | Envoltorio local y especificación pública | Parcial: superficie conocida, comportamiento nativo sin verificar. |
| Volumen y mute por persona | Envoltorio local y exportaciones PE relacionadas | Parcial: operaciones declaradas y rango nativo de `MuteUser` desensamblado. |
| Actividad al hablar y hablar silenciado | Callbacks locales | Parcial: señal y algoritmo sin verificar. |
| Entrar, salir, reintentar, latidos | Envoltorio, protocolo público y exportación PE de reconexión | Parcial: rango nativo de reconexión desensamblado; sin llamada ni transición real observada. |
| Entrada/salida y prueba de micrófono | Marcadores locales y ayuda oficial | Parcial: sin dispositivos reales ensayados. |
| Roles y moderación de voz | Especificación pública | Documentado; aplicación efectiva del cliente local no examinada. |
| Pulsar para hablar | Delegación local y ayuda oficial | Parcial: atajos y restricciones por plataforma no examinados. |
| Vídeo, pantalla, sonido compartido | Delegaciones y marcadores locales | Inventario de superficie; fuera del primer alcance de voz. |
| MLS y fotogramas seguros | Nombres y delegaciones locales | Implementación y garantías desconocidas. |
| Funciones globales de Discord | No existe un inventario exhaustivo en este estudio | No resuelto; los artefactos estudiados no cubren todo el producto. |

La investigación identifica los controles y requisitos necesarios para construir la primera voz de Nuvex. Quedan pendientes las pruebas de comportamiento de Discord y un análisis nativo más profundo si una pregunta concreta lo requiere y hay un proveedor disponible. La aceptación de voz de Nuvex debe documentarse con sus propias pruebas, separadas de este informe.

## English summary

REA 6.4.0 inspected the installed Discord 1.0.9261 ASAR bootstrap and voice JavaScript module without execution or access to user data. The bootstrap references an external Vencord patch and cannot establish stock Discord behavior. The voice wrapper exposes separate self mute/deafen, per-user local mute/volume, speaking and failure callbacks, retry controls and device capability declarations. REA native analysis was blocked by unavailable Ghidra/IDA configuration and unsupported Hopper on Windows. Existing GNU objdump recovered 268 named PE exports and actual x86-64 disassembly for three 256-byte ranges at mute, reconnect and N-API registration exports. These are bounded instructions, not full function bodies, recovered source or runtime proof. Directory-wide JavaScript semantic coverage is partial. Official Discord documentation supplies the distinct voice permissions and state fields. Nuvex should implement its own minimal controls, authenticated room lifecycle, explicit media connection status and independently tested transport.
