# TLS 证书轮换工作台

面向企业平台团队的证书轮换系统：集中管理域名、证书链、部署节点与切换记录，支持灰度发布、暂停、回滚和全链路节点回执审计。**私钥不进入本系统**——平台只保存证书（公钥）元数据，节点 agent 自行持有私钥并通过拉取协议工作。

## 架构

```
┌────────────┐   HTTP    ┌──────────────────┐      ┌────────────┐
│ Vue 3 前端  │ ────────▶ │ NestJS API        │ ───▶ │ PostgreSQL │
│ (到期清单/  │           │ - 证书校验         │      │ (证书元数据/ │
│  节点矩阵/  │           │ - 灰度状态机        │      │  发布计划/   │
│  计划操作)  │           │ - 回执幂等处理      │      │  节点回执)   │
└────────────┘           └──────────────────┘      └────────────┘
                                    ▲
                         poll/receipt│（agent 拉取式，平台不推送）
                          ┌─────────┴───────┐
                          │ 节点模拟器        │  可制造超时 / 重复回执 /
                          │ (simulator/)    │  部分成功 / 矛盾回执
                          └─────────────────┘
```

- `server/` — NestJS + TypeORM。生产用 PostgreSQL（`docker-compose.yml`），本地开发/测试可用 `DB_TYPE=sqljs` 嵌入式库。
- `web/` — Vue 3 + Vite + Pinia 前端。
- `simulator/` — 本地节点模拟器（agent 协议参考实现）。
- `scripts/` — openssl 测试证书生成、种子数据。

## 快速开始（本地，无需 Docker）

```bash
npm install
bash scripts/gen-certs.sh          # 生成 demo CA + 各类测试证书到 fixtures/

# 1. 启动 API（sqljs 嵌入式库，数据落盘 server/data/workbench.db）
cd server && DB_TYPE=sqljs npm run start:dev

# 2. 另开终端：灌入 6 个节点 + 2 张证书
npm run seed

# 3. 启动节点模拟器（带 20% 重复回执）
npm run simulator -- --dup 2

# 4. 打开前端
npm run dev:web                    # http://localhost:5173
```

生产（PostgreSQL）：`docker compose up`，API 默认使用
`DATABASE_URL=postgres://postgres:postgres@localhost:5432/tls_workbench`。

## 核心流程

1. **上传证书**（页面「证书」或 `POST /api/certificates`）：服务端校验
   - 有效期：已过期 / 尚未生效直接拒绝；30 天内到期给出警告；
   - 域名覆盖：声明域名必须全部被 SAN 覆盖（支持 `*.example.com` 单标签通配）；
   - 证书链：逐级核对 issuer/subject 与签名，断链拒绝；链尾非自签根给出警告。
   - 可先调 `POST /api/certificates/validate` 干跑校验。
2. **创建计划**：选择目标证书与节点，前 `canaryCount` 个（canary 角色优先）为灰度批。
3. **启动**：仅灰度批可领取任务；灰度全部成功 → `AWAITING_APPROVAL`，
   操作员确认「推进剩余节点」→ `ROLLING`。灰度有失败则停在 `CANARY`，绝不自动推进。
4. **暂停/恢复**：`PAUSED` 期间不再派发新任务，已下发的回执仍受理。
5. **失败与超时**：节点回执失败 → 该节点 `FAILED`，**保留其原有版本**，其余节点照常推进，
   计划终态 `COMPLETED_WITH_FAILURES`；下发后 `DELIVERY_TIMEOUT_MS`（默认 60s）无回执 → `TIMEOUT`。
6. **回滚**：仅可回滚到**仍有效且覆盖计划域名**的证书（接口会逐项标出不可回滚原因）；
   回滚只针对**实际已切换**的节点生成新计划（失败/未下发的节点本来就在旧版本，不动），
   回滚计划同样走灰度流程。

## Agent 协议（节点侧）

```
GET  /api/agent/poll?node=<name>            → 待执行任务（含目标指纹），领取即开始超时计时
POST /api/agent/receipt?node=<name>         → 上报回执
     { assignmentId, receiptKey, ok, fingerprint?, error? }
```

- **幂等**：同一 `receiptKey` 重复提交返回 `duplicate: true`，状态不变；
  任务进入终态后的迟到/矛盾回执一律忽略（`late: true`）。
- 回执指纹与目标指纹不一致按失败处理，节点版本指针不移动。
- agent 重启后重复 poll 会重新拿到未回执的任务（重投不重置超时计时）。

## 模拟器混沌开关

```bash
npm run simulator -- \
  --nodes canary-1,canary-2,prod-1,prod-2 \
  --timeout-rate 0.2 \   # 领取后永不回执（触发 TIMEOUT）
  --fail-rate 0.3 \      # 上报应用失败（节点保留旧版本）
  --dup 2 \              # 每个回执重复发送 N 次（幂等性）
  --flap                 # 成功后再发一条矛盾回执（必须被忽略）
```

## 测试

```bash
npm test          # 15 个用例：证书链/域名/有效期校验 + 灰度状态机集成测试（sqljs 内存库）
```

覆盖：有效/过期/断链/域名不覆盖证书，通配符匹配，灰度门禁，暂停恢复，
失败节点版本保留，重复与矛盾回执幂等，超时判定，回滚目标资格与「只回滚已切换节点」。

## 主要 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/certificates?expiringWithinDays=30` | 证书列表 / 到期清单 |
| POST | `/api/certificates` / `/validate` | 上传（先校验）/ 干跑校验 |
| GET/POST | `/api/nodes` | 节点列表 / 注册 |
| GET | `/api/nodes/:id/history` | 节点切换记录 |
| GET/POST | `/api/plans` | 计划列表 / 创建 |
| GET | `/api/plans/:id` | 计划详情（含各节点回执与上报指纹） |
| POST | `/api/plans/:id/start` `/approve` `/pause` `/resume` | 状态机操作 |
| GET | `/api/plans/:id/rollback-targets` | 可回滚证书及资格 |
| POST | `/api/plans/:id/rollback` | 创建回滚计划 |

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DB_TYPE` | `postgres` | `postgres` 或 `sqljs`（本地/测试） |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/tls_workbench` | PG 连接串 |
| `DB_LOCATION` | `data/workbench.db` | sqljs 数据文件 |
| `DELIVERY_TIMEOUT_MS` | `60000` | 下发后无回执的超时时间 |
| `PORT` | `3000` | API 端口 |
