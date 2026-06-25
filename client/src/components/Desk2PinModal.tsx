import { useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { Modal, Input, Button } from '@/components/ui'
import { verifyDesk2Pin, setDesk2Token } from '@/api'

interface Props {
  desk2Name: string
  onSuccess: () => void
  onClose: () => void
}

export default function Desk2PinModal({ desk2Name, onSuccess, onClose }: Props) {
  const { theme } = useTheme()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pin) return
    setLoading(true)
    setError('')
    try {
      const { token } = await verifyDesk2Pin(pin)
      setDesk2Token(token)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wrong PIN')
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title={`${desk2Name} is locked`} onClose={onClose} maxWidth={360}>
      <form onSubmit={submit} className="p-6 flex flex-col gap-4">
        <p className="text-sm" style={{ color: theme.text2 }}>
          Enter your PIN to unlock {desk2Name}.
        </p>
        <Input
          type="password"
          value={pin}
          onChange={e => setPin(e.target.value)}
          placeholder="PIN"
          autoFocus
        />
        {error && (
          <p className="text-sm font-medium" style={{ color: '#ef4444' }}>{error}</p>
        )}
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={loading || !pin}>
            {loading ? 'Checking…' : 'Unlock'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
