import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClickToComponent } from 'click-to-react-component';

import '@puckeditor/core/puck.css';
import '../kit/tokens/tokens.css';
import '../kit/src/styles.css';
import './studio/shell.css';

import { App } from './studio/App.jsx';

createRoot(document.getElementById('root')).render(
  <>
    {/* Option-click any component on the canvas to open its source in VS Code. */}
    <ClickToComponent editor="vscode" />
    <App />
  </>
);
