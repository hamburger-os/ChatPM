# 架构决策记录（ADR）

**状态：架构基线审查完成。** 每条决定注明候选方案、原因、代价和复审条件，避免“最新技术即最佳设计”的误区。

| ID | 拟议决定 | 为什么 | 代价 / 何时复审 |
|---|---|---|---|
| ADR-001 | 模块化单体 + API/Worker 双进程 | 降低部署与分布式一致性复杂度 | 某模块扩缩容/部署边界确有需求时复审 |
| ADR-002 | PostgreSQL 为正式事实源 | 任务、风险、决策需事务性和可查询性 | 高吞吐/分库需求有实测依据时复审 |
| ADR-003 | 候选变更与正式领域事实分离 | 防止 AI 猜测被误当团队承诺 | 经实际验收证明可安全自动化时调整策略 |
| ADR-004 | 单编排器 + 有权限边界的业务工具 | 比自由自治多 Agent 更易审计/纠错 | 新角色协同确有收益时复审 |
| ADR-005 | 事务 Outbox、至少一次交付、幂等消费者 | 降低数据库/队列双写丢事件风险 | 吞吐瓶颈有证据时改事件基础设施 |
| ADR-006 | FollowUpPlan 持久化于数据库 | 防止 Worker 重启和队列丢失导致漏催 | 高规模时评估专用调度服务 |
| ADR-007 | PostgreSQL 查询优先，语义检索渐进引入 | 防止过早将向量库当可信记忆 | 文档规模与召回评测达阈值后升级 |
| ADR-008 | 产品四层文档 + 中文方案优先审查 + 双语社区 | 支持非代码审查及 AI 编码治理 | 工具链变更或协作规模扩大时复审 |
| ADR-009 | 不维护遗留兼容接口 | 当前仓库全新、无历史系统 | 首个稳定对外 API 发布后改用版本治理 |

## 已选用的安全默认策略（ADR-010）
- 默认不向外部模型发送项目消息；现有实现需项目负责人主动启用。未来组织级策略可以进一步限制模型提供商、传输和数据保留。
- AI 可以自动生成候选提取与非敏感内部草稿；任何正式负责人、截止日期、关键完成状态、里程碑和风险升级均需有权限的人员确认。
- 周报与月报默认由有发布权限的项目负责人审阅后发布。
- 催办采用“关闭优先”：没有明确期限、负责人或授权时不主动对人催办；工作时间与冷却阈值由项目负责人配置，否则只生成内部待确认事项。
- 核心代码采用 Apache-2.0；官方 SaaS 与自部署使用同一应用核心，数据与模型出站策略需明确。

以上为保守安全基线，变更默认值必须提出新的 ADR 和明确的用户审批。

## 已确认的产品边界

- 服务于各种项目团队，业务概念保持通用，行业差异交给模板。
- 官方 SaaS 和社区自部署共享核心代码与数据库契约。
- AI 动作分级：观察、受控低风险动作、需要审批的正式变更；授权始终由服务端策略判定。
- 云端模型和本地模型均是目标接入方式；当前只有外部模型实现。
- 首发优先聊天—候选确认—主动跟进—报告闭环；Apache-2.0 是选定许可证。

## 已采用的运行时技术
| ID | 已决定的调整 | 原因 / 复审条件 |
|---|---|---|
| ADR-011 | API 使用 Fastify + strict TypeScript | 薄 API、少框架魔法；模块复杂度显著提高时重新评估 NestJS |
| ADR-012 | PostgreSQL Outbox + 轮询 Worker，暂不采用 Redis/BullMQ | 初期减小故障面、避免双写，吞吐证据表明瓶颈后升级 |
| ADR-013 | Web 页面采用 5 秒轮询 | 先验证任务闭环；有并发/延迟证据后使用 SSE/WebSocket |

这些改动不影响 PostgreSQL 正式事实源、AI 候选审批、租户权限和人工决策原则。

## ADR-014 · 消息增量游标与报告草稿一致性（2026-10-12）
- **决定**：所有服务端消息写入必须在业务事务内经过统一消息命令，以项目级 PostgreSQL advisory transaction lock 串行化序号分配和提交。报告通过单条 SQL 读取快照，全量聚合、限制明细，草稿允许覆盖重算，已发布内容保持不可变；更新 FollowUpPlan 保留实际发送冷却。
- **原因**：Identity 自增序号不能独立保证并发提交顺序，前端按 `after=seq` 可能漏消息；截断聚合与过期草稿可能导致不真实汇报，重新排期不能成为刷屏入口。
- **代价**：同项目写消息串行化；全量聚合随任务数增长需数据库索引和查询压测，报告仅支持同周期一份定稿。
- **不选择**：不为上述缺陷引入 Kafka、全量事件溯源、Redis 序号源或通用工作流引擎。
- **复审**：项目写入吞吐成为实际瓶颈，或业务明确需要同周期多版本已发布报告时重新设计。

## ADR-015 · 可靠事件和受审计的 AI 多轮澄清（2026-10-12）
决定：PostgreSQL Outbox 使用五分钟租约、至多八次交付、指数退避、死信隔离和 owner 授权重放；AI 仅采集明确引用候选 UUID 的回复作为持久证据，不直接变更正式事实；抽象一个 LLMProvider，按项目/UTC 日限制模型调用；SQL 迁移逐文件校验和保护。不引入 Redis/Kafka、多自治 Agent 或旧接口兼容。代价：成员需引用完整候选 ID，日调用限额无法等价于 token 成本治理。复审：生产安全/隐私评估、自然回复关联评测、负载与数据库吞吐证据要求升级时。

## ADR-016 · 原生跨平台部署与同源 API（2026-10-12）

**决定**：Windows、Linux 和 Docker Compose 共享 TypeScript NodeNext 编译产物、SQL 迁移与 PostgreSQL 契约；Next.js 同源 `/api` 代理在服务器运行时解析内部 API 地址；Node 服务配置启动时校验；原生服务由操作系统服务管理器管理。生产镜像和原生系统运行同一业务代码，不建立平台兼容层。

**替代方案**：拒绝 Docker-only 限制；拒绝为 Windows 增加 SQLite 分支；拒绝引入微服务或 Redis；拒绝以 `tsx watch` 充当生产进程。保留 PostgreSQL 作为事实源。

**代价和复审**：Next.js 代理增加一跳；原生平台需要独立维护服务配置和安全基线；升级、备份恢复及安全测试仍需持续验收。未来依据真实负载评估进一步封装发行包和 Helm。


## ADR-017 · 单终端运行与安全的一键容器启动（2026-10-13）

- **选择**：保留 Web/API/Worker 三个独立 Node 进程。开发和本地临时运行提供一个跨平台前台进程管理入口，任一子进程异常退出时结束整组，让操作者知道应用不完整；正式 Windows/Linux 长期驻留仍由 WinSW/systemd 按进程托管，支持单独重启。Docker Compose 使用已有健康检查、数据库迁移依赖及 `restart: unless-stopped`，增设一次性入口自动创建缺失的本地配置与强随机秘密后后台启动。
- **边界**：一键容器启动以 Docker Engine 与 Compose 已安装并运行作为前提；原生部署仍要求先配置 PostgreSQL，拒绝以管理员权限静默安装数据库。工具不得覆盖既有非占位符秘密，不覆盖已有数据库，不输出秘密。
- **替代**：不合并 API/Worker/Web 为一个业务进程，不引入 PM2 或额外运行时依赖，也不把跨平台临时进程管理脚本宣传为操作系统守护服务。
- **代价 / 复审**：临时前台运行时某进程故障会停止整组；Windows 服务封装器、自动备份、HTTPS、容器宿主机启动和生产韧性仍需各平台验证。若有独立扩缩容、故障隔离需求，优先使用已有分进程服务或容器编排。

## ADR-018 · 可观测的独立 Worker、备份维护和最小权限运维（2026-10-13）

- **决定**：延续 PostgreSQL 为事实源，不引入独立监控数据库。Worker 周期写入轻量 `worker_health` 全局存活和成功心跳，独立 `doctor` 检查数据库、迁移、API、心跳与消息积压，非零退出码便于接入外部监控。心跳记录仅属运维遥测，不写入领域事实或 AI 候选。
- **备份**：显式调用 PostgreSQL custom-format `pg_dump`，先写私有临时文件，成功后原子更名，失败清理临时产物，保留最近 N 份。使用系统调度器（systemd timer / Windows Task Scheduler），绝不在 API 或 Worker 请求路径中执行备份；独立位置保存，需磁盘加密或离机加密副本及实际恢复演练。
- **权限与升级**：原生服务拒绝默认高权限长驻：Windows 使用明确的内置低权限账户并将必要的工作目录和日志目录授权；Linux 保留专用系统用户。升级应先做可验证备份，停止写入、迁移、重启、健康检查；数据库不可自动回滚，仅代码可回退到兼容 schema 的版本。
- **范围**：运维工具、系统任务和操作手册属于可交付物，不能替代真实 Windows 11/Linux 开机及故障演练，也不构成生产审计合格证明。离机备份、PITR、集中监控告警、可签名安装包应由明确的发布环境和密钥政策再落地。

## ADR-019 · 多模型双协议传输与部署配置（2026-10-13）

**决定**：不再硬编码 OpenAI API URL；单一业务 Provider 通过纯 HTTP 传输适配响应接口 `responses`（强制 JSON Schema）和 `chat-completions`（JSON Object + 本地 Zod 强校验）。服务端通过四个 `LLM_*` 环境变量指定 URL、Key、模型、协议。项目 Owner 现有显式启用、配额、来源、审批及事件幂等维持不变。

**备选**：仅增加 Base URL 不足以覆盖协议差异；不为每个品牌复制业务流程，也不引入泛化路由/代理、数据库存密钥、多租户模型配置或自动故障切换。

**安全/代价**：校验端点为可信部署配置，公网仅 HTTPS、本机 HTTP 例外；不输出上游响应体或密钥；拒答/超时/截断/Zod 失败关闭，真实 DeepSeek 和本地模型行为需要联调。改配置需重启；日配额计请求次数而非费用。积累不同模型真实验收数据后复审。

**ADR-019 /review 补充**：项目 AI 开启 API 与 Worker 复用同一配置验证；HTTP 请求禁用自动重定向；在现有候选/澄清 model_name 文本中记录供应商端点主机、传输类型与 URL SHA-256 截断指纹以区分同名模型和代理路径，不存敏感 URL path 和 Key。本期不引入数据库迁移。

## ADR-020 · 原生前台进程统一停止（2026-10-13）

- **决定**：给 `npm run dev` 和 `npm start` 的同一前台进程管理器增加受令牌保护的回环控制入口，并提供跨平台 `npm run stop`；复用既有 Worker IPC 优雅关闭，不引入 PM2、操作系统后台守护器或全机进程枚举。
- **理由**：本地测试阶段，尤其 Windows 上遇到 `npm ci` 文件锁时，使用者需要可验证、只影响当前 ChatPM 实例的一键停止操作，而非按照镜像名批量关闭 Node.js。
- **替代与边界**：拒绝 `taskkill /IM node.exe /F`、`Stop-Process -Name node` 及 PID 文件直接 kill（存在误杀和 PID 重用风险）。原生前台应用以外的 Docker、Windows 服务、systemd 不受控制；`npm ci` 不是服务进程，失败后也可能没有 ChatPM 在运行。
- **安全/失败**：运行状态文件私有、不入 Git；本地回环随机凭证与独占状态锁。控制器失联但 PID 存在时明确报错，避免错误杀进程。实机 Windows graceful shutdown 与被杀死后恢复仍要验证。

