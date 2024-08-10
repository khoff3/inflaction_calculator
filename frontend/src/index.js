// /src/index.js
import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import { DataProvider } from './components/utils/DataProvider'; // Ensure correct import path

ReactDOM.render(
    <DataProvider>
        <App />
    </DataProvider>,
    document.getElementById('root')
);
