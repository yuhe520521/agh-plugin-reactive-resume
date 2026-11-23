# Reactive Resume

由 gen-mcp-bridge.mjs 从 https://rxresu.me/mcp 的 tools/list 直接生成。

- 工具数：7（服务端共 7）
- 覆盖端点：`https://rxresu.me/mcp`

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
