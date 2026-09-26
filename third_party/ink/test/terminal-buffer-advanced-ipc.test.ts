import {fork, type ChildProcess} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import test from 'ava';
import {Serializer, Deserializer} from '../src/serialization.js';
import {buildStyledLine, styledLineToString} from '../src/tokenize.js';

// Verifies that the forked render worker (which now uses `serialization:
// 'advanced'`) receives Uint8Array payloads produced by Serializer.serialize
// intact and renders them to stdout. This exercises the full IPC path end to
// end: parent-side serialization -> advanced IPC -> worker deserialization ->
// composition -> ANSI output, all against a real forked worker-entry.ts.
test('forked worker receives binary edits payloads and renders them', async t => {
	// Fork the real worker entry with the same options TerminalBuffer uses,
	// but pipe stdout so we can assert on what the worker writes.
	const worker = fork(
		new URL('../src/worker/worker-entry.ts', import.meta.url),
		{
			env: {
				...process.env,
				INK_WORKER: 'true',
			},
			serialization: 'advanced',
			stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
		},
	) as ChildProcess;

	const output: string[] = [];
	worker.stdout!.on('data', (chunk: Buffer) => {
		output.push(chunk.toString('utf8'));
	});
	const errors: string[] = [];
	worker.stderr!.on('data', (chunk: Buffer) => {
		errors.push(chunk.toString('utf8'));
	});

	const renderDone = new Promise<void>(resolve => {
		worker.on('message', (message: any) => {
			if (message?.type === 'renderDone') resolve();
		});
	});
	const doneConfirmed = new Promise<void>(resolve => {
		worker.on('message', (message: any) => {
			if (message?.type === 'doneConfirmed') resolve();
		});
	});

	// worker-entry has no ack for `init`; just send it and wait for the
	// worker's initial render (its constructor kicks one off) to settle.
	worker.send({
		type: 'init',
		columns: 80,
		rows: 10,
	});

	// Build the same binary edits message TerminalBuffer.sendEdits produces.
	const serializer = new Serializer();
	const lines = ['hello advanced ipc', 'second line'].map(text =>
		buildStyledLine(text),
	);

	worker.send({
		type: 'edits',
		tree: {id: 'root', children: []},
		updates: [
			{
				id: 'root',
				x: 0,
				y: 0,
				width: 80,
				height: 2,
				lines: {
					updates: [
						{
							start: 0,
							end: 2,
							data: serializer.serialize(lines),
						},
					],
					totalLength: 2,
				},
				stickyHeaders: [],
			},
		],
		cursorPosition: undefined,
	});

	worker.send({type: 'render'});
	await renderDone;

	worker.send({type: 'done'});
	await doneConfirmed;

	await new Promise(resolve => setTimeout(resolve, 100));

	// The child runs under ts-node via NODE_OPTIONS, so ignore Node's own
	// loader/deprecation warnings on stderr; only real errors matter.
	const realErrors = errors.filter(
		error =>
			!error.includes('ExperimentalWarning') &&
			!error.includes('DeprecationWarning'),
	);
	t.deepEqual(realErrors, []);
	const rendered = output.join('');
	t.regex(rendered, /hello advanced ipc/);
	t.regex(rendered, /second line/);

	worker.kill();
});

// Ensures the Serializer output survives the advanced-IPC round trip: what the
// parent serializes must arrive as a Uint8Array and deserialize into equal
// lines on the receiving side. The child process body lives in
// test/helpers/advanced-ipc-child.ts (it must not import ava).
test('serializer payloads round-trip through advanced IPC unchanged', async t => {
	const original = ['hello advanced ipc', 'second line'].map(text =>
		buildStyledLine(text),
	);

	const child = fork(
		new URL('./helpers/advanced-ipc-child.ts', import.meta.url),
		{
			env: {
				...process.env,
			},
			serialization: 'advanced',
			stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
		},
	) as ChildProcess;

	const ready = new Promise<void>(resolve => {
		child.once('message', (message: any) => {
			if (message?.type === 'ready') resolve();
		});
	});
	await ready;

	const result = await new Promise<any>(resolve => {
		child.once('message', (message: any) => {
			if (message?.type === 'roundtrip') resolve(message);
		});
		child.send({
			type: 'payload',
			data: new Serializer().serialize(original),
		});
	});

	child.kill();

	t.true(result.isUint8Array);
	t.is(result.bytes, new Serializer().serialize(original).length);
	t.deepEqual(result.restored, ['hello advanced ipc', 'second line']);
});

// Verifies the receiving side of the worker (SceneManager) can consume a
// payload that arrived via advanced IPC: Uint8Array in, StyledLines out.
test('deserializer consumes advanced-IPC received payload', t => {
	const original = ['hello advanced ipc'].map(text => buildStyledLine(text));
	const serialized = new Serializer().serialize(original);

	// advanced serialization delivers the payload as a Uint8Array view over the
	// IPC buffer; simulate that shape (not a full Buffer) as the hard case.
	const view = new Uint8Array(
		serialized.buffer,
		serialized.byteOffset,
		serialized.byteLength,
	);

	const restored = new Deserializer(view).deserialize();
	t.deepEqual(
		restored.map(line => styledLineToString(line)),
		['hello advanced ipc'],
	);
});
