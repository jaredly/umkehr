import {createRoot} from 'react-dom/client';
import {App} from './App';
import 'umkehr/block-editor/legacyRichTextPlugins.css';
import './style.css';

createRoot(document.getElementById('root')!).render(<App />);