## ADR-021 · 项目 AI 设置、上下文与可解释事件
- **决定**：每项目 Owner 管理受限制的模型配置（服务端预置配置/内置 OpenAI/DeepSeek HTTPS 固定端点），密钥在 PostgreSQL 使用 AES-GCM 密文存储；不允许普通用户指定任意 URL。统一校验、限频测试连接、分层有界上下文、候选的唯一近期澄清推断、显式“回复此候选”、消息分析状态和 `@AI` 只读回复。
- **不选**：不把通用 Pi Coding Agent SDK 的 Shell/文件工具注入项目；不采用无界聊天历史、隐式摘要覆盖正式事实、跨项目记忆或自动提交通用模型动作。SDK 移植仅在专门 PoC 验证上下文成本、供应商兼容性和权限边界后决定。
- **权衡**：AES 由 SESSION_SECRET 派生会受密钥轮换影响；第一版以固定服务商端点限制 SSRF，任意私有模型地址仍由服务器管理员配置 `LLM_BASE_URL`。请求次数预算不是费用；上下文字符裁剪不等于模型真实 Token compaction。真实模型能力和 Windows 实机仍需检验。
- **复审**：出现多租户密钥轮换需求时独立 KMS；长会话和模型切换达到测量阈值后评估持久摘要与 SDK；自动多步骤工具需求经 RBAC/审计验收后再增加。

## ADR-022 · 证据驱动的任务进度与提前跟进（2026-10-14）
- **决定**：AI 首先解析当前消息的“新任务、既有任务进展、风险/阻塞、无行动信息”，受限于同项目正式任务 ID 关联、证据与可解释性。匹配明确的既有任务时仅产生证据型进度更新建议，不创建同义新任务；歧义时询问用户选择。已确认任务状态、完成与期限仍由 Owner 通过业务命令决定。
- **领域模型**：增加带来源消息、模型/提示版本、确认状态和目标任务 FK 的 `task_progress_updates`；AI 提交候选、Owner 审核，将“已完成初稿”等事实归属到该任务，未审核不自动标记 done。先保持轻量、明确证据来源，不引入向量数据库、通用工作流引擎或 Pi Shell 工具。
- **任务日期**：把任务业务截止日期迁移为项目当地日历 `DATE`，到期判断依据项目时区；实际时间和发送提醒仍为 `TIMESTAMPTZ`。旧数据使用当时项目时区进行一次性迁移，业务接口改为 `YYYY-MM-DD`，不维护旧 `dueAt` 兼容。
- **主动跟进**：规则首次检查由截止前 1 天改为从任务开始后的阶段性计划（随剩余时间比例调整），工作时段对齐、冷却、提前风险检查与幂等仍有效；已阻塞/新增风险进入高优先级检查队列。缺少验收证据不凭模型推断完成。
- **模型与运维**：模型能力选项依协议及供应商能力约束，DeepSeek 官方 1M Token 窗口与最大 384K 输出只代表模型理论能力，不默认一次性塞满；扩大结构化任务分析预算，修复 Chat Completions 固定 6500 字符，新增安全 schema 错误诊断和确定性失败不重试 8 次。
- **UX**：日期选择仅到天，三栏 min-height/滚动容器调整，邀请成员按钮保持横排，中文 IME 正常输入，复杂设置较小屏幕可达。
- **边界**：不会声明“已实现通用 Agent 自动计划/跨任务依赖推理/百万 Token 动态语义压缩”。长时记忆与多 Agent 引入须完成真实评测再议。


## ADR-023 · 分离组织人员维度、项目交付维度和 AI 管理权（2026-10-14）
- **决定**：在组织租户中独立建模部门、项目组合、项目集、项目和资源分配；项目可以独立于项目集存在；部门和项目集不能相互冒充。项目可归属一个主项目集，或直接归属项目组合。
- **权限**：项目成员增加 manager、observer，权限由服务端动作策略与任务归属决定；组织管理员管理成员，系统总管理员经本机操作员命令授予，仅管理系统配置，不继承其他组织的业务数据读权。
- **模型**：删除项目级模型凭据和固定供应商品牌选项，仅保留部署级管理员配置的模型与协议；独立加密密钥，不与 Session 密钥共用；无默认模型时项目 AI 保守拒绝开启。
- **未选择**：部门=项目集、单一 Owner 万能角色、项目 Owner 持有 API Key、微服务与自治 Agent。当前保留 API/Worker/Web+PostgreSQL。
- **权衡**：既有项目级试验模型配置必须由管理员重新录入；企业身份、邀请、费用配额、DNS/SSRF 强化、跨项目收益管理以及生产验收需要后续独立实现。
- **验收**：跨组织 FK/接口拒绝、动作级权限矩阵、刷新不登出、模型密钥不回传/仅总管理员可配置、双语文档/CI；详见 [组织治理设计](organization-governance.md)。

## ADR-024 · 分层导航及供应商连接中心（2026-10-14）
- **导航**：项目、组织、系统、个人功能入口归属全局左栏；项目右侧仅负责任务、候选、汇报和项目设置。组织与系统管理是独立工作区，遵守前端可见性及后端强制授权。
- **身份**：名称统一为「系统管理员」；与普通用户共用登录体系，经本机受控命令首次授权。组织管理员不是系统管理员，系统管理员不天然读取全部项目资料。
- **AI**：供应商连接拥有端点、协议和加密 Key，多个模型注册在同一连接下。浏览器不显示明文密钥。只用协议适配和模型明确能力发送推理参数，不再按域名猜测品牌；启动密钥留在运行环境，供应商凭据从界面受控录入。
- **迁移**：009 将既有每模型凭据移到独立连接，保持一次性迁移，不保留旧 UI/API/环境回退。详见 [设计与验收](navigation-provider-center.md)。

## ADR-025 · 供应商创建、移动协作及多用户轮询预算（2026-10-14）

选择显式创建状态和同源品牌标志，移动窄屏在消息/工作台两视图中切换；保持桌面布局。非实时数据轮询下调为 15 秒、标签页隐藏时暂停；登录人员的 API 配额与未登录来源分离，并对登录注册继续严限。保留现有 Fastify/Next.js/PostgreSQL/Worker 架构，不为当前负载引入 Redis 或通用 WebSocket 服务。QNAP/IPv6 部署使用可信 HTTPS 反向代理和最小网络暴露，是否能远程访问以设备实测为准。

风险：移动设备尚未实机验收；多实例限流一致性和反向代理真实来源安全配置仍需专项压力测试；SSE/通知与模型出站网络隔离不属于已交付项。复审条件：并发规模、失联延迟或公网生产验收需要。


## ADR-026 · AI 模型目录发现及发现优先的管理员工作流（2026-10-14）

- **决策**：继续使用独立的供应商连接和模型注册；新增系统管理员专属服务端 GET /models 目录探测、事务性批量注册、默认禁用与手工 ID 后备。发现的模型 ID 是调用主键，展示名为可编辑标签；同连接的模型 ID 幂等去重。目录发现不等于推理兼容验证，也不据名字猜上下文、成本或推理能力。
- **交互**：连接保存后主动尝试获取目录，失败不回滚已保存的连接；原模型/连接编辑使用明确草稿，离开时确认；目录搜索/全选/批量注册；模型参数移到高级设置，默认模型显式切换；测试允许未启用连接下的模型，只发送固定的匿名结构化测试语句。普通成员无权调用管理 API。
- **失败与安全**：目录请求只访问已保存、由系统管理员配置的 Base URL，不接受模型返回的跳转 URL；服务端解密 Key，浏览器不见 Key。GET 有 10 秒超时、512 KB 响应上限、500 模型上限、按连接每 10 秒数据库限频，不跟随重定向；特殊网络地址和 DNS 私网结果作发送前预检。生产部署仍必须靠网络出口防火墙/代理实现强制私网隔离（DNS 检查不能消除 TOCTOU），不能宣称彻底解决 SSRF。
- **取舍**：本次不引入厂商 SDK、自动推理能力探测、自动重试或隐式故障切换；只对实现了 OpenAI 风格 GET /models 的服务提供自动发现，未实现该 API 的服务可手动注册。连接测试或模型目录为空不能证明模型可调用。保持模块化单体和现有审计。
- **验收**：目录有/无/错误/401/404/429、重复模型/超长响应、网络安全及模型测试回归；管理员权限、批量事务与唯一约束、TypeScript/构建、文档检查与 CI。真实供应商以及 Windows Docker 内网路径需独立联调。


## ADR-028 · 模型目录即时刷新与快速结构化自检（2026-10-14）

- **决定**：管理员手动刷新模型目录，不再施加固定 10 秒冷却。目录查询仅读取模型元数据且通常不会触发推理费用；界面在单个请求进行时禁用刷新按钮，结束后可立即再次刷新。成功时以新目录保留仍有效的勾选项；失败时保留已发现模型与选中状态，展示错误，不误报成功。
- **工程清理**：历史 010 迁移不可改写校验和，新增 011 迁移移除已不使用的 `ai_provider_checks` 表。仍限制 10 秒上游请求超时、512 KB 响应和 500 个条目，并保留系统管理员权限；上游若返回 429 应明确提示，不能无限自动重试。
- **模型测试**：默认快速测试仅执行一次 ChatPM 正式结构化 JSON 推理检查，最适合管理员日常确认可用性；完整诊断依次运行匿名基础文本和结构化 JSON 两次调用，用于兼容排障。两种模式均只有结构化 JSON 验证成功才显示模型测试通过。快速模式的基础文本状态为“未单独测试”，不得伪称基础文本测试通过。
- **费用与保护**：模型推理有实际成本，继续执行每模型 30 秒数据库限频；快速/完整两种模式共享冷却，无隐式自动重试或跨模型切换。前端分别标注一次和两次调用，延迟由实际模型计算决定而不是人为等待。
- **取舍**：不引入 Redis、定时自动抓目录、服务端跨实例缓存或多平台品牌猜测。不宣称纯文本成功即可满足结构化项目任务抽取。实际代理费用、并发行为仍需在部署环境验证。

## ADR-029 · V2 受治理 PM 运行时目标基线（2026-10-14）

**决定（目标设计，不声明已交付）：** 采用 [V2 架构](v2-architecture.md)、[命令/事件契约](command-event-contracts.md)、[AI 版本授权](ai-governance-v2.md) 与 [方法/Playbook](project-methods-playbooks.md)。Chat/AI 建议与正式项目事实分离；组织维度和项目集/组合维度正交；API 与 Worker 写入逐步归模块命令所有，正式更改、审计、事件、Outbox 与幂等结果同事务。

**选用原因：** 防止模型推断成为承诺、跨项目数据失控、未审计变更、审核完成与实际验收混淆。**代价：** 领域建模和事务契约增加初期开发工作；分期演进保留现有可用功能。**不选：** 直接一次性重建仍被使用的数据库、微服务/全事件溯源、多自治 Agent、持久兼容适配器。**复审：** 通过真实用户项目、AI golden eval、部署与数据库基线验收后逐步提升自动化权限。详见 [分期计划](v2-delivery-plan.md)。

## ADR-030 · 项目正式登记簿、幂等命令与可审计事件（2026-10-14）

**选择：** 先独立建模正式目标、里程碑、交付物、问题、决策、变更请求与任务依赖，不引入一个涵盖所有 PM 语义的万能 JSON 实体表。新增 scoped CommandReceipt 和 DomainEvent，业务、Audit、DomainEvent、Outbox 与幂等回执在单事务内产生。新领域事件经 Worker 明确识别后确认投递；未知事件仍失败并进入重试/死信，禁止静默丢弃。

**权限：** manager 可以维护普通交付计划与提交成果，owner/manager 可以独立验收，但不得验收自己的提交；关键变更审批仅 owner。所有正式写入均在事务内复核有效项目与组织成员关系，乐观 version 与受控状态转换不可被 AI 绕过。

**代价：** 增加独立领域表、强数据约束和显式路由；新功能暂时不与旧任务状态语义混淆。不对已有记录做破坏性清库或修改历史迁移。**复审：** 多组织规模压力、状态模型出现明确统一收益时才考虑抽象合并，不以代码行数作为仓促泛化依据。

## ADR-031 · 当前项目下的正式 PM 治理工作台（2026-10-14）

**决定：** 延续 ChatPM 当前同源工作台，增加独立「项目治理」页签和可复用 PMRegisterPanel 组件，按正式域模型展示对象，提供创建、提交/验收、变更审批与依赖登记。按当前项目 id 重新装载，避免跨项目缓存串页；操作错误直接展示，项目成员只能看到有权限操作。**不选：** 新建微前端、多端路由框架、开放系统设置给项目用户、无明确权限的通用编辑器。**代价：** 当前是紧凑的项目上下文侧栏；高级大型组织看板/报表会按真实规模评估独立工作区。以真实移动端交互和权限回归为验收门槛。

