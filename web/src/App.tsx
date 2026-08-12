import { Route, Routes } from 'react-router-dom'
import StatusPage from './pages/StatusPage'
import MonitorDetailPage from './pages/MonitorDetailPage'
import LoginPage from './pages/LoginPage'
import SetupPage from './pages/SetupPage'
import AdminLayout from './pages/admin/AdminLayout'
import MonitorsPage from './pages/admin/MonitorsPage'
import MonitorEditPage from './pages/admin/MonitorEditPage'
import GroupsPage from './pages/admin/GroupsPage'
import WebhooksPage from './pages/admin/WebhooksPage'
import SettingsPage from './pages/admin/SettingsPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<StatusPage />} />
      <Route path="/m/:id" element={<MonitorDetailPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<MonitorsPage />} />
        <Route path="monitors/new" element={<MonitorEditPage />} />
        <Route path="monitors/:id" element={<MonitorEditPage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="webhooks" element={<WebhooksPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
