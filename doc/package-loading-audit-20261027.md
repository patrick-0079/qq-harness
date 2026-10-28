# 全部旧包离线加载与生命周期检查（2026-10-27）

覆盖101包：98包通过独立编译、加载、启用、停用和卸载检查；image-studio、cross-memory、cross-group-memory由原生图片工坊与统一三层记忆替代。**加载检查不能代替完整业务验收。**

原始证据：`var/package-audit-1793098791476`；[去路径JSON清单](package-loading-audit-20261027.json)。子进程使用独立数据、mock QQ／模型；网络、外部进程和目录外读写受审计守卫限制。被守卫拦截的请求表示对应真实外部行为尚未验收。

以前的7个宿主编译阻塞均已处理：发送转换接公开工具准备阶段，表情限制接原生同步策略，self-surf接会话存储／网页／outbound，net-proxy使用应用级代理传输，记忆工具使用原生事实及草稿。21个原包另有局部工作流测试，见[逐项矩阵](parity-matrix.md)。

组合演练 `var/extension-rehearsal-1793098754486/runtime-rehearsal.json`：98包加载无失败，保留7会话50处启用设置，无越界操作。正式安装和版本快照见[当前状态](status.md)。

| 包 | 加载 | 启用后 | 停止 |
|---|---|---|---|
| addressee-guard | 成功 | 声明可用，完整业务待验收 | 完成 |
| agent-task | 成功 | 声明可用，完整业务待验收 | 完成 |
| ai-status | 成功 | 声明可用，完整业务待验收 | 完成 |
| anti-recon | 成功 | 声明可用，完整业务待验收 | 完成 |
| at-identity | 成功 | 声明可用，完整业务待验收 | 完成 |
| at-mention | 成功 | 声明可用，完整业务待验收 | 完成 |
| auto-finish | 成功 | 声明可用，完整业务待验收 | 完成 |
| cache-suite | 成功 | 声明可用，完整业务待验收 | 完成 |
| ccb-command | 成功 | 声明可用，完整业务待验收 | 完成 |
| chatter-guard | 成功 | 声明可用，完整业务待验收 | 完成 |
| chuanzi | 成功 | 声明可用，完整业务待验收 | 完成 |
| command-digest | 成功 | 声明可用，完整业务待验收 | 完成 |
| content-guard | 成功 | 声明可用，完整业务待验收 | 完成 |
| context-chime | 成功 | 声明可用，完整业务待验收 | 完成 |
| context-reuse | 成功 | 声明可用，完整业务待验收 | 完成 |
| continuous-life | 成功 | 声明可用，完整业务待验收 | 完成 |
| cross-chat-link | 成功 | 声明可用，完整业务待验收 | 完成 |
| cross-memory | native-port-separate-tests | 原生替代 | — |
| daily-checkin | 成功 | 声明可用，完整业务待验收 | 完成 |
| deepseek-search-fix | 成功 | 声明可用，完整业务待验收 | 完成 |
| deepseek-status | 成功 | 声明可用，完整业务待验收 | 完成 |
| detailed-thinking | 成功 | 声明可用，完整业务待验收 | 完成 |
| face-decode | 成功 | 声明可用，完整业务待验收 | 完成 |
| friend-gate | 成功 | 声明可用，完整业务待验收 | 完成 |
| group-manner | 成功 | 声明可用，完整业务待验收 | 完成 |
| guardian | 成功 | 声明可用，完整业务待验收 | 完成 |
| hell-joke | 成功 | 声明可用，完整业务待验收 | 完成 |
| image-compat | 成功 | 声明可用，完整业务待验收 | 完成 |
| kaomoji | 成功 | 声明可用，完整业务待验收 | 完成 |
| kb-hub | 成功 | 声明可用，完整业务待验收 | 完成 |
| mc-status | 成功 | 声明可用，完整业务待验收 | 完成 |
| mcp-bridge | 成功 | 声明可用，完整业务待验收 | 完成 |
| member-aliases | 成功 | 声明可用，完整业务待验收 | 完成 |
| msg-reaction | 成功 | 声明可用，完整业务待验收 | 完成 |
| net-proxy | 成功 | 声明可用，完整业务待验收 | 完成 |
| ops-ctrl | 成功 | 声明可用，完整业务待验收 | 完成 |
| owner-identity | 成功 | 按条件停用 | 完成 |
| persona-picker | 成功 | 声明可用，完整业务待验收 | 完成 |
| poke-counter | 成功 | 声明可用，完整业务待验收 | 完成 |
| punch-card | 成功 | 声明可用，完整业务待验收 | 完成 |
| qianyeyue-affinity | 成功 | 声明可用，完整业务待验收 | 完成 |
| question-relay | 成功 | 声明可用，完整业务待验收 | 完成 |
| quota-guard | 成功 | 声明可用，完整业务待验收 | 完成 |
| quote-reply | 成功 | 声明可用，完整业务待验收 | 完成 |
| quote-target | 成功 | 声明可用，完整业务待验收 | 完成 |
| reminder | 成功 | 声明可用，完整业务待验收 | 完成 |
| repeat-echo | 成功 | 声明可用，完整业务待验收 | 完成 |
| reply-pacing | 成功 | 声明可用，完整业务待验收 | 完成 |
| reply-safety | 成功 | 声明可用，完整业务待验收 | 完成 |
| reply-tool-guard | 成功 | 声明可用，完整业务待验收 | 完成 |
| revenge-ledger | 成功 | 声明可用，完整业务待验收 | 完成 |
| rollpig | 成功 | 声明可用，完整业务待验收 | 完成 |
| safety-guard | 成功 | 声明可用，完整业务待验收 | 完成 |
| search-guard | 成功 | 声明可用，完整业务待验收 | 完成 |
| share-card | 成功 | 按条件停用 | 完成 |
| silent-voice-check | 成功 | 声明可用，完整业务待验收 | 完成 |
| sleep-schedule | 成功 | 声明可用，完整业务待验收 | 完成 |
| speech-to-text-qq | 成功 | 声明可用，完整业务待验收 | 完成 |
| steam-query | 成功 | 声明可用，完整业务待验收 | 完成 |
| sticker-cap | 成功 | 声明可用，完整业务待验收 | 完成 |
| sticker-memory | 成功 | 声明可用，完整业务待验收 | 完成 |
| sticker-send-as-emoji | 成功 | 声明可用，完整业务待验收 | 完成 |
| sticker-sense | 成功 | 声明可用，完整业务待验收 | 完成 |
| sticker-steal | 成功 | 声明可用，完整业务待验收 | 完成 |
| token-ledger | 成功 | 按条件停用 | 完成 |
| tool-boost | 成功 | 声明可用，完整业务待验收 | 完成 |
| topic-guard | 成功 | 声明可用，完整业务待验收 | 完成 |
| typing-indicator | 成功 | 声明可用，完整业务待验收 | 完成 |
| video-frames | 成功 | 按条件停用 | 完成 |
| ark-db | 成功 | 声明可用，完整业务待验收 | 完成 |
| bili-card | 成功 | 声明可用，完整业务待验收 | 完成 |
| bilibili-peek | 成功 | 声明可用，完整业务待验收 | 完成 |
| cross-group-memory | native-port-separate-tests | 原生替代 | — |
| daily-fortune | 成功 | 声明可用，完整业务待验收 | 完成 |
| deai-flavor | 成功 | 声明可用，完整业务待验收 | 完成 |
| friend-approval | 成功 | 按条件停用 | 完成 |
| group-image-repost | 成功 | 声明可用，完整业务待验收 | 完成 |
| health-report | 成功 | 声明可用，完整业务待验收 | 完成 |
| image-studio | native-port-separate-tests | 原生替代 | — |
| long-memory | 成功 | 声明可用，完整业务待验收 | 完成 |
| meme-mood | 成功 | 声明可用，完整业务待验收 | 完成 |
| mimo-tts | 成功 | 按条件停用 | 完成 |
| minecraft-master | 成功 | 声明可用，完整业务待验收 | 完成 |
| my-weather | 成功 | 声明可用，完整业务待验收 | 完成 |
| office-export | 成功 | 声明可用，完整业务待验收 | 完成 |
| owner-console | 成功 | 声明可用，完整业务待验收 | 完成 |
| pcstatus | 成功 | 声明可用，完整业务待验收 | 完成 |
| pig-hub | 成功 | 声明可用，完整业务待验收 | 完成 |
| recall | 成功 | 声明可用，完整业务待验收 | 完成 |
| reply-meme | 成功 | 声明可用，完整业务待验收 | 完成 |
| scheduled-task | 成功 | 声明可用，完整业务待验收 | 完成 |
| self-avatar | 成功 | 声明可用，完整业务待验收 | 完成 |
| self-surf | 成功 | 声明可用，完整业务待验收 | 完成 |
| sing-aloud | 成功 | 声明可用，完整业务待验收 | 完成 |
| skill-summary | 成功 | 声明可用，完整业务待验收 | 完成 |
| smart-image | 成功 | 声明可用，完整业务待验收 | 完成 |
| stamina | 成功 | 声明可用，完整业务待验收 | 完成 |
| steam-deals | 成功 | 声明可用，完整业务待验收 | 完成 |
| trendy-memes | 成功 | 声明可用，完整业务待验收 | 完成 |
| usage-report | 成功 | 声明可用，完整业务待验收 | 完成 |
| verify-first | 成功 | 声明可用，完整业务待验收 | 完成 |
