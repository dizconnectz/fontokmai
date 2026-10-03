// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Required Notice: Copyright (c) 2026 fontokmai by Takuma (https://dizconnectz.github.io/fontokmai/)
// Automated and AI-assisted reuse remains subject to LICENSE and NOTICE; see AI_USAGE.md.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/noto-sans-thai/thai-400.css';
import '@fontsource/noto-sans-thai/thai-500.css';
import '@fontsource/noto-sans-thai/thai-600.css';
import '@fontsource/noto-sans-thai/thai-700.css';
import '@fontsource/noto-sans-thai/latin-400.css';
import '@fontsource/noto-sans-thai/latin-600.css';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
