import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTheme } from '@/contexts/ThemeContext'
import { getSettings, updateSettings, setDesk2Pin, clearDesk2Pin, clearDesk2Token } from '@/api'
import { queryKeys } from '@/queryKeys'
import { Button, Input, Surface } from '@/components/ui'
import { useAsyncStatus } from '@/hooks/useAsyncStatus'

export default function DesksSection() {
  const { theme } = useTheme()
  const queryClient = useQueryClient()
  const [name1, setName1] = useState('')
  const [name2, setName2] = useState('')
  const [pinSet, setPinSet] = useState(false)
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [removingPin, setRemovingPin] = useState(false)
  const [currentPin, setCurrentPin] = useState('')
  const { status, loading, run } = useAsyncStatus(2000)
  const { status: pinStatus, loading: pinLoading, run: runPin } = useAsyncStatus(2000)

  useEffect(() => {
    getSettings().then(s => {
      if (s.desk_1_name) setName1(s.desk_1_name)
      if (s.desk_2_name) setName2(s.desk_2_name)
      setPinSet(s.desk2_pin_set === '1')
    }).catch(() => {})
  }, [])

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await updateSettings({ desk_1_name: name1.trim(), desk_2_name: name2.trim() })
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      return 'Saved'
    })
  }

  const savePin = (e: React.FormEvent) => {
    e.preventDefault()
    if (newPin !== confirmPin) { return }
    void runPin(async () => {
      await setDesk2Pin(newPin)
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      setPinSet(true)
      setNewPin('')
      setConfirmPin('')
      return 'PIN saved'
    })
  }

  const removePin = (e: React.FormEvent) => {
    e.preventDefault()
    void runPin(async () => {
      await clearDesk2Pin(currentPin)
      clearDesk2Token()
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      setPinSet(false)
      setRemovingPin(false)
      setCurrentPin('')
      return 'PIN removed'
    })
  }

  const pinMismatch = newPin && confirmPin && newPin !== confirmPin

  return (
    <Surface className="p-6 mb-5">
      <h2 className="text-base font-bold mb-1" style={{ color: theme.text }}>Desks</h2>
      <p className="text-xs mb-5" style={{ color: theme.text2 }}>
        Desks are two fully separate libraries with their own videos and collections.
        Name them after how you split things (e.g. "Music" / "Tutorials"). Leave blank for the defaults.
      </p>
      <form onSubmit={save} className="flex items-center gap-2 flex-wrap">
        <Input
          type="text"
          value={name1}
          onChange={e => setName1(e.target.value)}
          placeholder="Desk 1"
          maxLength={20}
          className="!flex-1 !w-auto min-w-0"
        />
        <Input
          type="text"
          value={name2}
          onChange={e => setName2(e.target.value)}
          placeholder="Desk 2"
          maxLength={20}
          className="!flex-1 !w-auto min-w-0"
        />
        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? 'Saving...' : 'Save'}
        </Button>
        {status && <span className="text-sm font-medium" style={{ color: theme.accent }}>{status}</span>}
      </form>

      <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${theme.border}` }}>
        <h3 className="text-sm font-semibold mb-1" style={{ color: theme.text }}>Desk 2 PIN</h3>
        <p className="text-xs mb-4" style={{ color: theme.text2 }}>
          Require a PIN to switch to Desk 2. Good for keeping separate libraries private on a shared device.
        </p>
        {pinSet ? (
          removingPin ? (
            <form onSubmit={removePin} className="flex flex-col gap-2 max-w-xs">
              <Input
                type="password"
                value={currentPin}
                onChange={e => setCurrentPin(e.target.value)}
                placeholder="Enter current PIN to confirm"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <Button type="submit" variant="danger" size="sm" disabled={pinLoading || !currentPin}>
                  {pinLoading ? 'Removing…' : 'Confirm remove'}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => { setRemovingPin(false); setCurrentPin('') }}>
                  Cancel
                </Button>
                {pinStatus && <span className="text-sm font-medium" style={{ color: theme.accent }}>{pinStatus}</span>}
              </div>
            </form>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-sm" style={{ color: theme.text2 }}>PIN is set.</span>
              <Button variant="ghost" size="sm" onClick={() => setRemovingPin(true)}>
                Remove PIN
              </Button>
              {pinStatus && <span className="text-sm font-medium" style={{ color: theme.accent }}>{pinStatus}</span>}
            </div>
          )
        ) : (
          <form onSubmit={savePin} className="flex flex-col gap-2 max-w-xs">
            <Input
              type="password"
              value={newPin}
              onChange={e => setNewPin(e.target.value)}
              placeholder="New PIN"
              maxLength={20}
            />
            <Input
              type="password"
              value={confirmPin}
              onChange={e => setConfirmPin(e.target.value)}
              placeholder="Confirm PIN"
              maxLength={20}
            />
            {pinMismatch && (
              <p className="text-xs" style={{ color: '#ef4444' }}>PINs do not match</p>
            )}
            <div className="flex items-center gap-2">
              <Button type="submit" variant="primary" size="sm" disabled={pinLoading || !newPin || !!pinMismatch}>
                {pinLoading ? 'Saving…' : 'Set PIN'}
              </Button>
              {pinStatus && <span className="text-sm font-medium" style={{ color: theme.accent }}>{pinStatus}</span>}
            </div>
          </form>
        )}
      </div>
    </Surface>
  )
}
