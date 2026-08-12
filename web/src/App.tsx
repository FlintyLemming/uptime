import { Route, Routes } from 'react-router-dom'
import StatusPage from './pages/StatusPage'
import MonitorDetailPage from './pages/MonitorDetailPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<StatusPage />} />
      <Route path="/m/:id" element={<MonitorDetailPage />} />
      {/* /login /setup /admin/* 在计划 05 添加 */}
    </Routes>
  )
}
