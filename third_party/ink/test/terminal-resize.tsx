import test from 'ava';
import delay from 'delay';
import stripAnsi from 'strip-ansi';
import React from 'react';
import {render, Box, Text} from '../src/index.js';
import createStdout from './helpers/create-stdout.js';

type SpyStdout = ReturnType<typeof createStdout>;

const getWriteCalls = (stdout: SpyStdout): string[] => {
	const write = stdout.write as unknown as {
		callCount: number;
		args: unknown[];
		getCalls(): {args: unknown[]}[];
	};

	return write.getCalls().map(call => call.args[0] as string);
};

const isEraseOnlyWrite = (output: string): boolean =>
	output.includes('\u001B[') && stripAnsi(output).trim() === '';

function Test() {
	return (
		<Box borderStyle="round">
			<Text>Hello World</Text>
		</Box>
	);
}

test.serial('clear screen when terminal width decreases', async t => {
	const stdout = createStdout(100);

	const {unmount} = render(<Test />, {stdout});

	const initialOutput = stripAnsi(
		(stdout.write as unknown as {firstCall: {args: unknown[]}}).firstCall
			.args[0] as string,
	);
	t.true(initialOutput.includes('Hello World'));
	t.true(initialOutput.includes('╭')); // Box border

	const writeCountBeforeResize = getWriteCalls(stdout).length;

	// Decrease width - should trigger clear and rerender
	stdout.columns = 50;
	stdout.emit('resize');
	await delay(100);

	const calls = getWriteCalls(stdout);
	const lastOutput = stripAnsi(calls.at(-1)!);

	t.true(lastOutput.includes('Hello World'));
	t.true(lastOutput.includes('╭')); // Box border
	t.not(initialOutput, lastOutput); // Output should change due to width

	// A dedicated erase-only write must precede the repainted frame.
	t.true(calls.length > writeCountBeforeResize + 1);

	const eraseWrites = calls.slice(writeCountBeforeResize, -1);
	t.true(eraseWrites.length >= 1);
	t.true(eraseWrites.some(output => isEraseOnlyWrite(output)));

	unmount();
});

test.serial('no screen clear when terminal width increases', async t => {
	const stdout = createStdout(50);

	const {unmount} = render(<Test />, {stdout});

	const initialOutput = stripAnsi(
		(stdout.write as unknown as {firstCall: {args: unknown[]}}).firstCall
			.args[0] as string,
	);
	t.true(initialOutput.includes('Hello World'));

	// Increase width - should rerender but not clear
	stdout.columns = 100;
	stdout.emit('resize');
	await delay(100);

	const calls = getWriteCalls(stdout);
	const lastOutput = stripAnsi(calls.at(-1)!);

	t.true(lastOutput.includes('Hello World'));
	t.true(lastOutput.includes('╭'));
	t.not(initialOutput, lastOutput);

	// No dedicated erase-only write should be emitted when growing.
	const postResizeWrites = calls.slice(1);
	t.false(postResizeWrites.some(output => isEraseOnlyWrite(output)));

	unmount();
});

test.serial(
	'incremental rendering - width decrease forces clean full repaint',
	async t => {
		const stdout = createStdout(100);

		const {unmount} = render(<Test />, {
			stdout,
			incrementalRendering: true,
		});

		await delay(100);

		stdout.columns = 50;
		stdout.emit('resize');
		await delay(100);

		const lastOutput = stripAnsi(getWriteCalls(stdout).at(-1)!);

		t.true(lastOutput.includes('Hello World'));
		t.true(lastOutput.includes('╭'));

		// Every line of the repainted frame must fit within the new width,
		// proving no stale wide-width lines leaked through the diff path.
		for (const line of lastOutput.split('\n')) {
			t.true(line.length <= 50, `Line exceeds new width: ${line}`);
		}

		unmount();
	},
);
