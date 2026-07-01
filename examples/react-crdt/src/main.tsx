import {createRoot} from 'react-dom/client';
import '../../../src/block-editor/defaultBlockEditorPlugins.css';
import {App} from './App';

createRoot(document.getElementById('root')!).render(<App />);
