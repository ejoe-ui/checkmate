import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Kiosk from './pages/Kiosk'

const Dashboard = () => (
  <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#333' }}>
    <h1>♟ CheckMate — Dashboard</h1>
    <p>Inventory, checkout history, and student management coming in Phase 3.</p>
    <a href="/">← Back to Kiosk</a>
  </div>
)

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"          element={<Kiosk />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*"          element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
