# 插件依赖清单（由源码生成）

覆盖 plugins/ 的 49 个目录及 example-notes 后装示例。运行 `npm run docs:dependencies` 更新，`npm run check:dependencies` 检查漂移。

服务端 requires 填服务名；客户端 requires 填插件 ID。表里的替代提供者按启动配置择一装配，不代表同时启动。动态安装的社区扩展不在此清单内。

| 插件与入口 | 装配方式 | 必需服务 → 提供者 | 对外服务 | 客户端依赖 |
|---|---|---|---|---|
| [access-policy](../plugins/access-policy/src/index.ts) | 默认装配 | `harness.config → config-file` | `harness.access` | — |
| [adapter-mock](../plugins/adapter-mock/src/index.ts) | 演示 | — | `harness.adapter` | — |
| [adapter-onebot](../plugins/adapter-onebot/src/index.ts) | live | `harness.access → access-policy`<br>`harness.config → config-file`<br>`harness.system-control → system-control` | `harness.adapter` | — |
| [agent-basic](../plugins/agent-basic/src/index.ts) | 默认装配 | `harness.access → access-policy`<br>`harness.basic-tools → basic-tools`<br>`harness.config → config-file`<br>`harness.model → model-mock / model-openai`<br>`harness.outbound → outbound-queue`<br>`harness.storage → storage-file / storage-sqlite`<br>`harness.tools → tool-runtime` | `harness.agent` | — |
| [agent-memory](../plugins/agent-memory/src/index.ts) | 默认装配 | `harness.access → access-policy`<br>`harness.agent → agent-basic`<br>`harness.config → config-file`<br>`harness.conversation → conversation`<br>`harness.http → transport-http`<br>`harness.memory.index → memory-index-lexical`<br>`harness.memory.repository → storage-file / storage-sqlite`<br>`harness.model → model-mock / model-openai`<br>`harness.storage → storage-file / storage-sqlite`<br>`harness.tools → tool-runtime` | `@qq-harness/contracts`<br>`harness.memory`<br>`harness.memory.members` | `console-chats` |
| [basic-tools](../plugins/basic-tools/src/index.ts) | 默认装配 | `harness.access → access-policy`<br>`harness.adapter → adapter-mock / adapter-onebot`<br>`harness.config → config-file`<br>`harness.outbound → outbound-queue`<br>`harness.storage → storage-file / storage-sqlite`<br>`harness.tools → tool-runtime` | `harness.basic-tools` | — |
| [command-direct](../plugins/command-direct/src/index.ts) | 默认装配 | `harness.access → access-policy`<br>`harness.config → config-file`<br>`harness.tools → tool-runtime` | — | — |
| [config-file](../plugins/config-file/src/index.ts) | 默认装配 | — | `harness.config` | — |
| [console-api](../plugins/console-api/src/index.ts) | 默认装配 | `harness.config → config-file`<br>`harness.http → transport-http`<br>`harness.storage → storage-file / storage-sqlite`<br>`harness.system-control → system-control` | — | — |
| [console-chats](../plugins/console-chats/client.tsx) | 客户端页面 | — | — | — |
| [console-overview](../plugins/console-overview/client.tsx) | 客户端页面 | — | — | — |
| [console-plugins](../plugins/console-plugins/client.tsx) | 客户端页面 | — | — | — |
| [console-settings](../plugins/console-settings/client.tsx) | 客户端页面 | — | — | — |
| [container-console](../plugins/container-console/src/index.ts) | 默认装配 | `harness.container.jobs → container-jobs`<br>`harness.container.runtime → container-runtime`<br>`harness.container.session → container-session`<br>`harness.http → transport-http` | — | `console-chats` |
| [container-jobs](../plugins/container-jobs/src/index.ts) | 默认装配 | `harness.access → access-policy`<br>`harness.config → config-file`<br>`harness.container.runtime → container-runtime`<br>`harness.container.session → container-session`<br>`harness.storage → storage-file / storage-sqlite`<br>`harness.tools → tool-runtime` | `harness.container.jobs` | — |
| [container-runtime](../plugins/container-runtime/src/index.ts) | 默认装配 | `harness.access → access-policy`<br>`harness.storage → storage-file / storage-sqlite` | `harness.container.runtime` | — |
| [container-session](../plugins/container-session/src/index.ts) | 默认装配 | `harness.access → access-policy`<br>`harness.config → config-file`<br>`harness.container.runtime → container-runtime`<br>`harness.tools → tool-runtime` | `harness.container.session` | — |
| [conversation](../plugins/conversation/src/index.ts) | 默认装配 | `harness.access → access-policy`<br>`harness.adapter → adapter-mock / adapter-onebot`<br>`harness.agent → agent-basic`<br>`harness.config → config-file`<br>`harness.storage → storage-file / storage-sqlite`<br>`harness.system-control → system-control` | `harness.conversation` | — |
| [conversation-manual](../plugins/conversation-manual/src/index.ts) | 默认装配 | `harness.config → config-file`<br>`harness.conversation → conversation`<br>`harness.http → transport-http` | — | `console-chats` |
| [conversation-proactive](../plugins/conversation-proactive/src/index.ts) | 默认装配 | `harness.access → access-policy`<br>`harness.config → config-file`<br>`harness.conversation → conversation`<br>`harness.storage → storage-file / storage-sqlite` | — | `console-chats` |
| [example-notes](../extensions/example-notes/plugin.json) | 后装示例，默认关闭 | `harness.external-loader → external-plugins`<br>`harness.http → transport-http` | — | `console-chats` |
| [ext-knowledge](../plugins/v2-knowledge/src/index.ts) | 默认装配 | `harness.extensions → extension-system` | — | `extension-system` |
| [ext-mcp](../plugins/v2-mcp/src/index.ts) | 默认装配 | `harness.extensions → extension-system` | — | `extension-system` |
| [ext-promptinject](../plugins/v2-promptinject/src/index.ts) | 默认装配 | `harness.extensions → extension-system` | — | `extension-system` |
| [ext-skill](../plugins/v2-skills/src/index.ts) | 默认装配 | `harness.extensions → extension-system` | — | `extension-system` |
| [ext-tool](../plugins/v2-tools/src/index.ts) | 默认装配 | `harness.extensions → extension-system` | — | `extension-system` |
| [extension-system](../plugins/extension-system/src/index.ts) | 默认装配 | `harness.access → access-policy`<br>`harness.adapter → adapter-mock / adapter-onebot`<br>`harness.agent → agent-basic`<br>`harness.config → config-file`<br>`harness.conversation → conversation`<br>`harness.http → transport-http`<br>`harness.model → model-mock / model-openai`<br>`harness.outbound → outbound-queue`<br>`harness.storage → storage-file / storage-sqlite`<br>`harness.tools → tool-runtime` | `harness.extensions`<br>`harness.model.middleware`<br>`harness.network.proxy`<br>`harness.tool-scope`<br>`harness.tools.policy`<br>`harness.video-frames` | `console-chats`<br>`console-settings`<br>`console-overview` |
| [external-plugins](../plugins/external-plugins/src/index.ts) | 配置 extensionDir 时 | `harness.config → config-file`<br>`harness.http → transport-http` | `harness.external-loader` | — |
| [html-renderer](../plugins/html-renderer/src/index.ts) | 默认装配 | — | `harness.html-renderer` | — |
| [image-studio](../plugins/image-studio/src/index.ts) | 默认装配 | `harness.agent → agent-basic`<br>`harness.config → config-file`<br>`harness.media → media-runtime`<br>`harness.outbound → outbound-queue`<br>`harness.storage → storage-file / storage-sqlite`<br>`harness.tools → tool-runtime` | — | — |
| [media-runtime](../plugins/media-runtime/src/index.ts) | 默认装配 | `harness.adapter → adapter-mock / adapter-onebot`<br>`harness.config → config-file`<br>`harness.http → transport-http`<br>`harness.storage → storage-file / storage-sqlite` | `harness.media` | — |
| [media-tools](../plugins/media-tools/src/index.ts) | 默认装配 | `harness.access → access-policy`<br>`harness.adapter → adapter-mock / adapter-onebot`<br>`harness.config → config-file`<br>`harness.media → media-runtime`<br>`harness.outbound → outbound-queue`<br>`harness.storage → storage-file / storage-sqlite`<br>`harness.tools → tool-runtime` | — | — |
| [memory](../plugins/memory/src/index.ts) | 旧简版，默认未装配 | `harness.agent → agent-basic`<br>`harness.config → config-file`<br>`harness.storage → storage-file / storage-sqlite`<br>`harness.tools → tool-runtime` | — | — |
| [memory-index-lexical](../plugins/memory-index-lexical/src/index.ts) | 默认装配 | — | `harness.memory.index` | — |
| [model-mock](../plugins/model-mock/src/index.ts) | 演示 | — | `harness.model` | — |
| [model-openai](../plugins/model-openai/src/index.ts) | live | `harness.config → config-file` | `harness.model`<br>`harness.model.http` | — |
| [model-opencode](../plugins/model-opencode/src/index.ts) | live | `harness.model.http → model-openai` | — | — |
| [ops-control](../plugins/ops-control/src/index.ts) | 默认装配 | `harness.access → access-policy`<br>`harness.adapter → adapter-mock / adapter-onebot`<br>`harness.config → config-file`<br>`harness.http → transport-http`<br>`harness.outbound → outbound-queue`<br>`harness.storage → storage-file / storage-sqlite`<br>`harness.system-control → system-control` | `harness.operations.ingress` | — |
| [outbound-queue](../plugins/outbound-queue/src/index.ts) | 默认装配 | `harness.access → access-policy`<br>`harness.adapter → adapter-mock / adapter-onebot`<br>`harness.config → config-file`<br>`harness.storage → storage-file / storage-sqlite`<br>`harness.system-control → system-control` | `harness.outbound` | — |
| [qq-portable](../plugins/qq-portable/src/index.ts) | 默认装配 | `harness.http → transport-http`<br>`harness.storage → storage-file / storage-sqlite` | `harness.qq-portable` | — |
| [reminders](../plugins/reminders/src/index.ts) | 默认装配 | `harness.access → access-policy`<br>`harness.config → config-file`<br>`harness.outbound → outbound-queue`<br>`harness.storage → storage-file / storage-sqlite`<br>`harness.tools → tool-runtime` | `harness.reminders` | — |
| [run-inspector](../plugins/run-inspector/src/index.ts) | 默认装配 | `harness.config → config-file`<br>`harness.http → transport-http` | `harness.traces` | `console-chats` |
| [snowluma-runtime](../plugins/snowluma-runtime/src/index.ts) | 默认装配 | `harness.config → config-file`<br>`harness.http → transport-http`<br>`harness.storage → storage-file / storage-sqlite` | `harness.snowluma` | — |
| [sticker-tools](../plugins/sticker-tools/src/index.ts) | 默认装配 | `harness.adapter → adapter-mock / adapter-onebot`<br>`harness.agent → agent-basic`<br>`harness.config → config-file`<br>`harness.media → media-runtime`<br>`harness.outbound → outbound-queue`<br>`harness.storage → storage-file / storage-sqlite`<br>`harness.tools → tool-runtime` | `harness.stickers` | — |
| [storage-file](../plugins/storage-file/src/index.ts) | 替代 SQLite | — | `harness.memory.repository`<br>`harness.storage` | — |
| [storage-sqlite](../plugins/storage-sqlite/src/index.ts) | 默认存储 | — | `harness.memory.repository`<br>`harness.storage` | — |
| [system-control](../plugins/system-control/src/index.ts) | 默认装配 | `harness.access → access-policy`<br>`harness.config → config-file`<br>`harness.storage → storage-file / storage-sqlite` | `harness.system-control` | — |
| [tool-runtime](../plugins/tool-runtime/src/index.ts) | 默认装配 | `harness.access → access-policy`<br>`harness.config → config-file` | `harness.tools` | — |
| [transport-http](../plugins/transport-http/src/index.ts) | 默认装配 | — | `harness.http` | — |
| [web-tools](../plugins/web-tools/src/index.ts) | 默认装配 | `harness.config → config-file`<br>`harness.http → transport-http`<br>`harness.storage → storage-file / storage-sqlite`<br>`harness.tools → tool-runtime` | `harness.web` | — |