## ADR-032 · 单一项目 AI 开关 + 版本化撤权 + 调用账本（2026-10-14）

**决定：** `projects.ai_enabled` 继续是模型出站许可的唯一当前状态；PostgreSQL 触发器维护 `ai_authorization_version` 并保证 UI/后台脚本更改保持同一规则。Worker 的单次模型操作在调用前检验开启状态及版本，重试与失败独立写入只含脱敏字段的 `ai_model_invocations`。ModelInvocation 是外部尝试而非 AI 自动执行许可；正式任务与风险仍需人审批。

**不选：** 复制多份互相冲突的 `enabled` 字段、以 Chat 原文作为账本、估算 token 成本当作真实账单、在外部 60 秒网络请求期间长期持有数据库写锁、隐式供应商故障切换。**局限：** 数据库校验与网络请求之间有不可消除的 TOCTOU 窗口，生产仍需网络 egress 策略；细粒度 ProjectAIAuthorization、组织数据分级与真实费用需要后续实现。**复审：** CI 与真实模型评测明确验证网络调用幂等和成本，并完成出站限制后升级。

## ADR-033 · Worker 调度与核心业务 Runner 分离（2026-10-14）

**选择：** 将三条独立 Runner——AI 事件、规则提醒与周期报告——从 apps/worker/src/worker.ts 的进程启动文件移到 packages/core/src/conversation/ai-event-runner.ts、packages/core/src/automation/reminder-runner.ts 与 packages/core/src/reporting/period-runner.ts，保留同一 PostgreSQL 事务/工作时区/重试设计与实际运行行为。Worker 仅引用 runner 并负责 tick、心跳与 graceful shutdown。**不选：** 跨进程 RPC、额外队列、改变消息事件消费业务语义、引入新的通用调度框架。**复审：** 多 Worker 租约与 SQL 语义出现实际性能需求后再调整。验收以 CI 事件/提醒/报告集成与原生/Docker 运行测试为准。

## ADR-034 · 运行边界可执行守卫与运维心跳（2026-10-15）

**决定：** Worker 入口不再直接写任何数据库表，心跳/成功与失败的存储逻辑归 `operations/worker-heartbeat.ts` 所有，主进程只负责 tick、停止与调用 Runner。CI 增加零依赖的静态架构守卫，保证 Worker 启动文件不引入领域 SQL、不会重新聚合事件/提醒/报告实现，且能正常调用三个 Runner。**范围：** 守卫目前只覆盖 Worker bootstrap；遗留 API/治理路由有直接业务 SQL，尚不能误报它们已实现全部无跨模块 SQL。后续逐模块迁移 API 时扩大规则。

**取舍：** 使用精准且窄范围的源码断言，而不是为现有 560 行 API 建立大量豁免的复杂 ESLint 插件；不修改数据库 schema、Outbox 重试或 Win11 进程模型。守卫自身要纳入 GitHub CI 并能够通过主动违反约束的测试证明会失败。

## ADR-035 · 可重复黄金评测，不伪造模型质量（2026-10-15）

新增与当前项目分析 Prompt 和 JSON Schema 同源的合成样例/评分器；CLI 在明确 `PM_EVAL_LIVE=1` 且有部署方密钥时才能调用实际模型，不使用生产聊天。CI 验证样例覆盖/评分器正确性和提示版本，不假定 AI 质量已经通过；对当前不支持的 Commitment/Issue/Decision/Change/Acceptance/Intervention 另列 Coverage Gap，不混入误导性的成功率。不新增自治 Agent，不引入 Shell/文件模型工具。

## ADR-036 · 正式 Issue 生命周期与版本化历史（2026-10-15）

**决定：** 扩展已存在的 `project_issues`，而不是创建第二套不兼容的问题记录，新增按项目复合外键引用的 `project_issue_transitions` 状态事件表。现有问题保持 `open` 或 `resolved`；新增闭环 API 支持 resolve/reopen 两种受控状态转换，所有写入复用正式 PM CommandReceipt/DomainEvent/Outbox 事务。UI 为授权用户展示历史，只有 owner/manager 可更改状态，AI 不可自动解决。

**选用原因：** 不丢失多次解决/复发历史，并为周报及整改后核验提供事实基础。**代价：** 更多小表和版本约束；不直接计算实际整改效果，也不标榜 PMBOK Issue/Change 的所有流程已实现。**不选：** 在单个 `resolution_note` 字段覆盖历史、跨项目引用和成员离职时删除操作者记录。

## ADR-037 · 完成时校验依赖和事务内授权（2026-10-15）

**决定：** 既有项目任务状态转为 done 时必须保证该时刻前置任务均为 done；新增依赖时若被依赖任务已 done 而前置任务未 done，拒绝创建；检查与插入使用 `pm-dependencies:{projectId}` 同一事务顾问锁。旧任务命令与正式 PM Command 均复用 `project-access.ts` 的项目/组织成员授权行锁，修复“服务端早先读到 manager，但事务提交前已被降级”的竞态。负责人指派也同时验证租户成员身份。

**取舍：** 不为了任务状态扩展而重写已发布 Task API 的响应契约，也不把任务依赖变成全流程引擎；不禁止因真实问题重新打开已完成任务，但应由后续下游影响评估回应。此处只覆盖任务 create/update 与新 PM command 的授权统一，其他旧 API 的事务级角色校验仍待迁移。

## ADR-038 · 同项目证据片段与来源作者确认（2026-10-15）

**决定：** 证据与业务事实分层存储：新增 EvidenceSpan（消息、code-point 范围、服务器提取原文）和 ProjectClaim（类别、人的解释、pending/source_acknowledged/dismissed 状态）。只允许来源人自己确认，PM 可以驳回错误解释；所有操作使用正式项目 Command/审计/Outbox。允许项目成员引用自己发言形成待确认主张，但禁止跨项目聊天或仅凭系统管理员角色读取。

**理由：** 为聊天中的承诺、阻塞、完成声称、决策线索建立可复核来源，不让模型猜测、工期估计或“已开发完”直接变成已验收事实。**取舍：** 新表留存准确摘录（受项目成员权限保护），避免存一份消息全文；证据量增长与保留期限需要 P4 统一治理。当前不执行 LLM 主张自动抽取或跨来源冲突消解，后续有黄金评测再升级。

## ADR-039 · 正式任务唯一命令提交边界（2026-10-15）

**决定：** 把旧 `POST /projects/:id/tasks` 与 `PATCH /projects/:id/tasks/:taskId` 搬出 API bootstrap，迁入 `delivery/task-routes.ts` 并使用 `executePmCommand`。每个写入请求必须带客户端 UUID `idempotencyKey`；更新仍显式携带 `version` 并保持任务负责人/里程碑依赖/权限条件。正式 Task 状态、审计、DomainEvent、Outbox、CommandReceipt 与提醒计划刷新同事务提交。同命令键/同请求返回原结果；键被不同 payload 复用返回 409。现有前端及集成测试须改为显式唯一命令键，**不为旧请求提供绕过审计的可选降级**。

**理由：** 消除旧直接 Task 路由与新 PM 登记簿不同的幂等/事件语义；将领域 SQL 与 API 验证分离。**限制：** 提案审核触发创建 Task/修订 Risk 的遗留路径仍待后续同类迁移；不能据此宣称全域正式命令一体化或项目管理 V2 全部完成。

## ADR-040 · 候选提案与任务进度审核的唯一正式命令（2026-10-15）

**决定：** 将旧 `POST /projects/:id/proposals/:proposalId/decision` 和 `POST /projects/:id/progress/:progressId/decision` 从 API bootstrap 抽离到独立 `approval-routes.ts`，每个命令强制 UUID `idempotencyKey` 并通过 `executePmCommand` 统一当前租户+项目成员权限、行锁、幂等回执、Audit、DomainEvent、Outbox。AI 只是 pending 建议；由 owner/manager 核准，审批接受 task 候选时才写正式 Task，risk 候选才写正式 Risk，已审核候选不得被另一个 key 二次接受。进度审核只记录“建议采纳/驳回”，完成声明**不直接更改 Task.done/Deliverable.accepted**。采纳 blocker 的原有提醒冷却保持不变。

**原子性：** 命令、更新候选 status/reviewedBy、澄清 thread 关闭、正式事项写入、任务 followup 与领域事件审计在同一事务中提交；相同 key 同 payload 重试直接返回回执，不重复创建事项；同 key 不同 payload 409；不同 key 重复决策因 status 已非 pending 而 409。当前两张遗留审批表没有自然 version，故该一次性审核事件的 aggregateVersion 为 1，不能误认为整个 Task 版本。

**取舍：** 为所有现有 UI 审核动作同步添加“同意图稳定 key”，以及测试正式命令事件数量/角色限制/重复行为；旧无 key 路径不再存在。此切片不包含报告发布、成员管理、后续 Playbook 或 AI 自动采纳。

## ADR-041 · 项目负责人写入必须在业务事务内重新鉴权（2026-10-15）

**决定：** 旧路由（成员邀请/角色更改/移除、项目设置、Outbox 死信重试、报告人工生成和发布）原先在事务外使用 owner(await member(...)) 读到角色快照，可能与角色撤销并发。所有这些正式写入改为事务内 lockProjectAccess(db,projectId,actorId)，并按 members.manage、settings.manage、operations.manage、report.manage 等精确权限校验。helper 同时锁住当前项目/组织成员行，权限被降级或撤销后不得提交先前未经正确授权的事务；目标受邀人也需验证有效租户成员。

**安全不变量：** 没有项目及组织成员身份的账号不能执行项目写入；系统管理员身份不替代项目角色；被降级/移除人员的活动任务先转交。写入与审计在同一事务。本补丁修复旧接口并发授权窗口，不宣称所有旧接口都具 CommandReceipt/DomainEvent/Outbox。

## ADR-042 · 对外模型连接的 DNS 锁定与统一出站策略（2026-10-15）

**现状漏洞：** 目录导入前的 DNS 地址检查和真正 fetch 建立 TCP 连接之间还会再解析一次地址；公开域名可能被重绑定到本地网络，结构化推理及连通性探针甚至缺少同样的防私网条件，构成模型密钥与聊天内容潜在泄露路径。

**决定：** 所有运行态模型出站（模型目录、连接探针、结构化抽取、AI 助手与选择性真实模型黄金评测）统一经过模型网络出口。仅允许 HTTPS 公网服务，保留管理员显式选择的 localhost / 127.0.0.1 / ::1 / host.docker.internal 本地模型；HTTP 只允许这些明确本地端点。禁止 URL 用户信息、重定向、代理自动转发、私有/保留网段、无地址或公私混合 DNS。DNS 解析后筛选**整个地址集合**，在实际 socket 的 lookup 回调只返回已验证并锁定的 IP；不能只做易被绕过的先验 DNS 检查。每次请求新建连接，TLS hostname 校验与 SNI 继续使用原域名；严格限制响应字节、请求总超时，错误码不得包含 token、响应正文或地址的隐私路径。

**取舍：** 使用 Node 内建 HTTP(S) 客户端而非不稳定的全局 fetch 自定义 DNS 参数或增加代理/依赖，封装为小型 ModelEgress 模块，不影响给测试注入 fake fetch 的能力。容器/主机级 egress firewall、DNS rebind 下的真实网关测试与厂商兼容性仍属于 P4 生产验收，不能由单元测试代替。管理员若需要其它 RFC1918 地址模型网关，应经受控网络反向代理或显式部署出口策略，不扩展无条件内网白名单。

## ADR-043 · 周报/月报草稿与发布的可追溯版本命令（2026-10-15）

**决定：** 把人工生成和审核发布报告迁入单独 `report-routes.ts`，基于 `executePmCommand` 的事务内项目/组织 owner 授权、UUID `idempotencyKey`、DomainEvent/Outbox/Audit/Receipt；新增报告 `revision`，草稿每次实际重生成递增，发布要求当前 `expectedRevision` 并原子递增 revision、持久化 published_at/published_by。已发布报告内容不可覆盖；同 key 同 payload 重试只重放原报告，同 key 不同 payload 409，不同 key 重复发布 409。人工重新请求已发布周期报告仅返回现有发布快照，不修改内容/时间，并且作为重新请求（而非新生成）留下 Audit 和 receipt。

