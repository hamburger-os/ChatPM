# 工程不变量（供 AI）

- **事实源**：正式项目任务、风险、决定只从 PostgreSQL 领域记录读取；聊天、LLM 预测和向量召回不是正式完成状态。
- **候选状态**：提取建议带来源消息/文档版本、模型与 Prompt 版本、置信度、明确陈述/推断标志和批准状态。
- **变更授权**：高影响动作须人工确认，普通低风险自动动作由显式租户策略决定，所有工具调用都强制 RBAC。
- **事务**：正式状态更新 + Audit + Outbox 同事务；消费至少一次，使用 event_id/业务键去重；处理失败可重试、可隔离。
- **并发**：任务聚合 version 乐观锁；审批旧版本冲突时重评，不可悄悄覆盖。
- **消息**：同项目消息的事务提交顺序必须与 `seq` 相同，所有写入走共享消息命令并获取项目 advisory transaction lock；房间内部有顺序标识；外部输入以 source_id 去重；删除采用策略化保留/脱敏，引用仍遵从访问权限。
- **主动任务**：任务编辑不得重置已发送提醒的冷却窗口；FollowUpPlan 持久化，发送前复查任务版本、时区、静默窗口、节假日、退避及审批结果，防止重复提醒。
- **报告**：全量统计与有限明细由单次 SQL 快照取得，草稿可重算、已发布正文不可变；记录截点、事实源和证据链接；未知字段显式留空，不虚构完成率。
- **安全**：群聊、附件、检索全部视为非可信；提示注入不得突破后端权限。
- **观测**：队列滞留、重复提醒、无效抽取、审批耗时、模型错误和费用可计量。
- **测试**：最小需要并发覆盖、重复事件、越权、多租户、消息重放、模型异常、夏令时和失败恢复用例。

## MVP 守则增补
- Outbox 已具备 UUID 领取令牌、重试退避、隔离与项目负责人手动重放；候选已记录模型/Prompt 版本。生产前仍要补主动告警、审计覆盖与恢复演练。
- 内建项目授权与会话 Cookie、Origin 校验、请求限速并不构成生产安全认证。
- 生成的报告只代表执行时的当前任务/风险状态，不应宣称历史周期完成率。
- 群聊消息目前按项目 `seq` 游标每 5 秒增量轮询（首次最近 200 条）；任务等其余资源仍定时刷新。后续推送必须保留顺序与权限校验。

## 关键不变量
- Outbox 最多八次交付、租约五分钟；逾期的最终尝试必须隔离，失败只保存脱敏代码，重放受项目 owner 授权和审计。
- AI 模型请求先原子预留项目 UTC 日额度；触顶延期次日，不能静默丢事件。
- 澄清回复必须引用同项目仍待确认候选 UUID，保存消息、模型和 Prompt 版本，不自动写正式任务。
- SQL 迁移校验和不可更改；校验和表与执行由数据库互斥锁保护。
- CI 覆盖真实数据库重试、崩溃租约、重放权限与候选审批，生产恢复测试仍未完成。

## 身份、租户与提醒不变量

- 项目创建需显式指定有管理员身份的 Tenant ID，禁止隐式选择第一个租户。
- 登录 JWT 包含 JTI，服务端 sessions 表决定有效性；退出时撤销当前会话。
- 撤销项目成员后，全部项目读取/写入入口必须立即拒绝访问；Owner 不可通过普通成员移除命令被删除。
- 业务关系必须在数据库中保证项目归属一致；不能只依靠 AI 输出或路由校验。
- 未在工作时间内成功投递的提醒不消耗冷却间隔，下一次检查必须在最近合法工作窗口。
- 不识别的 Outbox 事件类型不允许静默确认完成；应走明确失败和隔离路径。

## 跨平台部署实现约束

- API 和 Worker 使用 TypeScript 编译后的 JS 运行，SQL migration 随构建产物一起交付；不能依赖开发态 tsx watch。
- Web 浏览器固定使用同源 `/api`；服务器内部 `API_INTERNAL_URL` 是可信配置而非客户端参数。转发身份 Cookie、Origin，不转发任意上游 URL。
- 生产配置启动时校验，必须提供数据库配置和非示例 SESSION_SECRET；公网须 HTTPS。
- Windows / Linux 原生服务、Docker Compose 必须运行相同数据库迁移及业务代码。升级先备份、迁移后启动。
- Worker 只补偿本周和本月当前状态报告，不虚构停机期间已过的周期快照；停止信号等待当前 tick 结束。
- 跨平台编译和测试不等于 Windows Service、TLS 或数据库恢复的实际验收。


## 一键部署与进程管理不变量

