import { lazy, Suspense } from 'react';
import NonstopMakerApp from './nonstopmaker/NonstopMakerApp.jsx';

const TimeMarkEditor = lazy(() => import('./TimeMarkEditor.jsx'));

export default function App() {
  const showTimeMark = new URLSearchParams(window.location.search).get('app') === 'timemark';
  if (!showTimeMark) return <NonstopMakerApp />;

  return (
    <Suspense fallback={<div className="legacy-loading">Opening TimeMark Studio…</div>}>
      <TimeMarkEditor />
    </Suspense>
  );
}