**范围：** 手工和 Worker `generateReport` 继续共用现有 Snapshot/周期算法；Worker 定时生成首份报告保持单次/并发安全，旧已发布记录无可验证发布时间不补造 `published_at`。新增一份不重写旧 migration 的 016 增量迁移。不会把当前统计快照误当成历史每日事实，本批也不实现逐条证据引用、AI 总结质量验收、报告附件或完整企业级留存。

## ADR-044 · 项目人员管理与项目设置正式命令（2026-10-15）

**问题：** 项目成员邀请/调角色/移除与 AI/提醒项目设置尚留在 API bootstrap，虽已在事务内核验当前 tenant+project owner，但缺少幂等回执、DomainEvent 和 Outbox；设置没有独立的乐观版本，两个浏览器修改会静默相互覆盖；前端缺少项目人员移除入口。

**决定：** 抽取 `project-governance-routes.ts`，对邀请、角色更新、成员移除与项目设置的写入统一使用 `executePmCommand`，由 `members.manage`/`settings.manage` 校验当前 owner 并锁当前组织和项目角色；所有写入强制客户端 UUID `idempotencyKey`，回执、领域事件、Outbox、Audit 与正式业务写入在同一事务。为 projects 添加 `settings_revision` 增量迁移（017），设置修改必须提供 `expectedRevision` 并在事务内以匹配版本的 SQL 更新，避免丢失另一管理员的修改。已提交的相同命令重试返回原回执，不重复更新；同 key 不同 payload 返回 409。

**人员不变量：** 受邀人必须是当前 tenant 成员（`FOR SHARE`），目标项目角色修改/移除在 `FOR UPDATE` 锁下检查；不能改变或移除项目 owner；从项目移除 manager/member/observer 均允许，但任何未完成任务先移交或取消，observer 不能保留未完成任务。已存在成员的第二个邀请命令及未发生实际角色变化的第二个命令应返回 409，而不是生成虚假的“添加/变更”事件。

**AI 安全：** 只更改项目 `ai_enabled` 开关与工作提醒时段；模型、提供商与 API Key 继续只能由系统总管理员配置，执行启用前必须有可用配置。模型权限版本触发器保持有效，关闭 AI 不会自动批准任何候选。**取舍：** 这批不迁移系统管理员配置与 Tenant Governance 的所有写入、不宣称运营端 Outbox 死信重试已经统一命令或全部 P2 完成。

## ADR-045 · Outbox 死信人工重试的幂等恢复命令（2026-10-15）

**现状：** `POST /projects/:id/outbox/:eventId/retry` 已在事务内校验当前项目 owner 权限，但仍直接更新 Outbox 和 Audit，没有统一 CommandReceipt/DomainEvent；一次操作成功、HTTP 响应丢失后，同一操作再次提交返回 409 而不是原成功回执，运维人员无法辨别是否成功。

**决定：** 把 owner-only Outbox 汇总/死信查询与手动重试抽离 `operations-routes.ts`；重试 POST 必须由当前 tenant/project owner 以 UUID `idempotencyKey` 执行 `executePmCommand`（`operations.manage`），对指定项目中仍处于 dead 且未 processed 的 Outbox 行加锁后恢复 attempts=0、dead_at=NULL、claim/token 清空、next_attempt_at=NOW。原业务 Outbox 恢复、Audit、DomainEvent 与新事件 Outbox、持久 Receipt 同事务；同 key 原样重试返回原回执，即使 Worker 已重新处理目标事件；新 key 的重复恢复仍返回 409；不同 payload 同 key 返回 409。重试只能针对某项目自身的 dead-letter，不能重新投递其他项目或已处理事件。

**取舍：** 继续由 PostgreSQL Outbox 的现有 `claimEvents`/fencing/retry/backoff 处理实际业务投递，不另加 Redis/Kafka；恢复行为只重设重试状态，不能借恢复接口修改消息、AI 候选或直接完成人工验收。保留服务器原有权限语义与死信详情脱敏要求。此增量不声称所有租户、项目创建、组织治理命令已经统一，也不代表真实多 Worker 故障注入和生产 Egress 已验收。

**ADR-045 补充：** 为 Outbox 原事件增加 `manual_retry_revision`，默认 0；每次真实 dead→pending 的人工恢复在同一受锁 UPDATE 中 +1，DomainEvent aggregateVersion 使用新恢复版本，命令响应携带 recoveryRevision。相同幂等命令重放不再次增版本；下一次经过 Worker 失败重新 dead 后的新命令使用版本 2、3……。独立增加 migration 018，不改写既有发布迁移。

## ADR-046 · 风险登记簿评估与正式应对闭环（2026-10-15）

**问题：** 原风险登记是仅有 open/resolved 的旧数据结构，AI 候选经人工接受后没有概率、影响、责任人、应对计划与状态变化历史。不能将“发生的 Issue”与“未来可能发生的 Risk”混为一谈；也不能让 AI 无人审核直接关闭正式风险。

**决定：** 在现有 `risks` 中增量增加 `version`、`likelihood`（1–5）、`impact`（1–5）、`owner_id`（允许为空以支持待评估 AI 候选）、`response_plan` 和 `updated_at`。状态为 open→mitigating→resolved，resolved→open 需有人给出原因；open→mitigating 必须已有当前租户及项目内非 observer 的负责人与完整的评估/应对计划；open→resolved 不能跳过正式应对。风险评估与状态命令均强制 `idempotencyKey` 和 `expectedVersion`，通过 `executePmCommand`、`pm.plan` 权限、同事务 `Audit/DomainEvent/Outbox/Receipt`；风险历史 `risk_register_changes` 按 `project_id,risk_id,risk_version` 不可修改记录操作人、旧/新状态与说明，关联采用项目复合 FK。新迁移 019 不能重写既有迁移 checksum。

**统计：** 正在应对的 mitigating 仍是未解决的风险，周/月报的 `open_risks` 源统计应使用 `status<>'resolved'`，不得因为切换状态隐瞒风险。**权限与 AI 边界：** 只有项目 owner/manager 有权正式评估和流转；普通成员/观察者仅阅读，AI 仍只能提出带来源的候选，owner/manager 接受后进入 open 未评估状态，不能自动推进为 resolved。系统管理员权限不替代项目经理角色。已记录的旧风险保持其已有 open/resolved 状态与缺失评估，不凭空补造风险概率、负责人或历史事件。

**范围限制：** 本切片不等于项目级资源平衡、完整成本风险量化、基于历史证据的自动评分或生产环境实际迁移验收；依然需要 P1/P3/P4 门禁。

## ADR-047 · 单项目唯一负责人和原子交接（2026-10-15）

**问题：** 项目 owner 当前不能通过正式管理流程转让，projects.owner_id 和 project_members.role='owner' 也缺少唯一负责人数据库约束。直接把前 owner 降为 manager 会丢掉当前发起者的 members.manage；如果交接成功后 HTTP 响应丢失，现有 executePmCommand 会拒绝他的原命令重放，可能使人员误以为交接失败。

**决定：** 增量 migration 020 为 projects 增加专属 ownership_revision，并在 project_members 上创建每项目仅唯一 owner 的 partial unique index。新 POST /projects/:id/ownership-transfer 要求 {idempotencyKey,expectedRevision,targetUserId}；只能当前项目与租户有效 owner 通过 members.manage 发起。事务内锁 projects 当前 owner/版本和目标成员/租户记录，先将原 owner 变为 manager，再将目标角色变为 owner，最后更新 projects.owner_id 并使 ownership_revision +1；对外始终同一事务提交，Project 始终保留一个负责人。目标必须已有项目及组织成员资格；不得自我移交。

**幂等与权限：** executePmCommand 对 owner 转移专用的 replayAction:'read' 使重试者仍是同一项目有效成员时可取回自己已提交的 Receipt，但第一次执行仍必须在事务内验证 members.manage。这确保降为 manager 的原 owner 能安全获取同一操作结果，而不能发起新的转让；失去项目成员身份则不得再读取回执。

**审计与界面：** Owner 移交与角色变更、project.owner_id/revision、Audit/DomainEvent/Outbox/Receipt 同事务，双向移交版本单调递增；Web 由 owner 选择项目成员并确认转让，交接成功刷新工作台权限视图。不得由 AI 代签，也不改全局模型管理员权限。完整组织治理、生产迁移演练仍另行验收。

## ADR-048 · 项目创建使用租户级幂等回执（2026-10-15）

**问题：** 当前 POST /projects 仅在现有事务内写入 projects、owner membership 和 audit。HTTP 响应丢失后重复创建会生成另一项目，没有幂等键、DomainEvent、Outbox 或正式 CommandReceipt。项目不存在时也无法使用现有 project-scoped executePmCommand 键空间，不能通过虚构 projectId 绕过现有约束。

**决定：** 增量迁移 021 新建 tenant_command_receipts，以 (tenant_id,actor_id,kind,idempotency_key) 唯一键和 canonical payload_sha256 为租户管理员项目创建命令提供可持久重放的入口，项目 ID 在同一事务内生成并回填关联。服务端先校验当前 tenant 管理员及其成员行锁，再 INSERT ... ON CONFLICT DO NOTHING；相同 key+payload 读原 Receipt，不重新生成项目；不同 payload 返回 409；原管理员失去 tenant/admin 权限不得重放或创建。同一事务写入项目、唯一 owner、项目级 command_receipts、DomainEvent、Outbox、audit 和租户级结果；任何一步失败全部回滚。项目级 Receipt 与租户级创建回执共享命令 hash、kind 和 key，前者满足既有领域事件 FK，后者解决项目创建前缺少 projectId 的并发窗口。

**访问安全：** 只有原 actor 当前仍是租户 admin 且仍有项目成员权限才能读取旧创建结果；已删除项目不返回幽灵项目。项目创建沿用既有名称、时区校验与默认关闭 AI，不能通过新流程修改全局模型配置或绕过租户治理。Web 为同一次创建意图保留 UUID，在发生网络失败时用相同请求重试；修改表单意图则使用新 key。不提供无幂等键的兼容路径。

**边界：** 这是组织级命令可靠性基础，为未来组织治理命令提供回执表，但本次只迁移项目创建，不宣称所有 Tenant/Program/Portfolio 创建已经命令化。真实存量库迁移、冷备恢复、旧部署升级及多副本长压测仍属于 #51 发布验收。

## ADR-049 · 已批准变更与实际实施/复核分离（2026-10-15）

**问题：** ChangeRequest 只有 pending→approved/rejected，审批通过不代表新计划真实落地，却缺少实施责任人、后续执行状态、项目聊天原始证据、复核人和不可变实施历史。这会让 AI 或工作台误把“批准”呈现为“完成”。

**决定：** 增量迁移 022 为变更增加 approved→implementing→implemented 的独立生命周期，rejected 保持终止状态。项目 owner/manager 按 pm.plan 从已批准变更启动实施，明确当前组织/项目的非 observer 实施责任人，并填写说明；只有负责人真实发出的本项目 user 消息才能作为实施证据，且时间不早于实际启动时间。项目 owner/manager 按 pm.accept 复核“已实施”，需不同于执行责任人、消息证据 UUID 和人类核验说明。所有状态操作要求 UUID idempotencyKey 与 expectedVersion，经 executePmCommand 在事务内锁当前项目身份与变更行，记录实施/完成时间、责任人/复核人、project-scoped 原始消息引用、append-only project_change_implementation_history、Audit/DomainEvent/Outbox/Receipt。UI 显示实施责任、证据来源及分页历史。

**约束：** 不能在 pending 未批准、rejected 拒绝或已 implemented 的申请上直接开始实施/再次完成；不可跳过实施阶段，不能用 AI 消息或另一个项目消息作证明，不能让执行人批准自己的完成声明。同一次成功命令重放仅返回 Receipt，不能重复状态历史；不同 key 的旧版本 409。旧 approved/rejected 历史保持原状态，不补造实施记录、证据、actor 或时间。原变更审批的申请人与批准人分离规则不变。

**取舍：** implemented 仅表示已按人类证据完成实施并复核，不自动改变既有里程碑、范围基线或历史任务计划；审批的后续计划影响仍需单独的受控基线变更命令。模型不得因为聊天中的完成声明自动修改正式变更。真实多团队工作流、计划 baseline 应用和实体变更对账仍是 #48/#50 的未完成验收。

