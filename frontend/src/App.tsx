import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { useGameStore } from './store/gameStore';
import { SetupScreen } from './components/SetupScreen';
import './styles/global.css';

const Dashboard = lazy(async () => {
  const module = await import('./components/Dashboard');
  return { default: module.Dashboard };
});

class RenderErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('CoffeeSim UI failed to render', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="ui-crash">
          <div className="eyebrow">COFFEESIM UI DIAGNOSTIC</div>
          <h1>The control room could not render.</h1>
          <p>{this.state.error.message}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload UI</button>
        </main>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const phase = useGameStore((state) => state.phase);

  return (
    <div className="app">
      {phase === 'setup' && <SetupScreen />}
      {(phase === 'playing' || phase === 'ended') && (
        <Suspense fallback={<main className="ui-loading">Loading control room…</main>}>
          <Dashboard />
        </Suspense>
      )}
    </div>
  );
}

function App() {
  return <RenderErrorBoundary><AppContent /></RenderErrorBoundary>;
}

export default App;

