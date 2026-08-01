import { isSupabaseConfigured } from './supabase/client';
import { ErrorScreen } from './components/ErrorScreen';
import { GameScreen } from './components/GameScreen';
import { HomeScreen } from './components/HomeScreen';
import { LoadingScreen } from './components/LoadingScreen';
import { SetupRequiredScreen } from './components/SetupRequiredScreen';
import { useGameRoom } from './hooks/useGameRoom';

export default function App() {
  if (!isSupabaseConfigured) {
    return (
      <div className="app">
        <header className="app__header">
          <h1 className="app__title">Tic-Tac-Toe</h1>
        </header>
        <main className="app__main">
          <SetupRequiredScreen />
        </main>
      </div>
    );
  }
  return <GameApp />;
}

function GameApp() {
  const game = useGameRoom();

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Tic-Tac-Toe</h1>
      </header>

      <main className="app__main">
        {game.screen === 'home' && <HomeScreen game={game} />}
        {game.screen !== 'home' && game.status === 'loading' && <LoadingScreen />}
        {game.screen !== 'home' && game.status === 'error' && (
          <ErrorScreen message={game.error} onRetry={game.retry} />
        )}
        {game.screen !== 'home' && game.status === 'connected' && <GameScreen game={game} />}
      </main>
    </div>
  );
}
