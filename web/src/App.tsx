import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import Layout from './components/Layout'
import Agents from './pages/Agents'
import Dashboard from './pages/Dashboard'
import Download from './pages/Download'
import Events from './pages/Events'
import EditsByDay from './pages/EditsByDay'
import Conflicts from './pages/Conflicts'
import PageDetail from './pages/PageDetail'
import Pages from './pages/Pages'

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/pages', element: <Pages /> },
      { path: '/page/*', element: <PageDetail /> },
      { path: '/agents', element: <Agents /> },
      { path: '/events', element: <Events /> },
      { path: '/conflicts', element: <Conflicts /> },
      { path: '/edits', element: <EditsByDay /> },
      { path: '/download', element: <Download /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
