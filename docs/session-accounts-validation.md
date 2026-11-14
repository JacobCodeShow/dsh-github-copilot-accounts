# Session accounts 本地验证记录

## 验证目标

- DSH 0.2.2-rc.1、Cordis 4.1、pi-ai 1.3.0 的原生接口。
- 每个普通原生会话可固定账号或跟随全局默认；请求准备后不换账号。
- 切号续聊隔离旧签名/replay 和传输 affinity，不清历史、不静默重跑工具。
- 优先使用标准 LlmAdapter 注册/替换、Session 投影与 Query、Remote、服务隔离、Agent 事件及 documented summarize 虚拟扩展点。

## 已通过的门禁

- 完整 Node 回归：488 项通过，失败 0，跳过 0（本机存在原生离线 fixture）。
- 浏览器侧构建通过，git diff --check 通过。
- 独立真实 Edge FILE 页面：会话菜单严格模式 83 项 DOM/生命周期断言通过（47 次合成 RPC、6 次明确点击绑定、1 次独立全局操作，网络 fallback 0）；紧凑设置页与单一 UTC 月进度总览 44 项通过；原生 IMG 缓存 hook 检查 41 项通过。
- 打包 dry-run：仅运行模块、构建客户端、composition、许可证和说明文档；无凭据、用户会话、诊断、测试 fixture 或 node_modules。

最终发行前若代码再变更，应重跑上述门禁；最终验收数字以交付时报告为准。

## 关键覆盖

1. A/B 并发、固定槽位刷新、文档级凭据锁下新鲜 B 不被 A 续期阻塞、缺失/删除/禁用不回退。
2. 多轮推理/工具 replay、A→B→A、受管理默认与专属绑定双向转换、same-account 429/压缩仍保留必要推理签名，传输状态独立失效。
3. 同 SID、同旧槽位 key、不同 issuer/长期授权的复制历史不能复用旧账号签名；短期 access 更新不破坏合法签名。
4. 凭据字段验证、认证/环境 override 拒绝、post-auth 重新分配拦截、非法刷新结果在写入前拒绝。
5. 普通模型选择的全局偏好保持原生保存逻辑；绑定选择不写全局默认；managed 保存为 native，旧版卸载后不残留新全局 provider。
6. 两种消费者隔离域、两种 teardown 顺序、pending alias/native-unbind 均不泄露全局保存；暖回退要求完整重启。
7. 明确 owner + Session 资源校验、异步后复核、跨 Host 同 SID、连接代际及迟到响应隔离；不通过本地 REST 代替远端 Host。
8. v4 codec +真实 JSONL backend READ/restore、再次 reopen、普通 fork 前缀继承、新子代理捕获选项与旧 seed 修正、已有子代理独立控制保留。
9. 切号自动压缩使用当前已捕获的 B，而非旧 header A；显式摘要覆盖优先；原生精确策略扩展、启动已知别名预算继承与新增敏感路由门禁。
10. 最简账号菜单、真实组件渲染、解绑/全局动作区分、错误弹窗过滤/去重/关闭、旧 Host 弹窗抑制、无原始错误文本展示或自动变更重试。

## 全角色冷启动与补充安全门禁

真实 MemoryLoader、原生默认模型服务/BasicCompaction/LlmRuntime/Session/Query/Schema/协议模块，结合当前实际 patch，按 native-first 与 roles-first 两种加载顺序均通过。公共/私有服务唯一性、门控依赖无环、Ready 顺序、原配置可编辑条目与受管理目录均已验证。控制器/凭据/模型协议仍使用测试替身，不启动真实应用。

同时移除了旧的进程全局 fetch/dispatcher 修改和 DOM 导航补丁；遗留未知错误全部使用固定安全诊断。OAuth 外链只接受规范 GitHub/GHE HTTPS URL，以无 shell 的 argv 打开，注入/凭据 URL/非法目的地测试通过。

## 当前用量与 UTC 月进度

只展示当前 `copilot_internal/user` 快照，不保存用量历史、不生成趋势或月底预测，也不会向 profile 写入用量采样文件。蓝色圆点/填充表示各账号当前已用比例；黄色菱形和 UTC 已过／剩余天数在页面总览只显示一次，避免每个账号重复相同的月进度内容。

“合计已用”是多个登录账号当前百分比的归一化相加，仅作查看辅助；不是 AI credit 金额、组织共享池、网页付款方下拉项或模型请求计费选择。单账号隐藏合计。公开接口调查见 [计费主体调查](copilot-billing-options-research.md)。

## 没有做的声明

- 没有安装、替换或重启用户正在运行的 DSH。
- 没有读取用户凭据文件或提取/打印真实 token，没有真实模型请求或真实账号 API 实验。
- 原生模块测试复用安装包代码，但使用合成凭据/会话/协议；不等于真实 GHE HTTP 端到端验收。
- JSONL 测试证明 native codec/backend-read/restore，不声称验证 native writer/fsync/Windows 锁、崩溃或跨进程持久化。
- Edge 使用合成 Session/Host/RPC、专用空白 profile、网络阻断；Modal 是符合公共 props 的测试 stub，因此不声称验证 Host Modal 的实际皮肤/焦点陷阱，也不是当前 GUI 截图。
- 显式外部认证/API-key 或非原生端点不能被猜作某个 OAuth 账号；此类路径显示为 unmanaged。

## 手工测试与回退

见 [人工验收清单](session-accounts-manual-check.md)。测试包应先停止会话并完整退出 DSH 后安装，重新启动；不要热移除策略角色。回滚保留账号和会话记录，但旧版不识别新增固定绑定路由，需用户明确选回旧版原生模型，或重新安装本功能恢复。
