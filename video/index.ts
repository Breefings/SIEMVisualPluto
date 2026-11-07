import { continueRender, delayRender, registerRoot } from 'remotion';
import { Root } from './Root.tsx';

// Server-side renders run in a bare headless Chrome: load the same web fonts as the UI
// (Jost + JetBrains Mono) and hold the first frame until they're ready.
const FONTS = 'https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=block';
if (typeof document !== 'undefined' && !document.querySelector(`link[href="${FONTS}"]`)) {
  const handle = delayRender('Loading fonts');
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONTS;
  const done = () => continueRender(handle);
  link.onload = () => {
    Promise.all(['300 40px Jost', '500 40px Jost', '600 40px Jost', '400 20px "JetBrains Mono"'].map((f) => document.fonts.load(f)))
      .then(done, done);
  };
  link.onerror = done; // offline: fall back to system fonts rather than hang the render
  document.head.appendChild(link);
}

registerRoot(Root);
