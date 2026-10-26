# Docker / Podman 容器插件

容器操作由四个独立 Cordis 插件提供，内核不依赖 Docker、Podman 或容器业务。前端页面及会话子页同样由插件注册。

| 插件              | 职责                                                      |
| ----------------- | --------------------------------------------------------- |
| container-runtime | CLI 探测、创建与绑定、启停/删除、归属检查、执行与资源限制 |
| container-session | 当前会话工具、会话开关、文件读写与搜索                    |
| container-jobs    | 后台执行、输出查询、取消、有界历史与 SQLite 持久化        |
| container-console | /api/containers API、React 容器页面、会话详情的容器页签   |

依赖方向：session → runtime；jobs → session；console → 前三者。工具通过 tool-runtime 注册，卸载撤销。扩展点为 container.before（guard）、container.after（observe）、container.job.ended（observe）。

## 使用

编译后可以在不连接 QQ、不调用真实模型的演示实例中操作容器：

```powershell
npm run build
node dist/server/main.mjs --demo --containers
```

进入 `/containers`：选择 Podman/Docker、填写本地已有的 Linux 镜像、勾选启用并保存。PATH 找不到 CLI 时填写绝对路径。在全局设置准入会话后，填入相同会话标识（例如 `group:10001`），创建会话容器。随后可通过页面或该会话中的 Agent 执行命令、操作文件。

--containers 是进程级门禁，设置 API 不能打开它；普通 demo 不探测引擎或操作容器。--live 也允许配置容器操作，但 enabled 默认仍为 false。库调用可传 `containers: { allowOperations: true }`。

默认镜像为 docker.io/library/ubuntu:24.04；使用 --pull=never，不自动下载镜像。基础功能需要镜像含 /bin/sh、mkdir、cat，搜索需要 find/grep。Node.js、Python 等环境由管理员选择的镜像决定。默认工作目录是 /tmp/qq-harness-workspace，启动后初始化，不假设镜像根目录可写。相对路径以此为起点，也可使用容器内绝对路径。

## Agent 工具

工具绑定当前 ToolContext.chatKey，没有目标容器或其他会话参数。管理员创建绑定后，才向该会话展示工具。

| 工具                             | 用途                                                 |
| -------------------------------- | ---------------------------------------------------- |
| container_status                 | 当前会话容器状态                                     |
| container_start / container_stop | 启动或停止已绑定容器                                 |
| container_bash                   | 执行命令，支持 workdir、timeoutMs、run_in_background |
| container_read / container_write | UTF-8 文件读写及创建父目录                           |
| container_glob / container_grep  | 文件名模式查找、文本搜索                             |
| container_job_list               | 本会话任务列表                                       |
| container_job_output             | 按任务 ID 查询状态和输出                             |
| container_job_kill               | 取消本会话任务                                       |

前台结果包括 exitCode、stdout、stderr、truncated，非零退出标为工具错误。文件内容走 stdin，不拼入宿主命令。同一会话执行串行化，不同会话可并行。

## 归属与生命周期

- 每个数据目录保存独立 owner UUID。每次操作先 inspect 校验 io.qq-harness.owner 和 io.qq-harness.chat 标签，只管理本工程创建的绑定容器，不接管其他项目容器。
- 宿主 CLI 使用 argv 和 shell:false；shell 命令仅在容器内执行。不向 Agent 暴露宿主挂载、socket、privileged 或任意 OCI 参数。默认网络 none、内存 512 MB、CPU 1、进程上限 128，cap-drop ALL、no-new-privileges。CLI 语义参考 [Docker exec](https://docs.docker.com/reference/cli/docker/container/exec/) 和 [Podman run](https://docs.podman.io/en/stable/markdown/podman-run.1.html)。
- 取消/超时不能只杀宿主 CLI，否则远端 exec 可能仍运行。当前策略是停止该会话容器，其中其他进程也会结束，文件保留。显式停止同时取消该会话的排队操作。
- 正常关闭/停用运行时会停止归属容器，不删除文件；重新启用恢复 SQLite 绑定。任务不自动恢复执行，重启时遗留 running 记录标 interrupted。宿主强杀或引擎不可达时，须检查可能遗留的容器进程。
- 删除只在管理 API/界面提供，页面要求再次确认；删除包含内部文件。切换引擎或 CLI 前先清理已有绑定。
- 后台任务最多同时 16 个、每会话 2 个，历史约 100 条，输出有界。结束时发布事件，不自动唤醒 Agent 或向 QQ 发消息。

## 验证（2026-10-26）

自动化测试使用 mock 引擎和临时数据，覆盖 Docker/Podman argv、门禁、准入、归属拒绝、Agent 工具循环、UTF-8/参数隔离、后台输出、跨会话拒绝、取消/超时、排队取消、失败回滚及卸载。浏览器覆盖配置保存、门禁和页面装卸。

人工 Podman 6.1.4 验收使用本机 ubuntu:26.10、独立 var/ 临时数据和 mock QQ/模型，旧 QQ-agent-script-runtime 容器保持原状。已通过实际命令、中文文件读写、后台任务完成、取消后停止容器、重启保留文件、活跃任务期间卸载停止容器、重新启用恢复绑定。临时容器全部删除，QQ 消息发送数为 0。

人工验收入口不属于 npm test，需显式选择本地镜像：

```powershell
npx tsx tools/verify-containers.ts --engine=podman --image=docker.io/library/ubuntu:26.10
```

Docker 分支通过 mock 协议测试；本机没有 Docker CLI，未完成真实 Docker 验收。

## 与旧版的差异

本次提供操作容器的基础闭环，尚未接入任意已有容器绑定、交互式 PTY/terminal、文件图片读取、专用编辑工具、container_web_*、任务结束自动续跑，以及 v2 技能脚本的实际容器执行后端；技能仍用原有降级执行器。CLI 的远程连接由管理员配置，程序不启动 Podman machine、不安装引擎或拉取镜像。
