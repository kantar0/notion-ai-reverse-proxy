# Análisis de Arquitectura e Inferencia: Notion AI Chat

Este informe documenta y analiza las solicitudes HTTP capturadas desde la consola de red mientras se utiliza **Notion AI Chat**, detallando su modelo de datos, la gestión del ciclo de vida de las inferencias y los mecanismos de observabilidad en producción.

---

## 1. Primera Solicitud: Sincronización de Registros y Estado Local

### `POST https://app.notion.com/api/v3/syncRecordValuesSpaceInitial`

#### Payload Analizado:
```json
{
  "requests": [
    {
      "pointer": {
        "table": "thread",
        "id": "3c41ea7f-3832-80a0-884f-00a91c630a56",
        "spaceId": "20a1ea7f-3832-81fb-a0a2-0003aeeff04b"
      },
      "version": 30
    },
    {
      "pointer": {
        "table": "thread_message",
        "id": "3c41ea7f-3832-8116-be31-00aaaeacf194",
        "spaceId": "20a1ea7f-3832-81fb-a0a2-0003aeeff04b"
      },
      "version": 3
    }
  ],
  "spacePointer": {
    "table": "space",
    "id": "20a1ea7f-3832-81fb-a0a2-0003aeeff04b"
  }
}
```

### Arquitectura de Datos Revelada:
* **RecordStore Unificado (Entity-Pointer Pattern)**: Notion no utiliza rutas REST independientes para cada recurso. Todos los elementos (páginas, bloques, usuarios, chats) se representan como punteros tipados `{ table, id, spaceId, version }`.
* **Tablas Específicas de Chat**:
  * `thread`: Representa el contenedor de la conversación. El parámetro `?t=3c41ea7f383280a0884f00a91c630a56` en la URL de Notion apunta directamente al UUID del `thread`.
  * `thread_message`: Cada turno o mensaje individual (del usuario o de la IA).
  * `space`: El Workspace en el cual se valida el acceso y se busca contexto mediante RAG (embeddings).
* **Control de Concurrencia Optimista (`version`)**: El cliente envía la versión local que posee de cada registro. El servidor responde con los deltas necesarios si existen versiones más recientes.

---

## 2. Segunda Solicitud: Telemetría y Observabilidad de Inferencias

### `POST https://http-inputs-notion.splunkcloud.com/services/collector/raw`

#### Payload Analizado:
```json
{
  "environment": "production",
  "level": "info",
  "from": "inferenceTranscriptAnalyticsActions",
  "type": "runInferenceTranscriptClientLifecycle",
  "data": {
    "phase": "stall_mid_stream_no_progress",
    "thread_id": "3c41ea7f-3832-80a0-884f-00a91c630a56",
    "inference_id": "c37a19e9-f4c8-49c2-8886-db4872c64942",
    "time_since_start_ms": 13138.399999976158,
    "config_type": "workflow",
    "opened_from": "ai_module",
    "is_retry": false,
    "is_new_thread": true,
    "is_offline_at_start": false,
    "client_ui_running": true,
    "inference_lease_active": false,
    "time_since_last_stream_frame_ms": 10000.800000011921
  },
  "instantClientData": {
    "href": "https://app.notion.com/chat?t=3c41ea7f383280a0884f00a91c630a56",
    "clientTimestamp": 1787379731089
  },
  "clientEnvironmentData": {
    "idbSessionId": "09e899c9-d7f3-4f4a-90e5-cea3baced71b",
    "version": "23.13.20260822.0220",
    "os": "windows",
    "platform": "browser",
    "storageUsageEstimate": 67201569,
    "storageQuotaEstimate": 10804619809,
    "userId": "646357f5-4b41-4f62-8767-b25670188037",
    "isPersistent": false
  },
  "samplePercentage": 100
}
```

### Componentes Internos y Mecanismos Revelados:

1. **Watchdog de Streaming en el Cliente**:
   * Evento: `phase: "stall_mid_stream_no_progress"`
   * El cliente detectó que pasaron **10 segundos exactos** (`time_since_last_stream_frame_ms: 10000.8`) sin recibir nuevos tokens/frames desde el servidor tras 13 segundos de ejecución total (`time_since_start_ms: 13138.4`).
   * Registra automáticamente el incidente en Splunk para monitorear la salud de sus proveedores de LLM.

2. **Diferenciación de Identificadores Clave**:
   * `thread_id`: Identificador persistente de la conversación a lo largo del tiempo.
   * `inference_id`: Identificador efímero único por cada turno/generación del modelo. Permite correlacionar reintentos (`is_retry`) con una inferencia fallida específica.

3. **Orquestación basada en Workflows / Agentes**:
   * `config_type: "workflow"` confirma que Notion AI no invoca únicamente un prompt aislado, sino un flujo DAG compuesto (búsqueda de contexto vectorial en el espacio de trabajo, herramientas y generación de respuesta estructurada).

4. **Control de Bloqueo por Concurrencia (`inference_lease_active`)**:
   * Notion implementa un sistema de leases/locks para evitar solicitudes concurrentes desincronizadas sobre el mismo hilo de chat.

5. **Persistencia Local Offline-First**:
   * `idbSessionId` e IndexedDB gestionan una copia local del historial de mensajes (~67 MB de datos en caché para carga instantánea antes de sincronizar con el servidor).

---

## 3. Flujo Completo del Ciclo de Vida de un Chat en Notion AI

```text
┌────────────────────────┐
│  Usuario envía prompt  │
└───────────┬────────────┘
            │
            ├──► [1. Local Optimistic Update]
            │    Guarda mensaje en IndexedDB con estado pendiente.
            │    Envía mutación a /api/v3/saveTransactions.
            │
            ├──► [2. Adquisición de Lease / Lock]
            │    inference_lease_active = true (evita envíos solapados).
            │
            ├──► [3. Invocación de Inferencia / Workflow]
            │    POST a endpoint de IA (/api/v3/runAi o stream de eventos).
            │    Genera un nuevo `inference_id`.
            │    Ejecuta búsqueda RAG sobre el `spaceId`.
            │
            ├──► [4. Transmisión de Chunks / Stream Frames]
            │    Cliente procesa tokens y referencias a bloques en vivo.
            │    Watchdog activo: si transcurren > 10s sin frame -> emite alerta a Splunk.
            │
            └──► [5. Cierre y Sincronización]
                 Consolida registro en tabla `thread_message`.
                 Actualiza versión del `thread`.
                 Libera el lease de inferencia.
```

---

## 4. Conclusiones y Recomendaciones de Diseño

Al implementar un sistema similar:
* **Separar conversación de ejecución**: Mantener un `thread_id` estable y un `inference_id` por turno de IA para observabilidad precisa.
* **Watchdogs en cliente**: Monitorear el tiempo entre frames SSE/WebSocket para detectar caídas de conexión o cuellos de botella del LLM sin bloquear la interfaz.
* **Almacenamiento tipado en cliente**: Combinar IndexedDB en local con sincronización basada en versiones de punteros para interfaces rápidas y tolerantes a desconexiones.