- `tools/ops/run.mjs` 只负责本机**前台**三个子进程的统一运行；意外退出时组内故障显式可见，并向其他进程发出终止信号。不得用于声称已具备后台守护、滚动更新、故障隔离或开机自启。
- `tools/ops/deploy.mjs` 依赖已安装的 Docker Compose；首次安装生成独立随机 SESSION_SECRET 与 POSTGRES_PASSWORD，不输出密钥，不重写用户已设置的秘密，重复运行保持幂等。
- 原生迁移与编译通过 `npm run setup:native` 统一执行；PostgreSQL 配置必须预先有效，不能在失败后静默创建或删除已有数据库。
- Linux systemd 三服务统一读取 `/opt/chatpm/.env`，Windows WinSW 使用根目录 `.env`。秘密文件只授权服务运行账户读取；Windows WinSW 显式使用 LocalService；文件 ACL、服务恢复及权限边界仍需实机验收，不能视为已通过。
- CI 覆盖 Docker 配置的秘密生成、重复执行、已有设置保护以及 Windows/Linux Node 入口语法；Docker 服务自启和原生服务实际故障恢复需要另外在目标系统验证。

## 运维健康、备份、恢复的非业务边界（ADR-018）

- 新 SQL `004_worker_health.sql` 创建单行健康状态。Worker 每次完整 tick 后记录存活、最后成功和最后失败时间；维护脚本只读这些遥测和 Outbox，不借此变更正式任务、模型审批或成员权限。
- `tools/ops/doctor.mjs` 为**本机 CLI**，不向未授权的 Web HTTP 路由开放数据库/队列内部状态；失败用非零退出码连接外部监控。超过 3 分钟无心跳、5 分钟没有成功 tick、积压事件延迟大于 10 分钟或存在死信都为诊断异常，阈值需实测调优。
- `tools/ops/backup.mjs` 每次使用唯一文件名、独立私有临时文件、成功后原子更名；仅对匹配名称的本工具归档应用保留策略，失败不得删历史备份。custom-format 签名检查不是数据可恢复性证明。
- Docker `--docker` 使用容器内 `pg_dump`；原生从受限环境读 DB 凭证。系统定时任务使用低权限主体，DB 密码不得出现在任务计划命令或日志中。
- 数据库迁移保持 checksum 不可更改与单调执行。故障恢复只能在停止在线写入、目标环境隔离和明确确认后进行。CI 不得伪称为 Win11/Linux 服务实机验收或 PITR/加密异地恢复。


## 升级和发行约束

- `upgrade:native` 必须先显式确认全部服务已停，并在数据库操作前生成私有备份；若备份失败，禁止执行 `npm ci` 或数据库迁移。迁移失败后不得自动重启服务或声称 rollback 完成。
- 发布的 CI Artifact 不携带实际 `.env`、数据库、云端模型凭证；其运行依赖、版本及需要的操作应在中英文文档明确说明。未实测的安装器签名、系统级升级和卸载不能标识为完成。


## PR 审查修复的跨平台不变量

- 有数据库卷而缺失原数据库密钥时，一键部署**必须失败关闭**；不能因为 `.env` 丢失就生成新凭证并导致数据库无法访问。
- Compose 使用显式根 `.env`；Node 单终端入口显式将根环境注入 Next Web 代理，`API_INTERNAL_URL` 不得因工作目录差异悄然失效。
- Windows 下不能依赖 `SIGTERM` 优雅停止 Node Worker；前台进程管理器必须通过 IPC 通知 Worker 排空，并在完成后断开 IPC；超时停止需公开限制。

## 双协议模型传输不变量（ADR-019）

- 只读部署级可信 LLM URL，不接收来自聊天内容、浏览器和非管理员成员的目标 URL；外部必须 HTTPS，本机开发 HTTP 明确限于回环和内部宿主别名。Key 不流向 Web，也不进入日志、Outbox 或异常输出。
- Responses API 使用 `text.format=json_schema`，Chat Completions 使用 `response_format=json_object` 并且系统提示包含预期 JSON Schema；两种格式的结果都必须交给 Zod 校验。HTTP 异常、截断、空 JSON、拒答和 JSON 解析失败均安全失败。
- 依然必须先按项目预留日调用次数、在明确 Owner 启用后运行、只保存候选与来源，由有权限用户审核。真实模型 API 质量、隐私和 Token 费用需独立实测。

**review 修复**：AI 开启校验必须与 Worker 的 LLM 配置一致；禁止 fetch 自动跟随上游重定向以避免携带聊天数据的 POST 跨地址发送。记录不含机密的提供商/协议/端点指纹，保证模型名称相同、配置不同的项目建议在审计中可追踪。

## 停止命令安全约束（ADR-020）

