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