**ADR-049 补充 · 责任移交：** 变更实施中允许有授权的 owner/manager 以 reassign 命令重新指派当前有效负责人员；实施状态仍保持 implementing，版本 +1、历史 action=reassign，并将 implementation_started_at 更新到这次交接时间，使旧负责人先前的消息不再满足本次证据窗口。成员在 status=implementing 且仍被指派时不能降为 observer 或移出项目，必须先办理正式重新指派。被撤销组织或项目资格的实施负责人亦不能被拿来完成验证。这是防止“旧聊天证据复用”和孤立实施事项的必需约束。

## ADR-050 · PostgreSQL 备份到隔离库的全表恢复核验（2026-10-15）

**问题：** 已有 backup 命令把 pg_dump custom 文件写入受限目录，但 Docker CI 目前仅检查 PGDMP 头和 pg_restore --list，不能证明恢复可行，也无恢复后的表行数或数据一致性证据。

**决定：** 在 Docker 完成应用健康、Web 认证与 Worker 检查后停止 web/api/worker 写入者；以原有备份入口生成私有 custom-format archive，计算源库所有 public 普通表的行数和稳定内容指纹。随机创建单独的 chatpm_restore_drill_* 数据库，使用 pg_restore --exit-on-error --no-owner --no-privileges 真正恢复，并要求源/目标所有表名、行数及数据摘要完全相等且包含应用数据与 schema_migrations。演练后删除**自己创建**的隔离库和私有备份目录，绝不 drop 源库、替换源数据卷或将备份正文打印到 CI log。

**安全边界：** 仅当 CI=true 且显式设置 CHATPM_CI_RESTORE_DRILL=1 才允许运行；业务应用容器未停必须拒绝。新数据库名需随机且以前缀固定，目标创建成功才可删除。所有操作均是 Docker 集成测试，不等于生产数据全量 ETL、跨机器加密冷备、PITR、Windows/Linux 实机重建或任何 RTO/RPO 服务承诺。Issue #51 必须保持开放。

## ADR-051 · 所有组织治理写入口复用租户级命令回执（2026-10-15）

**问题：** 组织成员、角色、部门/项目集/项目组合、项目归属与资源投入的写入已有事务内 tenant admin 鉴权/租户锁/Audit，但 HTTP 重试没有 CommandReceipt。同一请求成功且响应丢失后可能创建第二个 Portfolio/Program/Allocation 或再次更改角色，误导项目资源统计；每次重试还会写多余审计。

**决定：** 复用迁移 021 的 tenant_command_receipts，而不是给组织创建伪造 projectId。组织命令服务 organisationCommand 改为强制 {idempotencyKey,payload} 参数，在现有租户互斥 advisory transaction lock 和 tenant_members FOR UPDATE 的当前管理员验证后，按 (tenantId,actorId,action,key) 原子插入 receipt，SHA256(JSON.stringify(payload)) 判断 key 是否复用给其他输入；成功写入业务状态与 OrganizationAudit 后存储原 result；同 actor/tenant/action/key/payload 的重放只返回旧值，不再次写入或审计；同 key 不同 payload HTTP 409。未提供 UUID key HTTP 400，旧无 key 写路径不再允许。原始成员被撤权后不能用回执绕过组织管理员身份验证；项目 owner 无法代替 tenant admin。所有 8 条治理命令与客户端统一迁移：部门、组合、项目集创建，项目分类，组织成员加入/调角、部门人员、资源投入。

**事实边界：** 部门、组合、项目集不依附单个项目，因此使用租户级持久回执及原有组织级审计，不能冒充项目级 DomainEvent/Outbox。下一阶段若加入独立 tenant domain event + outbox，必须有真正的消费/投递定义；本次不引入空 broker，不宣称 P2 整体完成。项目分类仍是 last-write-wins，此批只保证每个重试意图只执行一次，乐观版本与资源总容量约束属于后续治理。

## ADR-052 · 跨项目资源日容量不超过 100%（2026-10-15）

**问题：** 组织管理员可为同一人员的多项目、多段重叠日期登记百分比投入，已有范围校验只限制单条记录为 1–100%，不保证同一人同一天总投入不超过 100%。项目集、项目组合和部门的资源视图因此可能显示看似合法但无法执行的工作计划。网络重复提交已由 ADR-051 的 tenant receipt 去重，但不同 key 的并发登记仍必须校验累计容量。

**决定：** 新的资源容量领域服务 `resource-allocation.ts` 在组织命令事务内计算**整个租户同一人员**于拟登记日期闭区间每个投入变化边界的最大已有百分比，以 `existingPeak+requestedPercentage<=100` 决定能否加入。边界集合为拟登记开始日和区间内所有已有分配的开始日；投入百分比只在已有分配起止日变动，故无需按日展开整个年份。涵盖跨项目、同项目、相同日期、部分重叠、前一项贯穿请求起始日期和端点接壤（结束日当天仍占用容量），区间完全不重叠可复用 100%。必须在同一事务内使用既有 `organizationCommand` 租户 advisory 互斥锁、当前 tenant admin 行锁和持久 UUID receipt；校验成功后才能写业务行和 OrganizationAudit/Receipt。超额 HTTP 409，不写分配、审计和新回执；同 key 同 payload 成功回放不能重新分配或因后来的真实分配误判为失败。

**权限与数据：** 输入项目、人员必须是当前同一租户、且该人是项目成员；组织内其他项目的分配同样计入，不能通过在多个项目/部门分别登记规避上限。保留旧资源记录且不虚构历史真实工时。当前系统的所有资源分配 API 都经 organizationCommand 全租户互斥，但数据库直接手工改写不在此应用层校验覆盖范围内；未来若增加更新/删除、批量导入或独立 Worker 写资源，必须共享同一容量锁/服务，或升级成数据库触发器/强制约束。此规则是计划投入容量，不代表每人实际考勤或每日工时实测。

**验收：** 真 PostgreSQL API 测试覆盖同人多项目 60+40 成功、60+41 失败、相交边界、完全不重叠、日中重叠、不同人员互不影响、多份不同 key 同时写 60+60 只有一份成功；原 key 重试只返回相同 ID，一次失败可用新合法计划重试；同键不同负载 409，越权和项目成员资格仍拒绝。

## ADR-053 · 组织项目归属分类的乐观并发版本（2026-10-15）

**现状问题：** 组织治理的项目归属 PATCH 已有 tenant admin 权限、租户事务 advisory 锁、幂等回执和 OrganizationAudit，但两个浏览器读到旧值之后可以先后覆盖项目主部门、项目集或直接项目组合，后提交者不知晓别人已修改，导致部门资源及项目组合统计不可信。

**决定：** 新增 migration 023，为 projects 加独立 `classification_revision`（初始 1，严格正整数），不与 `settings_revision`、`ownership_revision` 或 `ai_authorization_version` 混用。结构 GET 返回项目当前分类版本；项目归属 PATCH 强制 `expectedRevision`，在已有组织管理员事务命令内对目标 Project `FOR UPDATE` 锁定并比较版本。成功实际变更时仅对本项目的 department_id/program_id/portfolio_id 和 classification_revision 原子更新+1；失配返回 409，重复同状态的**新命令**也返回 409 而不制造伪更新和 OrganizationAudit。成功原命令沿用 UUID key/payload 的租户 Receipt 重放，不再修改版本。项目不存在返回 404；跨租户目标仍依赖复合 FK 与项目 tenant_id 过滤。项目可独立或关联一个 Program 或直接 Portfolio，不得同时填写 programId 与 portfolioId。

**交互**：组织界面携带当前项目版本，并显示版本；发生冲突后可刷新项目归属表单重新人工确认，不能偷偷覆盖其他管理员的工作。变更意图和版本改变应使用新 key，失败的原 UUID 不产生已提交回执。保持现有项目 owner 移交、AI 开关等版本完全独立，不用自动 AI 回答改项目归属。

**范围限制：** 对已有分类记录只给一个可靠的当前版本，不伪造历史上每次分类调整；未来需要历史事件流可在真正可消费的租户 DomainEvent/Outbox 建成后增量设计。未完成真实 V1→V2 迁移、全局战略组合优化和企业级压力验收。

## ADR-054 · 组织治理命令的无操作拒绝与管理员自降权回执（2026-10-15）

**问题：** 组织成员重复加入、已有成员再次设置相同角色及部门成员重新指派相同身份，当前仍会把没有业务状态变化的请求作为成功变更，写入新的 OrganizationAudit/Receipt。组织 admin 若在有其他管理员时把自己降为 member，成功但响应丢失后现有 admin 检查拒绝原请求重放，操作者无法确认结果。

**决定：** 重复成员邀请、同角色修改、相同部门角色重复指派统一返回 409，且不新建审计与回执；同 key+payload 的已完成操作继续重放成功结果。只对组织角色变更命令开启更窄的 replayAccess='member'：租户 advisory 事务锁和成员行锁依然有效，当前仍是 tenant member 的原 actor 可以读取自己已完成、同 tenant/kind/key/hash 的 Receipt；若尚无该 Receipt，则必须有 admin 权限才允许新 mutation。Role route 前置验证只要求 tenant member，由 organizationCommand 在事务内重新决定新命令权限。失去组织成员身份的人不能读取回执。

**约束：** 必须至少保留一位租户 admin，成员角色修改和最后管理员检查在统一租户 advisory lock 下执行；原 key 不同 payload 409、无 key 400、普通 member 不能发出新的组织管理操作。其它组织命令严格保持 admin 回放要求，不修改全局模型管理员身份。不改既有迁移与 API 的其它契约。

## ADR-055 · 项目设置必须真正变化才增加版本与发出事件（2026-10-15）

**问题：** 项目负责人在 Web 重复点击「保存设置」而 AI 开关、提醒时段与冷却间隔均未发生变化时，旧 settings PATCH 仍在同一事务写入 settings_revision+1，创建 project.settings_changed.v1、DomainEvent、Outbox、Audit/Receipt，并重新计算所有任务 FollowUp。这些既不是实际策略更改，也会错误消耗其他浏览器的设置版本。项目启用 AI 的授权账本须保持其自身真实变化版本。

**决定：** 项目 settings 修改保持当前 tenant/project owner 的 executePmCommand 事务锁与 UUID idempotencyKey/expectedRevision；在锁住 Project 并确认 expectedRevision 仍最新之后，比较 ai_enabled/work_start/work_end/cooldown_hours 全部规范化字段。当新设置与数据库逐项相等时，以 409 拒绝新命令，不插入正式成功 Receipt、Audit、DomainEvent、Outbox，也不重新生成 FollowUp；相同 key/payload 的**已经完成**的真实变更命令继续返回原回执，不再次比较或写入。旧版本的请求仍以版本冲突 409 被拒绝，不把无操作判断作为绕过并发锁的方法。

**Web：** 维护最后一次已确认成功保存的设置快照，只有表单数据不同才启用保存按钮；成功提交后更新设置版本和基线，后续又修改表单形成新意图。其他人修改导致的旧版本冲突仍由服务端返回，用户须刷新并确认。AI 默认模型与密钥仍由总管理员配置，触发器只在 AI enable 标志实际改变时推进 AI 授权版本。没有新增数据库迁移、无兼容无键 POST。

## ADR-065 · 面向所有入口的授权事务与领域数据单一写入权（2026-10-16）

- **决定**：HTTP 用户消息统一交由 Conversation Core 命令，在保存 Message、Outbox 与 Audit 的同一 PostgreSQL 事务中锁定当前 ProjectMember/TenantMember，并验证 message.write。AI 人工审批仍为一个 CommandReceipt，却经 Delivery/Risk Core 写正式 Task/Risk；PM 多登记簿读取在 Core 的 REPEATABLE READ 事务内锁定成员身份。
- **原因**：消除消息权限检查与提交之间的撤权竞态，避免同一领域由 HTTP 与 Core 双重维护 SQL，防止 PM 多表读取快照不一致。
- **不选择**：外部权限服务器、微服务、跨事务嵌套命令、第二套兼容 API。跨聚合 DomainEvent/Receipt 一对一问题另行设计。
- **代价与验收**：同事务的成员行锁会与角色撤销互斥；新增不含正文的 message.created 审计。真实 PostgreSQL 覆盖权限/幂等/撤权，架构守卫拒绝路由直接写业务表。本切片不代表 P1–P4 整体完结、真实模型或生产实机验收。

