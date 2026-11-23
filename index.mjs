// 由 gen-mcp-bridge.mjs 从 MCP 服务端 schema 直接生成，勿手改
const Kind = Symbol.for('TypeBox.Kind')

const SCHEMAS = {
  "list_resumes": {
    "description": "list_resumes（参数透传：本工具的参数 schema 未从服务端在线获取）",
    "input": {
      "type": "object",
      "properties": {}
    }
  },
  "read_resume": {
    "description": "read_resume（参数透传：本工具的参数 schema 未从服务端在线获取）",
    "input": {
      "type": "object",
      "properties": {}
    }
  },
  "apply_resume_patch": {
    "description": "apply_resume_patch（参数透传：本工具的参数 schema 未从服务端在线获取）",
    "input": {
      "type": "object",
      "properties": {}
    }
  },
  "update_resume": {
    "description": "update_resume（参数透传：本工具的参数 schema 未从服务端在线获取）",
    "input": {
      "type": "object",
      "properties": {}
    }
  },
  "import_resume": {
    "description": "import_resume（参数透传：本工具的参数 schema 未从服务端在线获取）",
    "input": {
      "type": "object",
      "properties": {}
    }
  },
  "unlock_resume": {
    "description": "unlock_resume（参数透传：本工具的参数 schema 未从服务端在线获取）",
    "input": {
      "type": "object",
      "properties": {}
    }
  },
  "lock_resume": {
    "description": "lock_resume（参数透传：本工具的参数 schema 未从服务端在线获取）",
    "input": {
      "type": "object",
      "properties": {}
    }
  }
}

// JSON Schema -> TypeBox 节点。AGH 靠 Symbol 键识别 kind，缺了会被判 schema 无法解释。
function tb(schema) {
  if (!schema || typeof schema !== 'object') return { [Kind]: 'Any', type: 'object', properties: {} }
  if (Array.isArray(schema.anyOf)) {
    const variants = schema.anyOf.map(tb)
    return { [Kind]: 'Union', anyOf: variants }
  }
  const desc = typeof schema.description === 'string' ? { description: schema.description } : {}
  switch (schema.type) {
    case 'string':
      return { [Kind]: 'String', type: 'string', ...desc, ...(schema.enum ? { enum: schema.enum } : {}) }
    case 'number':
      return { [Kind]: 'Number', type: 'number', ...desc }
    case 'integer':
      return { [Kind]: 'Integer', type: 'integer', ...desc }
    case 'boolean':
      return { [Kind]: 'Boolean', type: 'boolean', ...desc }
    case 'array':
      return { [Kind]: 'Array', type: 'array', items: tb(schema.items), ...desc }
    case 'object':
    case undefined: {
      const props = {}
      for (const [k, v] of Object.entries(schema.properties || {})) props[k] = tb(v)
      const required = Array.isArray(schema.required) ? schema.required : []
      const node = { [Kind]: 'Object', type: 'object', properties: props, ...desc }
      if (required.length) node.required = required
      // 允许自由字段的（additionalProperties: true），显式带上，别用 undefined 让底层崩
      if (schema.additionalProperties === true) node.additionalProperties = true
      return node
    }
    default:
      return { [Kind]: 'Any', type: 'object', properties: {} }
  }
}

async function callMcpTool(toolName, args) {
  const endpoint = process.env.MCP_ENDPOINT || "https://rxresu.me/mcp"
  const apiKey = process.env.RXRESUME_API_KEY
  if (!apiKey) throw new Error('RXRESUME_API_KEY is not configured')

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: args } }),
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error('MCP request failed with status ' + res.status + ': ' + body.slice(0, 200))
  }

  const rawText = await res.text()
  let data
  if (/^s*(data:|event:)/.test(rawText)) {
    for (const line of rawText.split('\n')) {
      if (!line.startsWith('data:')) continue
      const body = line.slice(5).trim()
      if (!body || body === '[DONE]') continue
      try { data = JSON.parse(body) } catch { /* ignore */ }
    }
    if (!data) throw new Error('MCP 返回 SSE 但无法解析出 JSON-RPC 响应')
  } else {
    data = JSON.parse(rawText)
  }

  if (data.error) throw new Error('MCP error: ' + JSON.stringify(data.error))
  if (data.result && Array.isArray(data.result.content)) {
    const text = data.result.content.map((c) => c.text || '').join('\n')
    if (data.result.isError) throw new Error(text || 'MCP tool returned an error')
    return text
  }
  return JSON.stringify(data.result ?? '')
}

const textResult = (text) => ({ content: [{ type: 'text', text: String(text ?? '') }] })

const TOOL_DEFS = Object.entries(SCHEMAS).map(([rawName, def]) => ({
  name: "agh_agh_plugin_reactive_resume" + '_' + rawName,
  remoteName: rawName,
  description: def.description,
  parameters: tb(def.input),
}))

const readOnlyHint = []

export const aghPluginReactiveResume = {
  id: 'ext:agh-hub/agh-plugin-reactive-resume/main',
  name: 'agh-plugin-reactive-resume',
  version: '0.1.0',
  apiRange: '^5.0.0',
  inject: ['tools'],
  apply(ctx) {
    for (const def of TOOL_DEFS) {
      const readOnly = readOnlyHint.includes(def.remoteName)
      // 「不是只读」不等于「破坏性」。新建/更新/导入这类写操作会改变数据，但不会毁掉已有内容，
      // 把它们一并标成 destructive 会让用户以为有风险，审批提示也失去区分度。
      // 只有真正删改已有数据的才配 destructive。
      const destructive = /delete|remove|destroy|trash|purge|wipe|erase|reset|clear/i.test(def.remoteName)
      ctx.tools.register({
        name: def.name,
        description: def.description,
        parameters: def.parameters,
        meta: {
          isReadOnly: readOnly,
          isDestructive: destructive,
          isConcurrencySafe: readOnly,
          isOpenWorld: true,
          replay: readOnly ? 'safe' : 'never',
          costHint: {},
          deferLoading: true,
          discoveryGroup: 'agh-plugin-reactive-resume',
          requiresApproval: readOnly ? 'never' : destructive ? 'destructive' : 'always',
        },
        async execute(args) {
          return textResult(await callMcpTool(def.remoteName, args || {}))
        },
      })
    }
  },
}

export default aghPluginReactiveResume
