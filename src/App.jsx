import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Kiosk from './pages/Kiosk'
import Admin from './pages/Admin'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"          element={<Kiosk />} />
        <Route path="/admin"     element={<Admin />} />
        <Route path="/dashboard" element={<Navigate to="/admin" replace />} />
        <Route path="*"          element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
