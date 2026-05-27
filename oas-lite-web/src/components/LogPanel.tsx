import { useEffect, useRef } from 'react'
import type { LogEvent } from '../api/oasClient'

interface Props {
  events: LogEvent[]
  onClear: () => void
}

export function LogPanel({ events, onClear }: Props) {
  const listRef = useRef<HTMLDivElement | null>(null)

  // 自动滚到底
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events])

  return (
    <section className="log">
      <div className="log-head">
        <h2>日志 ({events.length})</h2>
        <button type="button" className="btn" onClick={onClear}>清空</button>
      </div>
      <div className="log-list" ref={listRef}>
        {events.length === 0 ? (
          <div style={{ color: 'var(--text-dim)' }}>暂无日志。</div>
        ) : (
          events.map((e, i) => (
            <div key={i} className={`log-item ${e.level}`}>
              <span className="ts">{fmtTime(e.ts)}</span>
              <span className="lv">[{e.level.toUpperCase()}]</span>
              <span>{e.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

function fmtTime(ts: number) {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
