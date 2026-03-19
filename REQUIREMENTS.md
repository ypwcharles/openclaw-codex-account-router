# OpenClaw Codex Account Router — 需求文档

## 1. 文档目的

为 OpenClaw 设计一个**面向 `openai-codex` 的多账号管理与运行时切换方案**，用于在 Codex 账号触发额度限制、工作区失效、鉴权失效等场景时，优先在 Codex 账号池内切换，只有在 **所有 Codex 账号都不可用** 时，才继续 fallback 到 MiniMax 等备用模型。

这份文档聚焦：
- 业务目标
- 已验证事实
- 硬约束
- 功能需求
- 非功能需求
- 错误分类与路由策略
- MVP 范围
- 验收标准

---

## 2. 背景与问题定义

当前 OpenClaw 已具备模型级 fallback 能力，但针对 `openai-codex` 的**多账号池调度**仍不完整。

用户的真实需求不是“单纯多登录几个账号”，而是：

> 当某个 Codex 账号因为 `usage limit`、`429`、`deactivated_workspace`、auth/billing 问题不可用时，系统应**优先切换到另一个 Codex 账号继续工作**；只有在整个 Codex 账号池都不可用时，才降级到 MiniMax。

换句话说，目标是：

```text
Codex account A
→ Codex account B
→ Codex account C
→ MiniMax
→ 其他兜底
```

而不是当前更偏向的：

```text
gpt-5.4
→ gpt-5.2
→ openrouter/free / MiniMax
```

---

## 3. 已验证事实（基于本地源码 / CLI / 日志）

### 3.1 OpenClaw 已有的能力
1. OpenClaw **通用多 profile auth 引擎**是存在的，源码层已确认有以下概念：
   - `profiles`
   - `order`
   - `lastGood`
   - `usageStats`
   - `cooldownUntil`
   - `disabledUntil`
   - `failureCounts`
2. 这说明 OpenClaw **底层并不缺多账号 / 多 profile failover 机制**。
3. `openclaw models auth order set --provider openai-codex ...` 这类“优先级顺序控制”思路是成立的。

### 3.2 当前 `openai-codex` 登录链路的限制
1. `openclaw models auth login --provider openai-codex` 在当前版本中是**内建 special-case**，不是普通 provider plugin 可优雅接管的路径。
2. 当前 CLI 没有暴露：
   - `--profile-id`
   - `--account-alias`
   - `--keep-existing`
3. `openai-codex` 的 profile 写入逻辑依赖 OAuth 返回的身份信息；若拿不到 email，则可能退回 `openai-codex:default`。
4. 当前机器的实际状态曾显示只有 `openai-codex:default`，说明**不能依赖“重复 login 一定自然形成多个稳定 profile”**。

### 3.3 当前运行时行为的关键信号
1. **`usage limit` 已观察到会触发模型级 fallback**：
   - 典型链路：`gpt-5.4 -> gpt-5.2 -> openrouter/free`
   - 期间会插入 `Continue where you left off...` continuation
2. **`deactivated_workspace` 在已检查的 run 中表现为直接失败**，未观察到被可靠当作自动可恢复错误处理。
3. 因此，当前 OpenClaw 更像是：
   - 已经具备模型 fallback
   - 尚未完成“Codex 账号池优先”的路由层

### 3.4 关于第三方现成方案的判断
1. 未确认存在成熟的 OpenClaw 插件，可直接替代内建 `openai-codex` 登录链路并实现完整账号池调度。
2. `odrobnik/codex-account-switcher-skill` 一类项目更像是：
   - Codex CLI / auth 文件切换工具
   - 账号池 / quota / cooldown 策略参考
   - **不是 OpenClaw 原生 provider 级 failover 方案**

---

## 4. 产品目标

### 4.1 P0 目标
1. 为 `openai-codex` 提供**多账号池管理能力**。
2. 当触发 `usage limit`、`429`、`deactivated_workspace`、auth/billing 相关错误时，**优先切换到下一个 Codex 账号**。
3. **只有当所有 Codex 账号都不可用时，才 fallback 到 MiniMax。**
4. 尽量复用 OpenClaw 现有能力，不直接 patch 安装目录下的 dist bundle。

### 4.2 P1 目标
1. 提供账号池健康状态观测。
2. 支持从 Telegram 或其他电脑进行远程账号恢复/切换，而**不需要直接操作 gateway 所在机器**。
3. 允许将来上游化为更小的 OpenClaw 核心补丁（例如显式 `--profile-id`）。

---

## 5. 非目标（明确排除项）

1. **不**优先做“替换 OpenClaw 内建 `openai-codex` login 的 provider plugin”。
   - 原因：内建 special-case 已确认存在。
