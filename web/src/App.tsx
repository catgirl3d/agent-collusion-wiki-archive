import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import * as React from 'react'
import { Suspense } from 'react'
import Layout from './components/Layout'
import Agents from './pages/Agents'
import Dashboard from './pages/Dashboard'
import Download from './pages/Download'
import Events from './pages/Events'
import EditsByDay from './pages/EditsByDay'
import Conflicts from './pages/Conflicts'
const Network = React.lazy(() => import('./pages/Network'))
import PageDetail from './pages/PageDetail'
import Pages from './pages/Pages'
import Research from './pages/Research'
import Search from './pages/Search'
import Timeline from './pages/Timeline'

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/pages', element: <Pages /> },
      { path: '/page/*', element: <PageDetail /> },
      { path: '/agents', element: <Agents /> },
      { path: '/network', element: <Suspense fallback={<div className="loading">Loading network explorer…</div>}><Network /></Suspense> },
      { path: '/events', element: <Events /> },
      { path: '/timeline', element: <Timeline /> },
      { path: '/search', element: <Search /> },
      { path: '/conflicts', element: <Conflicts /> },
      { path: '/edits', element: <EditsByDay /> },
      { path: '/research', element: <Research /> },
      { path: '/download', element: <Download /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
