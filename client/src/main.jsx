import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Polyfills for WebRTC (simple-peer)
import { Buffer } from 'buffer';
import process from 'process';

window.global = window;
window.process = process;
window.Buffer = Buffer;

createRoot(document.getElementById('root')).render(
    <App />
)