2. **不**在第一阶段直接修改 OpenClaw 安装目录中的 dist JS。
   - 原因：升级脆弱、维护成本高。
3. **不**重写 OpenClaw 全部模型 fallback 机制。
   - 原因：现有模型 fallback 已有价值，应复用。
4. **不**把需求收缩成“纯手动切账号脚本”。
   - 原因：用户明确需要运行时自动切换。

---

## 6. 核心设计原则

1. **Codex 优先，MiniMax 兜底。**
2. **账号级路由优先于 provider 级降级。**
3. **复用 OpenClaw 既有 auth/order/failover 机制，不重复造轮子。**
4. **状态外置、行为可观测、切换可解释。**
5. **先做外部 wrapper/router，后考虑上游核心补丁。**

---

## 7. 功能需求

## 7.1 账号池管理
系统必须支持：
1. 添加 Codex 账号
2. 列出已登记账号
3. 查看账号别名、映射 profile、状态、最近成功/失败
4. 启用 / 禁用账号
5. 设置优先顺序
6. 手动切换当前优先账号
7. 校验账号是否可用

建议抽象字段：
- `alias`
- `profileId`
- `provider`
- `status`（healthy / cooldown / disabled / unknown）
- `lastSuccessAt`
- `lastFailureAt`
- `lastErrorCode`
- `cooldownUntil`
- `priority`

---

## 7.2 Profile 规范化
由于当前 `openai-codex` 登录链路不能可靠显式命名 profile，系统需要有一层**规范化管理**：

1. 登录完成后，识别新写入的 Codex 凭据
2. 将其稳定映射/规范化为可长期管理的 profile 标识
3. 建立 `alias -> profileId` 的持久映射
4. 避免多个账号反复落回单一 `openai-codex:default` 而不可区分

> 注：MVP 可以允许通过外部管理文件保存 alias 与 profile 的关系；后续再评估是否需要更深的持久化方案。

---

## 7.3 运行时账号路由
在 `openai-codex` provider 内部增加一层账号路由逻辑：

1. 正常情况下，按账号健康度和优先顺序选择账号
2. 若当前账号失败，按错误类别决定：
   - 当前账号重试
   - 切换下一个 Codex 账号
   - 直接禁用当前账号
   - 最终触发 provider fallback
3. 当某账号恢复健康后，可重新回到候选池

---

## 7.4 错误分类与动作规则

### A. 配额/限流类错误
典型示例：
- `You have hit your ChatGPT usage limit (team plan)`
- `429`
- `Retry-After`
- `insufficient_quota`

**要求动作：**
1. 不直接切 MiniMax
2. 先切换到下一个 Codex 账号
3. 当前账号进入 cooldown
4. cooldown 到期后允许重新加入池

### B. 账号/工作区硬失效
典型示例：
- `{"detail":{"code":"deactivated_workspace"}}`
- auth revoked
- invalid grant
- workspace disabled
- billing/auth irrecoverable

**要求动作：**
1. 当前账号立即标记为 `disabled` 或硬失效
2. 不再短期重试当前账号
3. 立即切换到下一个 Codex 账号
4. 仅当所有 Codex 账号都不可用时，才 fallback 到 MiniMax

### C. 瞬时失败 / 网络抖动 / timeout
**要求动作：**
1. 允许对当前账号进行有限次数重试
2. 重试失败后切换到下一个 Codex 账号
3. 不应立即把当前账号永久摘除

### D. 全池耗尽
**要求动作：**
1. 当所有 Codex 账号均为 `cooldown` / `disabled` / `failed` 时
2. 才允许 provider 级 fallback 到 MiniMax
3. 若 MiniMax 也失败，再继续走现有更低优先级兜底链

---

## 7.5 路由优先级要求（硬约束）
这是本项目最关键的行为要求：

```text
同一个 provider（openai-codex）内部的账号切换
优先于
跨 provider 的模型 fallback
```

即：
- `usage limit` 时，优先横向切账号
- 不是立刻纵向切到 MiniMax

---

## 7.6 观测与运维
系统至少要能提供：
1. 当前账号池列表
2. 当前活跃账号
3. 每个账号最近成功/失败时间
4. 每个账号最近错误码/错误类型
5. cooldown 结束时间
6. 当前顺序 / 下一个候选
7. 最近一次 provider fallback 原因

建议提供的命令或界面：
- `status`
- `list`
- `order set`
- `disable`
- `enable`
- `cooldown clear`
- `verify`
- `doctor`

---

## 7.7 远程恢复与无头操作
用户明确希望：

> 将来如果因为 ChatGPT 工作区失效 / 欠费 / 账号问题导致 Codex 不可用，希望能通过 Telegram 或其他电脑恢复，而不是必须碰 gateway 机器。

