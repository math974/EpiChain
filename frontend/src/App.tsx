import { ConnectButton } from "@rainbow-me/rainbowkit";
import "./App.css";

function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>EpiChain</h1>
        <ConnectButton />
      </header>
      <main className="app-main">
        <p>
          ERC-4337 smart account UI and indexer feed will live here. See the
          root README for setup.
        </p>
      </main>
    </div>
  );
}

export default App;
