# OAS 探索28 Lite 控制台

一个极简的网页前端，专门面向 OnmyojiAutoScript 的「探索28 副本刷取」场景。
不修改 OAS 后端任何代码，只通过 HTTP / WebSocket 调用现有 API。

## 功能

- 自动检测后端在线状态（`GET /test`）
- 读取配置列表（`GET /config_list`），自动选第一个或带 `default` 的配置
- 显示并切换当前配置
- **一键应用探索28 预设**：第二十八章 / 单人 / 30 次 / 30 分钟 / 关闭组队、绘卷与切魂
- 启动 / 停止脚本（`GET /{script_name}/start|stop`）
- WebSocket 实时状态监听（`ws://<host>/ws/{script_name}`），自动重连按钮
- 底部日志面板显示所有 API 调用结果、错误信息与 WS 消息

## 一键启动（推荐）

双击 `oas-lite-web/start.bat`。脚本会：

1. 检查 `python` / `npm` 是否在 PATH 中
2. 如果第一次跑，自动执行 `npm install`
3. 弹出窗口 **OAS Backend** 运行 `python server.py`
4. 弹出窗口 **OAS Lite Web** 运行 `npm run dev`
5. Vite 自动打开浏览器到 `http://127.0.0.1:5173`

浏览器打开时后端可能还在加载（OCR 模型约 10-30 秒），
前端会显示「正在等待 OAS 后端就绪…」并每 2 秒自动重试，
后端就绪后会无缝进入控制台界面 —— 你不用做任何操作。

关闭对应窗口即可停止该服务。

> 第一次启动会 npm install，可能需要 1-3 分钟；之后再启动就只剩几秒。

## 手动启动

### 1. 启动 OAS 后端

在 OnmyojiAutoScript 根目录下：

```bash
python server.py
```

默认监听 `http://127.0.0.1:22288`（端口看 `deploy/config.yaml` 的 `WebuiPort`）。

### 2. 启动前端

```bash
cd oas-lite-web
npm install
npm run dev
```

启动后控制台会输出 Vite 的本地地址，浏览器打开即可。

### 3. 操作流程

1. 打开网页 → 顶部显示「后端已连接」「当前配置：xxx」
2. 点击中间卡片的 **应用探索28 预设** 按钮 → 日志栏会输出每条字段写入是否成功
3. 点击 **启动探索28** → 后端开始运行
4. 想停止时点 **停止脚本**
5. 状态栏会实时显示当前任务、下次任务、最新状态消息

## 配置后端地址

复制 `.env.example` 为 `.env.local`，按需修改：

```
VITE_OAS_BASE_URL=http://127.0.0.1:22288
```

## 排查：预设按钮点了没反应 / 报字段错误

OAS 后端在不同版本中字段名可能微调。前端**不会硬编码字段名**，会先调用
`GET /{script}/Exploration/args` 拿到当前结构，再根据 group/argument 写入。

如果某个字段写入失败，**打开浏览器开发者工具的控制台**，会看到形如：

```
[preset] writing exploration_config.exploration_level = 第二十八章 (type=string)
[preset] PUT /xxx/Exploration/exploration_config/exploration_level/value?types=string -> 200
```

或失败：

```
[preset] WARN: argument "minions_cnt" not found in group "exploration_config"
        available args: [...]
```

也会同步打到页面底部日志面板。排查步骤：

1. 看「available args」列表里有没有同名的字段（驼峰 vs 下划线？是否被改名？）
2. 看 group 名是否正确（默认我们用：`exploration_config` / `scrolls` /
   `switch_soul_config`）
3. 在 `src/api/oasClient.ts` 里 `applyExploration28Preset()` 调整字段名即可，无需改后端。

## 不修改 / 不重写

- 不动 `module/`、`tasks/`、`deploy/`、`server.py`
- 不重写 Exploration 任务逻辑
- 不替代 OASX / fluentui，仅做「探索28」专用极简控制台

## 目录结构

```
oas-lite-web/
├─ package.json
├─ index.html
├─ vite.config.ts
├─ tsconfig.json
├─ .env.example
├─ README.md
└─ src/
   ├─ main.tsx
   ├─ App.tsx
   ├─ api/
   │  └─ oasClient.ts
   ├─ hooks/
   │  └─ useOasStatus.ts
   ├─ components/
   │  ├─ Header.tsx
   │  ├─ BackendStatus.tsx
   │  ├─ ExplorationPresetCard.tsx
   │  ├─ ControlPanel.tsx
   │  └─ LogPanel.tsx
   └─ styles/
      └─ main.css
```
