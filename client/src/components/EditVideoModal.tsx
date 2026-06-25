import { useState, useMemo } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { useDownloadPath } from '@/hooks/useDownloadPath'
import { updateVideo, createCollection } from '@/api'
import { Button, Input, Select, Textarea, Modal, ColorSwatches, PRESET_COLORS, OutputOptions } from '@/components/ui'
import type { Video, Collection } from '@/types'

interface Props {
  video: Video
  collections: Collection[]
  onCollectionsChange: () => void
  onClose: () => void
  onSaved: () => void
}

export default function EditVideoModal({ video, collections, onCollectionsChange, onClose, onSaved }: Props) {
  const { theme } = useTheme()
  const outputDir = useDownloadPath()
  const [url, setUrl] = useState(video.page_url)
  const [title, setTitle] = useState(video.title ?? '')
  const [notes, setNotes] = useState(video.notes ?? '')
  const [collectionId, setCollectionId] = useState<number | ''>(video.collection_id ?? '')
  const [outputMp3, setOutputMp3] = useState(false)
  const [outputMp4, setOutputMp4] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [redownload, setRedownload] = useState(false)

  const [showNewColl, setShowNewColl] = useState(false)
  const [newCollName, setNewCollName] = useState('')
  const [newCollColor, setNewCollColor] = useState(PRESET_COLORS[0])
  const [creatingColl, setCreatingColl] = useState(false)
  const [extraCollections, setExtraCollections] = useState<Collection[]>([])
  const allCollections = useMemo(() => [
    ...collections,
    ...extraCollections.filter(ec => !collections.some(c => c.id === ec.id)),
  ], [collections, extraCollections])

  const urlChanged = url.trim() !== video.page_url

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const trimmedTitle = title.trim()
      const trimmedNotes = notes.trim()
      await updateVideo(video.id, {
        page_url: urlChanged ? url.trim() : undefined,
        redownload: urlChanged && redownload,
        collection_id: collectionId !== '' ? Number(collectionId) : null,
        title: trimmedTitle !== (video.title ?? '') ? (trimmedTitle || null) : undefined,
        notes: trimmedNotes !== (video.notes ?? '') ? (trimmedNotes || null) : undefined,
        download_mp3: outputMp3,
        output_mp4: outputMp4,
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes.')
    }
    finally { setLoading(false) }
  }

  const handleCreateCollection = async () => {
    if (!newCollName.trim()) return
    setCreatingColl(true)
    try {
      const col = await createCollection({ name: newCollName.trim(), color: newCollColor })
      setExtraCollections(prev => [...prev, col])
      setCollectionId(col.id)
      setShowNewColl(false)
      setNewCollName('')
      setNewCollColor(PRESET_COLORS[0])
      onCollectionsChange()
    } catch { /* ignore */ }
    finally { setCreatingColl(false) }
  }

  return (
    <Modal title="Edit video" onClose={onClose}>
      <form onSubmit={handleSave} className="px-6 py-5 flex flex-col gap-4">
        <div>
          <label className="block text-xs font-semibold mb-1.5 tracking-wide" style={{ color: theme.text2 }}>Title</label>
          <Input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Video title"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1.5 tracking-wide" style={{ color: theme.text2 }}>URL</label>
          <Input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            required
            className="font-mono"
            highlighted={urlChanged}
          />
          {urlChanged && (
            <div
              className="mt-2 p-3 rounded-xl flex flex-col gap-2"
              style={{ background: theme.surface2, border: `1px solid ${theme.border}` }}
            >
              <p className="text-xs font-semibold tracking-wide" style={{ color: theme.text }}>
                URL changed — what should happen on save?
              </p>
              <label className="flex items-start gap-2 cursor-pointer text-sm" style={{ color: theme.text }}>
                <input
                  type="radio"
                  name="url-change-action"
                  checked={!redownload}
                  onChange={() => setRedownload(false)}
                  className="mt-0.5"
                  style={{ accentColor: theme.accent }}
                />
                <span>
                  Keep current file
                  <span className="block text-xs" style={{ color: theme.text2 }}>Only the stored URL is updated.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer text-sm" style={{ color: theme.text }}>
                <input
                  type="radio"
                  name="url-change-action"
                  checked={redownload}
                  onChange={() => setRedownload(true)}
                  className="mt-0.5"
                  style={{ accentColor: theme.accent }}
                />
                <span>
                  Re-download from the new URL
                  <span className="block text-xs" style={{ color: theme.text2 }}>Replaces all metadata and the local file.</span>
                </span>
              </label>
            </div>
          )}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold tracking-wide" style={{ color: theme.text2 }}>Collection</label>
            <button
              type="button"
              onClick={() => setShowNewColl(v => !v)}
              className="text-xs font-medium transition-opacity hover:opacity-80"
              style={{ color: theme.accent }}
            >
              {showNewColl ? 'Cancel' : '+ New collection'}
            </button>
          </div>
          <Select
            value={collectionId}
            onChange={e => setCollectionId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">No collection</option>
            {allCollections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>

          {showNewColl && (
            <div className="mt-2 p-3 rounded-xl flex flex-col gap-2" style={{ background: theme.surface2, border: `1px solid ${theme.border}` }}>
              <ColorSwatches value={newCollColor} onChange={setNewCollColor} />
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={newCollName}
                  onChange={e => setNewCollName(e.target.value)}
                  placeholder="Collection name"
                  className="!py-1.5"
                  autoFocus
                />
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleCreateCollection}
                  disabled={creatingColl || !newCollName.trim()}
                >
                  {creatingColl ? '...' : 'Create'}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1.5 tracking-wide" style={{ color: theme.text2 }}>Notes (optional)</label>
          <Textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Add a note..."
            rows={2}
          />
        </div>

        {outputDir && (
          <OutputOptions
            outputDir={outputDir}
            outputMp3={outputMp3}
            outputMp4={outputMp4}
            onMp3Change={setOutputMp3}
            onMp4Change={setOutputMp4}
          />
        )}

        {error && <p className="text-sm" style={{ color: '#e11d48' }}>{error}</p>}

        <Button type="submit" variant="primary" fullWidth disabled={loading}>
          {loading ? 'Saving...' : 'Save'}
        </Button>
      </form>
    </Modal>
  )
}
