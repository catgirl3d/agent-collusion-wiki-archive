import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import Layout from './components/Layout'
import Agents from './pages/Agents'
import Dashboard from './pages/Dashboard'
import Events from './pages/Events'
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
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}