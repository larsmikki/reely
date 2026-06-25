import { useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { createCollection } from '@/api'
import { Button, Input, Modal, ColorSwatches, PRESET_COLORS } from '@/components/ui'
import type { Collection } from '@/types'

interface Props {
  onClose: () => void
  onCreated: (collection: Collection) => void
}

export default function NewCollectionModal({ onClose, onCreated }: Props) {
  const { theme } = useTheme()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      const collection = await createCollection({
        name: name.trim(),
        description: description.trim() || undefined,
        color,
      })
      onCreated(collection)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create collection.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal title="New collection" onClose={onClose}>
      <form onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-4">
        <div>
          <label className="block text-xs font-semibold mb-1.5 tracking-wide" style={{ color: theme.text2 }}>Color</label>
          <ColorSwatches value={color} onChange={setColor} size={24} />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1.5 tracking-wide" style={{ color: theme.text2 }}>Name</label>
          <Input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Collection name" required autoFocus />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1.5 tracking-wide" style={{ color: theme.text2 }}>Description (optional)</label>
          <Input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description..." />
        </div>
        {error && <p className="text-sm" style={{ color: '#e11d48' }}>{error}</p>}
        <Button type="submit" variant="primary" fullWidth disabled={creating || !name.trim()}>
          {creating ? 'Creating...' : 'Create Collection'}
        </Button>
      </form>
    </Modal>
  )
}
