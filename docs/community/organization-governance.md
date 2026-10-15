# 组织与系统 AI 管理 / Organization and AI Administration

[中文](#中文) · [English](#english)

## 中文

### 组织与项目层级
组织管理员可以在工作台的「组织管理」中建立部门、项目集、项目组合，给项目指定主部门及项目集或直属组合。部门管理人员与资源，不与项目集或组合等同。一个人员可加入多个项目，项目聊天仍按项目成员授权。组织管理支持输入已注册邮箱将用户添加至组织；当前**没有邮件邀请或接受流程**。

### 权限
项目 owner 可以授权 manager、member、observer；manager 管理计划并审核候选，普通 member 仅修改自己任务状态，observer 仅查看。项目成员必须先由组织管理员加入该组织。系统管理员不能仅凭该身份查看其他组织的聊天。

### AI 模型
模型配置由系统管理员在最左侧「系统管理 → AI 服务中心」操作，普通项目成员无需填写密钥。初次部署时，先配置 `MODEL_ENCRYPTION_KEY`，创建账号后在本机受控命令行执行：
```sh
npm run admin:grant -- --email=admin@example.com --confirm
```
以管理员账号登录，在「系统 AI」添加模型名称、模型 ID、API 地址、协议与 Key，启用并设为默认。项目 owner 仅开启/关闭项目 AI 分析。更换 `MODEL_ENCRYPTION_KEY` 会使已有模型凭据无法解密，必须计划重新配置。请勿在公网 HTTP 上运行真实数据。

### 操作审计与权限撤销

部门、项目组合、项目集、项目归类、成员角色和资源投入等组织管理写入由服务器重新检查当前组织管理员身份。成功写入和组织审计记录作为一次原子操作保存；如果校验或审计失败，不会留下部分组织修改。已被撤销管理员角色的账号不能继续通过先前加载的页面操作。组织成员身份本身不授予跨项目聊天访问权。

### 当前限制
这是实验性功能：尚无 SSO、邮件邀请、跨项目基线/投资分析、真实任意模型兼容认证或生产级安全验收。

---


### 正式项目治理工作台

在具体项目中打开「项目治理」页签，可维护目标、里程碑、交付物、已发生问题、决策与变更申请，查看任务依赖。项目负责人和管理者可以录入治理事项；实际负责人提交交付物，独立审核者验收或退回，重要变更由项目负责人审批。聊天中的 AI 建议不会自动成为交付物验收或基线变更。界面暂不提供跨项目资源优化或自动决策引擎。


### 问题处理闭环

项目治理中的“已发生问题”允许负责人和管理者填写处理说明后确认解决；若问题再次发生，可以重新打开。每次状态变更均受项目权限、乐观版本和幂等机制约束，并保留处理人、时间与说明。项目其他成员可查看授权项目的问题处理历史；AI 的猜测不会直接解决或重新打开正式问题。项目风险自动转问题和全部跨项目关联尚未支持。

### 聊天证据与待核实主张

项目治理中可以从当前项目聊天引用原始消息的精确片段，登记“进度线索、完成声称、个人承诺、阻塞、风险/问题/决策/变更线索”等待核实主张。普通成员只能引用自己的发言；项目负责人和管理者可以记录项目内其他成员发言。只有原发言人可以确认自己表达的意思，项目管理者可以驳回错误解释；任何此类确认均**不等同于任务完成、交付物验收或批准变更**。系统按项目权限隔离证据。当前尚不支持 AI 自动抽取/冲突调解。

### AI 候选与进度建议的审核

项目负责人和管理者可以批准或驳回项目内的 AI 候选任务/风险及待核实进度；审批现在是幂等且可审计的正式命令。只有批准的任务/风险候选会进入正式项目登记簿；确认进度或“已完成”的发言，不代表任务自动完结或交付物自动验收。网络重试不会重复创建正式工作，重复审核只能返回原回执或被拒绝。模型不能自行批准。 

### 项目人员变更与设置版本

项目 owner 可以添加已由组织管理员加入的注册用户，修改 manager/member/observer 角色，并移除非 owner 的项目成员。仍有未完成任务时必须先移交或取消；不能移除项目 owner。成员操作可审计，同一次网络重试不会重复增加、修改或删除人员。项目 AI 开关和提醒时间独立使用设置版本，其他浏览器已修改设置时，过期的保存请求会被拒绝而不是覆盖。模型供应商、密钥与默认模型继续仅由系统总管理员统一设置。

### 风险评估与人工应对

风险描述尚未发生但可能影响项目目标的事项，与已实际发生的「问题」分开登记。AI 可以建议风险，项目负责人或管理者必须人工审核后才形成正式开放风险。项目负责人/管理者评估发生可能性与影响（各 1–5）、指定项目内有效责任人并填写应对计划，才能把风险推进为「应对中」，之后可记录解决说明并关闭；情况变化时可重新打开。每次评估和状态变更可查历史，普通成员只能查看。正在应对的风险仍列入未解决风险报告；移除或降级负责人前必须移交未关闭风险。

### 项目负责人交接

项目负责人可以从已加入本项目、同时仍是组织成员的人员中选择接任者，经明确确认后转让 owner 身份；原负责人自动变为项目管理者。系统会同时更新项目正式负责人、角色和审计历史，并确保同一项目只能有一个 owner。交接要求最新版本，过期浏览器不能覆盖已发生的转交；网络超时后使用同一命令重试可以取得原结果，即使原 owner 已降级。交接后工作台自动刷新角色；系统 AI 模型供应商和密钥仍仅由系统总管理员配置。

### 变更批准后还要实施与核验

项目 owner 批准变更申请，不代表其范围、时间或责任变更已经落地。项目 owner/manager 需指定有效实施人启动实施；中途可重新指派责任人，旧负责人的聊天记录不会成为新负责人的完成证据。最终需由非实施人的项目 owner/manager 引用本项目实施人在本次实施开始之后发布的原始消息，并填写核验说明，才能把状态记为“已复核实施”。所有操作都有不可变版本历史与幂等回执；人员退出项目前必须先交接尚在实施的变更。工作台不会自动修改项目计划基线。


### 组织管理操作的安全重试

部门、项目集、项目组合创建，以及组织成员管理、项目归属和人员资源投入的所有保存操作现在具备持久幂等回执。相同操作在网络超时后可以原样重试，不会额外生成一条项目组合、资源分配或审计记录。普通组织成员不能因此获得管理员操作权限；已经撤销管理员权限的人员也不能通过旧命令恢复管理权。更改表单内容会产生新的操作键。组织项目集与项目组合不同于项目，组织命令记录在租户级，不冒用某个项目的领域事件。

### 跨项目投入比例与容量检查

组织管理员在资源投入计划里为同一人员登记多个项目时，系统按日期汇总所有项目的百分比；同一天总和不得超过 100%，否则拒绝保存。开始日、结束日均计入占用。例如 10 月 1–31 日已投入 30%，在 10 月 10–20 日另登记 70% 可以通过，再多 1% 就不能通过；11 月 1 日则可重新安排 100%。网络超时重试同一操作不会重复登记。该比例仅代表规划中的资源容量，不是实际工时记录。

### 项目归属版本与并发管理员

项目可归属一个主部门、一个项目集或直接一个项目组合。组织管理员在「项目结构归属」修改项目时，保存会带上当前显示的版本号：如果别的管理员已经先修改了同一项目，过期的保存请求将被拒绝，不会静默覆盖。选择「刷新所选项目归属」可取回服务器最新的部门、项目集、项目组合和版本，再由人重新确认。成功的网络重试不会重复修改归属。

### 人员重复操作与管理员自降权

项目组和组织人员的角色应体现真实发生的变更。组织管理员对已经加入组织的人员再次使用**新的操作命令**发起邀请、再次设置其已有的组织角色，或对部门人员重复设置原有身份，系统将提示冲突，不会追加一条并未发生的“成功变更”审计。网络重试**原来那次已完成的操作**则会复用原 UUID 回执，不重复添加成员或更改角色。

若组织已有另一位管理员，当前管理员可在明确确认后将自己降为普通成员；成功后工作台重新载入权限。响应丢失时仍可重试**自己原来那次已完成的降权命令**，但降权后不能凭新的命令键修改组织人员。组织不能移除最后一名管理员。AI 模型、项目管理角色与系统总管理员资格均不会因此被自动授予。

## English

### Organization and project structure
Organization administrators can create departments, programs and portfolios from "Organization". Projects may be assigned a lead department and a program or directly a portfolio. Departments manage people and resources and are not substitutes for programs or portfolios. A person can work in multiple projects; project chat access still requires explicit project membership. Adding users by an existing registered email is supported; **email invitations and acceptance are not yet implemented**.

### Authorization
Project owners can assign manager, member, or observer roles. Managers maintain project plans and review proposals; members update only their own task status; observers have read-only access. The organization administrator must add a user to the organization before a project owner can add them to a project. A platform system administrator is not granted cross-organization chat access merely by that platform role.

### AI models
Only the platform system administrator can edit models in the "System AI" panel; ordinary project members do not enter API keys. Configure `MODEL_ENCRYPTION_KEY`, register an account, then run this operator command locally:
```sh
npm run admin:grant -- --email=admin@example.com --confirm
```
Log in as the promoted account. Open System Management → AI Service Center, create a provider connection (endpoint, protocol and encrypted API key), then register its models and select an enabled default. Project owners may enable or disable AI for their project. Rotating `MODEL_ENCRYPTION_KEY` makes previously encrypted model credentials unreadable and requires a planned reconfiguration. Do not run sensitive deployments over public HTTP.

### Operation audit and administrator revocation

Organization management writes—including departments, portfolios, programs, project classification, membership roles, and resource allocations—recheck the current organization administrator's role on the server. A successful write and its organization audit record are committed atomically; validation or audit failure leaves no partial organization change. A user whose administrator role has been revoked cannot keep modifying the organization from an already-open page. Organization membership does not grant access to other projects' conversations.

### Limitations
Experimental: SSO, invitation emails, cross-project benefits analytics, universal model compatibility certification and production security acceptance remain outstanding.
### Formal PM governance workspace

Open the “Project Governance” tab within a project to maintain goals, milestones, deliverables, issues, decisions and change requests, and to view task dependencies. Project owners and managers can register governance items; assignees submit deliverables, separate authorized reviewers accept or return them, and project owners approve critical changes. AI suggestions from chat never automatically become delivery acceptance or baseline changes. Cross-project resource optimization and autonomous decisions are not offered by this UI.

### Issue resolution and reopening

Project owners and managers can record a resolution note for an occurred issue and reopen it if the impact returns. Every state transition checks current project authorization, optimistic versioning and idempotency, and keeps the actor, time and explanation in a project-scoped history. Authorized project members can read that history. AI guesses cannot resolve or reopen official issues. Automatic risk-to-issue conversion and full cross-project traceability remain out of scope.

### Chat evidence and unverified claims

The Project Governance workspace can cite exact spans of a project member's existing chat message and register a pending claim about progress, completion statements, personal commitments, blockers, and risk/issue/decision/change signals. Members can cite their own messages; project owners and managers may register interpretations of other project members' messages. Only the original speaker may acknowledge their wording, while authorized managers can dismiss inaccurate claims. **Acknowledgment does not mean a task is done, a deliverable is accepted, or a change is approved.** Project membership limits access to citations. Automated model extraction and conflict adjudication are not implemented.

### AI candidate and progress approvals

Project owners and managers can approve or reject pending AI task/risk proposals and progress evidence. These decisions now use auditable, idempotent commands. Only human-approved proposals create official tasks or risks. Acknowledging a progress report or completion statement never automatically closes a task or accepts a deliverable. Retrying the same request cannot create duplicate work; AI cannot approve on behalf of a person.

### Project membership commands and settings versions

Project owners can add registered members already authorized in the tenant, change manager/member/observer roles, and remove non-owner members. Incomplete assigned tasks must be reassigned or cancelled before removal; the project owner cannot be removed. Membership commands are audited and idempotent across network retries. Project AI enablement and reminder settings have an optimistic revision so a stale browser cannot overwrite another owner's update. Provider credentials and the default model remain system-administrator-only.
### Human-owned risk assessments and response lifecycle

Risks are prospective uncertainties, distinct from already-occurred issues. AI may propose a risk, but a project owner or manager must approve it before it becomes an open, unassessed official risk. Owners/managers score likelihood and impact (1–5 each), assign an active project owner for the response and record a response plan before transitioning to mitigating; resolution requires a human note and the risk can later be reopened. All assessments and transitions have auditable history; ordinary members may read but not manage them. Mitigating risks remain in unresolved-risk reports. Unresolved risk ownership must be reassigned before removing or demoting the owner to observer.
### Project owner transfer

A current project owner can explicitly transfer ownership to an active member of both the project and tenant. The previous owner becomes a project manager, and the database prevents multiple simultaneous owner roles. The transfer is version-checked, transactionally audited and idempotent: the former owner may replay the same completed receipt while still a project member, but cannot issue another transfer. The workspace refreshes role permissions after success. Global AI providers and credentials remain system-administrator-only.
### Approved changes still need implementation and verification

Approval of a ChangeRequest does not mean a scope, schedule or responsibility change has been applied. Project owners/managers designate an active implementer, may reassign the work (resetting the eligible evidence window), and must independently verify completion using a human message posted by the current implementer in the same project after implementation began. A person cannot verify their own implementation. Each action has a durable command receipt and versioned immutable history; active implementation duties must be reassigned before removing or demoting a member. This workflow does not automatically rewrite project baselines.

### Safe retries for organization management

Creation of departments, programs and portfolios, membership/role edits, project classification and resource allocation now require durable tenant-scoped idempotency keys. Retrying the same submission after a lost HTTP response returns the original result without creating another portfolio, allocation or audit entry. Only active tenant administrators can issue these operations; a revoked administrator cannot regain access by replaying an old command. Editing an intent creates a new key. Organization actions do not masquerade as project-scoped DomainEvents.
### Cross-project allocation capacity

A tenant administrator may plan a person's contributions to several projects, but the sum for that person on any given date must not exceed 100%. Both start and end dates count. For example, an existing 30% allocation for October 1–31 may coexist with another 70% for October 10–20, but an extra 1% on an overlapping day will be rejected; the person can be allocated 100% starting November 1. Retrying the same saved command never creates a duplicate. Percentages represent planned capacity rather than actual timesheets.
### Project classification version and concurrent administrators

A project may belong to a primary department, to a program, or directly to a portfolio. When a tenant administrator edits its classification, the submission includes the version they reviewed. If another administrator has already changed the project, the stale save is rejected rather than silently overwriting the new classification. **Refresh selected project classification** loads the current department, program, portfolio and revision for explicit review. Replaying the original completed command does not alter the classification again.

### Duplicate membership commands and administrator self-demotion

Organization membership and role audit records should describe genuine changes. A **new** invitation for an already enrolled tenant member, a role change to the person's existing tenant role, or an unchanged department assignment is rejected rather than recorded as a successful change. Retrying the **original completed command** with the same UUID safely replays its receipt without creating another audit entry.

If another tenant administrator remains, an administrator can explicitly confirm their own demotion to an ordinary member. The workspace refreshes the user's permissions after success. A lost response can be recovered by replaying only that same already-completed demotion command while the issuer remains a tenant member; a new privileged command is denied. The last administrator cannot be demoted. AI model actions and system administrator permissions remain separate from tenant governance.

