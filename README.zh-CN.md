# Agent Runtime Services

[English](README.md)

面向领域 agent 和构建 agent 的本地优先运行时服务平面。本包提供
TypeScript 库和 localhost JSON-RPC 服务，暴露由模型、存储、向量、资源和
密钥支撑的 Runtime Core 能力与 Agent Services。

默认 runtime home 为 `~/.agent-runtime-services`。

## 定位

`agent-runtime-services` 是项目中立的运行时服务平面。领域 agent 和构建
agent 通过类型化能力或本地 JSON-RPC 使用它；它们不需要自己维护 provider
client、模型目录、产物存储、记录存储、记忆存储、向量索引或通用密钥解析。

密钥按 runtime home 由操作者配置。Runtime Core 覆盖模型访问、能力 envelope、
产物存储、记录存储、记忆存储、向量存储、资源发现、provider 配置和密钥解析。
Agent Services 是构建在 Runtime Core 之上的 agent-facing 组合服务。领域 agent
和构建 agent 项目可以复用这两层，而不必重复维护 provider/storage 代码，也不会
获得隐藏的决策权。

## 产品叙事

Agent 项目首先需要的是运行时能力平面，而不是另一个面向特定领域的 agent
框架。反复出现的基础工作包括 provider 选择、密钥读取、产物和记录持久化、
向量检索、资源就绪检查，以及保留有来源依据的记忆上下文。如果每个消费方
agent 都直接拥有这些部分，项目会重复实现 provider/storage 代码，并且在
agent 之间需要共享的契约上发生分裂。

Runtime Services 保持这层运行时表面的项目中立性。它暴露两层服务：

- Runtime Core：模型访问、产物、记录、向量、资源、密钥、provider 配置和能力
  envelope 的可复用运行时底座。
- Agent Services：基于 Runtime Core 组合出的 agent-facing 服务，用于记忆、
  上下文、检索或交付契约。它们不拥有领域判断、审批、工具选择、会话变更或
  行动编排。

它的公共表面有四个职责：

- 执行 provider 支撑的模型能力，同时不泄漏 provider 细节；
- 在显式调用方隔离键下持久化产物、JSON 记录、记忆对象和向量；
- 通过标准 Runtime Services envelope 报告资源就绪和操作者 smoke 状态；
- 通过 TypeScript 库和本地 JSON-RPC 暴露同一组能力契约。

记忆基底是这层表面里的第一个 Agent Service，不是整个产品。它底层的
`MemoryStore` 属于 Runtime Core；公开的 `memory.*` family 为有来源依据的上下文
提供可回放、可审计的结构：

```text
append-only event -> extracted claim -> relationship context -> evidence-backed retrieval bundle
```

这属于 Runtime Services，因为它是 agent-facing 服务契约，不是领域判断。服务
可以保留事件、证据、声明、关系、检索 bundle 和调用方提供的 policy metadata，
同时仍然拒绝决定领域意图、审批、工具选择、会话变更或协同行动。消费方 agent
继续负责解释和面向用户的行为。

该能力的 L1 PRD 是
[`architecture/memory-substrate-prd.md`](architecture/memory-substrate-prd.md)。
它说明为什么记忆基底属于 P0、哪些内容不进入 P0，以及能力契约如何在 L1-L4
中被证明。

## 领域结构

- `capabilities/`：CapabilityRegistry，是能力 id、请求/输出 schema、服务层分类、
  effect、risk class、consumer 和 authority 的单一来源。
- `models/`：provider 目录、模块选择、provider runtime 解析和 provider API
  client。
- `resources/`：能力/资源目录和可用性 overlay。
- `services/`：基于 Runtime Core port 组合出的 Agent Services 模块。
- `storage/`：产物存储、JSON 记录存储、记忆存储和向量索引。
- `rpc/`：localhost JSON-RPC server/client，镜像库里的能力接口。
- `mcp/`：基于同一 CapabilityRegistry 的 MCP adapter mapping helper。完整远程
  transport 不会被复制成第二套业务层。
- `config/`：runtime home 路径、secret ref、加密 keystore 和通用密钥解析器。

## 使用方式

```bash
pnpm install
pnpm test
pnpm build
agent-runtime-services models install-volcengine-agent-plan
agent-runtime-services secrets set --id ARK_API_KEY
agent-runtime-services serve --host 127.0.0.1 --port 8765
```

库入口是 `createRuntimeServices(config)`。它跨两层服务暴露类型化能力：

Runtime Core：

- `language.complete`
- `embedding.create`
- `vision.generateImage`
- `artifact.save/get/list/cleanupExpired`
- `record.upsert/get/query/delete`
- `vector.upsert/search`
- `resources.list/doctor/smoke/status`

Agent Services：

- `memory.event.append/get/list`
- `memory.claim.upsert/get/query`
- `memory.relation.upsert/query`
- `memory.context.retrieve`

