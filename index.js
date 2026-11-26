import { KnowledgeStore } from './src/core/store.js'
import { registerKnowledgeTools, takeCitedSince, clearCitedBefore, takeUpdatedSince } from './src/tools.js'
import { registerApi } from './src/api.js'
import { syncAllLibraries } from './src/core/sync-all.js'

const PROMPT = `
## 知识库规则（dsh-knowledge-manager）

1. 用户提出**新的要求或新任务**时，默认先调用一次 kb_search 检索知识库（每次新要求都允许、也鼓励重新检索，不要因为“刚查过”而跳过）；同一轮内是否需要多次检索由你按需判断。
2. 检索结果有命中时结合命中内容回答，不必在正文里手动标注来源（界面会显示本轮引用）；没有命中就正常回答。
3. 除“新要求先检索”外，其余工具调用完全按需：一轮中可以多次调用、也可以不调用，不做硬性要求。
4. **每次对话正常结束前**检查本轮是否产生了值得保存的知识：有就写入，没有就不写，不要为凑数而记录。
5. 值得记录的是：用户明确认可（如“很棒”“就这样”）或默许为正确（没有反对且继续采用）的内容、踩过的坑、项目约定与配置事实。闲聊、临时状态、未完成的尝试不要记录。
6. 记录时把知识拆成独立的知识点，一条只记一个事实，用 kb_record 写入；一轮可以记多条，但不要把一段长总结塞进一条。默认为默许认可（tier=tentative）；用户明确夸奖或确认的记 tier=accepted。
7. 不确定是否为正确结论时不要记录；疑似包含敏感信息时标 sensitivity=uncertain。
8. 禁止记录密码、口令、token、密钥、账号、身份证、手机号等凭据与隐私；禁止记录公司经营、财务、合同、客户名单等敏感信息。
9. 失败教训、踩过的坑、项目约定与配置事实值得记录；同一事实重复出现时不必重复记录。
10. 需要新主题表时用 kb_create_table，需要新主题库时用 kb_create_library（库名以 agent- 开头）；不要删除知识，删除由用户在侧栏完成。
`.trim()

export const inject = ['tools', 'systemPrompt']

export function apply(ctx, config = {}) {
  const toolsEnabled = config?.tools === true
  const promptEnabled = config?.prompt === true

  ctx.effect(() => {
    const store = new KnowledgeStore()
    const ready = store.init().catch((err) => {
      try {
        ctx.logger?.warn?.(`[knowledge] init failed: ${err?.message ?? err}`)
      } catch {
        /* logging must never break activation */
      }
    })

    const disposers = []
    const getStore = async () => {
      await ready
      return store
    }

    try {
      ctx.inject(['webServer'], (scoped) => {
        try {
          disposers.push(registerApi(scoped, getStore))
        } catch (err) {
          try {
            ctx.logger?.warn?.(`[knowledge] api routes failed: ${err?.message ?? err}`)
          } catch {
            /* ignore */
          }
        }
      })
    } catch (err) {
      try {
        ctx.logger?.warn?.(`[knowledge] api injection failed: ${err?.message ?? err}`)
      } catch {
        /* ignore */
      }
    }

    // Record which knowledge was created during each assistant message so the
    // per-message knowledge box can match it by message id.
    const recordAssistant = (a, b) => {
      try {
        const event = b?.type ? b : a?.type ? a : undefined
        const sessionArg = b?.type ? a : a?.type ? b : undefined
        const data = event?.data
        if (event?.type !== 'assistant/message' || !data?.message?.id) return
        const sessionKey =
          String(sessionArg?.id ?? event.sessionId ?? data.sessionId ?? '') || 'global'
        const lastAt = store.attribCursor(sessionKey)
        const since = lastAt || new Date(Date.now() - 10 * 60_000).toISOString()
        const attributed = store.attributedIds()
        const created = store.idsCreatedSinceAllLibraries(since).filter((id) => !attributed.has(id))
        const sinceMs = Date.parse(since) || Date.now() - 10 * 60_000
        const updated = takeUpdatedSince(sinceMs).filter((id) => !created.includes(id))
        const cited = takeCitedSince(sinceMs).filter((id) => !created.includes(id) && !updated.includes(id))
        const states = {}
        try {
          for (const lib of store.listLibraries()) {
            for (const id of [...created, ...updated]) {
              const entry = store.getEntry(lib.name, id)
              if (entry) states[id] = entry.sensitivity
            }
          }
        } catch {
          /* ignore */
        }
        const stamp = new Date().toISOString()
        if (created.length || cited.length || updated.length) {
          store.recordTurn({
            turnId: String(typeof data.turn === 'string' ? data.turn : (data.turn?.id ?? data.message.id)),
            messageId: data.message.id,
            sessionId: sessionKey === 'global' ? '' : sessionKey,
            created,
            updated,
            cited,
            states,
          })
        }
        clearCitedBefore(Date.parse(stamp))
        store.setAttribCursor(sessionKey, stamp)
      } catch {
        /* bookkeeping must never break the message path */
      }
    }
    try {
      ctx.on('session/event', recordAssistant)
    } catch (err) {
      try {
        ctx.logger?.warn?.(`[knowledge] session/event listener failed: ${err?.message ?? err}`)
      } catch {
        /* ignore */
      }
    }
    try {
      ctx.on('assistant/message', recordAssistant)
    } catch {
      /* the session/event listener above is the primary path */
    }

    // Background sync: once at startup (pull → push → backup) and then on an interval.
    if (config?.sync !== false) {
      const credentials = ctx.get?.('credentials')
      const runSync = async () => {
        try {
          await ready
          if (!store.listConnections().length) return
          await syncAllLibraries({ store, credentials })
        } catch (err) {
          try {
            ctx.logger?.warn?.(`[knowledge] sync failed: ${err?.message ?? err}`)
          } catch {
            /* ignore */
          }
        }
      }
      let interval = Math.max(Number(config?.syncIntervalMs) || 60_000, 30_000)
      try {
        const configured = store.getSetting?.('syncIntervalSec', null)
        if (configured) interval = Math.max(Number(configured) * 1000, 30_000)
      } catch {
        /* keep default */
      }
      const timer = setTimeout(runSync, 1_500)
      const repeater = setInterval(runSync, interval)
      disposers.push(() => {
        clearTimeout(timer)
        clearInterval(repeater)
      })
    }

    if (toolsEnabled) {
      try {
        disposers.push(...registerKnowledgeTools(ctx, getStore))
      } catch (err) {
        try {
          ctx.logger?.warn?.(`[knowledge] tool registration failed: ${err?.message ?? err}`)
        } catch {
          /* ignore */
        }
      }
    }

    if (promptEnabled) {
      try {
        disposers.push(
          ctx.systemPrompt.section({
            name: 'plugin:dsh-knowledge-manager',
            order: 640,
            text: PROMPT,
          }),
        )
      } catch (err) {
        try {
          ctx.logger?.warn?.(`[knowledge] prompt section failed: ${err?.message ?? err}`)
        } catch {
          /* ignore */
        }
      }
    }

    return () => {
      for (const dispose of disposers) {
        try {
          dispose?.()
        } catch {
          /* ignore */
        }
      }
      try {
        store.close()
      } catch {
        /* ignore */
      }
    }
  })
}
