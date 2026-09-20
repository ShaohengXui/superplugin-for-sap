<p align="center">
  <img src="sp4sap.png" alt="SuperPlugin for SAP" width="720"/>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.ko.md">한국어</a> | <a href="README.ja.md">日本語</a> | <a href="README.de.md">Deutsch</a> | 中文
</p>

# SuperPlugin for SAP (sp4sap)

> 面向 **Claude Code、ZCode、Codex** 及任意 MCP 客户端的 SAP ABAP 开发工具 — 支持 SAP ECC / S/4HANA On-Premise / S/4HANA Cloud（公有云与私有云）

[![MCP server on npm](https://img.shields.io/npm/v/@babamba2/abap-mcp-adt-powerup?label=mcp-server&color=cb3837&logo=npm)](https://www.npmjs.com/package/@babamba2/abap-mcp-adt-powerup)
[![Plugin on npm](https://img.shields.io/npm/v/@shaohengxui/superplugin-for-sap?label=plugin&color=cb3837&logo=npm)](https://www.npmjs.com/package/@shaohengxui/superplugin-for-sap)
[![GitHub stars](https://img.shields.io/github/stars/ShaohengXui/superplugin-for-sap?style=flat&color=yellow)](https://github.com/ShaohengXui/superplugin-for-sap)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## sp4sap 是什么？

SuperPlugin for SAP 把你的编码助手变成一名全栈 SAP 开发助手。它通过 [MCP ABAP ADT 服务器](https://github.com/babamba2/abap-mcp-adt-powerup)（150+ 工具）连接你的 SAP 系统，直接创建、读取、修改、删除 ABAP 对象 —— 类、函数模块、报表、CDS 视图、Dynpro、GUI 状态等等。

SAP 能力位于 MCP 服务器中，因此**同一份安装服务于所有客户端**。Claude Code 额外获得 skill / agent 编排层（25 个专用 agent、14 个 workflow skill、按阶段模型路由）；ZCode 和 Codex 拿到完全相同的工具，可用 prompt 驱动。

## 快速开始

### 1. 安装

**Claude Code** —— 把本仓库加为自定义 marketplace，然后安装插件：

```
/plugin marketplace add https://github.com/ShaohengXui/superplugin-for-sap.git
/plugin install sp4sap
```

**ZCode、Codex 或其他 MCP 客户端** —— 一条命令自动检测本机已安装的客户端并完成注册：

```bash
git clone https://github.com/ShaohengXui/superplugin-for-sap.git
cd superplugin-for-sap
npm install

node bridge/cli.cjs install              # 注册到本机检测到的所有客户端
node bridge/cli.cjs install --dry-run    # 先预览，不改动任何文件
```

也可以只指定某一个客户端：

```bash
node bridge/cli.cjs install --client codex    # codex plugin + MCP，失败则回退 codex mcp add
node bridge/cli.cjs install --client zcode    # 写入 <repo>/.zcode/config.json
node bridge/cli.cjs install --client claude   # claude plugin，失败则回退 claude mcp add -s user
node bridge/cli.cjs install --mcp-only        # 跳过 skills/agents 插件，仅注册 MCP
```

执行 `npm i -g @shaohengxui/superplugin-for-sap` 之后，同样的命令可直接用 `sp4sap install`。用 `sp4sap status` 查看注册到了哪里，用 `sp4sap uninstall` 完整撤销。

> **请确认版本。** `sp4sap` CLI 从 **0.7.0** 起才有。如果 `sp4sap --version` 显示更早的版本，说明 npm 上的包早于安装器 —— 请改用上面的 clone + `node bridge/cli.cjs` 方式，或在检出目录里执行 `npm i -g .` 安装 CLI。

> **ZCode** 能读取 Claude Code 的插件布局，所以本仓库也可直接作为 ZCode 插件使用：**设置 → 插件管理 → 发现 → `+`**，填入检出目录路径（或 Git URL）。如果你用这种方式安装，就不要再执行 `--client zcode`，否则同一批工具会被注册两次。

### 2. 连接 SAP

```
/sp4sap:setup
```

向导会创建 profile、把密码存入**操作系统钥匙串**、安装并构建 MCP 服务器、安装写保护 hook，并执行连接测试。**不会**把任何敏感信息写进你的仓库。

已有 profile，或者用的是非 Claude 客户端？显式指向它即可：

```bash
sp4sap doctor          # 显示解析到的 profile、vendor pin 与当前 tier
```

### 3. 验证

```
/sp4sap:sap-doctor
```

或者直接让 agent 调用 `GetSession` —— 它会返回 SAP 系统 ID、client 和用户名。

> **环境要求** —— Node.js ≥ 20；已启用 ADT 的 SAP 系统（SICF 服务 `/sap/bc/adt` 处于激活状态）；以及具备 `S_DEVELOP` / `S_TRANSPRT` 权限的用户。

## 使用方式

### Claude Code —— workflow skill

```
/sp4sap:create-program    创建一张按供应商统计未清采购订单的 ALV 报表，支持按工厂和采购组织筛选
/sp4sap:create-object     创建自定义类 / 函数模块 / CDS 视图
/sp4sap:analyze-code      静态审查：Clean ABAP、性能、安全
/sp4sap:analyze-symptom   把 dump 或故障定位到根因
/sp4sap:program-to-spec   把对象逆向成功能/技术规格说明书
/sp4sap:compare-programs  对比 2–5 个同一场景下的程序
/sp4sap:package-to-process  把 CBO 包整理成端到端业务流程文档
/sp4sap:ask-consultant    咨询模块顾问（SD/MM/FI/CO/PP/PS/PM/QM/TR/HCM/WM/TM/BW/Ariba/BC）
/sp4sap:sap-option        切换 profile、调整 blocklist 策略、HUD 设置
```

也可以直接用自然语言描述任务 —— skill 会按关键词自动触发。

### 任意 MCP 客户端 —— 同一套工具

没有插件层就没有斜杠命令，但所有工具都可用；用自然语言提要求，客户端会自己选择工具。常见任务：

| 目标 | 涉及的工具 |
|------|-----------|
| 验证连接 | `GetSession` |
| 读取对象 | `GetClass`、`ReadClass`、`GetProgram`、`ReadProgram`、`GetFunctionModule` |
| 查找对象 | `SearchObject`、`GetPackageContents`、`GetWhereUsed` |
| 创建 / 修改对象 | `Create*` → `Update*` → `ActivateObjects` |
| 测试 | `RunUnitTest`、`GetUnitTestResult`、`GetAbapSemanticAnalysis` |
| 传输请求 | `ListTransports`、`GetTransport`、`CreateTransport` |
| 故障诊断 | `RuntimeListDumps`、`RuntimeGetDumpById`、`RuntimeAnalyzeDump` |

在任意客户端都可用的示例 prompt：

```
读取 ABAP 类 ZCL_SD_ORDER_VALIDATOR，总结它的作用。
创建一张按供应商统计未清采购订单的 ALV 报表，支持按工厂筛选。
检查 Z_MM_PURCHASE_ORDER_CREATE 是否存在 Clean ABAP 违规和性能问题。
列出我名下所有未释放的传输请求，并总结其中的内容。
```

### QA 与 Prod 的写保护

只要注册了 QA 或 Prod profile 就自动生效，无需任何开关。三层独立防护，绕过其中一层仍会被其余层拦住：

| 层 | 位置 | 生效范围 |
|----|------|---------|
| **L1** | 客户端 `PreToolUse` hook（`scripts/hooks/tier-readonly-guard.mjs`），由 `/sp4sap:setup` 安装 | Claude Code |
| **L1.5** | bridge 内的 MCP 代理（`SC4SAP_TIER_GUARD=proxy`） | 任意 stdio 客户端 —— 对 Codex / ZCode 默认开启（不假设其 hook 覆盖能力） |
| **L2** | `abap-mcp-adt-powerup` 内部，无法绕过 | 所有客户端，始终生效 |

在 QA 与 Prod 上，变更类操作（`Create*` / `Update*` / `Delete*` / `Patch*` / `Write*` / `Activate*`）与 ABAP 执行类操作（Prod 上的 `RunUnitTest`、`RuntimeRun*`）都会被拒绝。QA 上 `RunUnitTest` 仍然可用。只读取 dump 和 trace 的诊断工具在两者上都保留。

在会话中切换环境：Claude Code 用 `/sp4sap:sap-option`，其他客户端把 `SC4SAP_ENV_FILE` 指向另一个 profile 的 `sap.env`。

## 核心能力

| 能力 | 说明 |
|------|------|
| 🔌 **MCP 自动安装** | `abap-mcp-adt-powerup` 在 `/sp4sap:setup` 过程中自动安装、配置并完成连接测试，无需手工接线。 |
| 🌐 **多环境 Profile（Dev / QA / Prod）** | 按公司注册多套 SAP 系统（如 `KR-DEV`、`KR-QA`、`KR-PRD`、`US-DEV`），在会话中通过 `/sp4sap:sap-option` 热切换。**QA 与 Prod profile 自动受保护**：三层防护（客户端 PreToolUse hook + MCP 层代理 + MCP 服务器 guard）拦截 `Create*/Update*/Delete*/Patch*/Write*/Activate*`、`CreateTransport` 及运行时代码执行工具 —— 绕过一层不等于绕过全部。密码存放在**操作系统钥匙串**（`@napi-rs/keyring` —— Windows 凭据管理器 / macOS Keychain / libsecret），因此 `.sc4sap/` 永远不会把密钥泄漏进 git。产物（规格书、CBO 清单、审计报告）按 profile 隔离，并提供只读的跨 profile 查看，使 QA 会话能查阅 Dev 产出的规格而不污染它们。 |
| 🏗️ **格式化自动建程序** | 端到端生成 ABAP 程序：Main + 条件 Include（OOP / 过程式）、完整 ALV + Docking、Dynpro + GUI 状态、必备文本元素、ABAP Unit 测试 —— 并识别平台差异（ECC / S4 On-Prem / Cloud）。 |
| 🔍 **程序分析** | 通过 MCP 读取任意 ABAP 对象，执行 Clean ABAP / 性能 / 安全审查，或逆向成功能与技术规格（Markdown / Excel）。 |
| 🧪 **代码分析** | `/sp4sap:analyze-code` —— 独立的静态审查（`sap-code-reviewer`）：Clean ABAP、性能、安全、SAP 标准符合度。按严重程度排序，并给出具体修复建议。 |
| 🔀 **程序对比** | `/sp4sap:compare-programs` —— 对 2–5 个同一场景但按模块（MM/CO）、国家（KR/EU）或角色（controller/warehouse）拆分的程序做业务层面并排对比。产出面向顾问的 Markdown 报告，覆盖 10 个可配置维度。 |
| 🗺️ **包 → 流程** | `/sp4sap:package-to-process` —— 把 CBO 包逆向成**端到端业务流程**文档：自动识别 TCode 入口 → AI 流程分组（PR→PO→GR→IR）→ 逐流程叙述 + Mermaid 流程图 / 时序图 + 步骤表格。缺少 CBO 清单时自动串联 `sap-stocker`。→ `.sc4sap/processes/<MODULE>/<PACKAGE>/`。 |
| 🩺 **运维诊断** | 运维排障闭环：ST22 dump、SM02 系统消息、/IWFND/ERROR_LOG、profiler trace、日志、where-used 关系图 —— 全部在助手内完成。 |
| ♻️ **CBO 复用（棕地加速器）** | 对 Z 包做一次清单化 —— `create-program` / `program-to-spec` 会优先复用已有 CBO 资产，而不是重复造轮子。 |
| 🧷 **CBO 扩展点识别（CMOD / GGB1·2 / BAdI / APPEND）** | 清单化 user-exit（CMOD）、替代与校验（GGB1/GGB2）、BAdI 实现以及 APPEND 结构。`create-program` / BAPI 流程优先复用已有 Extension 字段（如 BAPI `EXTENSIONIN` / 表追加）而非新建 CBO；dump 与故障诊断会把 Extension 点作为一等嫌疑对象检查。 |
| 🏭 **行业上下文** | 14 份行业参考文件（零售、时尚、化妆品、轮胎、汽车、制药、食品饮料、化工、电子、建筑、钢铁、公用事业、银行、公共部门）。 |
| 🌏 **国家 / 本地化** | 15 份国别文件 + 欧盟通用（KR/JP/CN/US/DE/GB/FR/IT/ES/NL/BR/MX/IN/AU/SG）。覆盖电子发票、银行、薪酬、税务本地化。 |
| 🧩 **激活模块感知** | 跨模块集成提示：MM + PS 激活 → 在 MM 的 CBO 上自动提示 WBS 字段；SD + CO 激活 → CO-PA 推导。[详情 →](common/active-modules.md) |
| 🤝 **模块咨询** | `sap-analyst` / `sap-critic` / `sap-planner` / `sap-architect` 在需要业务判断时委派给 14 位模块顾问 + 1 位 BC 顾问。用户也可通过 `/sp4sap:ask-consultant` 直接提问 —— 按关键词自动路由到 SD/MM/FI/CO/PP/PS/PM/QM/TR/HCM/WM/TM/BW/Ariba/BC，并基于已配置的 SAP 环境（版本、行业、国家、激活模块）作答，只读。 |
| ⚡ **按阶段模型路由** | 每个 skill 都面向一个经过成本调优的主线程档位（配置 / 诊断 / 问答用 Haiku，analyze / create / compare 的编排用 Sonnet），同时把重活委派给专用 agent（新代码生成为主、跨模块综合与故障定位用 Opus；事实提取用 Sonnet；报告渲染用 Haiku）。主线程档位是声明式的 —— 运行时主模型跟随用户会话模型；而按阶段的 `Agent()` 派发确实运行在其声明的档位上。模型选择在每次响应的前缀与每阶段横幅中可见（如 `▶ phase=3 (writer-spec) · agent=sap-writer · model=Opus 4.7`）。完整的逐 skill、逐阶段矩阵见 [docs/skill-model-architecture.md](docs/skill-model-architecture.md)。 |

## 文档

- 📦 **[安装与配置 →](docs/INSTALLATION.md)** —— 环境要求、安装方式、向导步骤、blocklist 配置
- 🎯 **[功能详解 →](docs/FEATURES.md)** —— 25 个 agent、14 个 skill、MCP 工具、RFC 后端、hook、数据提取策略
- 🔌 **[MCP 客户端接入 →](mcp/README.md)** —— 接入 ZCode、Codex、Claude Desktop 或任意 MCP 客户端；配置模板；各客户端的写保护分层
- 🧭 **[多客户端改造 →](docs/multi-client-migration.md)** —— 哪些是 Claude Code 专有、哪些是 MCP 通用能力；分阶段改造、风险与回退
- 🧠 **[Skill 模型架构 →](docs/skill-model-architecture.md)** —— 逐 skill / 逐阶段的模型分配（Haiku 4.5 / Sonnet 4.6 / Opus 4.7）、模型覆盖模式、升级阶梯、设计依据
- 📜 **[更新日志 →](docs/CHANGELOG.md)** —— 版本历史与破坏性变更

## Unleashed

<p align="center">
  <a href="sp4sap_unleashed.png">
    <img src="sp4sap_unleashed.png" alt="SuperPlugin for SAP Unleashed" width="100%"/>
  </a>
</p>

## 作者

- **paek seunghyun** &nbsp; [![LinkedIn](https://img.shields.io/badge/-LinkedIn-0A66C2?style=flat-square&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/seunghyun-paek-5b83b7183/)

## 贡献者

- **김시훈 (Kim Sihun)** &nbsp; [![LinkedIn](https://img.shields.io/badge/-LinkedIn-0A66C2?style=flat-square&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/sihun-kim-27737132b/)

## 致谢

本项目的灵感来自 **허예찬 (Hur Ye-chan)** 的 [**oh-my-claudecode**](https://github.com/huryechan/oh-my-claudecode)。这里的多 agent 编排模式、苏格拉底式深度访谈门控、持久循环等概念，以及整体插件设计哲学，都可追溯到那份工作。

**fr0ster** 的 [**mcp-abap-adt**](https://github.com/fr0ster/mcp-abap-adt) 对我们构建定制 MCP 服务器（`abap-mcp-adt-powerup`）贡献巨大。其在 ADT-over-MCP 上的开创性工作 —— 请求构造、端点覆盖、对象读写 —— 为我们在设计与扩展自己的服务器时提供了概念基础。

## 许可证

[MIT](LICENSE)