## 可选服务调用

以下是 src/ 中 use 调用但未列入 requires 的服务。缺席时必须有降级行为，不能把可选依赖误画成启停绑定。兼容宿主内部额外按需使用容器服务。

| 消费者 | 可选服务 → 提供者 |
|---|---|
| agent-basic | `harness.system-control → system-control`<br>`harness.tool-scope → extension-system`<br>`harness.traces → run-inspector` |
| agent-memory | `harness.traces → run-inspector` |
| basic-tools | `harness.media → media-runtime`<br>`harness.traces → run-inspector` |
| console-api | `@qq-harness/contracts → agent-memory`<br>`harness.access → access-policy`<br>`harness.adapter → adapter-mock / adapter-onebot`<br>`harness.conversation → conversation`<br>`harness.memory → agent-memory`<br>`harness.outbound → outbound-queue`<br>`harness.tools → tool-runtime` |
| container-session | `harness.container.jobs → container-jobs` |
| conversation | `harness.operations.ingress → ops-control` |
| extension-system | `harness.container.session → container-session` |
| media-runtime | `harness.network.proxy → extension-system`<br>`harness.video-frames → extension-system` |
| model-openai | `harness.model.middleware → extension-system`<br>`harness.network.proxy → extension-system`<br>`harness.traces → run-inspector` |
| ops-control | `harness.network.proxy → extension-system` |
| outbound-queue | `harness.traces → run-inspector` |
| snowluma-runtime | `harness.adapter → adapter-mock / adapter-onebot` |
| tool-runtime | `harness.tool-scope → extension-system`<br>`harness.tools.policy → extension-system`<br>`harness.traces → run-inspector` |
| web-tools | `harness.network.proxy → extension-system` |