- 私有运行状态文件加入 gitignore，原子独占创建、包含随机能力令牌，TCP 控制只监听 `127.0.0.1`；错误凭证、不同项目或第二个运行管理器不能停止当前实例。
- `npm run stop` 仅使用管理器控制通道，状态文件里的 PID 不能被用于 kill；若通道不可达且 PID 存在，立即失败，不猜测归属。仅确认 PID 不存在时可清理残留状态文件。
- `Ctrl+C` 与跨终端 stop 共用原有关闭过程，Worker Windows IPC 优雅退出；对 PostgreSQL、Docker、系统级 Windows/Linux 服务及不受管理的 Node.js 无影响。
- `npm ci` 依赖安装失败、病毒扫描文件占用和已由旧启动脚本启动的进程不由该管理器接管。Windows 本机测试仍需验证特殊终止情况。

## ADR-021 安全和验收边界

- 项目模型端点只准固定预置 OpenAI/DeepSeek HTTPS，或可信部署管理员的服务器 LLM URL；不让项目成员注入任意 IP/URL。Key 使用 AEAD 密文保存，只有 API/Worker 能读出，不能出现在客户端响应、审计或日志。
- 模型测试采用非敏感静态 prompt；Owner + 每项目 30 秒限频，不能借模型测试绕过权限或泄露项目资料。密钥更换和模型参数修改必须审计。
- 长对话遵循正式事实不可覆盖、消息按项目授权、输入预算有界；自然语言澄清只在唯一、最近的相关待问事项及明确补充意图成立时自动匹配，多线程不默默猜测。
- 对每条 AI 启用消息保留明确状态和失败码，避免静默；出站失败仍按既有 Outbox 重试/死信约束。 `@AI` 只读聊天必须保留原始消息来源和跨项目隔离。
- 前端「AI」与规则式提醒独立，不允许修改/关闭 AI 时悄悄修改提醒；发送按钮必须最小宽度和单行文本。真实 DeepSeek、Windows 11 UI/时间行为、网络错误及备份/密钥轮换尚须实机验证。

## ADR-022 工程质量约束

- 模型可以从可信项目上下文提议进度证据，但任务关系必须严格属于该项目且不能指向已完成/取消任务；进度证据未经过 Owner 审查前不得修改任务状态。所有接受/拒绝必须事务与审计关联。
- DATE 期限不能使用浏览器随机的分钟或服务器本地时间决定是否逾期；比较必须在项目 `timezone` 的日历日上进行。旧 TIMESTAMPTZ 一次性迁移时必须按项目原时区取日历日期，保留实际审计时间。
- 模型输出必须经过 Schema 和 Zod；不可信日期字符串缺少完整时间/时区时保留为待澄清，不凭 AI 猜测。确定性 Zod `MODEL_SCHEMA` 错误在该次消费立即隔离，避免八次重复计费；跨网络可恢复错误仍保留指数重试。
- DeepSeek 能力字段基于官方协议区分 `reasoning.effort` 与 `reasoning_effort`；Chat Completions 不允许固定 6500 字符偷偷截断，输入预算仍为字符不是 Token；需实机评估实际模型成本和可靠性。
- 站内催办既遵守发送冷却和时区，也可从阶段检查及阻塞信号提前提醒。页面滚动容器必须设置 `min-height:0`，邀请按钮不可折行；中文 IME 组合输入不能触发发送。

## 2026-10-15 · 权限、资源与后台工作通道契约

- 正式 ChangeRequest 审批开放给具有 `pm.approve` 的当前项目 owner 或 manager，但绝不允许 `created_by` 同人自审。单一负责人没有其他合资格成员时，应提示先指定独立复核人，不能自动降级为自批。
- 经 Next.js 代理的登录/注册请求以规范化邮箱 HMAC 作为独立限流桶；挂载在 Fastify preHandler 以读取解析后的 body。缺失/无效的账号输入退回所见 IP。不要把未经验证的 `X-Forwarded-For` 当可信客户端身份。公网应另有来源级和全局防滥用层。
- Worker 以 events、reminders、reports 三个独立 single-flight 通道安排工作，任何 AI 重试/超时都不得停止规则提醒或周期报告调度；关闭进程时等待全部正在执行的通道结束。
- 受控模型调用返回对应 `ai_authorization_version`，将 AI 回复、提案、进展和澄清消息正式发布前，都必须在同一事务中 `SELECT ... FOR SHARE` 检查项目 `ai_enabled` 与版本；版本已变化应抛出 `AI_AUTHORIZATION_CHANGED`，禁止旧授权产物写入业务记录。
- 任何需要正式提交的 Deliverable 只允许有效的 owner/manager/member 负责人，不允许 observer。项目成员撤权或降为 observer 前必须检查未验收交付物与未取消且 end_date 未过去的资源分配。组织管理员取消分配时保留历史行、幂等回执和组织审计；容量汇总过滤已取消行。
- 这些代码合同需要单元、数据库集成、完整 Smoke 和跨平台真实环境验证。不得将静态架构检查宣称为生产级高并发、隐私或安全验收。

