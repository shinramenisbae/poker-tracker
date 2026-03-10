import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Home } from './pages/Home';
import { NewSession } from './pages/NewSession';
import { SessionDetail } from './pages/SessionDetail';
import { Results } from './pages/Results';
import { Settings } from './pages/Settings';
import { Stats } from './pages/Stats';
import './index.css';

function App() {
  console.log('APP: Rendering');
  return (
    <HashRouter>
      <div className="h-full w-full bg-bg-primary relative">
        {/* Watermark faces */}
        <div className="watermark watermark-left" aria-hidden="true" />
        <div className="watermark watermark-right" aria-hidden="true" />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/session/new" element={<NewSession />} />
          <Route path="/session/:id" element={<SessionDetail />} />
          <Route path="/session/:id/results" element={<Results />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </HashRouter>
  );
}

export default App;
