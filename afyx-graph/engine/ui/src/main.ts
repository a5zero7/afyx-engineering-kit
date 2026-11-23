import './app.css';
import { mountApp } from './native/app';

const target = document.getElementById('app');
if (!target) throw new Error('afyx-graph ui: #app host element is missing from index.html');

export default mountApp(target);