RPC 服务通过 localhost JSON-RPC 镜像这些能力，并支持 `health`、`version`、
`capabilities.list` 和 `capabilities.describe`。descriptor endpoint 面向 agent：
它返回 intended consumers、机器可读的请求形状、结果形状、副作用分类、
`serviceLayer` 分类（`runtime-core` 或 `agent-service`）、transport hint 和
authority boundary，而不是面向人的帮助文本。

Provider port assembly 与模型目录分开配置。本地模型目录仍是
`model-providers.json`；runtime provider port 选择位于 runtime home 下的
`runtime-providers.json`。如果没有 `runtime-providers.json`，`serve` 使用本地
默认值。如果存在，它可以把 model、artifact object、artifact manifest、record
和 vector port 指向远程 HTTP/JSON adapter，而不改变任何 `/rpc` method 或请求
形状。记忆替换通过类型化 `MemoryStorePort` 可用；`runtime-providers.json` 中的
远程 memory provider assembly 会等到选定具体 metadata service 后再进入。

使用 `agent-runtime-services serve --provider-config <path>` 覆盖默认的
`<runtime-home>/runtime-providers.json`。`resources`、`doctor`、`storage` 和
`models smoke` 命令接受同样的 `--runtime-home` 和 `--provider-config` 选项，
因此操作者检查会查看与运行中的 RPC 进程相同的 runtime provider assembly。
`models smoke` 还接受 `--config`，用于覆盖 smoke 调用使用的模型 provider 配置。
这些文件都是本地操作者配置，不能提交。

## 远程 Provider 配置

当稳定的 `/rpc` 表面需要通过远程 provider service 而不是本地默认值路由时，
使用 `runtime-providers.json`。该形状在 Runtime Services 边界上稳定；endpoint
背后的 provider 实现仍可替换：

```json
{
  "model": {
    "kind": "remote-http-json",
    "endpoint": "https://runtime.example/internal",
    "providerId": "remote-model"
  },
  "artifact": {
    "object": {
      "kind": "remote-http-json",
      "endpoint": "https://runtime.example/internal",
      "providerId": "remote-object"
    },
    "manifest": {
      "kind": "remote-http-json",
      "endpoint": "https://runtime.example/internal",
      "providerId": "remote-rds-manifest"
    }
  },
  "record": {
    "kind": "remote-http-json",
    "endpoint": "https://runtime.example/internal",
    "providerId": "remote-record"
  },
  "vector": {
    "kind": "remote-http-json",
    "endpoint": "https://runtime.example/internal",
    "providerId": "remote-vector"
  }
}
```

每个远程 adapter 都是相对于 `endpoint` 的 JSON-over-HTTP POST 契约。当前
adapter route 包括：

- `/resources/probe`
- `/models/complete`
- `/models/embedding`
- `/models/image`
- `/objects/put`
- `/objects/get`
- `/objects/delete`
- `/artifacts/insert`
- `/artifacts/list`
- `/artifacts/get`
- `/artifacts/delete`
- `/records/upsert`
- `/records/get`
- `/records/query`
- `/records/delete`
- `/vectors/upsert`
- `/vectors/search`

Storage route 携带调用方拥有的隔离键：

- `/objects/put`：`{ namespace, key, bodyBase64, mimeType? }`
- `/objects/get`：`{ path }`
- `/objects/delete`：`{ path }`
- `/artifacts/list`：`{ namespace }`
- `/artifacts/get`：`{ namespace, id }`
- `/artifacts/delete`：`{ namespace, id }`
- `/records/upsert`：`{ namespace, tableName, id, data, metadata? }`
- `/records/get`：`{ namespace, tableName, id }`
- `/records/query`：`{ namespace, tableName, limit? }`
- `/records/delete`：`{ namespace, tableName, id }`
- `/vectors/upsert`：`{ tableName, record }`
- `/vectors/search`：`{ tableName, embedding, limit?, filter? }`

`/vectors/search` 接受最小结构化的混合检索 filter：
`{ filter: { metadata: { key: string | number | boolean } } }`。这不是调用方
提供的 SQL DSL。本地 LanceDB 实现只在存在 `filter` 时把它编译成预过滤的
`where(...)` 谓词；未过滤的向量搜索保持普通 vector-search 路径。

显式 `headers` 支持受信任的本地/操作者配置。`headersSecretId` 被保留且当前会
被拒绝，避免在 provider 调用中出现尚未验证契约的密钥间接引用。

`/rpc` 是领域 agent 和构建 agent 消费者的本地表面。`/mcp` 保留为远程 MCP
Streamable HTTP adapter 表面，必须从 CapabilityRegistry 映射并显式限定暴露范围，
不能重新实现同一套能力逻辑。

Runtime service 输出使用通用 envelope，包含 `status`、`capabilityId`、
`providerId`、`modelId` 和 `evidence`。模型输出是类型化 proposal、embedding 或
artifact；它们不是执行 agent 的决策。

