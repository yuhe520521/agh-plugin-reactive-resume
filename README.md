# Reactive Resume

由 gen-mcp-bridge.mjs 从 https://rxresu.me/mcp 的 tools/list 直接生成。

- 工具数：7（服务端共 7）
- 固定端点：`https://rxresu.me/mcp`（编译期常量，不接受环境变量覆盖；云端凭据只发往该地址）

## 安全行为

- 拒绝重定向：`fetch` 使用 `redirect: "error"`，3xx 直接失败，凭据不会被带到别的 host
- 取消与超时：接入 AGH 工具取消信号（`ctx.signal`），并与 30s 超时合并
- 响应上限：单次响应超过 512KB 立即中止读取
- 响应对应性：只接受 id 与本次请求一致的 JSON-RPC 响应，SSE 混流里的其它事件一律忽略
- 写操作确认：非只读工具每次执行前走 AGH `decisions` 端口请求确认，确认内容包含目标对象与拟执行参数
- 结果不确定时：写入过程中被取消、超时或读体失败，只报「远端写入结果未知」，不报成功也不报已撤销

## 自托管

本包不内置自托管开关。确实需要自托管时请另建插件包，使用插件专属配置与
只绑定目标 https 来源的**独立凭据**，不要把云端 key 指向自建地址。

## 凭据配置（首次使用必读）

这个插件本身**不携带**访问凭据，需要在运行 AGH 的环境里配置环境变量：

```
RXRESUME_API_KEY=<你的 key>
```

key 获取方式（摘自原插件文档）：Mint an API key at `https://rxresu.me/dashboard/settings/api-keys` and export it as `RXRESUME_API_KEY` — the bundle patch reads that variable. To set it explicitly, or to change any other option, patch the row by id from your profile's `cordis.patch.yml`:

配置后重启 AGH 或重新加载插件即可生效。未配置时工具调用会报
`RXRESUME_API_KEY is not configured` 或 `401 Sign-in required` ——
这属于运行环境未就绪，不是插件缺陷。

重新生成：`node gen-mcp-bridge.mjs --endpoint https://rxresu.me/mcp --key-env RXRESUME_API_KEY --prefix agh_agh_plugin_reactive_resume --out /home/node/agh-artifacts/agh-plugin-reactive-resume/agn-plugin --name @agh-hub/agh-plugin-reactive-resume`
