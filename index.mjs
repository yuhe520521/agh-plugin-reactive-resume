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

// 端点是编译期常量，不接受环境变量覆盖：
// 云端凭据只随这一个 https 上游发送，任何能改地址的通道都不再带着 key 跑。
const ENDPOINT = "https://rxresu.me/mcp"
const ENDPOINT_HOST = "rxresu.me"
const API_KEY_ENV = 'RXRESUME_API_KEY'
const MAX_RESPONSE_BYTES = 512 * 1024
const REQUEST_TIMEOUT_MS = 30000

// 需要自托管时另建插件包，配插件专属配置与只绑定该 https 来源的独立凭据；
// 不要靠改这里复用云端 key —— 那等于把云端凭据发往任意域名。
function resolveTarget() {
  const apiKey = process.env[API_KEY_ENV]
  if (!apiKey) throw new Error(API_KEY_ENV + ' is not configured')
  return { endpoint: ENDPOINT, apiKey: apiKey }
}

// 响应必须限量：远端返回超大 JSON 时会直接把上下文挤爆
async function readLimitedBody(res) {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      total += chunk.value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        try { await reader.cancel() } catch { /* ignore */ }
        throw new Error('响应超过 ' + MAX_RESPONSE_BYTES + ' 字节上限，已中止读取')
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    try { reader.releaseLock() } catch { /* ignore */ }
  }
  return text
}

// JSON-RPC 响应必须对应本次请求：SSE 流里可能夹着别的请求的事件，
// 只认 id 相同的那条，取不到就报错，绝不把别人的 result 当成本次结果。
function pickRpcResponse(rawText, rpcId) {
  const trimmed = rawText.trim()
  if (!/^(data:|event:)/.test(trimmed)) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return null
    }
  }
  for (const line of rawText.split('\n')) {
    if (!line.startsWith('data:')) continue
    const body = line.slice(5).trim()
    if (!body || body === '[DONE]') continue
    try {
      const parsed = JSON.parse(body)
      if (parsed && String(parsed.id) === String(rpcId)) return parsed
    } catch { /* ignore */ }
  }
  return null
}

async function callMcpTool(toolName, args, ctx, options) {
  const mutating = Boolean(options && options.mutating)
  const target = resolveTarget()
  const rpcId = 'agh-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
  // 同时绑定 AGH 的取消信号和本插件超时：用户中断时连接与读体都要断
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = ctx && ctx.signal ? AbortSignal.any([ctx.signal, timeoutSignal]) : timeoutSignal

  let res
  try {
    res = await fetch(target.endpoint, {
      method: 'POST',
      // 拒绝重定向：跟随 3xx 会把 x-api-key 带到另一个 host
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'x-api-key': target.apiKey,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcId, method: 'tools/call', params: { name: toolName, arguments: args } }),
      signal: signal,
    })
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      if (mutating) throw new Error('请求已取消或超时：远端写入结果未知（既不代表成功，也不代表已撤销），请先读取实际状态再决定是否重试')
      throw new Error('请求已取消或超时：' + toolName)
    }
    throw err
  }

  let rawText
  try {
    rawText = await readLimitedBody(res)
  } catch (err) {
    if (mutating) throw new Error('读取响应失败（' + ((err && err.message) || err) + '）：远端写入结果未知，请先读取实际状态')
    throw err
  }

  if (!res.ok) {
    throw new Error('MCP request failed with status ' + res.status + ': ' + rawText.slice(0, 200))
  }

  const data = pickRpcResponse(rawText, rpcId)
  if (!data) throw new Error('未收到对应本次请求的 JSON-RPC 响应（id 不匹配或响应无法解析）')
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
  name: "agh_reactive_resume" + '_' + rawName,
  remoteName: rawName,
  description: def.description,
  parameters: tb(def.input),
}))

const readOnlyHint = ["list_resumes","read_resume"]

export const aghPluginReactiveResume = {
  id: 'ext:agh-hub/agh-plugin-reactive-resume/main',
  name: 'agh-plugin-reactive-resume',
  version: '0.2.1',
  apiRange: '^5.9.0',
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
          // 写工具一律 'always'：outward 检查点要求这个值，且 destructive 只是描述性语义，
          // 不能替代「每次都问一次」。
          requiresApproval: readOnly ? 'never' : 'always',
          // 声明 outward，由宿主在每个调用上停一次等人批：只给「允许一次 / 拒绝」，
          // 全权限、auto-review、命令表规则、各类 grant 与 hook 都不能替人批准。
          // 插件自己不再走 ctx.decisions —— 两层确认会变成连续弹两次，
          // 而且手写那层在 full-access 下可能被自动通过，正是这次被指出的问题。
          ...(readOnly ? {} : { outward: true }),
        },
        async execute(args, ctx) {
          return textResult(await callMcpTool(def.remoteName, args || {}, ctx, { mutating: !readOnly }))
        },
      })
    }
  },
}

export default aghPluginReactiveResume