操作者 CLI 命令不能把失败的 Runtime Services envelope 格式化成成功的空输出。
`models smoke` 会打印每个模块的状态，并在任何模型 envelope 为 `missing_resource`
或 `failed` 时以非零状态退出；resource 和 doctor 命令会在报告中保留资源可用性，
同时仍然把非 `ok` 的 Runtime Services envelope 作为 CLI 错误暴露。

## 存储隔离

用户数据操作必须携带显式隔离键。Artifact 操作需要 `namespace`；record 操作需要
`namespace` 加 `tableName`；memory event、claim、relation 和 context 操作需要
`namespace`；vector upsert/search 需要 `tableName`。缺失隔离键会返回 failed
Runtime Services envelope，而不是回落到共享默认 bucket。

本地产物实现把字节存储在 `artifacts/<namespace>/` 下，只在 SQLite 中保存 manifest
metadata（`id`、`namespace`、path、MIME type、size、hash、timestamps 和 source
metadata）。SQLite 不用于向量存储或检索；本地向量存储和搜索使用由调用方提供
`tableName` 命名的 LanceDB table。

Artifact retrieval 通过显式 `namespace` 加 `id` 调用 `artifact.get`。它返回
manifest 和以 `bodyBase64` 表示的对象字节；SQLite 仍然是 manifest/RDS 风格的
metadata store，不存储 artifact body。可选 artifact expiration date 必须在进入
provider port 或本地 manifest 前就是有效日期字符串。

Record storage 通过 `record.upsert/get/query/delete` 暴露 JSON metadata record。
每次调用都使用显式 `namespace`、`tableName` 和适用的 record `id`；`record.query`
只按稳定的 createdAt/id 顺序列出同一个 namespace/table 中的 record。`record.query`
的 limit 为 `0` 时返回空 record set。二进制或大对象 body 留在 `artifact.*`。

记忆基底通过 `memory.event.*`、`memory.claim.*`、`memory.relation.*` 和
`memory.context.retrieve` 这个 `memory.*` Agent Service family 暴露。它把 source
event、extractor claim、通用 relation 和 retrieval bundle 保持在请求的
namespace 内，返回 agent-facing 上下文，而不是业务决策、审批、工具选择或行动。
可选 event timestamp 必须是有效日期字符串；retrieval `limit` 为 `0` 时返回空
bundle，不触碰 vector 或 memory provider。完整的 memory-substrate 设计依据和
验收契约位于
[`architecture/memory-substrate-prd.md`](architecture/memory-substrate-prd.md)。

Vector search 可以把相似度和精确顶层 metadata 预过滤组合起来。使用
`filter.metadata` 表达高频标量约束，例如 source、project、kind 或 tenant label。
值仅限 string、finite number 和 boolean；嵌套 JSON filter、原始 SQL 谓词、null
语义、range query 和 boolean expression DSL 都有意不进入 P0。`vector.search`
limit 为 `0` 时返回空结果集，不触碰 vector provider。

## RPC Client 示例

启动本地服务，然后运行或改造 `examples/client-sample.ts` 中的 TypeScript 示例：

```bash
agent-runtime-services serve --host 127.0.0.1 --port 8765
```

示例使用 `createRuntimeServicesRpcClient` 连接
`http://127.0.0.1:8765/rpc`，调用 `capabilities.describe` 做面向 agent 的发现，
然后通过公共 RPC 表面演示 model、artifact、record、memory、vector 以及
`resources.list/doctor/smoke/status` 流程。

需要在 RPC 上获得类型化 `RuntimeServices` 形状的消费者可以使用
`createRuntimeServicesRpcRuntime({ endpoint })`。更底层的调用方可以使用
`createRuntimeServicesRpcClient({ endpoint })` 并直接调用 capability id。

上游领域 agent 和构建 agent 集成可使用可复制的
`examples/upstream-agent-sample.md`。它展示了共享的 `RuntimeServicesPort`、本地
`/rpc` adapter，以及延后到未来的 `/mcp` 边界；该边界保持远程暴露与本地暴露分离，
同时共享同一个内部 Runtime Services 能力集合。

需要发现和判断可用能力的消费方 agent 应阅读
`examples/consumer-agent-capability-guide.md`。它记录了通过 `health`、`version`、
`capabilities.describe` 和 `resources.status` 完成启动的序列。消费者可以比较
`/rpc` 响应中的 `capabilityRevision`，在不读取本仓库的情况下在线检测公共能力变化，
然后刷新本地 capability cache。

## Product Development 边界

本 README 是 Product Development 的产品入口。它说明 runtime service 为用户和贡献者
提供什么、主要运行路径、公共能力、存储边界、包内容和操作者命令。

Product Development 包括 `src/`、`bin/`、`README.md`、`architecture/`、`examples/`、
公共契约、测试、harness 和 package metadata。这些文件必须保持可发布，且不能依赖
仓库维护材料。

仓库维护材料可以从 source checkout 中读取并索引这个产品表面。它不是 runtime
service 或 package payload 的一部分。产品 runtime code 不能 import 它。
