import { Route, Switch } from 'wouter'
import TopBar from './components/TopBar.tsx'
import Sidebar from './components/Sidebar.tsx'
import Overview from './components/Overview.tsx'
import RegistryPage from './components/RegistryPage.tsx'
import { useRegistryEvents } from './ws.ts'

export default function App() {
  useRegistryEvents()
  return (
    <div className="layout">
      <TopBar />
      <Sidebar />
      <main className="main">
        <Switch>
          <Route path="/" component={Overview} />
          <Route path="/r/:name">{params => <RegistryPage name={params.name} />}</Route>
        </Switch>
      </main>
    </div>
  )
}
