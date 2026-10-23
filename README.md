# Yuque Local MCP

让 AI 助手搜索、读取和编辑你的语雀知识库。使用浏览器登录 Cookie，无需 Personal Token。

## 1. 安装

准备 Node.js 18 或更新版本，以及支持 MCP 的 AI 客户端。

```sh
git clone https://github.com/rota1111/yuque-local-mcp.git
cd yuque-local-mcp
```

## 2. 配置登录凭证

在浏览器中登录语雀，打开开发者工具：

1. 点击 **Application（应用）** 面板；如果没有显示，在顶部 **`»`** 中查找。
2. 在左侧 **Storage（存储）→ Cookies** 下，选择当前语雀域名。
3. 找到 `_yuque_session`，复制对应的 **Value（值）**。

部分浏览器将 Cookie 管理放在独立的 **Storage（存储）** 面板中。

运行：

```sh
npm run setup
```

按提示填写语雀站点并粘贴 Cookie。输入不会显示，凭证保存在本机。登录过期后重新运行即可，请勿将 Cookie 发到聊天中。

## 3. 连接 AI 客户端

向 AI 助手发送：

> 帮我找到本机下载的 yuque-local-mcp 项目，并将它添加为当前客户端的 MCP 服务，工具超时时间设为 600 秒。

配置完成后，重载 MCP 服务即可使用。

## 4. 开始使用

直接对 AI 助手说：

- “列出我的语雀知识库，并记住入口。”
- “在这个知识库中搜索 Transformer。”
- “读取这篇文档，帮我总结。”
- “同步这个知识库的前 20 篇文档，之后从本地搜索。”
- “在这个知识库中新建一篇文档，先给我看预览。”
- “在这篇文档末尾追加以下内容，先给我看预览。”

团队或受邀知识库，首次使用时提供知识库链接。写入会先生成预览，再执行。

## 工具列表

| 工具 | 用途 |
| --- | --- |
| `yuque_status` | 查看本地配置和缓存状态 |
| `yuque_login` | 获取登录凭证配置说明 |
| `yuque_list_books` | 列出自有个人知识库 |
| `yuque_sources` | 查看或添加知识库入口 |
| `yuque_list_docs` | 获取知识库文档目录 |
| `yuque_read` | 读取文档并缓存到本地 |
| `yuque_web_search` | 在指定知识库中在线搜索 |
| `yuque_sync` | 同步知识库文档到本地 |
| `yuque_search` | 搜索已读取或同步的本地文档 |
| `yuque_prepare_write` | 预览创建、追加或替换文档 |
| `yuque_apply_write` | 执行写入计划 |

凭证和文档缓存保存在 `private/`，请勿上传或分享该目录。