## ADR-066 · 全局模型管理员写入的事务授权（2026-10-16）

- **决定**：系统 AI Provider/Model 七类创建、更新、删除、导入写入全部使用 Identity Core 的 `systemAdminTransaction(actorId,mutate)`。在同一个 PostgreSQL 事务先锁 `users.is_system_admin` 行并核验其为 true，再保存配置和审计。计费模型测试的数据库冷却预留也复用此事务入口；长期外部模型请求不占用数据库授权锁。
- **原因**：单纯在 Fastify 路由入口调用 `requireSystemAdmin`，无法阻止检查后平台角色被撤销、业务 SQL 后续仍写入的 TOCTOU；应与项目/租户治理采用一致的最新授权检查。
- **权衡与验收**：行级共享锁对管理员变更与撤权串行；模型连通性测试执行期间若发生权限撤销，无法撤回已发往第三方的网络调用，生产出站撤权仍是后续安全工作。真实 PostgreSQL 测试验证撤权锁冲突、撤权后拒绝及审计回滚；静态架构守卫阻止直接在模型 HTTP 路由新开授权外事务。不改变供应商 API 兼容性，不新增双来源权限表。

## ADR-067 · 事务连接单一来源与用户消息意图稳定（2026-10-17）

**决定：** 在 `executePmCommand` 事务内读取模型配置时，将既有 `DbClient` 向下传递；无事务的普通查询可继续使用默认 Pool。模型 URL 语义校验移到单一 Core 策略函数，出站传输仍执行不可绕开的网络安全检查。前端同一消息发送意图的 HTTP 重试复用 nonce，内容/项目改变才创建新 nonce，成功后清空。

**拒绝：** 不靠调大连接池掩盖连接借用缺陷，不移除安全防御层的运行时校验，不仅依赖前端防重而取消服务端唯一约束。

**限制：** 尚未完成全域隐藏 Pool 使用审计、跨浏览器离线队列与真实网络丢包压力测试；此设计切片也不等于生产交付。

## ADR-069 · Task 可恢复归档与单一事实历史（2026-10-17）

**决策与动机。** 归档是正式 Task 生命周期中退出当前工作视图的管理动作，不等于取消或物理删除。为满足保留来源证据、跨项目依赖及已发布报告的要求，选择在现有 `tasks` 增加 `archived_at/archived_by`，用已有 `version`、CommandReceipt/DomainEvent/Outbox/Audit 和 `project_task_history` 记录归档与恢复；不创建第二个 Archive 表、平行审计器、分叉状态机或破坏已发布 migration checksum。使用新增迁移 027 逐步升级。

**授权和并发。** Owner/Manager 执行 `task.plan`，要求期望版本、UUID 幂等键与当前 Tenant+Project 资格；普通执行成员及 Observer 不可归档。仅已完成或已取消且无待审进度的任务可归档；禁止归档任务继续修改/审核进度，恢复不擅自修改原状态或重派人员。重复原命令安全回放；同键异 payload、过期版本或新键重复状态均拒绝。归档停用催办；归档历史可查看并恢复。运行时跨线程争抢时，任务行级锁确保先后版本确定。

**查询口径。** 项目任务列表默认仅返回未归档项，另有显式归档视图。报告中当前任务数量和组合治理快照剔除归档项，并单列已归档计数；任务历史的真实归档/恢复事件与旧报告、证据引用保留。不补造迁移前历史，不自动删除数据。

**取舍。** 暂不引入永久删除（会破坏不可变审计和报告引用）；数据保留/法定删除必须另立受控策略。单页任务列表继续限制 300 项，后续应做数据库稳定分页及大规模归档性能验证。CI 能验证本次代码、PostgreSQL 和前端构建，但不足以替代真实移动端、Win11/QNAP、生产恢复或全量数据迁移验收。


**ADR-069 并发补充：** 仅在 Worker 的 `INSERT ... SELECT archived_at IS NULL` 做检查仍存在 MVCC 竞态。迁移 027 为所有 `task_progress_updates` 插入增加 `BEFORE INSERT` 触发器，先对目标 Task 加 `FOR SHARE` 锁并核验未归档，归档事务对 Task 持 `FOR UPDATE` 且随后检查 pending progress。两条路径互斥，无论顺序如何都不会提交归档后新增的 pending progress。原进度来源、索引和幂等键不变。

## ADR-070 · Outbox 长耗时事件租约续期与过期回写隔离（2026-10-17）

**问题。** 现有 Outbox 单事件领取、5 分钟租约、`claim_token` 和 DB 事务内的 `assertEventClaim(FOR UPDATE)` 能阻止已被重新认领的 Worker 发布旧结果，却不能保持长时间 AI 推理的处理权。超时但尚未被认领的旧 Worker 仍可能调用只验证 token 的 `finishEvent` 或 `failEvent`，错误确认/重新排期一个早已失效的领取。另一个新 Worker 如果确实接管，旧任务继续做外部推理会浪费计算/模型预算，但不得提交结果。

**决策。** 保留单一 PostgreSQL Outbox 与既有五分钟租约，不新增 Kafka/Redis/新表。将领取、最后尝试隔离、权限证明、续租、正常完成及失败退避统一使用 `OUTBOX_LEASE_SECONDS=300`。领取后只在真正调用外部模型的 `runAnalysis` 期间以一分钟节拍执行 `renewEventLease`：更新条件同时要求 project、event、当前 token、未完成、未隔离，且原租约仍有效；绝不恢复已经过期的 claim。事件执行器只能有一个正在进行的 heartbeat SQL；结束时释放 timer 并等待在途 SQL 完成。瞬时数据库故障不转化为授权，所有正式发布依然须在写事务内 `assertEventClaim` 且持有 `FOR UPDATE`。任何租约过期或被新 Worker 改写的旧请求均不得确认完成、失败重试或隔离事件。

**取舍。** 时间更新不会推进 attempts 或制造 DomainEvent/Audit；令牌保持不变，新的 Worker 仍可按过期条件 SKIP LOCKED 接管。续租不能取消已发送到第三方模型的 HTTP 请求，也不是跨进程外部执行 exactly-once 保证。5 分钟 DB 租约的正常 60 秒模型 timeout 足够安全；长耗时/DB 瞬断依赖有界续租和发布时 fencing。真实多 Worker crash/慢模型/网络中断故障注入及主动运维告警仍需继续；不能把本 PR 等同生产队列可靠性验收。

## ADR-071 · Outbox 运维权限的事务一致性（2026-10-17）

现有 Outbox 运维路由先检查权限，再通过独立连接读取统计与死信；在两步之间撤权，可能仍返回不应访问的信息。确定由 Core 统一拥有运维查询和死信恢复，Fastify 只解析身份、UUID 和 DTO。

`operations/outbox-admin.ts` 使用一次 REPEATABLE READ 事务，先锁当前 TenantMember/ProjectMember 并验证 operations.manage，再使用同一连接执行唯一 Outbox 读取 SQL。人工恢复继续由 executePmCommand 负责原子回执、审计、事件及重试版本，不创建另一套命令执行器或业务存储。健康领取不能被人工重置。

真实 PostgreSQL 覆盖 Owner/Observer、跨租户、权限撤销、重复请求、两次真实恢复及版本递增。仍需多实例故障注入、主动告警和生产实机验收。

## ADR-072 · Reporting Core 的授权快照与正式命令所有权（2026-10-17）

**问题。** 现有 `report-routes.ts` 以先查成员权限、后使用另一个 Pool 连接读取 Report 的方式响应 GET；授权撤销可能发生在两个语句之间。POST generate/publish 在 HTTP 路由直接持有 `executePmCommand` 与发布 SQL，导致正式 Reporting 模块有多个写入所有者，与已收敛的 Task/Risk/Approval/Operations Core 边界不一致。

**决定。** Reporting 是 `reports` 与报告快照的唯一事实 owner。增加 `reporting/report-services.ts`：`listProjectReports` 在 REPEATABLE READ 的同一事务内锁住当前 TenantMember/ProjectMember，返回最多 50 条当前项目报告；`requestProjectReport` 和 `publishProjectReport` 复用已有 `executePmCommand` 与现有 `generateReport` 单快照函数。只有项目 Owner 有 `report.manage` 写权限，普通项目成员仍可只读，组织管理员身份不等于跨项目阅读。已发布报告不可修改，版本冲突 409；请求幂等沿用 Receipt，不能产生额外版本/事件。

**取舍。** 保留所有既有 URL、Zod DTO、回应形状、已发布迁移、`reports` 数据和 Worker 定期报告路径；不建兼容层、不引入 Reporting 表镜像、任务外的消息历史推断或新的工作流引擎。此次仍沿用已有 `report.generation_requested.v1` 事件对已发布报告的人工重新生成请求记账语义，未擅改其正式契约。大规模历史分页、报告内容版本化编辑、PDF 导出和真实跨平台实测仍属于后续工作。

**验收。** 同 PR 增加真实 PostgreSQL 对 Owner/Manager/Observer/跨 Tenant、重试、冲突、发布后不可变、撤权和版本化 Receipt/Event 的验证，配合 API Smoke、全套 CI、文档检查；未执行的生产验收不标记完成。
 
## ADR-073 · SSE 只加速持久消息序号而非另建事件事实（2026-10-17）

采用当前 `messages.seq` 和项目级 advisory 提交顺序作为唯一事件游标，不引入第二套投递队列。新增 Conversation Core 当前成员锁定的同事务消息读模型（最近 200 条、`after` 增量、`before` 历史页），Fastify SSE 使用 `Last-Event-ID` / `id: seq`，每轮重检 Session 与 Tenant/Project 授权，失败立即结束流；最多 4 批×100 条、2.5 秒扫描、15 秒 keep-alive、连接/背压清理和进程内用户连接上限。Next `/api` 对流直接转发而不一次性缓冲，Web 持续 EventSource/后台暂停/REST 30 秒对账，支持读取更早历史。任何重连、弱网络丢事件都从持久序号补拉。

此方案适合中小项目，服务器仍为每连接定期查询 DB，不声称已完成多实例广播/大规模连接压测/真实移动设备或反向代理公网验收；未解决 #40 的所有验收前保持开放。

## ADR-074 · 项目只读视图的当前权限一致性（2026-10-17）

**问题。** 项目详情、AI 授权与调用/分析列表、待审核进度与候选的六个 GET 入口先由 HTTP 层执行项目成员查询，再通过另一条连接读取业务内容；在两步之间撤销项目或组织成员资格时，旧角色结果可能放行已失去权限的读取。

**决定。** 继续使用已有 PostgreSQL 和角色授权，不增加缓存、额外角色表或兼容 API。Identity Core 的 `withProjectRead` 在 REPEATABLE READ 事务内锁当前项目和组织成员资格，调用既有 `assertProject` 后使用同一个 DbClient 读取所属领域的业务数据。Project Core 负责项目详情及 Owner 专属 AI 视图，Approval Core 负责进度和候选只读视图，Fastify 只处理身份与 UUID。普通成员和观察者可读项目详情/候选，Owner 通过独立的 `ai.audit.read` 操作才能读取 AI 调用账本，不与 `members.manage` 耦合；不允许借系统管理员或组织管理员身份越过项目成员要求。

**取舍与验收。** 六个现有 URL、原返回字段及 40/60/150/200 上限不变，不引入新的数据源或 Repository 基类。撤权与读取在数据库成员行锁上串行化；不能撤回此前合法完成的已返回数据。真实 PostgreSQL 验证 Owner/Manager/Observer、跨租户与跨项目、实际数据隔离、组织与项目撤权；HTTP 无直接 SQL 的架构断言纳入 CI。其他仍留在 HTTP 层的领域查询、数据迁移与生产实机验收继续按 #49/#51 追踪。

## ADR-075 · PM 历史与导航读取的唯一授权快照（2026-10-17）

