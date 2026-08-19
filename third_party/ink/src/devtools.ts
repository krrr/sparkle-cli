// eslint-disable-next-line import/no-unassigned-import
import './devtools-window-polyfill.js';

import devtools from 'react-devtools-core';

(devtools as any).initialize();

(devtools as any).connectToDevTools();
