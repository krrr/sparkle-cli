// [sparkle patch] Regression test: the legacy-mode full-terminal render path
// (renderFullTerminal in ink.tsx) must wrap its clearTerminal + static
// scrollback + frame output in DECSET 2026 synchronized output so the whole
// full-frame rewrite is presented atomically on capable terminals.
import test from 'ava';
import React from 'react';
import ansiEscapes from 'ansi-escapes';
import {render, Text} from '../src/index.js';
import {
	enterSynchronizedOutput,
	exitSynchronizedOutput,
} from '../src/log-update.js';
import createStdout from './helpers/create-stdout.js';

test('legacy full-terminal render path wraps output in synchronized output (DECSET 2026)', t => {
	const stdout = createStdout();
	// A tiny viewport forces the renderFullTerminal branch
	// (lastOutputHeight >= stdout.rows).
	stdout.rows = 4;

	function App() {
		return (
			<>
				<Text>Line A</Text>
				<Text>Line B</Text>
				<Text>Line C</Text>
				<Text>Line D</Text>
				<Text>Line E</Text>
				<Text>Line F</Text>
			</>
		);
	}

	const {unmount} = render(<App />, {
		stdout: stdout as any,
	});

	unmount();

	const calls = (stdout.write as any).getCalls().map(
		(call: any) => call.args[0] as string,
	);
	// renderFullTerminal is the only render branch that emits clearTerminal
	// (outside of alternate-buffer teardown, which is not active here).
	const fullFrames = calls.filter(call =>
		call.includes(ansiEscapes.clearTerminal),
	);

	t.true(
		fullFrames.length > 0,
		'expected renderFullTerminal to be exercised at least once',
	);

	for (const [index, frame] of fullFrames.entries()) {
		t.true(
			frame.startsWith(enterSynchronizedOutput),
			`full-terminal frame ${index} must start with synchronized output enter`,
		);
		t.true(
			frame.endsWith(exitSynchronizedOutput),
			`full-terminal frame ${index} must end with synchronized output exit`,
		);
	}

	t.true(stdout.get().includes('Line A'));
});
