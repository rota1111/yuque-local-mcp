# 实现依据

此次为独立实现，未整体复制或运行第三方项目。参考的是认证流程、已存在的只读接口和工具划分。

- https://github.com/yuque/yuque-mcp-server ：官方工具拆分（知识库、目录、文档、搜索）；Token 模式不解决本项目的会员限制。
- https://github.com/andy8663/yuque-mcp-tool/blob/main/src/yuque_mcp/server.py ：Cookie HTTP 请求、页面 window.appData、嵌套 book.toc、GET /api/docs/{slug}?book_id=。
- https://github.com/n1ngPh/yuque-web-mcp/blob/main/src/yuque-client.ts ：凭证域名绑定、CSRF 请求头、失败显式报错、个人知识库搜索范围。
- https://github.com/n1ngPh/yuque-web-mcp/blob/main/contracts/yuque-web-2026-08-14.json ：GET /api/zsearch，data.hits/totalHits/info.scope；GET /api/mine/personal_books。
- https://github.com/yehuoshun/yuque-ai-mcp ：对比 OpenAPI 与 Cookie Web API 工具的认证区别。未将其所有工具直接搬入本项目。

第三方标记为 verified 不代表本项目已用真实账号验证。网页内部接口可能变化；在线结果结构或搜索范围未知时直接报错。没有自动解决验证码或浏览器验证的功能。

## v0.3 写入依据

- https://github.com/c-sunc6/yuque-cookie-plugin/blob/main/src/client-cookie.ts ：以 mode=edit 读取编辑快照，使用 draft_version 保存 body_asl/body_draft_asl，再发布。
- https://github.com/n1ngPh/yuque-web-mcp/blob/main/src/yuque-client.ts ：Markdown 转 Lake、根目录创建字段、一次写入和回读流程。
- 本项目独立实现计划、备份、版本校验、重复执行保护。创建请求仅发送原生Lake正文，由语雀处理渲染；未引入第三方Lake运行时。
- 2026-10-15：在专门新建的普通文档上，已实测创建、追加、替换、发布和编辑内容回读；未覆盖所有富文本、团队空间或同时编辑情形。