因此系统应预留：
1. 远程触发账号重新登录 / 替换的入口
2. 远程启用 / 禁用账号的入口
3. 远程查看账号池状态
4. 不依赖在 gateway 主机本地手工编辑文件

这部分在 MVP 可先做到：
- 远程查看状态
- 远程切换顺序
- 远程禁用/启用

重新登录流程可作为 P1/P2。

---

## 8. 非功能需求

### 8.1 稳定性
1. 不能因为一个 Codex 账号失效而让整个 cron / session 全部中断
2. 切换逻辑应尽量无人工介入

### 8.2 可升级性
1. 不依赖 patch dist bundle
2. 尽量通过外部 wrapper/router 落地
3. 后续 OpenClaw 升级后，项目改动面应尽可能小

### 8.3 可审计性
1. 每次切换必须可追踪
2. 每次 fallback 必须能解释原因
3. 日志不能泄漏 OAuth token / refresh token 等敏感信息

### 8.4 可恢复性
1. cooldown 到期后账号应可自动恢复到候选池
2. disabled 账号应支持人工恢复

---

## 9. 建议实现边界

## 9.1 MVP（建议先做）
MVP 目标：
- 不改 OpenClaw 核心源码
- 做一个外部 router / wrapper
- 先实现“Codex 账号池优先，MiniMax 后备”

MVP 包含：
1. 账号池配置文件
2. 账号别名与 profile 映射
3. 错误分类器
4. 健康状态存储
5. 顺序与 cooldown 管理
6. 运行时切换逻辑
7. 观测命令

MVP 不强制包含：
- 完整 Web UI
- 真正替换内建 login UX
- 上游 core patch

---

## 9.2 P1 / 后续增强
1. 更完整的 watchdog
2. 更强的结构化错误识别
3. Telegram 控制入口
4. 远程 relogin/rebind 流程
5. 上游 OpenClaw 补丁：
   - `openclaw models auth login --provider openai-codex --profile-id <alias>`

---

## 10. 推荐项目结构

```text
openclaw-codex-account-router/
├── README.md
├── REQUIREMENTS.md
├── config/
│   └── accounts.example.json
├── docs/
│   ├── error-taxonomy.md
│   └── routing-strategy.md
├── src/
│   ├── account_store/
│   ├── classifier/
│   ├── router/
│   ├── observer/
│   └── cli/
└── logs/
```

---

## 11. 验收标准

### 场景 1：usage limit
前提：账号 A 命中 usage limit，账号 B 正常

期望：
1. 当前请求不直接掉 MiniMax
2. 系统将 A 标记为 cooldown
3. 系统改用 B 继续执行
4. 任务最终仍在 Codex 体系内完成

### 场景 2：deactivated_workspace
前提：账号 A 返回 `deactivated_workspace`，账号 B 正常

期望：
1. A 被标记为 disabled
2. 不对 A 做短期重试
3. 系统立即切到 B
4. 只有当 B/C/... 全部失败时，才 fallback 到 MiniMax

### 场景 3：全池耗尽
前提：所有 Codex 账号都不可用

期望：
1. 系统明确记录“Codex account pool exhausted”
2. 才进入 MiniMax
3. 不出现无限重试/死循环

### 场景 4：网络抖动
前提：账号 A 发生一次瞬时 timeout

期望：
1. 对 A 先做有限重试
2. 若仍失败，再切下一个 Codex 账号
3. 不把 A 立即永久禁用

### 场景 5：可观测性
期望：
1. 能查看当前账号池状态
2. 能看到最近一次切换原因
3. 能区分：
   - usage limit
   - 429
   - deactivated_workspace
   - timeout
   - auth error

---

## 12. 风险与注意事项

1. **当前 `openai-codex` profile 生成路径不够显式**，可能导致 profile 管理脆弱。
2. **错误码未必始终结构化一致**，尤其 usage/billing 相关可能带自然语言文本。
3. 如果 router 只依赖日志解析，可能会有延迟或误判，需要为错误分类预留修正规则。
4. 如果账号切换过于频繁，长线程任务可能出现行为漂移，因此建议支持：
   - sticky session（可选）
   - 最小切换间隔
   - 冷却时间

---

## 13. 最终结论

本项目的本质不是“做一个能登录多个 Codex 账号的小工具”，而是：

> **在 OpenClaw 现有模型 fallback 之上，补齐 `openai-codex` provider 内部的账号池路由层。**

最关键的硬要求只有一句话：

> **命中 `usage limit` 或账号级错误时，先切 Codex 账号；只有所有 Codex 账号都不可用时，才 fallback 到 MiniMax。**

这应被视为本项目的第一原则。
