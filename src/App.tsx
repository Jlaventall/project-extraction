import { useGameStore } from './store/gameStore';
import { SetupScreen } from './components/SetupScreen';
import { Dashboard } from './components/Dashboard';
import './styles/global.css';

function App() {
  const phase = useGameStore((s) => s.phase);

  return (
    <div className="app">
      {phase === 'setup' && <SetupScreen />}
      {(phase === 'playing' || phase === 'ended') && <Dashboard />}
    </div>
  );
}

export default App;
