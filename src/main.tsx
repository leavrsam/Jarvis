import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { VoiceComparisonPage } from './voiceLab/VoiceComparisonPage';
import './index.css';

// Hash route so it works on the dev server and on Vercel without rewrites: /#/voice-compare
const VOICE_COMPARE_HASH = '#/voice-compare';

const Root: React.FC = () => {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash === VOICE_COMPARE_HASH ? <VoiceComparisonPage /> : <App />;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