## ADR-062 · 模型网络出站安全细化

- 模型终端必须由系统总管理员管理。公网端点只允许 HTTPS 且全量 A/AAAA 结果中任意私有、保留、映射私网目标均拒绝；实际 Socket lookup 固定已验证结果，不能再次解析和跟随重定向。
- `localhost` 例外只接受回环地址，`host.docker.internal` 例外只接受 10/8、172.16/12、192.168/16 和 ULA fc00::/7，不能信任任意「private」结果，尤其不得允许链接本地地址、云元数据、CGNAT、IPv4-mapped metadata、公网 DNS 污染或 NAT64 reserved 地址。
- `secureModelFetch` 只接受 `Authorization`、`Content-Type`、`Accept` 业务头；禁止 Host/Proxy-Authorization/Forwarded/Content-Length/Transfer-Encoding/Connection 等控制头以及任何调用方自定义头，避免代理绕过和 HTTP framing 混淆。
- Docker Host 网关的受信任性需要部署端明确控制 DNS 与出站防火墙。纯 Node 单元测试与 CI 不能替代真实 IPv6/DNS64/QNAP 生产验证。

## ADR-063 · 组织结构读模型授权边界

- 组织结构路由只做 UUID 输入与身份解析，查询表的所有权在 `core/governance/structure-query.ts`；禁止在 HTTP route 中恢复重复的 `pool.query` 和事后 tenant role 判断。
- 读事务必须先验证当前 TenantMember 并锁定行，再以同一事务快照读取部门、项目集、组合和项目归属；普通成员只可看明确授予 ProjectMember 的项目分类，读期间持有对应 membership SHARE 锁。
- 组织人员关系不等价于项目成员权限；管理员可作组织治理查看并不因此可以访问所有项目消息。真实 PostgreSQL 测试覆盖跨租户拒绝、项目撤权、组织撤权。此改动不能当作其他 API/Worker 领域读写收敛已经完成。

## ADR-064 · 项目结构命令唯一写入口

项目的主责/参与部门、Program/Portfolio 分类必须通过 Core `changeProjectClassification` 完成，并复用组织级事务幂等、权限和审计机制。所有候选调用（HTTP、Worker 或未来自动化）都不得绕过命令服务直接 `UPDATE projects` 或 `DELETE/INSERT project_departments`；既有主责/参与互斥、不可重复、版本乐观锁、跨租户复合外键为一致的业务不变量。正式分类和治理资料不能因模型聊天建议而自动改变。此约束仅覆盖分类命令，其它 API 路由迁移仍需独立实施与验证。

## ADR-065 · AI 结果必须持有效 Outbox 租约提交

- 任何来自 Worker 的 AI 正式可见写入（消息、建议、进展线索、澄清、运行状态）必须先在**同一 PostgreSQL 事务**调用 `assertEventClaim(db,event)`，并持有匹配事件 id/project/token 的 FOR UPDATE 行锁直到副作用 COMMIT。过期、已重新领取、已处理或死信 token 一律拒绝，不能借当前项目 AI 开启状态绕过。
- 完整 AI 授权版本检查与 Outbox 令牌检查缺一不可；失去 Outbox 租约的 Worker 不得写运行结果、失败状态、重新排队或死信。第三方模型已收到的 Prompt 不能因 Worker 取消而撤回，实际隐私防护仍在发送前执行。
- Worker 不得提前领取大量长时间模型调用的事件，必须 just-in-time 单条 claim，并保留已经实现的独立 AI/提醒/报告 lane。
- 真实数据库锁/租约测试和静态入口测试不能替代多实例 Worker 同时运行、网络分区、模型长尾延迟和真实关停/重启故障演练。

## ADR-066 · Core Task 命令唯一写入口

- 正式 Task 创建与更新只能通过 Core `createTask/updateTask`，HTTP/Worker 不得绕过当前 Project/Tenant 授权、依赖完成规则、有效负责人和 `executePmCommand` 事务写表。Task 状态、任务计划、FollowUp 与 TaskHistory 的事实必须同源。
- 只有 status、title、assignee 或 due_date **至少一个发生实际变化** 才创建新的版本、CommandReceipt、DomainEvent、审计、Outbox 与任务历史；新幂等键但完全无变化的调用 409 并完整回滚。完全相同的已完成命令仍按原 key+payload 回放。
- 任务计划编辑与任务状态编辑分别沿用 Role/action 校验，未审 AI 提议不能绕过 Core 写任务。此次仅迁移 Task 的创建更新写入口，不可将其冒称为完整 PM Domain Runtime 的迁移完成。
