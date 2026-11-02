import { createRoot } from 'react-dom/client';
import { IdentityApp } from './identity.tsx';
import { applyTheme, readThemePreference } from './design/theme.tsx';
import './design/tokens.css';
import './style.css';
const root = document.getElementById('root');
applyTheme(readThemePreference());
if (!root) throw new Error('Missing application root');
createRoot(root).render(<IdentityApp />);
