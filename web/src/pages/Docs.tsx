import { useCallback, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { Components } from 'react-markdown'
import 'katex/dist/katex.min.css'
import * as api from '../api'

const DOCS: { id: string; label: string }[] = [
  { id: 'README.md', label: 'README' },
  { id: 'docs/BUILD_AND_RUN.md', label: 'Сборка и запуск' },
  { id: 'docs/SECURITY.md', label: 'Безопасность' },
  { id: 'docs/API.md', label: 'API' },
  { id: 'docs/ARCHITECTURE.md', label: 'Архитектура' },
  { id: 'docs/MATH.md', label: 'Математика' },
]

const DOC_IDS = new Set(DOCS.map((d) => d.id))

function normalizeDocHref(href: string): string | null {
  try {
    if (/^https?:\/\//i.test(href)) {
      const u = new URL(href)
      const path = u.pathname.replace(/^\/+/, '').replace(/\/+$/, '')
      return path || null
    }
    let s = href.replace(/#.*$/, '').trim()
    if (s.startsWith('./')) s = s.slice(2)
    return s || null
  } catch {
    let s = href.replace(/#.*$/, '').trim()
    if (s.startsWith('./')) s = s.slice(2)
    return s || null
  }
}

export default function Docs() {
  const [file, setFile] = useState(DOCS[0].id)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .getDoc(file)
      .then((r) => {
        setContent(r.content)
      })
      .catch((e) => {
        setError(String(e))
        setContent(null)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [file])

  const handleDocLink = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      const href = (e.currentTarget.getAttribute('href') || '').trim()
      const docId = normalizeDocHref(href)
      if (docId && DOC_IDS.has(docId)) {
        e.preventDefault()
        setFile(docId)
      }
    },
    []
  )

  const components: Components = {
    a: ({ href, children, ...props }) => (
      <a
        href={href}
        onClick={handleDocLink}
        {...props}
      >
        {children}
      </a>
    ),
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {DOCS.map((d) => (
          <button
            key={d.id}
            type="button"
            className={file === d.id ? 'primary' : ''}
            onClick={() => setFile(d.id)}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="doc-content card" style={{ flex: 1, overflow: 'auto', padding: '1.5rem' }}>
        {loading && <p style={{ color: 'var(--muted)' }}>Загрузка…</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        {!loading && !error && content !== null && (
          <ReactMarkdown
            remarkPlugins={[remarkMath, remarkGfm]}
            rehypePlugins={[rehypeKatex]}
            components={components}
          >
            {content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  )
}
