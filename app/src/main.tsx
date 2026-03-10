import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

console.log('MAIN: Starting...');
const rootEl = document.getElementById('root');
console.log('MAIN: root element =', rootEl);

if (!rootEl) {
  console.error('MAIN: Root element not found!');
} else {
  try {
    const root = createRoot(rootEl);
    console.log('MAIN: root created');
    root.render(<App />);
    console.log('MAIN: render called successfully');
  } catch (e) {
    console.error('MAIN: Error during render:', e);
  }
}
