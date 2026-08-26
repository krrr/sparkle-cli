// eslint-disable-next-line import/no-unassigned-import
import './devtools-window-polyfill.js';

import WebSocket from 'ws';

import devtools from 'react-devtools-core';

const isDevToolsReachable = async (): Promise<boolean> =>
	new Promise(resolve => {
		const socket = new WebSocket('ws://localhost:8097');

		const timeout = setTimeout(() => {
			socket.terminate();
			resolve(false);
		}, 2000);
		// Don't let the timeout keep the process alive on its own
		timeout.unref();

		socket.on('open', () => {
			clearTimeout(timeout);
			socket.terminate();
			resolve(true);
		});

		socket.on('error', () => {
			clearTimeout(timeout);
			socket.terminate();
			resolve(false);
		});
	});

if (await isDevToolsReachable()) {
	(devtools as any).initialize();

	(devtools as any).connectToDevTools();
} else {
	console.warn(
		'DEV is set to true, but the React DevTools server is not running. Start it with:\n\n$ npx react-devtools\n',
	);
}
