import {BlogVisualDemos} from './BlogVisualDemos';
import {EditorApp} from './EditorApp';

export function App() {
    return hasDemoQuery() ? <BlogVisualDemos /> : <EditorApp />;
}

const hasDemoQuery = () =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demos');
