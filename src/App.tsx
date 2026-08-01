import { isFirebaseConfigured } from './firebase/config';
import { ErrorScreen } from './components/ErrorScreen';
import { GameScreen } from './components/GameScreen';
import { LoadingScreen } from './components/LoadingScreen';
import { SetupRequiredScreen } from './components/SetupRequiredScreen';
import { SpectatorScreen } from './components/SpectatorScreen';
import { useGameRoom } from './hooks/useGameRoom';

export default function App() {
  if (!isFirebaseConfigured) {
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
        {game.status === 'loading' && <LoadingScreen />}
        {game.status === 'error' && <ErrorScreen message={game.error} onRetry={game.retry} />}
        {game.status === 'spectator' && <SpectatorScreen />}
        {game.status === 'connected' && <GameScreen game={game} />}
      </main>

      <footer className="app__footer">Best of three sets · X always starts</footer>
    </div>
  );
}