## 接入、配置、存储与模型

箭头从消费者指向提供者；虚线表示同一服务有可替代的提供者。

```mermaid
flowchart LR
  p_access_policy["access-policy"]
  p_access_policy -->|"config"| p_config_file["config-file"]
  p_adapter_mock["adapter-mock"]
  p_adapter_onebot["adapter-onebot"]
  p_adapter_onebot -->|"access"| p_access_policy["access-policy"]
  p_adapter_onebot -->|"config"| p_config_file["config-file"]
  p_adapter_onebot -->|"system-control"| p_system_control["system-control"]
  p_config_file["config-file"]
  p_model_mock["model-mock"]
  p_model_openai["model-openai"]
  p_model_openai -->|"config"| p_config_file["config-file"]
  p_model_opencode["model-opencode"]
  p_model_opencode -->|"model.http"| p_model_openai["model-openai"]
  p_storage_file["storage-file"]
  p_storage_sqlite["storage-sqlite"]
  p_transport_http["transport-http"]
```

## 聊天、工具、记忆与提醒

箭头从消费者指向提供者；虚线表示同一服务有可替代的提供者。

```mermaid
flowchart LR
  p_agent_basic["agent-basic"]
  p_agent_basic -->|"access"| p_access_policy["access-policy"]
  p_agent_basic -->|"basic-tools"| p_basic_tools["basic-tools"]
  p_agent_basic -->|"config"| p_config_file["config-file"]
  p_agent_basic -.->|"model"| p_model_mock["model-mock"]
  p_agent_basic -.->|"model"| p_model_openai["model-openai"]
  p_agent_basic -->|"outbound"| p_outbound_queue["outbound-queue"]
  p_agent_basic -.->|"storage"| p_storage_file["storage-file"]
  p_agent_basic -.->|"storage"| p_storage_sqlite["storage-sqlite"]
  p_agent_basic -->|"tools"| p_tool_runtime["tool-runtime"]
  p_agent_memory["agent-memory"]
  p_agent_memory -->|"access"| p_access_policy["access-policy"]
  p_agent_memory -->|"agent"| p_agent_basic["agent-basic"]
  p_agent_memory -->|"config"| p_config_file["config-file"]
  p_agent_memory -->|"conversation"| p_conversation["conversation"]
  p_agent_memory -->|"http"| p_transport_http["transport-http"]
  p_agent_memory -->|"memory.index"| p_memory_index_lexical["memory-index-lexical"]
  p_agent_memory -.->|"memory.repository"| p_storage_file["storage-file"]
  p_agent_memory -.->|"memory.repository"| p_storage_sqlite["storage-sqlite"]
  p_agent_memory -.->|"model"| p_model_mock["model-mock"]
  p_agent_memory -.->|"model"| p_model_openai["model-openai"]
  p_agent_memory -.->|"storage"| p_storage_file["storage-file"]
  p_agent_memory -.->|"storage"| p_storage_sqlite["storage-sqlite"]
  p_agent_memory -->|"tools"| p_tool_runtime["tool-runtime"]
  p_basic_tools["basic-tools"]
  p_basic_tools -->|"access"| p_access_policy["access-policy"]
  p_basic_tools -.->|"adapter"| p_adapter_mock["adapter-mock"]
  p_basic_tools -.->|"adapter"| p_adapter_onebot["adapter-onebot"]
  p_basic_tools -->|"config"| p_config_file["config-file"]
  p_basic_tools -->|"outbound"| p_outbound_queue["outbound-queue"]
  p_basic_tools -.->|"storage"| p_storage_file["storage-file"]
  p_basic_tools -.->|"storage"| p_storage_sqlite["storage-sqlite"]
  p_basic_tools -->|"tools"| p_tool_runtime["tool-runtime"]
  p_command_direct["command-direct"]
  p_command_direct -->|"access"| p_access_policy["access-policy"]
  p_command_direct -->|"config"| p_config_file["config-file"]
  p_command_direct -->|"tools"| p_tool_runtime["tool-runtime"]
  p_conversation["conversation"]
  p_conversation -->|"access"| p_access_policy["access-policy"]
  p_conversation -.->|"adapter"| p_adapter_mock["adapter-mock"]
  p_conversation -.->|"adapter"| p_adapter_onebot["adapter-onebot"]
  p_conversation -->|"agent"| p_agent_basic["agent-basic"]
  p_conversation -->|"config"| p_config_file["config-file"]
  p_conversation -.->|"storage"| p_storage_file["storage-file"]
  p_conversation -.->|"storage"| p_storage_sqlite["storage-sqlite"]
  p_conversation -->|"system-control"| p_system_control["system-control"]
  p_conversation_manual["conversation-manual"]
  p_conversation_manual -->|"config"| p_config_file["config-file"]
  p_conversation_manual -->|"conversation"| p_conversation["conversation"]
  p_conversation_manual -->|"http"| p_transport_http["transport-http"]
  p_conversation_proactive["conversation-proactive"]
  p_conversation_proactive -->|"access"| p_access_policy["access-policy"]
  p_conversation_proactive -->|"config"| p_config_file["config-file"]
  p_conversation_proactive -->|"conversation"| p_conversation["conversation"]
  p_conversation_proactive -.->|"storage"| p_storage_file["storage-file"]
  p_conversation_proactive -.->|"storage"| p_storage_sqlite["storage-sqlite"]
  p_memory["memory"]
  p_memory -->|"agent"| p_agent_basic["agent-basic"]
  p_memory -->|"config"| p_config_file["config-file"]
  p_memory -.->|"storage"| p_storage_file["storage-file"]
  p_memory -.->|"storage"| p_storage_sqlite["storage-sqlite"]
  p_memory -->|"tools"| p_tool_runtime["tool-runtime"]
  p_memory_index_lexical["memory-index-lexical"]
  p_outbound_queue["outbound-queue"]
  p_outbound_queue -->|"access"| p_access_policy["access-policy"]
  p_outbound_queue -.->|"adapter"| p_adapter_mock["adapter-mock"]
  p_outbound_queue -.->|"adapter"| p_adapter_onebot["adapter-onebot"]
  p_outbound_queue -->|"config"| p_config_file["config-file"]
  p_outbound_queue -.->|"storage"| p_storage_file["storage-file"]
  p_outbound_queue -.->|"storage"| p_storage_sqlite["storage-sqlite"]
  p_outbound_queue -->|"system-control"| p_system_control["system-control"]
  p_reminders["reminders"]
  p_reminders -->|"access"| p_access_policy["access-policy"]
  p_reminders -->|"config"| p_config_file["config-file"]
  p_reminders -->|"outbound"| p_outbound_queue["outbound-queue"]
  p_reminders -.->|"storage"| p_storage_file["storage-file"]
  p_reminders -.->|"storage"| p_storage_sqlite["storage-sqlite"]
  p_reminders -->|"tools"| p_tool_runtime["tool-runtime"]
  p_tool_runtime["tool-runtime"]
  p_tool_runtime -->|"access"| p_access_policy["access-policy"]
  p_tool_runtime -->|"config"| p_config_file["config-file"]
```

