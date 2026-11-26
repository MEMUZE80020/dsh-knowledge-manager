window.__ModuleLoader__.load({
  id: 'dsh-knowledge-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const PANEL_ID = 'dsh-knowledge-manager'
    const KB_VERSION = '0.2.47'
    const API = `${(typeof window !== 'undefined' && window.__KB_API_BASE__) || ''}/kb-api`

    let pendingSection = ''
    let pendingFlashId = ''
    function flashEntryRow(id) {
      try {
        for (const el of document.querySelectorAll('.kb-flash')) el.classList.remove('kb-flash')
        const target = document.querySelector(`[data-kb-id="${id}"]`)
        if (!target) return false
        target.scrollIntoView({ block: 'center', behavior: 'smooth' })
        void target.offsetWidth
        target.classList.add('kb-flash')
        return true
      } catch {
        return false
      }
    }

    function openKnowledgePage(section = 'entries', flashId = '') {
      pendingSection = section
      pendingFlashId = flashId
      try {
        window.dispatchEvent(new CustomEvent('dsh-kb-section', { detail: { section, flashId } }))
      } catch {
        /* ignore */
      }
      try {
        window.__KB_OPEN_TAB__?.()
      } catch {
        /* right tab may be unavailable */
      }
    }
    function broadcastSection(section, flashId = '') {
      pendingSection = section
      pendingFlashId = flashId
      try {
        window.dispatchEvent(new CustomEvent('dsh-kb-section', { detail: { section, flashId } }))
      } catch {
        /* ignore */
      }
    }

    async function api(path, options) {
      const res = await fetch(`${API}/${path}`, options)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return res.json()
    }
    const post = (path, body) =>
      api(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    const NAV = [
      {
        group: '知识',
        items: [
          { key: 'entries', label: '条目管理', hint: '搜索、筛选、详情与历史' },
          { key: 'added', label: '新增记录', hint: '常规浅绿 / 敏感浅红' },
          { key: 'uncertain', label: '疑似记录', hint: '待归类，批量处理' },
        ],
      },
      {
        group: '库',
        items: [
          { key: 'libs', label: '库与连接', hint: '外部连接与高级设置' },
          { key: 'sync', label: '同步与备份', hint: '队列、备份与回滚' },
          { key: 'trash', label: '已删除', hint: '墓碑与还原' },
          { key: 'settings', label: '设置', hint: '同步、备份、注入与安全' },
        ],
      },
      {
        group: '帮助',
        items: [
          { key: 'guide', label: '教学文档', hint: '部署、接入与排障' },
          { key: 'stats', label: '统计', hint: '条数与分布' },
        ],
      },
    ]

    const muted = { opacity: 0.6, fontSize: 12 }
    const hair = '1px solid color-mix(in srgb, currentColor 13%, transparent)'
    const strong = 'color-mix(in srgb, currentColor 12%, transparent)'
    const soft = 'color-mix(in srgb, currentColor 6%, transparent)'
    const GREEN = 'color-mix(in srgb, #2e9a6a 16%, transparent)'
    const RED = 'color-mix(in srgb, #c0392b 16%, transparent)'

    const shell = { display: 'flex', height: '100%', minHeight: 0, fontSize: 13, lineHeight: 1.5 }
    const nav = {
      width: 208,
      flex: '0 0 208px',
      borderRight: hair,
      padding: '18px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      overflow: 'auto',
      boxSizing: 'border-box',
    }
    const content = { flex: 1, minWidth: 0, padding: '20px 24px', overflow: 'auto', boxSizing: 'border-box' }
    const navItem = (active) => ({
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      padding: '8px 10px',
      borderRadius: 8,
      border: 'none',
      background: active ? strong : 'transparent',
      color: 'inherit',
      textAlign: 'left',
      cursor: 'pointer',
      font: 'inherit',
      width: '100%',
    })
    const card = { border: hair, borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }
    const btn = {
      border: hair,
      borderRadius: 8,
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      padding: '5px 12px',
      cursor: 'pointer',
    }
    const btnPrimary = { ...btn, background: strong, borderColor: 'transparent' }
    const input = {
      padding: '6px 9px',
      borderRadius: 7,
      border: hair,
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      outline: 'none',
    }
    const rowStyle = (bg) => ({
      border: hair,
      background: bg || 'transparent',
      borderRadius: 8,
      padding: '8px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
      cursor: 'pointer',
    })
    const chip = (text) => h('span', { style: { ...muted, border: hair, borderRadius: 999, padding: '0 7px' } }, text)
    const warnChip = (text = '疑似') =>
      h(
        'span',
        {
          style: {
            background: '#f4b942',
            color: '#3a2c00',
            border: '1px solid #d9a52f',
            borderRadius: 999,
            padding: '1px 8px',
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1.6,
          },
        },
        text,
      )
    const sensitiveChip = (text = '敏感') =>
      h(
        'span',
        {
          style: {
            background: '#c0392b',
            color: '#ffffff',
            border: '1px solid #a93226',
            borderRadius: 999,
            padding: '1px 8px',
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1.6,
          },
        },
        text,
      )

    function useApi(path, deps = []) {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(true)
      const reload = useCallback(async () => {
        setLoading(true)
        try {
          setData(await api(path))
          setError('')
        } catch (e) {
          setError(String(e.message || e))
        } finally {
          setLoading(false)
        }
      }, deps)
      useEffect(() => {
        reload()
      }, [reload])
      return { data, error, loading, reload }
    }

    function Section({ title, desc, children, actions }) {
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' } },
          h(
            'div',
            { style: { flex: 1, minWidth: 160 } },
            h('div', { style: { fontSize: 16, fontWeight: 600 } }, title),
            desc ? h('div', { style: { ...muted, marginTop: 2 } }, desc) : null,
          ),
          actions ? h('div', { style: { display: 'flex', gap: 8 } }, actions) : null,
        ),
        children,
      )
    }

    function Empty({ text }) {
      return h('div', { style: { ...card, ...muted } }, text)
    }

    function BatchBar({ count, onClear, children, gate }) {
      const kids = Array.isArray(children) ? children : children == null ? [] : [children]
      return h(
        'div',
        { style: { ...card, flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
        h('div', { style: { minWidth: 90 } }, `已选 ${count} 条`),
        ...kids,
        count ? h('button', { style: btn, onClick: onClear }, '取消选择') : null,
        gate && !gate.ready ? h('span', { style: muted }, `删除需等待 ${gate.left}s`) : null,
      )
    }

    // ---------------------------------------------------------------- confirm gate
    function useCountdown(seconds) {
      const [left, setLeft] = useState(0)
      useEffect(() => {
        if (left <= 0) return undefined
        const timer = setTimeout(() => setLeft((v) => v - 1), 1000)
        return () => clearTimeout(timer)
      }, [left])
      return {
        left,
        start: () => setLeft(seconds),
        ready: left <= 0,
        reset: () => setLeft(0),
      }
    }

    function Popover({ open, onClose, children, placement = 'auto', title }) {
      useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
          const el = event.target
          if (el instanceof Element && el.closest('[data-kb-popover]')) return
          onClose?.()
        }
        const onKey = (event) => {
          if (event.key === 'Escape') onClose?.()
        }
        window.addEventListener('mousedown', onDown)
        window.addEventListener('keydown', onKey)
        return () => {
          window.removeEventListener('mousedown', onDown)
          window.removeEventListener('keydown', onKey)
        }
      }, [open, onClose])
      if (!open) return null
      const style = {
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        ...(placement === 'above' ? { bottom: 'calc(100% + 8px)' } : { top: 'calc(100% + 8px)' }),
        width: 340,
        background: 'Canvas',
        color: 'CanvasText',
        border: hair,
        borderRadius: 10,
        boxShadow: '0 10px 28px rgba(0,0,0,.28)',
        padding: '8px 10px',
        zIndex: 9999,
        fontSize: 12,
      }
      return h(
        'div',
        { 'data-kb-popover': '1', style, onClick: (e) => e.stopPropagation() },
        title ? h('div', { style: { fontWeight: 600, padding: '0 0 6px' } }, title) : null,
        h('div', { style: { maxHeight: 240, overflow: 'auto', display: 'flex', flexDirection: 'column' } }, children),
      )
    }

    function ConfirmDialog({ open, title, desc, seconds, confirmLabel, onConfirm, onClose }) {
      const [left, setLeft] = useState(seconds)
      useEffect(() => {
        if (!open) return undefined
        setLeft(seconds)
        return undefined
      }, [open, seconds])
      useEffect(() => {
        if (!open || left <= 0) return undefined
        const timer = setTimeout(() => setLeft((v) => v - 1), 1000)
        return () => clearTimeout(timer)
      }, [open, left])
      if (!open) return null
      return h(
        'div',
        { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 } },
        h(
          'div',
          { style: { background: 'Canvas', color: 'CanvasText', borderRadius: 12, padding: '16px 18px', width: 360, border: hair, boxShadow: '0 12px 40px rgba(0,0,0,.3)', display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { style: { fontWeight: 600, fontSize: 14 } }, title),
          desc ? h('div', { style: muted }, desc) : null,
          h(
            'div',
            { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 } },
            h('button', { style: btn, onClick: onClose }, '取消'),
            h('button', { style: { ...btnPrimary, opacity: left > 0 ? 0.55 : 1 }, disabled: left > 0, onClick: onConfirm }, left > 0 ? `${confirmLabel || '确认'}（${left}s）` : confirmLabel || '确认'),
          ),
        ),
      )
    }

    // ---------------------------------------------------------------- entries
    function EntryRow({ item, library, onOpen, selected, onSelect, background, highlight, onClassify, onToggleSensitive, badge }) {
      return h(
        'div',
        { 'data-kb-id': item.id, style: rowStyle(background), onClick: () => (selected !== undefined ? onSelect(item.id) : onOpen({ library, id: item.id })) },
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          selected !== undefined
            ? h('input', {
                type: 'checkbox',
                checked: selected,
                onClick: (e) => e.stopPropagation(),
                onChange: () => onSelect(item.id),
              })
            : null,
          h('div', { style: { fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.title || '(无标题)'),
          item.sensitivity === 'sensitive' ? sensitiveChip() : item.sensitivity === 'uncertain' ? warnChip() : null,
          chip(library),
          onToggleSensitive
            ? h('button', {
                style: { ...btn, padding: '1px 8px', fontSize: 12 },
                onClick: (e) => { e.stopPropagation(); onToggleSensitive(item.sensitivity === 'sensitive' ? 'safe' : 'sensitive') },
              }, item.sensitivity === 'sensitive' ? '设为普通' : '设为敏感')
            : null,
        ),
        h('div', { style: muted }, item.snippet || ''),
        h('div', { style: { ...muted, display: 'flex', gap: 10, flexWrap: 'wrap' } }, item.tags ? `#${item.tags}` : '', String(item.updatedAt || '').slice(0, 19)),
        item.sensitivity === 'uncertain' && onClassify
          ? h(
              'div',
              { style: { display: 'flex', gap: 6, marginTop: 2 } },
              h(
                'button',
                { style: { ...btn, padding: '1px 10px', fontSize: 12 }, onClick: (e) => { e.stopPropagation(); onClassify('safe') } },
                '通过',
              ),
              h(
                'button',
                { style: { ...btn, padding: '1px 10px', fontSize: 12 }, onClick: (e) => { e.stopPropagation(); onClassify('sensitive') } },
                '设为敏感',
              ),
            )
          : null,
      )
    }

    function EntryDetail({ library, id, onBack }) {
      const { data } = useApi(`entry?lib=${encodeURIComponent(library)}&id=${encodeURIComponent(id)}`)
      return h(
        Section,
        { title: '条目详情', desc: id, actions: h('button', { style: btn, onClick: onBack }, '← 返回列表') },
        !data ? h(Empty, { text: '加载中…' }) : null,
        data?.entry
          ? h(
              'div',
              { style: card },
              h('div', { style: { fontSize: 15, fontWeight: 600 } }, data.entry.title),
              h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, chip(library), chip(data.entry.tier), data.entry.sensitivity === 'sensitive' ? sensitiveChip() : chip(data.entry.sensitivity), chip(data.entry.source)),
              h('pre', { style: { whiteSpace: 'pre-wrap', margin: 0, font: 'inherit' } }, data.entry.body),
              data.entry.tags ? h('div', { style: muted }, `标签：${data.entry.tags}`) : null,
            )
          : h(Empty, { text: '条目不存在' }),
        data?.revisions?.length
          ? h(
              'div',
              { style: card },
              h('div', { style: { fontWeight: 600 } }, `历史版本（${data.revisions.length}）`),
              ...data.revisions.map((rev) =>
                h('div', { key: rev.version, style: { borderTop: hair, paddingTop: 6 } }, h('div', { style: muted }, `v${rev.version} · ${rev.reason || '修订'} · ${String(rev.updatedAt).slice(0, 19)}`), h('div', { style: { whiteSpace: 'pre-wrap' } }, rev.body)),
              ),
            )
          : null,
      )
    }

    const ENTRIES_PAGE_SIZE = 10

    function EntriesPage({ onOpen, flashId, clearFlash }) {
      const [q, setQ] = useState('')
      const [page, setPage] = useState(0)
      const [total, setTotal] = useState(0)
      const listRef = useRef(null)
      useEffect(() => {
        if (!flashId) return undefined
        let alive = true
        const params = new URLSearchParams({ q, ...filters, limit: '1000', offset: '0' })
        api(`search?${params.toString()}`)
          .then((data) => {
            if (!alive) return
            const ids = (data.groups || []).flatMap((g) => g.hits.map((h) => h.id))
            const index = ids.indexOf(flashId)
            if (index >= 0) setPage(Math.floor(index / ENTRIES_PAGE_SIZE))
          })
          .catch(() => {})
        const timer = setTimeout(() => {
          if (!alive) return
          flashEntryRow(flashId)
          clearFlash?.()
        }, 600)
        return () => {
          alive = false
          clearTimeout(timer)
        }
      }, [flashId])
      const [filters, setFilters] = useState({ sessionId: '', tag: '', from: '', to: '', source: '', sensitivity: '', sort: 'relevance' })
      const [selected, setSelected] = useState([])
      const [confirmOpen, setConfirmOpen] = useState(false)
      const [groups, setGroups] = useState([])
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)

      const load = useCallback(async () => {
        setBusy(true)
        try {
          const params = new URLSearchParams({ q, ...filters, limit: String(ENTRIES_PAGE_SIZE + 1), offset: String(page * ENTRIES_PAGE_SIZE) })
          const data = await api(`search?${params.toString()}`)
          const raw = data.groups || []
          const total = raw.reduce((n, g) => n + g.hits.length, 0)
          let remain = ENTRIES_PAGE_SIZE
          const trimmed = raw
            .map((g) => {
              const hits = g.hits.slice(0, Math.max(remain, 0))
              remain -= hits.length
              return { ...g, hits }
            })
            .filter((g) => g.hits.length)
          setGroups(trimmed)
          setTotal(data.total ?? 0)
          setError('')
        } catch (e) {
          setError(String(e.message || e))
        } finally {
          setBusy(false)
        }
      }, [q, filters, page])

      useEffect(() => {
        load()
      }, [load])

      useEffect(() => {
        if (listRef.current) listRef.current.scrollTop = 0
      }, [page])

      const classifyRow = async (library, id, to) => {
        await post('classify', { lib: library, ids: [id], to })
        load()
        setTimeout(() => {
          if (!flashEntryRow(id)) openKnowledgePage('entries', id)
        }, 280)
      }
      const toggle = (id) => {
        setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
      }
      const removeSelected = async (library) => {
        await post('delete', { lib: library, ids: selected })
        setSelected([])
        load()
      }

      return h(
        Section,
        { title: '条目管理', desc: '关键词支持中文子串；3 字以上走全文索引' },
        h(
          'div',
          { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
          h('input', { value: q, onChange: (e) => setQ(e.target.value), placeholder: '搜索知识…', style: { ...input, flex: '1 1 240px' } }),
          h('button', { style: btn, onClick: load }, busy ? '搜索中…' : '搜索'),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          h('label', { style: { ...muted, display: 'flex', gap: 6, alignItems: 'center' } }, '开始日期', h('input', { type: 'date', value: filters.from.slice(0, 10), onChange: (e) => setFilters({ ...filters, from: e.target.value ? `${e.target.value}T00:00:00.000Z` : '' }), style: { ...input, width: 140 } })),
          h('label', { style: { ...muted, display: 'flex', gap: 6, alignItems: 'center' } }, '结束日期', h('input', { type: 'date', value: filters.to.slice(0, 10), onChange: (e) => setFilters({ ...filters, to: e.target.value ? `${e.target.value}T23:59:59.999Z` : '' }), style: { ...input, width: 140 } })),
          h('select', { value: filters.source, onChange: (e) => setFilters({ ...filters, source: e.target.value }), style: input }, [['', '全部来源'], ['agent', 'Agent 记录'], ['human', '人工添加'], ['subagent', '子 Agent']].map(([v, l]) => h('option', { key: v, value: v }, l))),
          h('select', { value: filters.sensitivity, onChange: (e) => setFilters({ ...filters, sensitivity: e.target.value }), style: input }, [['', '全部敏感态'], ['safe', '普通'], ['uncertain', '疑似'], ['sensitive', '敏感']].map(([v, l]) => h('option', { key: v, value: v }, l))),
          h('select', { value: filters.sort, onChange: (e) => setFilters({ ...filters, sort: e.target.value }), style: input }, [['relevance', '相关度'], ['time', '时间']].map(([v, l]) => h('option', { key: v, value: v }, l))),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 } },
          h('button', {
            style: btnPrimary,
            onClick: () => {
              try {
                fetch(`${API}/debug-log`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'jump-click', hasOnJump: Boolean(onJump), at: new Date().toISOString() }) }).catch(() => {})
              } catch {
                /* ignore */
              }
              if (onJump) onJump('added')
              else openKnowledgePage('added')
            },
          }, '→ 去新增记录'),
        ),
        h(
          BatchBar,
          { count: selected.length, onClear: () => setSelected([]) },
          h('button', { style: btn, disabled: !selected.length, onClick: async () => { await post('classify', { lib: groups[0]?.library || 'dsh-main', ids: selected, to: 'sensitive' }); setSelected([]); load() } }, '批量设为敏感'),
          h('button', { style: btn, disabled: !selected.length, onClick: async () => { await post('classify', { lib: groups[0]?.library || 'dsh-main', ids: selected, to: 'safe' }); setSelected([]); load() } }, '批量设为普通'),
          h('button', { style: btnPrimary, disabled: !selected.length, onClick: () => setConfirmOpen(true) }, '删除所选'),
        ),
        error ? h(Empty, { text: `加载失败：${error}` }) : null,
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', margin: '6px 0' } },
          h('button', { style: btn, disabled: page === 0 || busy, onClick: () => setPage((p) => Math.max(0, p - 1)) }, '上一页'),
          h('span', { style: muted }, `当前第 ${page + 1} 页，共 ${Math.max(1, Math.ceil(total / ENTRIES_PAGE_SIZE))} 页`),
          h('button', { style: btn, disabled: page + 1 >= Math.max(1, Math.ceil(total / ENTRIES_PAGE_SIZE)) || busy, onClick: () => setPage((p) => p + 1) }, '下一页'),
        ),
        h(
          'div',
          { ref: listRef, style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 'calc(100vh - 420px)', minHeight: 200, overflowY: 'auto', paddingRight: 4 } },
          ...groups.map((group) =>
          h(
            'div',
            { key: group.library, style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('div', { style: { ...muted, marginTop: 4 } }, `${group.library} · ${group.hits.length} 条`),
            ...group.hits.map((item) =>
              h(EntryRow, {
                key: item.id,
                item,
                library: group.library,
                onOpen,
                highlight: flashId === item.id,
                selected: selected.includes(item.id),
                onSelect: () => toggle(item.id),
                onClassify: (to) => classifyRow(group.library, item.id, to),
                onToggleSensitive: (to) => classifyRow(group.library, item.id, to),
                onToggleSensitive: (to) => classifyRow(group.library, item.id, to),
              }),
            ),
          ),
        ),
        ),
        !groups.length && !error ? h(Empty, { text: '没有匹配的知识' }) : null,
        h(ConfirmDialog, {
          open: confirmOpen,
          title: '删除知识',
          desc: `确认删除所选 ${selected.length} 条？删除后可在「已删除」还原。`,
          seconds: 5,
          confirmLabel: '确认删除',
          onClose: () => setConfirmOpen(false),
          onConfirm: async () => {
            setConfirmOpen(false)
            await removeSelected(groups[0]?.library || 'dsh-main')
          },
        }),
      )
    }

    // ---------------------------------------------------------------- added / uncertain
    function AddedPage({ onOpen }) {
      const since = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
      const [created, setCreated] = useState(null)
      const [updated, setUpdated] = useState([])
      const [states, setStates] = useState({})
      useEffect(() => {
        let alive = true
        Promise.all([
          api(`recent?since=${encodeURIComponent(since)}`),
          api(`recent-updated?since=${encodeURIComponent(since)}`),
          api('snapshot-states'),
        ])
          .then(([recent, upd, snap]) => {
            if (!alive) return
            setCreated(recent?.groups ?? [])
            setUpdated(upd?.groups ?? [])
            setStates(snap?.states ?? {})
          })
          .catch(() => {
            if (alive) setCreated([])
          })
        return () => {
          alive = false
        }
      }, [])
      const badgeFor = (item, labelOverride) => {
        const value = states[item.id] || item.sensitivity
        if (labelOverride) return { label: labelOverride, bg: '#2f6fd0' }
        if (value === 'sensitive') return { label: '敏感', bg: '#c0392b' }
        if (value === 'uncertain') return { label: '疑似', bg: '#d9a52f' }
        return { label: '新增', bg: '#2e9a6a' }
      }
      return h(
        Section,
        { title: '新增记录', desc: '今天新增与更新；状态按写入时的快照显示，手动改分类不影响这里' },
        !created ? h(Empty, { text: '加载中…' }) : null,
        ...(created ?? []).map((group) =>
          h(
            'div',
            { key: group.library, style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('div', { style: muted }, group.library),
            ...group.items.map((item) =>
              h(EntryRow, { key: item.id, item, library: group.library, onOpen, badge: badgeFor(item) }),
            ),
          ),
        ),
        updated.length ? h('div', { style: { ...muted, marginTop: 8 } }, '今日更新') : null,
        ...updated.map((group) =>
          h(
            'div',
            { key: `updated-${group.library}`, style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('div', { style: muted }, group.library),
            ...group.items.map((item) =>
              h(EntryRow, { key: `u-${item.id}`, item, library: group.library, onOpen, badge: badgeFor(item, '更新') }),
            ),
          ),
        ),
        !created?.length && !updated.length ? h(Empty, { text: '今天还没有新增或更新' }) : null,
      )
    }

    function UncertainPage({ onOpen, onJump }) {
      const { data, reload } = useApi('uncertain')
      const [selected, setSelected] = useState([])
      const doClassify = async (library, to) => {
        await post('classify', { lib: library, ids: selected, to })
        setSelected([])
        reload()
      }
      const toggle = (id) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
      return h(
        Section,
        {
          title: '疑似记录',
          desc: '默认不推云端；通过后进待推队列并移入新增记录',
          actions: h('div', { style: { display: 'flex', gap: 8 } }, h('button', { style: btn, onClick: () => (onJump ? onJump('added') : openKnowledgePage('added')) }, '查看新增记录'), h('button', { style: btn, onClick: reload }, '刷新')),
        },
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 } },
          h('button', {
            style: btnPrimary,
            onClick: () => {
              try {
                fetch(`${API}/debug-log`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'jump-click', hasOnJump: Boolean(onJump), at: new Date().toISOString() }) }).catch(() => {})
              } catch {
                /* ignore */
              }
              if (onJump) onJump('added')
              else openKnowledgePage('added')
            },
          }, '→ 去新增记录'),
        ),
        h(
          BatchBar,
          { count: selected.length, onClear: () => setSelected([]) },
          h('button', { style: btnPrimary, disabled: !selected.length, onClick: () => doClassify(data.groups[0]?.library || 'dsh-main', 'safe') }, '通过（转普通）'),
          h('button', { style: btn, disabled: !selected.length, onClick: () => doClassify(data.groups[0]?.library || 'dsh-main', 'sensitive') }, '设为敏感'),
        ),
        !data ? h(Empty, { text: '加载中…' }) : null,
        ...(data?.groups ?? []).map((group) =>
          h(
            'div',
            { key: group.library, style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('div', { style: muted }, group.library),
            ...group.items.map((item) =>
              h(EntryRow, {
                key: item.id,
                item,
                library: group.library,
                selected: selected.includes(item.id),
                onSelect: () => toggle(item.id),
                onOpen,
              }),
            ),
          ),
        ),
        data && !data.groups.length
          ? h('div', { style: card }, h('div', { style: muted }, '没有待归类的疑似记录。'), h('a', { href: '#', style: { cursor: 'pointer' }, onClick: (e) => { e.preventDefault(); if (onJump) onJump('added'); else openKnowledgePage('added') } }, '去「新增记录」看看 →'))
          : null,
      )
    }

    // ---------------------------------------------------------------- libs / connect
    function SessionKnowledgePage({ onOpen }) {
      const { data } = useApi('session-knowledge')
      return h(
        Section,
        { title: '本会话知识', desc: '本会话调用过或写入过的全部知识' },
        !data ? h(Empty, { text: '加载中…' }) : null,
        ...(data?.groups ?? []).map((group) =>
          h(
            'div',
            { key: group.library, style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('div', { style: muted }, group.library),
            ...group.items.map((item) =>
              h(EntryRow, {
                key: item.id,
                item,
                library: group.library,
                onOpen: () => openKnowledgePage('entries', item.id),
              }),
            ),
          ),
        ),
        data && !data.groups.length ? h(Empty, { text: '本会话还没有涉及知识' }) : null,
      )
    }

    function LibsPage({ onConnect, onSettings }) {
      const { data } = useApi('state')
      const [conns, setConns] = useState([])
      const loadConns = () => fetch(`${API}/connections`).then((r) => r.json()).then((d) => setConns(d.connections || [])).catch(() => {})
      useEffect(() => {
        loadConns()
      }, [])
      return h(
        Section,
        { title: '库与连接', desc: '库名不可改；用户不能新建库，只能添加外部连接', actions: h('button', { style: btnPrimary, onClick: onConnect }, '添加连接') },
        !data ? h(Empty, { text: '加载中…' }) : null,
        h('div', { style: { ...muted, marginTop: 4 } }, `外部连接（${conns.length}）`),
        ...conns.map((conn) =>
          h(
            'div',
            { key: conn.id, style: { ...card, flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h('div', { style: { flex: 1, minWidth: 160 } }, h('div', { style: { fontWeight: 600 } }, `${conn.host}:${conn.port} · ${conn.user}`), h('div', { style: muted }, conn.lastError ? `最近错误：${conn.lastError}` : conn.lastSyncAt ? `最近同步 ${String(conn.lastSyncAt).slice(0, 19)}` : '尚未同步')),
            h('button', { style: btn, onClick: async () => { await post('sync', { connectionId: conn.id }); loadConns() } }, '立即同步'),
            h('button', { style: btn, onClick: () => onSettings?.(conn) }, '设置'),
            h('button', { style: btn, onClick: async () => { await post('disconnect', { id: conn.id }); loadConns() } }, '删除'),
          ),
        ),
        ...(data?.libraries ?? []).map((lib) =>
          h(
            'div',
            { key: lib.library, style: card },
            h('div', { style: { fontWeight: 600 } }, lib.library),
            h('div', { style: muted }, `条目 ${lib.total} · 敏感 ${(lib.bySensitivity.find((r) => r.sensitivity === 'sensitive') || {}).n || 0} · 疑似 ${(lib.bySensitivity.find((r) => r.sensitivity === 'uncertain') || {}).n || 0} · 修订 ${lib.revisions} · 附件 ${lib.attachments.bytes} B`),
          ),
        ),
      )
    }

    function ConnectPage({ onBack, initial }) {
      const [form, setForm] = useState({ host: initial?.host || '', port: String(initial?.port || '3306'), user: initial?.user || '', password: '', tls: Boolean(initial?.tls) })
      const [result, setResult] = useState(null)
      const [advanced, setAdvanced] = useState(false)
      const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
      const save = async () => {
        const res = await post('connect/save', { ...form, port: Number(form.port) || 3306 })
        setResult(res.ok ? { ok: true, saved: true, databases: [] } : { ok: false, error: res.error || '保存失败' })
      }
      const test = async () => {
        setResult({ ok: null })
        const res = await post('test-connection', { ...form, port: Number(form.port) || 3306 })
        setResult(res)
      }
      return h(
        Section,
        { title: '添加外部知识库', desc: '只填主机、端口、用户名、密码；库名由插件自动发现', actions: h('button', { style: btn, onClick: onBack }, '← 返回库列表') },
        h(
          'div',
          { style: card },
          ...[
            ['主机', 'host', 'db.example.com'],
            ['端口', 'port', '3306'],
            ['用户名', 'user', '数据库账号'],
            ['密码', 'password', '只用于本次连接测试'],
          ].map(([label, key, placeholder]) =>
            h(
              'div',
              { key, style: { display: 'grid', gridTemplateColumns: '90px 1fr', gap: 10, alignItems: 'center' } },
              h('div', null, label),
              h('input', { value: form[key], onChange: set(key), placeholder, type: key === 'password' ? 'password' : 'text', style: input }),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' } },
            h('button', { style: btnPrimary, onClick: save }, '保存连接'),
            h('button', { style: btn, onClick: test }, '测试连接'),
            h('button', { style: btn, onClick: () => setAdvanced(!advanced) }, advanced ? '收起高级设置' : '高级设置'),
            h('label', { style: { ...muted, display: 'flex', gap: 6, alignItems: 'center' }, title: '打开后使用加密连接；自签证书会被接受' },
              h('input', { type: 'checkbox', checked: form.tls, onChange: set('tls') }), 'TLS'),
          ),
          advanced
            ? h(
                'div',
                { style: { display: 'grid', gridTemplateColumns: '110px 1fr', gap: 10, alignItems: 'center', marginTop: 8 } },
                h('div', null, '连接超时（秒）'),
                h('input', { type: 'number', value: form.connectTimeoutSec ?? 8, onChange: set('connectTimeoutSec'), style: { ...input, width: 120 } }),
                h('div', null, '失败重试'),
                h('label', { style: { ...muted, display: 'flex', gap: 6, alignItems: 'center' } }, h('input', { type: 'checkbox', checked: Boolean(form.retryFailed), onChange: set('retryFailed') }), '连接失败时按退避重试'),
              )
            : null,
        ),
        result
          ? h(
              'div',
              { style: card },
              result.ok === null
                ? h('div', { style: muted }, '连接中…')
                : result.saved
                  ? h('div', null, '连接已保存，密码存入凭据服务；可回到库列表点「立即同步」。')
                  : result.ok
                    ? h('div', null, `连接成功，发现 ${result.databases.length} 个库：${result.databases.join('、') || '（无）'}`)
                    : h('div', { style: { color: 'crimson' } }, `失败：${result.error}`),
            )
          : null,
      )
    }

    const SETTINGS_DEFAULTS = {
      syncIntervalSec: 60,
      startupBackup: true,
      backupRetentionDays: 30,
      sensitiveKeywords: '',
      attachmentMaxMB: 20,
      attachmentMaxTotalMB: 1024,
      defaultSensitiveKeywords: ['密码','口令','token','密钥','身份证','手机号','合同','营收','客户名单'].join(String.fromCharCode(10)),
      injectMaxEntries: 3,
      injectMaxChars: 600,
    }

    function SettingsPage() {
      const [form, setForm] = useState(null)
      const [saved, setSaved] = useState(false)
      useEffect(() => {
        fetch(`${API}/settings`).then((r) => r.json()).then((d) => setForm({ ...SETTINGS_DEFAULTS, ...(d.settings || {}) })).catch(() => setForm({ ...SETTINGS_DEFAULTS }))
      }, [])
      const set = (k, fallback) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value) || e.target.value || fallback })
      const [clearOpen, setClearOpen] = useState(false)
      const [clearMsg, setClearMsg] = useState('')
      const save = async () => {
        const res = await post('settings', { settings: form })
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
      if (!form) return h(Section, { title: '设置' }, h(Empty, { text: '加载中…' }))
      const tips = {
        syncIntervalSec: '后台轮询云端的间隔，最小 30 秒，重启后生效',
        startupBackup: 'DSH 启动时对每个库做一次备份',
        backupRetentionDays: '超过天数的备份在下次清理时删除',
        defaultSensitiveKeywords: '内置敏感词，用于把命中条目标为疑似/敏感',
        sensitiveKeywords: '额外补充的敏感词，每行一个',
        attachmentMaxMB: '单个附件允许的最大体积',
        attachmentMaxTotalMB: '单个库附件总量上限，超出后新附件会被拒绝',
        injectMaxEntries: '每轮回答最多注入的知识条数',
        injectMaxChars: '每轮回答最多注入的字数',
      }
      const rows = [
        ['syncIntervalSec', '同步间隔（秒，最小 30）', 'number'],
        ['startupBackup', '启动时备份', 'checkbox'],
        ['backupRetentionDays', '备份保留天数', 'number'],
        ['defaultSensitiveKeywords', '默认敏感词（每行一个）', 'textarea'],
        ['sensitiveKeywords', '自定义敏感词（每行一个）', 'textarea'],
        ['attachmentMaxMB', '附件单件上限（MB，0 = 不限）', 'number'],
        ['attachmentMaxTotalMB', '附件单库上限（MB，0 = 不限）', 'number'],
        ['injectMaxEntries', '注入每轮最多条数', 'number'],
        ['injectMaxChars', '注入每轮最多字数', 'number'],
      ]
      return h(
        Section,
        { title: '设置', desc: '全局配置；修改后保存，标注“重启生效”的需重启 DSH', actions: h('button', { style: btnPrimary, onClick: save }, saved ? '已保存' : '保存') },
        h(
          'div',
          { style: card },
          ...rows.map(([key, label, type]) =>
            h(
              'div',
              { key, style: { display: 'grid', gridTemplateColumns: '220px 1fr', gap: 10, alignItems: 'center' } },
              h('div', { title: tips[key] || '', style: { cursor: 'help', borderBottom: '1px dotted color-mix(in srgb, currentColor 35%, transparent)', width: 'fit-content' } }, label),
              type === 'checkbox'
                ? h('input', { type: 'checkbox', checked: Boolean(form[key]), onChange: (e) => setForm({ ...form, [key]: e.target.checked }) })
                : type === 'textarea'
                  ? h('textarea', { value: form[key] ?? '', onChange: (e) => setForm({ ...form, [key]: e.target.value }), rows: 3, style: { ...input, width: '100%', minHeight: 64, resize: 'vertical', fontFamily: 'inherit' } })
                  : h('input', {
                    type: type === 'number' ? 'number' : 'text',
                    value: form[key] ?? '',
                    onChange: (e) => setForm({ ...form, [key]: type === 'number' ? Number(e.target.value) : e.target.value }),
                    style: { ...input, width: 240 },
                  }),
            ),
          ),
          h('div', { style: muted }, '同步间隔需重启生效；备份保留天数在下次备份清理时生效。'),
          clearMsg ? h('div', { style: muted }, clearMsg) : null,
          h(
            'div',
            { style: { marginTop: 10, paddingTop: 10, borderTop: hair, display: 'flex', justifyContent: 'flex-end' } },
            h('button', { style: { ...btn, background: '#c0392b', borderColor: '#c0392b', color: '#fff' }, onClick: () => setClearOpen(true) }, '清除全部数据'),
          ),
        ),
        h(ConfirmDialog, {
          open: clearOpen,
          title: '清除全部数据',
          desc: '将删除所有知识、附件、修订、备份，以及设置项与外部连接配置，且不可恢复。',
          seconds: 10,
          confirmLabel: '确认清除',
          onClose: () => setClearOpen(false),
          onConfirm: async () => {
            setClearOpen(false)
            await post('wipe-all', {})
            setClearMsg('全部数据已清除，建议重启 DSH')
          },
        }),
      )
    }

    // ---------------------------------------------------------------- sync / trash / stats / guide
    function SyncPage() {
      const { data, reload } = useApi('state')
      const [msg, setMsg] = useState(null)
      const [busy, setBusy] = useState(false)
      const manualSync = async () => {
        setBusy(true)
        setMsg({ kind: 'info', text: '正在同步…' })
        try {
          const res = await post('sync', {})
          const results = res?.results ?? []
          const errors = results.filter((r) => r.error)
          const pushed = results.reduce((n, r) => n + Number(r.pushed || 0), 0)
          const pulled = results.reduce((n, r) => n + Number(r.pulled || 0), 0)
          if (errors.length) setMsg({ kind: 'error', text: `同步失败：${errors.map((e) => e.error).join('；')}` })
          else if (!pushed && !pulled) setMsg({ kind: 'ok', text: '云端与本地一致，无需同步' })
          else setMsg({ kind: 'ok', text: `同步完成：推送 ${pushed} 条，拉取 ${pulled} 条` })
          reload()
        } catch (err) {
          setMsg({ kind: 'error', text: `同步失败：${err?.message || err}` })
        } finally {
          setBusy(false)
        }
      }
      return h(
        Section,
        { title: '同步与备份', desc: '启动时拉→推→备份；本地写入即时推送，云端默认 60 秒轮询', actions: h('div', { style: { display: 'flex', gap: 8 } }, h('button', { style: btnPrimary, disabled: busy, onClick: manualSync }, busy ? '同步中…' : '手动同步'), h('button', { style: btn, onClick: reload }, '刷新')) },
        !data ? h(Empty, { text: '加载中…' }) : null,
        msg
          ? h('div', { style: { ...card, borderLeft: `3px solid ${msg.kind === 'error' ? '#c0392b' : msg.kind === 'ok' ? '#2e9a6a' : '#888'}` } }, h('div', null, msg.text))
          : null,
        h(
          'div',
          { style: card },
          h('div', { style: { fontWeight: 600 } }, '队列'),
          ...(data?.queue?.length
            ? data.queue.map((row) => h('div', { key: row.createdAt, style: muted }, `${row.lib} · ${row.op} · 尝试 ${row.attempts} · ${row.lastError}`))
            : [h('div', { key: 'empty', style: muted }, '没有待处理项')]),
        ),
        h('div', { style: card }, h('div', { style: { fontWeight: 600 } }, `备份（${data?.backups?.length ?? 0}）`), ...(data?.backups ?? []).slice(0, 10).map((b) => h('div', { key: b.path, style: { ...muted, display: 'flex', gap: 8, alignItems: 'center' } }, h('span', { style: { flex: 1 } }, `${b.library} · ${String(b.createdAt).slice(0, 19)}`), h('button', { style: btn, onClick: async () => { await post('restore-backup', { path: b.path }); reload() } }, '回滚')))), 
      )
    }

    function TrashPage() {
      const { data, reload } = useApi('trash')
      return h(
        Section,
        { title: '已删除', desc: '墓碑永久保留，可一键还原并双向传播', actions: h('button', { style: btn, onClick: reload }, '刷新') },
        !data ? h(Empty, { text: '加载中…' }) : null,
        ...(data?.groups ?? []).map((group) =>
          h(
            'div',
            { key: group.library, style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('div', { style: muted }, group.library),
            ...group.items.map((item) =>
              h(
                'div',
                { key: item.id, style: { ...rowStyle(), cursor: 'default', flexDirection: 'row', alignItems: 'center', gap: 10 } },
                h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { style: { fontWeight: 600 } }, item.title || item.id), h('div', { style: muted }, String(item.deletedAt).slice(0, 19))),
                h('button', { style: btn, onClick: async () => { await post('restore', { lib: group.library, ids: [item.id] }); reload() } }, '还原'),
              ),
            ),
          ),
        ),
        data && !data.groups.length ? h(Empty, { text: '没有已删除条目' }) : null,
      )
    }

    function StatsPage() {
      const { data } = useApi('state')
      return h(
        Section,
        { title: '统计', desc: '各库条数与体积、tier 与敏感分布、附件占用、修订数' },
        !data ? h(Empty, { text: '加载中…' }) : null,
        ...(data?.libraries ?? []).map((lib) =>
          h(
            'div',
            { key: lib.library, style: card },
            h('div', { style: { fontWeight: 600 } }, lib.library),
            h('div', null, `总条目 ${lib.total} · 修订 ${lib.revisions} · 墓碑 ${lib.tombstones}`),
            h('div', { style: muted }, (lib.byTier || []).map((r) => `${r.tier === 'accepted' ? '明确认可' : '默许认可'} ${r.n}`).join(' · ') || '无'),
            h('div', { style: muted }, (lib.bySensitivity || []).map((r) => `${r.sensitivity === 'safe' ? '普通' : r.sensitivity === 'uncertain' ? '疑似' : '敏感'} ${r.n}`).join(' · ') || '无'),
            h('div', { style: muted }, `附件 ${lib.attachments?.n ?? 0} 个 · ${lib.attachments?.bytes ?? 0} B`),
          ),
        ),
      )
    }

    function renderInline(text, keyPrefix) {
      const parts = []
      const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|~~[^~]+~~)/g
      let last = 0
      let match
      let index = 0
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) parts.push(text.slice(last, match.index))
        const token = match[0]
        if (token.startsWith('~~')) parts.push(h('del', { key: `${keyPrefix}-d-${index}` }, token.slice(2, -2)))
        else if (token.startsWith('**')) parts.push(h('strong', { key: `${keyPrefix}-b-${index}` }, token.slice(2, -2)))
        else if (token.startsWith('`')) parts.push(h('code', { key: `${keyPrefix}-c-${index}`, style: { background: 'color-mix(in srgb, currentColor 10%, transparent)', padding: '0 4px', borderRadius: 4 } }, token.slice(1, -1)))
        else {
          const m = /\[([^\]]+)\]\(([^)]+)\)/.exec(token)
          parts.push(h('a', { key: `${keyPrefix}-a-${index}`, href: m[2], target: '_blank', rel: 'noreferrer', style: { color: 'inherit', textDecoration: 'underline' } }, m[1]))
        }
        index += 1
        last = match.index + token.length
      }
      if (last < text.length) parts.push(text.slice(last))
      return parts
    }

    function MarkdownView({ text }) {
      const NL = String.fromCharCode(10)
      const lines = String(text || '').split(NL)
      const blocks = []
      const isSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)
      const cells = (line) => line.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim())
      let i = 0
      while (i < lines.length) {
        const line = lines[i]
        if (line.startsWith('```')) {
          const code = []
          i += 1
          while (i < lines.length && !lines[i].startsWith('```')) {
            code.push(lines[i])
            i += 1
          }
          i += 1
          blocks.push(h('pre', { key: 'code-' + i, style: { border: hair, borderRadius: 8, padding: '8px 10px', overflow: 'auto', margin: '6px 0', fontSize: 12 } }, h('code', null, code.join(NL))))
          continue
        }
        if (/^\s*$/.test(line)) { i += 1; continue }
        if (line.includes('|') && i + 1 < lines.length && isSep(lines[i + 1])) {
          const header = cells(line)
          const rows = []
          i += 2
          while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
            rows.push(cells(lines[i]))
            i += 1
          }
          blocks.push(
            h('div', { key: 'table-' + i, style: { overflow: 'auto', margin: '8px 0' } },
              h('table', { style: { borderCollapse: 'collapse', fontSize: 12, width: '100%' } },
                h('thead', null, h('tr', null, ...header.map((c, ci) => h('th', { key: ci, style: { border: hair, padding: '4px 8px', textAlign: 'left', background: 'color-mix(in srgb, currentColor 6%, transparent)' } }, ...renderInline(c, 'th-' + ci))))),
                h('tbody', null, ...rows.map((row, ri) => h('tr', { key: ri }, ...row.map((c, ci) => h('td', { key: ci, style: { border: hair, padding: '4px 8px' } }, ...renderInline(c, 'td-' + ri + '-' + ci)))))),
              ),
            ),
          )
          continue
        }
        const heading = /^(#{1,4})\s+(.*)$/.exec(line)
        if (heading) {
          const level = heading[1].length
          blocks.push(h('h' + Math.min(level + 1, 5), { key: 'h-' + i, style: { margin: '10px 0 4px', fontSize: level === 1 ? 18 : level === 2 ? 16 : 14 } }, ...renderInline(heading[2], 'h-' + i)))
          i += 1
          continue
        }
        if (/^(---|\*\*\*)\s*$/.test(line)) {
          blocks.push(h('hr', { key: 'hr-' + i, style: { border: 0, borderTop: hair, margin: '12px 0' } }))
          i += 1
          continue
        }
        if (line.startsWith('>')) {
          const quote = []
          while (i < lines.length && lines[i].startsWith('>')) {
            quote.push(lines[i].replace(/^>\s?/, ''))
            i += 1
          }
          blocks.push(h('blockquote', { key: 'bq-' + i, style: { margin: '6px 0', paddingLeft: 10, borderLeft: '3px solid color-mix(in srgb, currentColor 30%, transparent)' } }, ...quote.map((q, qi) => h('p', { key: qi, style: { margin: '2px 0' } }, ...renderInline(q, 'bq-' + i + '-' + qi)))))
          continue
        }
        if (/^\s*[-*]\s+/.test(line)) {
          const items = []
          while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
            items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
            i += 1
          }
          blocks.push(h('ul', { key: 'ul-' + i, style: { margin: '4px 0', paddingLeft: 18 } }, ...items.map((it, ii) => h('li', { key: ii }, ...renderInline(it, 'ul-' + i + '-' + ii)))))
          continue
        }
        if (/^\s*\d+\.\s+/.test(line)) {
          const items = []
          while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
            items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
            i += 1
          }
          blocks.push(h('ol', { key: 'ol-' + i, style: { margin: '4px 0', paddingLeft: 20 } }, ...items.map((it, ii) => h('li', { key: ii }, ...renderInline(it, 'ol-' + i + '-' + ii)))))
          continue
        }
        blocks.push(h('p', { key: 'p-' + i, style: { margin: '4px 0' } }, ...renderInline(line, 'p-' + i)))
        i += 1
      }
      return h('div', { style: { display: 'flex', flexDirection: 'column' } }, ...blocks)
    }

    function GuidePage() {
      const [text, setText] = useState('')
      useEffect(() => {
        fetch(`${API}/deploy`).then((r) => (r.ok ? r.text() : '部署手册暂不可用')).then(setText).catch(() => setText('部署手册暂不可用'))
      }, [])
      return h(
        Section,
        { title: '教学文档', desc: '部署步骤 + 接入步骤 + 排障' },
        h('div', { style: { display: 'flex', gap: 8 } }, h('a', { href: `${API}/deploy`, download: '部署手册.md', style: { ...btn, textDecoration: 'none', display: 'inline-block' } }, '下载部署手册')),
        h('div', { style: { ...card, overflow: 'auto' } }, text ? h(MarkdownView, { text }) : h('div', { style: muted }, '加载中…')),
      )
    }


    // ---------------------------------------------------------------- per-message knowledge
    // 调用记录：跟在消息按钮后面的一颗小按钮
    function probeProps(kind, props) {
      try {
        const info = { kind, at: new Date().toISOString(), keys: Object.keys(props || {}) }
        try {
          info.turn = typeof props?.turn === 'object' ? Object.keys(props.turn || {}) : String(props?.turn)
        } catch {
          /* ignore */
        }
        try {
          info.message = typeof props?.message === 'object' ? Object.keys(props.message || {}) : typeof props?.message
        } catch {
          /* ignore */
        }
        fetch(`${API}/debug-log`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(info) }).catch(() => {})
      } catch {
        /* ignore */
      }
    }

    function collectSearchIds(value) {
      const out = new Set()
      const seen = new Set()
      const walk = (node, depth) => {
        if (!node || depth > 4 || out.size >= 30) return
        if (typeof node === 'string') {
          if (node.includes('"hits"') || node.includes('kb_search')) {
            const matches = node.match(/"id"\s*:\s*"([0-9a-fA-F-]{36})"/g) || []
            for (const m of matches) out.add(m.replace(/.*"([0-9a-fA-F-]{36})".*/, '$1'))
          }
          return
        }
        if (typeof node !== 'object') return
        if (seen.has(node)) return
        seen.add(node)
        try {
          if (Array.isArray(node)) {
            for (const item of node.slice(0, 50)) walk(item, depth + 1)
            return
          }
          for (const key of ['message', 'turn', 'parts', 'content', 'toolCalls', 'tool_calls', 'calls', 'node', 'data', 'result', 'output', 'items', 'blocks']) {
            if (key in node) walk(node[key], depth + 1)
          }
        } catch {
          /* ignore hostile getters */
        }
      }
      try {
        walk(value, 0)
      } catch {
        /* ignore */
      }
      return out
    }

    function KnowledgeTail() {
      return null
    }

    function KnowledgeTailDisabled(props) {
      const { messageId, sessionId } = props
      const [data, setData] = useState(null)
      useEffect(() => {
        if (!messageId) return undefined
        let alive = true
        fetch(`${API}/turn?messageId=${encodeURIComponent(messageId)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((value) => {
            if (alive) setData(value)
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [messageId])
      const toolIds = Array.from(collectSearchIds(props))
      const [toolEntries, setToolEntries] = useState(null)
      useEffect(() => {
        if (!toolIds.length) return undefined
        let alive = true
        fetch(`${API}/entries-by-ids?ids=${encodeURIComponent(toolIds.join(','))}`)
          .then((r) => r.json())
          .then((res) => {
            if (alive) setToolEntries(res?.entries ?? [])
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [toolIds.join(',')])
      const citedIds = toolIds.length ? toolIds : data?.turn?.cited ?? []
      const cited = citedIds.length
      const [open, setOpen] = useState(false)
      const entries = toolIds.length ? (toolEntries ?? []) : (data?.entries ?? []).filter((e) => citedIds.includes(e.entry.id))
      if ((!messageId && !toolIds.length) || !cited) return null
      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', position: 'relative' } },
        h(
          'button',
          {
            style: { ...btn, borderRadius: 999, padding: '2px 10px', fontSize: 12 },
            title: '本轮引用的知识',
            onClick: () => setOpen(true),
          },
          `引用 ${cited} 条`,
        ),
        h(
          Popover,
          { open, onClose: () => setOpen(false), title: `本轮引用 ${cited} 条` },
          ...entries.map(({ entry, library }) =>
            h(
              'div',
              {
                key: entry.id,
                className: 'kb-pop-item',
                style: { cursor: 'pointer', padding: '5px 6px', borderRadius: 6, display: 'flex', gap: 6, alignItems: 'center' },
                onClick: () => {
                  setOpen(false)
                  openKnowledgePage('entries', entry.id)
                },
              },
              h('span', { style: { opacity: 0.6, flex: '0 0 auto' } }, '·'),
              h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `${entry.title}（${library}）`),
            ),
          ),
        ),
      )
    }

    // 本轮新增：独立区域展示
    function scanTurnTools(turn) {
      const created = new Set()
      const cited = new Set()
      const seen = new Set()
      const idsOf = (text) => text.match(/"id"\s*:\s*"([0-9a-fA-F-]{36})"/g) || []
      const walk = (node, depth) => {
        if (!node || depth > 5) return
        if (typeof node === 'string') {
          if (node.includes('kb_search')) {
            for (const raw of idsOf(node)) {
              const id = raw.replace(/.*"([0-9a-fA-F-]{36})".*/, '$1')
              cited.add(id)
            }
          }
          return
        }
        if (typeof node !== 'object' || seen.has(node)) return
        seen.add(node)
        if (Array.isArray(node)) {
          for (const item of node.slice(0, 80)) walk(item, depth + 1)
          return
        }
        const name = node.name || node.toolName || node.tool || ''
        if (typeof name === 'string' && (name.includes('kb_record') || name.includes('kb_search'))) {
          const isSearch = name.includes('kb_search')
          let text = ''
          try {
            text = JSON.stringify(node)
          } catch {
            text = ''
          }
          for (const raw of idsOf(text)) {
            const id = raw.replace(/.*"([0-9a-fA-F-]{36})".*/, '$1')
            if (isSearch) cited.add(id)
            else created.add(id)
          }
        }
        for (const key of ['data', 'steps', 'content', 'result', 'output', 'message', 'parts', 'calls', 'toolCalls', 'turn']) {
          if (key in node) walk(node[key], depth + 1)
        }
      }
      try {
        walk(turn, 0)
      } catch {
        /* ignore */
      }
      for (const id of created) cited.delete(id)
      return { created: Array.from(created), cited: Array.from(cited) }
    }

    function toIso(value) {
      if (!value) return ''
      const raw = typeof value === 'object' ? value.time ?? value.at ?? value.ts : value
      if (raw === undefined || raw === null || raw === '') return ''
      if (typeof raw === 'number') return new Date(raw > 1e12 ? raw : raw * 1000).toISOString()
      const t = Date.parse(raw)
      return Number.isFinite(t) ? new Date(t).toISOString() : ''
    }

    function KnowledgeTailInTurn(props) {
      const turn = props?.turn
      const sessionId = props?.sessionId || ''
      const start = toIso(turn?.start)
      const end = toIso(turn?.end)
      const fallback = scanTurnTools(turn)
      const [ids, setIds] = useState({ created: [], updated: [], cited: [], states: {} })
      useEffect(() => {
        try {
          fetch(`${API}/debug-log`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              kind: 'turnv2',
              sessionId,
              start: String(turn?.start),
              end: String(turn?.end),
              keys: Object.keys(turn || {}),
              sample: JSON.stringify(turn || {}).slice(0, 1200),
            }),
          }).catch(() => {})
        } catch {
          /* ignore */
        }
      }, [])
      const [rows, setRows] = useState(null)
      const [open, setOpen] = useState(false)
      const [dir, setDir] = useState('below')
      useEffect(() => {
        let alive = true
        let timer = null
        const attempt = (round) => {
          if (sessionId && start && end) {
            fetch(`${API}/turn-window?sessionId=${encodeURIComponent(sessionId)}&from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`)
              .then((r) => r.json())
              .then((data) => {
                if (!alive) return
                if (data && (data.created?.length || data.updated?.length || data.cited?.length)) {
                  setIds({ created: data.created ?? [], updated: data.updated ?? [], cited: data.cited ?? [], states: data.states ?? {} })
                  return
                }
                if (round < 5) timer = setTimeout(() => attempt(round + 1), 1200)
                else setIds({ created: [], updated: [], cited: fallback.cited })
              })
              .catch(() => {
                if (alive) timer = setTimeout(() => attempt(round + 1), 1500)
              })
            return
          }
          setIds({ created: [], updated: [], cited: fallback.cited })
        }
        attempt(0)
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [sessionId, start, end, turn?.status])
      useEffect(() => {
        const all = [...ids.created, ...ids.updated, ...ids.cited]
        if (!all.length) return undefined
        let alive = true
        fetch(`${API}/entries-by-ids?ids=${encodeURIComponent(all.join(','))}`)
          .then((r) => r.json())
          .then((res) => {
            if (alive) setRows(res?.entries ?? [])
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [ids.created.join(','), ids.updated.join(','), ids.cited.join(',')])
      if (!ids.created.length && !ids.updated.length && !ids.cited.length) return null
      const all = rows ?? []
      const created = all.filter((r) => ids.created.includes(r.entry.id))
      const updated = all.filter((r) => ids.updated.includes(r.entry.id))
      const citedCount = ids.cited.length
      return h(
        'div',
        { style: { marginTop: 8, border: hair, borderRadius: 10, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('span', { style: { fontWeight: 600 } }, '本轮知识'),
          ids.created.length ? h('span', { style: muted }, `新增 ${ids.created.length} 条`) : null,
          ids.updated.length ? h('span', { style: muted }, `更新 ${ids.updated.length} 条`) : null,
          citedCount
            ? h(
                'span',
                { style: { position: 'relative', display: 'inline-flex' } },
                h('button', {
                  style: { ...btn, borderRadius: 999, padding: '1px 8px', fontSize: 12 },
                  onClick: (event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    setDir(window.innerHeight - rect.bottom < 280 ? 'above' : 'below')
                    setOpen(true)
                  },
                }, `引用 ${citedCount} 条`),
                h(
                  Popover,
                  { open, onClose: () => setOpen(false), title: `本轮引用 ${citedCount} 条`, placement: dir },
                  ...all
                    .filter((r) => ids.cited.includes(r.entry.id))
                    .map((r) =>
                      h(
                        'div',
                        { key: r.entry.id, className: 'kb-pop-item', style: { cursor: 'pointer', padding: '5px 6px', borderRadius: 6, display: 'flex', gap: 6, alignItems: 'center' }, onClick: () => { setOpen(false); openKnowledgePage('entries', r.entry.id) } },
                        h('span', { style: { flex: '0 0 auto', opacity: 0.6 } }, '·'),
                        h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.entry.title),
                      ),
                    ),
                ),
              )
            : null,
        ),
        ...[...created, ...updated].map(({ entry, library }) => {
          const snap = ids.states?.[entry.id] || entry.sensitivity
          const kind = ids.updated.includes(entry.id)
            ? { label: '更新', bg: '#2f6fd0' }
            : snap === 'sensitive'
              ? { label: '敏感', bg: '#c0392b' }
              : snap === 'uncertain'
                ? { label: '疑似', bg: '#d9a52f' }
                : { label: '新增', bg: '#2e9a6a' }
          return h(
            'div',
            { key: entry.id, onClick: () => openKnowledgePage('entries', entry.id), style: { cursor: 'pointer', borderRadius: 6, padding: '4px 8px', background: 'transparent', display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }, title: `${entry.title}（${library}）` },
            h('span', { style: { flex: '0 0 auto', background: kind.bg, color: '#fff', borderRadius: 999, padding: '0 8px', fontSize: 11, fontWeight: 600, lineHeight: '18px' } }, kind.label),
            h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.title),
          )
        }),
      )
    }

    // ---------------------------------------------------------------- knowledge chip
    function KnowledgeChip(props) {
      const [data, setData] = useState(null)
      const [open, setOpen] = useState(false)
      useEffect(() => {
        let alive = true
        const sid = props?.sessionId || props?.session?.id || ''
        const load = () =>
          fetch(`${API}/session-knowledge?sessionId=${encodeURIComponent(sid)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((value) => {
              if (alive) setData(value)
            })
            .catch(() => {})
        load()
        const timer = setInterval(load, 5000)
        const onVisible = () => {
          if (document.visibilityState === 'visible') load()
        }
        window.addEventListener('focus', onVisible)
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          alive = false
          clearInterval(timer)
          window.removeEventListener('focus', onVisible)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [])
      const groups = data?.groups ?? []
      const total = groups.reduce((sum, g) => sum + g.items.length, 0)
      if (!total) return null
      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', position: 'relative' } },
        h(
          'button',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              border: hair,
              borderRadius: 999,
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
              fontSize: 12,
              padding: '3px 10px',
              cursor: 'pointer',
              marginRight: 6,
            },
            title: '本会话涉及的知识',
            onClick: () => setOpen(true),
          },
          h('span', null, `知识 ${total} 条`),
        ),
        h(
          Popover,
          { open, onClose: () => setOpen(false), placement: 'above', title: `本会话知识 ${total} 条` },
          ...groups.flatMap((group) =>
            group.items.map((item) =>
              h(
                'div',
                {
                  key: `${group.library}:${item.id}`,
                  className: 'kb-pop-item',
                style: { cursor: 'pointer', padding: '5px 6px', borderRadius: 6, display: 'flex', gap: 6, alignItems: 'center' },
                  onClick: () => {
                    setOpen(false)
                    openKnowledgePage('entries', item.id)
                  },
                },
                h('span', { style: { flex: '0 0 auto', opacity: 0.6 } }, '·'),
                h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.title),
              ),
            ),
          ),
        ),
      )
    }

    // ---------------------------------------------------------------- shell
    function KnowledgePage() {
      const [active, setActive] = useState(pendingSection || 'entries')
      const [detail, setDetail] = useState(null)
      const [flashId, setFlashId] = useState(pendingFlashId || '')
      useEffect(() => {
        pendingSection = ''
        pendingFlashId = ''
        const onSection = (event) => {
          const section = event?.detail?.section
          if (!section) return
          setDetail(null)
          setActive(section)
          setFlashId(event?.detail?.flashId || '')
        }
        window.addEventListener('dsh-kb-section', onSection)
        return () => window.removeEventListener('dsh-kb-section', onSection)
      }, [])
      const open = (d) => setDetail(d)
      const back = () => {
        const id = detail?.id
        setDetail(null)
        if (id) setFlashId(id)
      }

      let body
      if (detail?.type === 'entry') body = h(EntryDetail, { library: detail.library, id: detail.id, onBack: back })
      else if (detail?.type === 'connect') body = h(ConnectPage, { onBack: () => setDetail(null), initial: detail.connection })
      else if (active === 'entries') body = h(EntriesPage, { onOpen: open, flashId, clearFlash: () => setFlashId('') })
      else if (active === 'added') body = h(AddedPage, { onOpen: open })
      else if (active === 'uncertain') body = h(UncertainPage, { onOpen: open, onJump: (section) => { setDetail(null); setActive(section) } })
      else if (active === 'libs') body = h(LibsPage, { onConnect: () => setDetail({ type: 'connect' }), onSettings: (conn) => setDetail({ type: 'connect', connection: conn }) })
      else if (active === 'sync') body = h(SyncPage)
      else if (active === 'trash') body = h(TrashPage)
      else if (active === 'settings') body = h(SettingsPage)
      else if (active === 'guide') body = h(GuidePage)
      else body = h(StatsPage)

      return h(
        'div',
        { style: shell },
        h(
          'div',
          { style: nav },
          h('div', { style: { fontSize: 15, fontWeight: 600, padding: '0 8px 4px' } }, `知识管理 v${KB_VERSION}`),
          ...NAV.map((group) =>
            h(
              'div',
              { key: group.group, style: { display: 'flex', flexDirection: 'column', gap: 2 } },
              h('div', { style: { ...muted, padding: '0 8px' } }, group.group),
              ...group.items.map((item) =>
                h(
                  'button',
                  {
                    key: item.key,
                    style: navItem(active === item.key && !detail),
                    onClick: () => {
                      setDetail(null)
                      setActive(item.key)
                    },
                    title: item.hint,
                  },
                  h('span', null, item.label),
                  h('span', { style: muted }, item.hint),
                ),
              ),
            ),
          ),
        ),
        h('div', { style: content }, body),
      )
    }

    function SidebarIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 16
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('path', {
          d: 'M3.2 3.1c0-.6 1.1-1.1 2.4-1.1s2.4.5 2.4 1.1v9.1c0 .6-1.1 1.1-2.4 1.1s-2.4-.5-2.4-1.1z',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
        h('circle', { cx: 10.9, cy: 9.7, r: 2.6, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', { d: 'M13.1 11.9l2.2 2.2', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      )
    }

    const FLASH_CSS = `@keyframes kb-flash { 0%,100% { background: transparent } 50% { background: rgba(244,185,66,.45) } } .kb-flash { animation: kb-flash .5s ease-in-out 4 } .kb-pop-item:hover { box-shadow: 0 2px 10px rgba(0,0,0,.22); background: color-mix(in srgb, currentColor 7%, transparent) }`
    function ensureFlashStyle() {
      if (typeof document === 'undefined') return
      if (document.getElementById('kb-flash-style')) return
      const style = document.createElement('style')
      style.id = 'kb-flash-style'
      style.textContent = FLASH_CSS
      document.head.appendChild(style)
    }

    return {
      inject: ['slots', 'sidebarRightTabs', 'sidebarRight'],
      apply(ctx) {
        ensureFlashStyle()
        try {
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 10, label: () => '知识管理' }, SidebarIcon),
          )
        } catch (error) {
          console.error('[dsh-knowledge-manager] sidebar row failed:', error)
        }
        try {
          ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, KnowledgePage))
        } catch (error) {
          console.error('[dsh-knowledge-manager] main page failed:', error)
        }
        try {
          ctx.effect(() =>
            ctx.sidebarRightTabs.register({
              id: PANEL_ID,
              kind: 'knowledge',
              patterns: [],
              title: () => '知识管理',
            }),
          )
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register({ name: 'sidebar.right.pane.tab', key: PANEL_ID }, KnowledgePage),
          )
        } catch (error) {
          console.error('[dsh-knowledge-manager] right tab failed:', error)
        }
        window.__KB_OPEN_TAB__ = () => {
          try {
            ctx.sidebarRight.openTab('knowledge')
          } catch {
            /* right tab may be unavailable */
          }
        }
        const openKnowledge = (section = 'entries', flashId = '') => openKnowledgePage(section, flashId)
        try {
          const InTurn = (props) => h(KnowledgeTailInTurn, { ...props, openKnowledge })
          ctx.slots.inject('conversation.chat.turnTail', () =>
            ctx.slots.register(
              { name: 'conversation.chat.turnTail', id: 'kb-knowledge-in-turn', order: 400 },
              InTurn,
            ),
          )
        } catch (error) {
          console.error('[dsh-knowledge-manager] in-turn tail failed:', error)
        }
        try {
          const Tail = (props) => h(KnowledgeTail, { ...props, openKnowledge })
          ctx.slots.inject('conversation.chat.assistant-actions', () =>
            ctx.slots.register(
              { name: 'conversation.chat.assistant-actions', id: 'kb-knowledge-tail', order: 500 },
              Tail,
            ),
          )
        } catch (error) {
          console.error('[dsh-knowledge-manager] knowledge tail failed:', error)
        }
        try {
          const Chip = (props) => h(KnowledgeChip, { ...props, openKnowledge })
          ctx.slots.inject('conversation.composer.dock', () =>
            ctx.slots.register(
              { name: 'conversation.composer.dock', id: 'kb-knowledge-chip', order: 60 },
              Chip,
            ),
          )
        } catch (error) {
          console.error('[dsh-knowledge-manager] knowledge chip failed:', error)
        }
      }
    }
  },
})
