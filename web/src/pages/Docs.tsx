import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import * as api from '../api'

const DOCS: { id: string; label: string }[] = [
  { id: 'README.md', label: 'README' },
  { id: 'docs/API.md', label: 'API' },
  { id: 'docs/ARCHITECTURE.md', label: 'Архитектура' },
  { id: 'docs/MATH.md', label: 'Математика' },
]

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
          <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
            {content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  )
}