## 管理 API、运行时、扩展宿主与管理器

箭头从消费者指向提供者；虚线表示同一服务有可替代的提供者。

```mermaid
flowchart LR
  p_console_api["console-api"]
  p_console_api -->|"config"| p_config_file["config-file"]
  p_console_api -->|"http"| p_transport_http["transport-http"]
  p_console_api -.->|"storage"| p_storage_file["storage-file"]
  p_console_api -.->|"storage"| p_storage_sqlite["storage-sqlite"]
  p_console_api -->|"system-control"| p_system_control["system-control"]
  p_container_console["container-console"]
  p_container_console -->|"container.jobs"| p_container_jobs["container-jobs"]
  p_container_console -->|"container.runtime"| p_container_runtime["container-runtime"]
  p_container_console -->|"container.session"| p_container_session["container-session"]
  p_container_console -->|"http"| p_transport_http["transport-http"]
  p_container_jobs["container-jobs"]
  p_container_jobs -->|"access"| p_access_policy["access-policy"]
  p_container_jobs -->|"config"| p_config_file["config-file"]
  p_container_jobs -->|"container.runtime"| p_container_runtime["container-runtime"]
  p_container_jobs -->|"container.session"| p_container_session["container-session"]
  p_container_jobs -.->|"storage"| p_storage_file["storage-file"]
  p_container_jobs -.->|"storage"| p_storage_sqlite["storage-sqlite"]
  p_container_jobs -->|"tools"| p_tool_runtime["tool-runtime"]
  p_container_runtime["container-runtime"]
  p_container_runtime -->|"access"| p_access_policy["access-policy"]
  p_container_runtime -.->|"storage"| p_storage_file["storage-file"]
  p_container_runtime -.->|"storage"| p_storage_sqlite["storage-sqlite"]
  p_container_session["container-session"]
  p_container_session -->|"access"| p_access_policy["access-policy"]
  p_container_session -->|"config"| p_config_file["config-file"]
  p_container_session -->|"container.runtime"| p_container_runtime["container-runtime"]
  p_container_session -->|"tools"| p_tool_runtime["tool-runtime"]
  p_example_notes["example-notes"]
  p_example_notes -->|"external-loader"| p_external_plugins["external-plugins"]
  p_example_notes -->|"http"| p_transport_http["transport-http"]
  p_ext_knowledge["ext-knowledge"]
  p_ext_knowledge -->|"extensions"| p_extension_system["extension-system"]
  p_ext_mcp["ext-mcp"]
  p_ext_mcp -->|"extensions"| p_extension_system["extension-system"]
  p_ext_promptinject["ext-promptinject"]
  p_ext_promptinject -->|"extensions"| p_extension_system["extension-system"]
  p_ext_skill["ext-skill"]
  p_ext_skill -->|"extensions"| p_extension_system["extension-system"]
  p_ext_tool["ext-tool"]
  p_ext_tool -->|"extensions"| p_extension_system["extension-system"]
  p_extension_system["extension-system"]
  p_extension_system -->|"access"| p_access_policy["access-policy"]
  p_extension_system -.->|"adapter"| p_adapter_mock["adapter-mock"]
  p_extension_system -.->|"adapter"| p_adapter_onebot["adapter-onebot"]
  p_extension_system -->|"agent"| p_agent_basic["agent-basic"]
  p_extension_system -->|"config"| p_config_file["config-file"]
  p_extension_system -->|"conversation"| p_conversation["conversation"]
  p_extension_system -->|"http"| p_transport_http["transport-http"]
  p_extension_system -.->|"model"| p_model_mock["model-mock"]
  p_extension_system -.->|"model"| p_model_openai["model-openai"]
  p_extension_system -->|"outbound"| p_outbound_queue["outbound-queue"]
  p_extension_system -.->|"storage"| p_storage_file["storage-file"]
  p_extension_system -.->|"storage"| p_storage_sqlite["storage-sqlite"]
  p_extension_system -->|"tools"| p_tool_runtime["tool-runtime"]
  p_external_plugins["external-plugins"]
  p_external_plugins -->|"config"| p_config_file["config-file"]
  p_external_plugins -->|"http"| p_transport_http["transport-http"]
  p_qq_portable["qq-portable"]
  p_qq_portable -->|"http"| p_transport_http["transport-http"]
  p_qq_portable -.->|"storage"| p_storage_file["storage-file"]
  p_qq_portable -.->|"storage"| p_storage_sqlite["storage-sqlite"]
  p_snowluma_runtime["snowluma-runtime"]
  p_snowluma_runtime -->|"config"| p_config_file["config-file"]
  p_snowluma_runtime -->|"http"| p_transport_http["transport-http"]
  p_snowluma_runtime -.->|"storage"| p_storage_file["storage-file"]
  p_snowluma_runtime -.->|"storage"| p_storage_sqlite["storage-sqlite"]
```

