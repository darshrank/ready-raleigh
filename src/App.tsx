import { useEffect } from 'react'
import MapView from './map/MapView'
import { useStore } from './store'
import Hud from './ui/Hud'

export default function App() {
  const status = useStore((s) => s.status)
  useEffect(() => {
    useStore.getState().init()
  }, [])
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      {status === 'ready' && <MapView />}
      <Hud />
    </div>
  )
}