**问题与边界。** 问题状态历史、变更实施历史和任务依赖列表仍由 `pm-routes.ts` 先使用 Pool 检查 `tenant_members/project_members`，再用另一个 Pool 查询业务表。鉴权与查询之间的成员撤权窗口和 API 对领域 SQL 的直接所有权违反 #49 的 Core 分工。项目列表 GET 的 SQL 也仍在 HTTP 层，但它本身是一条同时连接当前组织和项目成员的原子查询，无两步鉴权竞态。

**方案。** 不增加表、事件、缓存或平行权限引擎。在 `governance/pm-register-query.ts` 复用已经存在的 `withProjectRead`，使用 REPEATABLE READ + 当前 TenantMember/ProjectMember 行锁 + `read` 动作授权，顺序检查项目内目标记录的存在性并读取同一快照中的历史或依赖。原 PM 六个登记簿也改用同一 helper，避免再次复制授权事务模板。将项目导航查询移至 `project-queries.ts` 的 `listMemberProjects`，单条 SQL 用两层成员关系决定可见项目。历史游标上限为 PostgreSQL int 最大值 2147483647，在 HTTP 和 Core 层都校验，不让溢出转成 500。

**取舍与失败语义。** 保留原有 GET 路径、JSON 字段、依赖条数上限 250、历史 50+1 的 `nextBeforeVersion` 和所有正式写入命令；没有 V1 兼容分支。当前项目成员包括 observer 仍可查看业务历史；非当前成员和跨项目记录 404；无效历史游标 400。读取开始前完成的撤权会被拒绝，并发撤权与已开始读取由数据库行锁序列化，无法追回此前合法返回给客户端的信息。只读访问不创建 CommandReceipt、DomainEvent 或 Outbox。

**验证与后续。** 真实 PostgreSQL 集成测试覆盖 54 条问题状态历史、53 条变更实施历史、翻页与越界值、独立租户/项目、撤权后读取、项目导航隔离；API 静态架构门禁和整体 CI 必须在同一最新 Head 上通过。剩余 PM 正式命令 SQL 仍在 `pm-routes.ts`，应以独立命令所有权迁移继续 #48/#49；多进程故障、真实模型、跨平台设备和 V2 ETL/生产发布不是本变更范围。

## ADR-076 · PM 正式命令的 Core 唯一所有权（2026-10-17）

**问题。** `pm-routes.ts` 原本在 Fastify 入口直接持有八条正式变更的 `executePmCommand` 和 SQL：目标/里程碑/交付物/Issue/Decision/Change 通用创建、交付物改派/提交/验收、Issue 解决与重新打开、变更批准/拒绝、变更实施启动/改派/完成和任务依赖创建。其它领域已将正式写入迁至 Core，PM 路由保留这种模式会使新业务逻辑继续向 HTTP 复制，违反 #48/#49 的单一命令所有者要求。

**决定。** `governance/pm-register-commands.ts` 拥有原固定目录映射、PM 创建 Zod Schema、八个业务 Command Handler 以及所有正式 SQL。每个 Command 仍直接复用原 `executePmCommand`，在当前项目和租户成员权限锁下原子写入领域表、CommandReceipt、Audit、DomainEvent 和 Outbox；不引入替代命令总线、并行审核表、领域中间层或新迁移。Fastify 只做 Cookie/Session 身份解析、UUID/枚举/日期/版本 DTO 解析及委托。

**保持的不变量。** 项目/组织成员撤权保护与角色 `pm.plan`/`pm.submit`/`pm.accept`/`pm.approve` 仍由后端管控；交付物必须由当前责任人提交，独立审核者验收；Issue 状态只能合法切换并留下历史备注；重大 Change 不允许申请人自批，批准不等于实施完成，需不同有效责任人及项目原始消息的实施证据；任务依赖保持项目级锁、跨项目拒绝、循环拒绝和完成前置约束；同一意图的幂等键重放不得产生新事件。人工审核仍不授权 AI 直接更改正式状态。

**取舍与验收。** 当前代码保留完整 REST 路径、状态码、返回结构、事件 kind、数据库字段和历史，且无需历史兼容层。真实 PostgreSQL 直接调用 Core 验证创建、幂等、权限、验收、Issue 历史、依赖环与 Receipt/Event/Audit 原子数量；静态守卫阻止 Fastify 再直接调用 `executePmCommand` 或持有正式 PM SQL。原编译版 API Smoke、Web、native、Docker 和 Security 全套以 PR 最新 Head 验收。并不声称 Owner 模型单源、全域 API/Worker SQL、企业生产迁移及实机环境已经完成。

## ADR-077 · 项目成员、Owner 移交和设置的 Identity Core 所有权（2026-10-17）

**问题。** `project-governance-routes.ts` 仍在 Fastify 层实现成员新增、角色降级、移除、Owner 移交、项目设置的 `executePmCommand` 及领域 SQL；GET /projects/:id/members 先经 pool 授权，再用独立连接读取名单，存在成员/组织撤权窗口。降级为 observer 与移除前的五类有效责任核验各实现一份，改动其中一处可能造成不一致的权限回归。

**决定。** `identity/project-governance.ts` 唯一拥有项目成员及设置读写实现；GET 使用既有 `withProjectRead` REPEATABLE READ + `lockProjectAccess` 的当前组织/项目成员 FOR SHARE 快照；五个写入调用同一 `executePmCommand`，保持 `members.manage/settings.manage` 当前权限、Receipt/Audit/DomainEvent/Outbox 事务、原事件 kind 和 Owner 移交旧负责人只读重放语义。新增 `assertNoActiveResponsibilities`，在目标项目成员行 FOR UPDATE 锁保护下，同一条 SQL 检查未完成 Task、待验收 Deliverable、未取消且未过期资源分配、未关闭 Risk、实施中的 Change；降级/移除复用同一拒绝判定，保留原针对未完成任务的两种操作提示。

**设计取舍。** 不创建抽象基类、双轨接口或平行事实表；仍保留现有 `projects.owner_id/ownership_revision` 及成员 `role='owner'` 的双重存储现状，此问题需要另行统一而非借 HTTP 重构悄悄修改历史数据库。共享责任检查不会把完成的任务或已验收交付物当作悬空任务，历史记录不被物理删除。所有权限最终以 Core + PostgreSQL 当前成员关系为准，组织/项目管理员关系不自动扩大到其它项目。HTTP 只解析 UUID、Zod DTO 和 Session。

**验收。** 真实 PostgreSQL 在 Core 层验证观察者/陌生人/跨租户隔离、名单撤权、成员新增同键回放与 payload 冲突、五类未了责任对降级和删除均阻断、清除责任后状态变更与 Owner 移交、设置更新版本/无效工作时间、旧负责人只能重放原移交，以及每次成功 Command 仅有一条 Receipt/Event/Audit。增加静态边界守卫禁止 HTTP 路由再持有成员业务 SQL。CI 的最终 Head 必须经过 Product/Docs/Native/Docker/Security 全项通过和 /review。

**/review 补充：观察者分配的跨模块竞态。** 检查现有 `resource-allocation.ts` 发现其只验证项目/组织成员存在，没有检查 `pm.role`，造成成员被降级为 observer 后仍能收到新的计划资源。当前在组织资源命令已有的 Tenant advisory 事务锁和 `FOR SHARE OF p,pm,tm` 上补充 `pm.role<>'observer'`，使它和项目身份的行锁序列化，并显式拒绝观察者分配。真实 PostgreSQL 测试在角色降级后由组织命令路径模拟分配并断言 400/无新增有效配置；此处不引入新的容量池或策略缓存。

## ADR-078 · Project Owner 严格单一事实源（2026-10-17）

**问题与权威选择。** 正式项目负责人的 ID 同时存于 `projects.owner_id` 与 `project_members.role='owner'`。移交需在应用代码内依序更新两处，任何绕开 HTTP 的 SQL 都可造成永久漂移；Role 授权和 Owner 身份也会出现分歧。不保留两份数据、触发器自动同步镜像或遗留兼容端点。项目的 Owner 权威记录为 `project_members` 中且仅有一名 `role='owner'` 的有效项目成员；`projects.ownership_revision` 仅是独立乐观并发版本，不包含重复身份。

**一次性严格迁移。** 新增 `028_project_owner_single_authority.sql`；在事务中先验证每个旧项目的 `projects.owner_id` 与 owner 项目成员完全一致；不一致即抛出 `PROJECT_OWNER_MIGRATION_REQUIRES_RECONCILIATION`，终止并回滚整份 migration，**不猜测负责人、不自动修改历史、也不吞掉异构数据**。校验通过后删除 `projects.owner_id`，复用 `020_owner_transfer_revision.sql` 的 `uq_one_owner_per_project` 部分唯一索引保证**最多一名** Owner；新增 PostgreSQL DEFERRABLE INITIALLY DEFERRED 约束触发器，要求每个已存在项目在**提交时至少一名** Owner。这样项目创建可先插项目、再插 owner 成员；负责人移交可先降旧负责人、再升新负责人，并在同一事务提交，任何独立 SQL 导致无 Owner 的提交都会被数据库拒绝。删除项目时忽略随 FK 级联删除的 Owner 行，防止误阻合法卸载。

**读写与并发。** Project Core 的创建命令仍以租户作用域 CommandReceipt 创建项目，在**同一事务**插入唯一 Owner 项目成员、领域事件、审计和 Outbox；返回的 `owner_id` 只是在接口结果里由刚创建的 Owner 成员身份派生，不是第二份数据库字段。详情、导航从 `project_members.role='owner'` JOIN 派生 `owner_id`。移交命令按当前身份行锁 + 项目行锁校验 `ownership_revision`，原子降旧 Owner、升新 Owner、推进版本；保留原事件 kind、幂等回执、旧负责人 `replayAction='read'` 与完整审计。AI、部门、项目集和组合关系不授予隐式 Owner 资格。

**取舍与风险。** PostgreSQL 检查维持两个独立约束（一个部分唯一索引、一个提交时存在性约束），避免镜像列或另外的身份真相。既有安装中如果确实存在不一致旧数据，应先停写、备份，在隔离库人工按正式审计决策修复旧 Owner 成员关系，再重跑迁移；不在迁移里创建伪造权限。被组织撤销成员资格的人可以保留 Owner 历史角色但**所有访问仍由当前 tenant_members + project_members 双重认证拒绝**；完整管理员责任接管流程另行设计，不能靠自动重分配绕过审计。

**验证与门禁。** 真实 PostgreSQL 验证 schema 列已消失、无 Owner 创建失败、直接降级/删除唯一 Owner 失败、第二 Owner 违反索引、一次事务成功移交、并发版本/旧命令重放以及合法级联删除；所有旧测试项目夹具在一条 SQL 中原子建立唯一 Owner，避免无效项目；compiled API smoke + Web build + Windows/Linux/Docker/Security/Docs 最终 Head CI 通过。此切片**不等同** #48 所有 PM 正式领域、#49 Worker 故障、#50 AI 和 #51 实机生产完整验收。

## ADR-079 · 组织治理读写统一归属 Core（2026-10-17）

**问题。** `governance-routes.ts` 仍持有八类组织写入的 `organizationCommand` 回调和领域 SQL，并先由 HTTP `requireTenant` 做权限预检；组织成员和资源分配 GET 同样先在一个 Pool 连接校验租户管理员、再从另一个连接读取。这导致撤权读竞态、重复权限实现和 API 业务增长，与模块化单体中 Core 唯一业务命令所有权原则不符。

**决定。** 将 Department/Portfolio/Program 创建、组织成员加入/角色变更、部门成员分配/改派、资源分配登记/取消这八个现有正式写入移至 `governance/tenant-commands.ts`，继续只调用同一个 `organizationCommand`。保持 Tenant advisory transaction lock、当前组织管理员行锁、`tenant_command_receipts`（含 payload hash）、`organization_audit_entries` 同事务，以及部门/项目/租户复合外键和 `recordResourceAllocation` 的容量核验；不新建命令总线、缓存或其它执行源。HTTP 保留 Session、UUID、Zod、资源日期和组合归属校验及现有接口状态/返回结构；业务权限只通过 Core 当前事务授予，撤权前预检不再被作为凭据。