## 客户端插件依赖

```mermaid
flowchart LR
  p_agent_memory["agent-memory"]
  p_agent_memory --> p_console_chats["console-chats"]
  p_console_chats["console-chats"]
  p_console_overview["console-overview"]
  p_console_plugins["console-plugins"]
  p_console_settings["console-settings"]
  p_container_console["container-console"]
  p_container_console --> p_console_chats["console-chats"]
  p_conversation_manual["conversation-manual"]
  p_conversation_manual --> p_console_chats["console-chats"]
  p_conversation_proactive["conversation-proactive"]
  p_conversation_proactive --> p_console_chats["console-chats"]
  p_example_notes["example-notes"]
  p_example_notes --> p_console_chats["console-chats"]
  p_ext_knowledge["ext-knowledge"]
  p_ext_knowledge --> p_extension_system["extension-system"]
  p_ext_mcp["ext-mcp"]
  p_ext_mcp --> p_extension_system["extension-system"]
  p_ext_promptinject["ext-promptinject"]
  p_ext_promptinject --> p_extension_system["extension-system"]
  p_ext_skill["ext-skill"]
  p_ext_skill --> p_extension_system["extension-system"]
  p_ext_tool["ext-tool"]
  p_ext_tool --> p_extension_system["extension-system"]
  p_extension_system["extension-system"]
  p_extension_system --> p_console_chats["console-chats"]
  p_extension_system --> p_console_settings["console-settings"]
  p_extension_system --> p_console_overview["console-overview"]
  p_ops_control["ops-control"]
  p_qq_portable["qq-portable"]
  p_run_inspector["run-inspector"]
  p_run_inspector --> p_console_chats["console-chats"]
  p_snowluma_runtime["snowluma-runtime"]
  p_system_control["system-control"]
```

## 读图说明

- 五个 v2-* 目录的运行 ID 是 ext-tool / ext-mcp / ext-skill / ext-knowledge / ext-promptinject，能力依赖统一指向 harness.extensions。
- SnowLuma 进程托管与 OneBot 适配器相互独立；snowluma-runtime 可选读取适配器连接状态。关闭托管插件不会主动终止外部 QQ/SnowLuma。
- qq-portable 只依赖存储与 HTTP，提供独立登录程序的管理；与 snowluma-runtime、adapter-onebot 无强制启停依赖。登录与协议就绪需分别检查。
- container-session 仅在后台执行请求时调用 harness.container.jobs，避免与 container-jobs 的必需依赖形成环。
- 工具、模式和 hook 归属注册它们的插件；上表的服务依赖负责 Cordis 激活和撤销，表外动态扩展还受各自清单控制。
