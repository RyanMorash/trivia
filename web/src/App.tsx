import { Route, Routes } from 'react-router-dom';
import AudienceView from './pages/audience/AudienceView';
import CompetitorView from './pages/competitor/CompetitorView';
import BuzzerSim from './pages/dev/BuzzerSim';
import HostView from './pages/host/HostView';
import Landing from './pages/Landing';
import Console from './pages/showrunner/Console';
import GameComposer from './pages/showrunner/GameComposer';
import SessionControl from './pages/showrunner/SessionControl';
import SetEditor from './pages/showrunner/SetEditor';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/console" element={<Console />} />
      <Route path="/console/sets/:id" element={<SetEditor />} />
      <Route path="/console/games/:id" element={<GameComposer />} />
      <Route path="/console/session/:code" element={<SessionControl />} />
      <Route path="/host/:code" element={<HostView />} />
      <Route path="/team/:code/:teamId" element={<CompetitorView />} />
      <Route path="/audience/:code" element={<AudienceView />} />
      <Route path="/dev/buzzers" element={<BuzzerSim />} />
    </Routes>
  );
}
