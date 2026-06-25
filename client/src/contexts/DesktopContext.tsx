import { createContext, useContext, useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getActiveDesktop, setActiveDesktop, getSettings, isDesk2Unlocked, clearDesk2Token } from '@/api'
import { queryKeys } from '@/queryKeys'
import Desk2PinModal from '@/components/Desk2PinModal'

interface DesktopContextValue {
  desktop: 1 | 2
  switchDesktop: (d: 1 | 2) => void
  deskNames: Record<1 | 2, string>
}

const DesktopContext = createContext<DesktopContextValue>({
  desktop: 1,
  switchDesktop: () => {},
  deskNames: { 1: 'Desk 1', 2: 'Desk 2' },
})

export function DesktopProvider({ children }: { children: React.ReactNode }) {
  const [desktop, setDesktop] = useState<1 | 2>(getActiveDesktop)
  const [showPinModal, setShowPinModal] = useState(false)
  const queryClient = useQueryClient()

  const { data: settings } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: getSettings,
    staleTime: 60_000,
  })
  const pinRequired = settings?.desk2_pin_set === '1'
  const deskNames: Record<1 | 2, string> = {
    1: settings?.desk_1_name?.trim() || 'Desk 1',
    2: settings?.desk_2_name?.trim() || 'Desk 2',
  }

  function doSwitch(d: 1 | 2) {
    setActiveDesktop(d)
    setDesktop(d)
    void queryClient.invalidateQueries()
  }

  function switchDesktop(d: 1 | 2) {
    if (d === 2 && pinRequired && !isDesk2Unlocked()) {
      setShowPinModal(true)
      return
    }
    doSwitch(d)
  }

  // If the server rejects our token (e.g. after a restart), prompt again
  useEffect(() => {
    const handler = () => {
      clearDesk2Token()
      if (desktop === 2) setShowPinModal(true)
    }
    window.addEventListener('desk2-locked', handler)
    return () => window.removeEventListener('desk2-locked', handler)
  }, [desktop])

  return (
    <DesktopContext.Provider value={{ desktop, switchDesktop, deskNames }}>
      {children}
      {showPinModal && (
        <Desk2PinModal
          desk2Name={deskNames[2]}
          onSuccess={() => { setShowPinModal(false); doSwitch(2) }}
          onClose={() => { setShowPinModal(false); if (desktop === 2) doSwitch(1) }}
        />
      )}
    </DesktopContext.Provider>
  )
}

export const useDesktop = () => useContext(DesktopContext)
