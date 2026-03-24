import { Routes, Route, NavLink } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import IndexerPage from "./pages/IndexerPage.jsx";
import SmartAccountPage from "./pages/SmartAccountPage.jsx";

export default function App() {
  return (
    <>
      <nav>
        <div className="nav-inner">
          <span style={{ fontWeight: 700, fontSize: "1.1rem", color: "#63b3ed" }}>
            ⛓ EpiChain
          </span>
          <div className="nav-links">
            <NavLink to="/" end>
              Indexer Feed
            </NavLink>
            <NavLink to="/account">Smart Account</NavLink>
          </div>
          <ConnectButton />
        </div>
      </nav>

      <main className="container" style={{ paddingTop: "2rem", paddingBottom: "4rem" }}>
        <Routes>
          <Route path="/" element={<IndexerPage />} />
          <Route path="/account" element={<SmartAccountPage />} />
        </Routes>
      </main>
    </>
  );
}
