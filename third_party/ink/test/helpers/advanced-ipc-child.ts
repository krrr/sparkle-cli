import process from 'node:process';
import {Deserializer} from '../../src/serialization.js';
import {styledLineToString} from '../../src/tokenize.js';

// Child process body for the advanced-IPC round-trip test
// (test/terminal-buffer-advanced-ipc.test.ts). It receives a serialized
// StyledLine payload from the parent over an `serialization: 'advanced'` IPC
// channel, deserializes it, and reports the result back. It must not import
// ava (importing ava outside the runner hangs).
process.on('message', (message: any) => {
	if (message?.type !== 'payload') return;

	const data = message.data as Uint8Array;
	const lines = new Deserializer(data).deserialize();

	process.send?.({
		type: 'roundtrip',
		isUint8Array: data instanceof Uint8Array,
		ctor: data?.constructor?.name,
		bytes: data.byteLength,
		restored: lines.map(line => styledLineToString(line)),
	});
});

process.send?.({type: 'ready'});