**读取一致性。** `governance/tenant-queries.ts` 复用同一个 `withTenantAdminRead`，对 GET members / allocations 开启 REPEATABLE READ，并锁定当前租户管理员成员行 `FOR SHARE`；对象读取在同一 DbClient/快照完成。非管理员、被撤销组织成员或跨租户 ID 不会泄露姓名、邮箱、日期或分配信息。其它已在 Core 的 `getTenantStructure` 与 `getGovernancePulse` 保持原独立作用域及读取安全。

**权限和并发边界。** 组织管理员自降级/他降级保留已有“至少一名管理员”规则，唯一成功的角色变更可在本人降为普通成员后凭相同 idempotencyKey **仅重放已完成回执**；新命令依旧拒绝。资源容量按日期边界、跨项目 100% 上限、非 observer 项目成员、项目/租户作用域与组织命令串行化进行校验，删除历史分配仅标取消，不能覆盖历史来源。

**验证与遗留范围。** 静态架构守卫禁止 Fastify 组织路由直接持有业务 SQL 或 `organizationCommand`；真实 PostgreSQL 覆盖管理员可见性、跨租户禁止、部门与组合/项目集及 FK、成员加入、部门责任、资源超配/取消、组织角色降级及最后管理员保护、回执重放/冲突与审计数量；最新 Head 五项 CI 成功后才合并。不代表 #49 其它 API/Worker 或 #43 PMP 收益治理、#39 实网安全、#51 实机发布已完成。

## ADR-080 · Worker 按执行通道独立健康度与诊断告警（2026-10-17）

**缺陷。** 独立的 events/reminders/reports Worker 执行通道原本都更新同一条 `worker_health(name='default')`。只要提醒通道成功，last_success_at 即刷新，导致 Outbox/AI 通道持续失败、报告通道长时间没有成功时，`doctor` 仍可能返回 healthy。运维信号与实际执行所有权不一致，掩盖了关键告警。

**唯一状态源。** 使用现有 PostgreSQL `worker_health` 表，新增不可回退迁移 `029_worker_lane_health.sql`，删除旧 default 遥测记录并将 name CHECK 约束改为 `events|reminders|reports`。不增建第二套健康表，也不保留 default 兼容写入。每条通道完成一次实际 tick 时独立写入 last_seen_at/last_success_at/last_failure_at；成功不会清除历史失败时间，诊断时通过最后成功/失败先后决定是否仍有当前故障。事务和 Worker 业务效果不依赖健康写入成功；即使 DB 遥测失败也只产生脱敏告警，不改变正式业务状态。

**诊断策略。** 唯一可执行阈值规则存放 `tools/ops/doctor.mjs`：events/reminders 最后心跳 180 秒、成功 300 秒，reports 最后心跳/成功 900 秒（报告扫描计划约每 300 秒）。缺失任意通道行、最近 tick 失败、成功过期、心跳过期均输出机器可解析的明确 lane 告警码，并将 doctor 进程置非零退出码。原 Outbox 逾期、死信、API、DB/迁移检测保持。Linux 沿用已存在的 `chatpm-doctor.timer` 5 分钟检测；Windows 新增 LocalService 低权限 `install-doctor-task.ps1` 同频执行。该任务本身只写诊断退出码/操作系统日志，**不会自动向邮箱、IM 或公网 webhook 发送通知**，需要企业监控对非零检查结果及任务长期未运行单独建立通知路由/升级策略。

**理由与边界。** 保留 API/Worker/Web 三进程和单 PostgreSQL；不将告警写成聊天消息/AI 候选、也不在内网 Worker 随机调用未验证的公网 webhook（避免凭据泄漏与 SSRF）。故障注入测试验证一条通道失败、另外两条成功不再掩盖故障；成功恢复、陈旧心跳、缺失记录、数据库 CHECK 和 CLI 规则各自可复现。通道遥测不是 per-pod 活跃探针；多实例/模型上游网络真实超时、外部 PagerDuty/邮件/IM 送达、通知去重升级、压测 SLA 仍需独立 #4/#49/#51 验收。

## ADR-081 · 账户身份与租户导航统一归属 Identity Core（2026-10-17）

**问题。** Fastify `server.ts` 在路由直接写账户创建、密码验证、注册状态、用户个人信息和组织列表 SQL；此前项目、组织治理已经各归 Core，身份根命令仍留在 HTTP 入口，形成模块边界例外，权限与注册逻辑容易被后续路由复制。

**选择。** 新建单一 `identity/account-services.ts`，负责 `getRegistrationStatus`、`registerAccount`、`authenticateAccount`、`getAccountProfile`、`listAccountTenants`。注册命令保持 `enforceRegistration` 的唯一 bootstrap PostgreSQL advisory transaction lock，按现有 `REGISTRATION_MODE` 和部署者单一 `BOOTSTRAP_TOKEN` 规则执行；User、Tenant、TenantMember(admin) 在同一事务插入，任何用户名冲突回滚全部。核心密码 hash/verify 继续使用既有 `security.ts`；不新建重复凭据存储、不持久化明文、不将注册秘钥返回客户端。登录返回 id/email/display_name，不回传 password_hash；系统管理员状态在用户记录的同一次读取里获得；租户导航按当前 `tenant_members.user_id` 实时查询，不给跨租户用户缓存身份许可。

**HTTP 边界与取舍。** Fastify 仅负责 Zod DTO、Cookie 设定、会话验证、Origin 与原速率限制；无需改变已有 URL、状态码或公开 response shape。创建 Session/登出仍调用现有 `security.ts`，不在本次引入认证微服务、第二个 RBAC、额外登录缓存、后门注册模式或旧接口兼容层。保留现有账户创建“新用户自动有自己组织”的 open/bootstrap 策略；生产默认 bootstrap、首次创建后关闭，额外人员需经过邀请闭环。跨组织项目成员资格/系统管理员的正式写操作仍由当前 DB 事务授权；个人资料仅 UI 信号，不构成管理员命令许可。

**测试。** 真实 PostgreSQL 验证原子注册、密码哈希与正确/错误登录、重复邮箱不可创建第二租户、个人总管理员身份当前值、跨租户不可导航、组织成员撤销即时隐藏及后续改角色恢复可见；现有 bootstrap 并发测试、HTTP Auth/Cookie/CSRF/注册限流/邀请、Docker 与原生构建保留。静态守卫禁止 HTTP 账户路由恢复业务 SQL、hash 与注册事务。剩余 #49 其它 API 模块边界、系统强密码/多因素认证、正式生产环境安全与性能验收另行处理，不在本 PR 假定全部完成。

## ADR-082 · Docker 本地模型网关的明确 IP 信任锚（2026-10-17）

**安全缺陷。** 既有 ADR-042 已实施全部 DNS A/AAAA 结果校验、校验后连接绑定、TLS 原域名校验、重定向拒绝、非代理传输、响应字节上限。审核发现一个信任边界例外：`host.docker.internal` 的解析只要落在任意 RFC1918 或 ULA 地址便被接受。若管理员保存了此本地模型别名，恶意或被劫持的 DNS 首次应答可指向另一台内网主机（甚至同一个 172.16/12 网段中的不同 IP）；虽然 socket 固定于该应答 IP，没有第二次 DNS rebinding，**连接目标却可能从第一跳就不是真正网关**。公开部署不能将“私网”当作可信服务身份。

**单源选择。** 仍使用唯一 `model-egress.ts` 传输实现，不增加另一个 HTTP 客户端或兼容分支。仅对 `host.docker.internal` 引入部署者显式设置的 `MODEL_DOCKER_GATEWAY_IPS`：1–4 个逗号分隔的 IP 字面值，必须属于现有 Docker 网关可接受的 RFC1918/ULA 集合；未设置、为空、格式错误、包含公网/回环/元数据/链路本地或 DNS 回答中包含任何名单外 IP 均 fail closed。先拒绝缺少信任锚的配置、再做 DNS；解析每个 A/AAAA 的地址家族必须与内容一致。允许名单通过 Node `BlockList.addAddress/check` 精确匹配数值地址（包括 IPv6 标准写法），不是子网放行。HTTP(S) 真正连接依然仅使用本次安全验证的固定解析 IP，禁止重定向和代理、TLS SNI 仍用原 hostname。

**部署与失败原则。** Docker API/Worker 都通过 Compose 显式映射 `host.docker.internal:host-gateway`，接收部署者提供的同一 `MODEL_DOCKER_GATEWAY_IPS`；默认空值意味着云端模型、显式 localhost 不受影响，但 Docker host 模型在没有网关 IP 审查与配置前拒绝请求。需管理员从实际容器查询该别名的 A/AAAA，验证它确属预期 Docker 宿主机网关，然后在受保护 .env 设置确切 IP；Docker 网络重建或 IP 变化后必须重新审核，绝不自动学习并信任新私网地址。测试涵盖无 PIN、同网段恶意私网 IP、混合 A/AAAA、映射 IPv4、族别伪造、无效 allowlist、正常显式网关、原有公网限制与真实本地 socket 拒绝跳转/超大响应。

**安全边界。** 这只解决应用内 Docker 网关别名冒用，不证明实际 Docker 引擎/QNAP/Windows host-gateway 语义、宿主机端口权限、外部 egress 防火墙、恶意 DNS/代理基础设施、HTTPS/TLS 网络攻防与供应商日志合规；#39、#41、#51 保留开放直到真实公网/IPv6/模型流量/注册邀请/密钥泄漏与宿主机网络隔离验收。模型始终只能由系统总管理员配置，聊天内容不得指定 URL。

## ADR-083 · 租户邀请名单与组织敏感查询统一的事务授权（2026-10-17）

**发现问题。** 邀请管理 GET `/tenants/:tenantId/invitations` 曾在 Fastify 路由中先调用 `requireTenant(...,true)`，随后另取一个数据库连接查询 `tenant_invitations` 并返回邮箱、邀请/过期/接受/撤销时间。这存在当前组织管理员身份被撤销后、旧预校验与后续 SQL 读取交叉的 TOCTOU 窗口，且与 ADR-079 的组织人员/资源敏感读取重复实现管理员校验。邀请邮箱是组织敏感信息，不应以 UI 当下看到按钮或过去的角色作为读取许可。

**决策。** 将原 `governance/tenant-queries.ts` 内的 `withTenantAdminRead` 迁到唯一的 `identity/tenant-admin-read.ts`，由租户成员事实 `tenant_members(role='admin')` 执行统一授权：同一 PostgreSQL REPEATABLE READ 事务查询并 `FOR SHARE` 锁住管理员行，然后使用相同 DbClient 读取目标租户的敏感记录。邀请列表查询实现于唯一的 `identity/invitations.ts`，仅输出既有 `id/email/created_at/expires_at/accepted_at/revoked_at` 字段，不增加 token、token_sha256 或可恢复凭证；原组织成员和资源查询复用此同一个助手，**不存在第二套授权缓存或重复的查询前校验**。路由只做 Session、UUID、Zod 及 Core 服务调用；创建/撤销仍由原 `organizationCommand` 在含 tenant advisory lock、当前管理员行锁及同事务审计/幂等回执下授权，不依赖 Fastify 提前做的 `requireTenant`。

**并发与失败语义。** 管理员降级事务和包含邀请邮箱的读取通过行锁序列化。若 READ REPEATABLE 快照与并发更新冲突，可在 PostgreSQL 返回 `40001`（服务端拒绝本次请求，不返回名单），或在看到最新角色后返回 403；不得把这类异常降级为成功空名单或重试时使用旧权限。完成降级后所有名单读取、发起邀请和撤销请求均必须拒绝。原邀请码使用 32B 随机 token，数据库仅保存 SHA-256 digest，现有签发/单次接受/过期/撤销/重发逻辑、JWT 会话及审计保持不变。

**验证。** 实际 PostgreSQL 集成覆盖管理员可见、普通成员 403、跨组织 403、名单不包含 digest/明文 token、管理员行被其他事务锁住时读取不能越过撤权、撤权后读写请求拒绝；原邀约一次性领取/重放/并发验收继续运行，静态架构守卫禁止在邀请 HTTP 路由恢复 `pool.query` 和 `requireTenant` 权限预检。五组 PR 最新 Head CI 全绿、零未解决审查线程、主干无漂移才可合并；不代表 #39 的公众防滥用、真实公网邀请安全、邮件送达、QNAP/IPv6 实机部署已经完成。
