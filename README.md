# TLS 证书轮换工作台

集中管理域名、证书链、部署节点与切换记录的灰度发布平台。

- **前端**：Vue 3 + Vite + Pinia —— 到期清单、节点 × 证书矩阵、灰度操作页、节点回执、切换记录
- **后端**：NestJS 10 + TypeORM
- **存储**：PostgreSQL（证书元数据、部署计划/任务、节点回执、切换日志）
- **私钥不进入本系统**：上传内容做私钥特征拦截，库内只保存证书链 PEM
- **本地节点模拟器**：可制造失败、随机抖动、超时+迟到回执、重复回执

## 目录

```
backend/    NestJS API（端口 3000）
frontend/   Vue 3 页面（端口 5173，/api 代理到 3000）
samples/    演示用 PKI：合法链 / 过期 / 断链 / 不覆盖域名 / 私钥样例
docker-compose.yml  标准 PostgreSQL（生产式部署）
```

## 快速开始（无需 Docker）

后端通过 `embedded-postgres` 自动拉起一个本地 PostgreSQL（数据在 `backend/.pgdata`）：

```bash
# 1. 生成演示证书（合法链/过期/断链/越权域名/私钥）
cd backend
npm install
npm run gen:samples

# 2. 启动（终端 1：本地 PG，端口 55444）
npm run dev:pg

# 3. 启动（终端 2：API，端口 3000，首次自动建表+种子数据）
npm start

# 4. 前端（终端 3）
cd ../frontend
npm install
npm run dev
# 打开 http://localhost:5173
```

> 注意：API 用 **ts-node** 启动（NestJS 依赖 `emitDecoratorMetadata`，esbuild/tsx 不生成构造函数注入元数据）；独立脚本（dev-pg、gen:samples）用 tsx。

### 使用外部 PostgreSQL

```bash
docker compose up -d postgres          # 提供 127.0.0.1:55444
PGHOST=127.0.0.1 PGPORT=55444 PGUSER=postgres PGPASSWORD=postgres \
  PGDATABASE=tls_rotation npm start
```

## 种子数据

- 3 张证书：当前证书（397d）、临期证书（18d，进到期清单）、泛域名证书 `*.example.com`
- 7 个节点：2 test → 1 canary → 4 prod，全部从「当前证书」起步
- 首次启动自动写入；重置只需停服后删除 `backend/.pgdata`

## 上传校验流水线

`POST /certificates/upload`（multipart 字段 `chain`，或 `pem` 文本 + `label`）依次执行：

1. **私钥拦截**：匹配 `PRIVATE KEY` 头直接 422，私钥永不落库
2. **PEM 解析**：至少一张 X.509
3. **有效期**：链上每张证书 notBefore/notAfter 均需覆盖当前时间
4. **证书链**：相邻证书 issuer/subject DN 匹配、CA 基本约束、RSA-SHA256 签名逐跳验证、根自签名验证
5. **域名覆盖**：叶子 SAN（含通配符 `*.example.com`）必须覆盖至少一个受管节点域名
6. **指纹去重**：叶子 SHA-256 指纹唯一

`samples/` 下每一类反例都可在页面拖入验证报错。

## 灰度发布模型

```
test (2 节点) ──门──▶ canary (1 节点) ──门──▶ prod (4 节点)
```

- 创建计划时按节点域名是否被证书 SAN 覆盖筛选，按 env 分批
- 每批**顺序推送**：某节点失败不掩盖同批其他节点结果
- 一批全部成功后状态置 `paused` 停在灰度门，**必须人工「推进」**
- 失败：状态 `failed`，**控制面与节点都保留各自原版本**；可「重试失败节点」
- 暂停：批次执行中请求暂停，当前批次自然结束后不越过灰度门
- 操作：开始 / 暂停 / 重试 / 推进 / 回滚

## 故障语义与对账

- **失败/抖动**：节点回执 `result=error`，任务 `failed`，节点实际版本不变
- **超时**：控制面 2.5s 超时即标 `timeout`；节点随后仍可能加载成功并发出**迟到回执**。批次收尾与「重试」都会按节点真实状态对账（`reconcileLate`），把任务修正为成功并补写切换记录
- **重复回执**：节点对同一 `request_id` 重发 ack，回执表保留两条但第二条标 `duplicate`，幂等不产生二次切换
- **控制面 vs 实际**：矩阵同时展示数据库记录指纹与模拟器真实服务指纹，超时场景下可见短暂「分歧」

## 回滚规则

回滚目标对每个节点独立校验，**只允许回到**：

1. 仍在有效期内（`now <= notAfter`）
2. SAN 覆盖该节点域名
3. 不是本次被回滚的证书本身

不传目标证书时，自动取该节点在本次部署前的版本（来自部署切换记录的 `fromCertId`）。可按 `nodeIds` 部分回滚；单个节点回滚推送失败不影响其他节点，失败节点保留其真实版本。回滚同样走模拟器，因此也会触发超时/失败模式。

## 模拟器

节点矩阵页可对任一节点设置：

| 模式 | 行为 |
|---|---|
| normal | 正常成功 |
| fail | 永久拒绝加载 |
| flaky | ~55% 随机失败 |
| timeout | 5–7s 后才加载成功并发迟到回执（超过 2.5s 控制面期限） |
| duplicate | 成功后再补发一张相同 request_id 的回执 |

另有「下次失败」按钮注入一次性失败。

## 主要 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/certificates` | 证书清单（状态/剩余天数/在用节点） |
| GET | `/certificates/expiring?withinDays=30` | 到期清单 |
| POST | `/certificates/upload` | 上传证书链（multipart 或 PEM 文本） |
| GET | `/nodes/matrix` | 节点矩阵：控制面指纹 vs 节点实际指纹 |
| PATCH | `/nodes/:id` | 设置 simMode 等 |
| POST | `/nodes/:id/force-fail` | 注入一次性失败 |
| GET | `/nodes/switch-log` | 切换记录（最终指纹） |
| POST | `/deployments` | 创建分批计划 |
| POST | `/deployments/:id/start` `/pause` `/promote` `/retry` | 灰度操作 |
| GET | `/deployments/:id/rollback-candidates` | 每节点有效+匹配的回滚候选 |
| POST | `/deployments/:id/rollback` | 按节点回滚 |
| GET | `/deployments/:id` | 任务、回执、批次明细 |

## 重置演示环境

```bash
# 停掉 API 与 dev:pg，然后：
rm -rf backend/.pgdata
npm run dev:pg   # 重新 initdb
npm start        # 重新建表+种子
```
