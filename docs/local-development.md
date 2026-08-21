# Local development guide

This guide provides instructions for setting up and using local development
features for Sparkle CLI.

## Build the vendored ink fork

Sparkle CLI bundles a patched version of ink from `third_party/ink`. The root
install links `node_modules/ink` to this folder, so builds always use the
vendored copy instead of the published package. The compiled output in
`third_party/ink/build/` isn't committed to the repository, but the bundle step
requires it. The bundle step runs automatically through the npm `prepare` script
whenever you install dependencies.

On a fresh clone, build the vendored ink fork before you run the root install:

```bash
cd third_party/ink
npm install --no-audit --no-fund
npm run build
cd ../..
```

CI runs the same sequence through the `.github/actions/build-vendored-ink`
composite action before every root install.

## Tracing

Sparkle CLI uses OpenTelemetry (OTel) to record traces that help you debug agent
behavior. Traces instrument key events like model calls, tool scheduler
operations, and tool calls.

Traces provide deep visibility into agent behavior and help you debug complex
issues. They are captured automatically when you enable telemetry.

### Instrument code with traces

You can add traces to your own code for more detailed instrumentation.

Adding traces helps you debug and understand the flow of execution. Use the
`runInDevTraceSpan` function to wrap any section of code in a trace span.

Here is a basic example:

```typescript
import { runInDevTraceSpan } from 'sparkle-cli-core';
import { GeminiCliOperation } from 'sparkle-cli-core/lib/telemetry/constants.js';

await runInDevTraceSpan(
  {
    operation: GeminiCliOperation.ToolCall,
    attributes: {
      [GEN_AI_AGENT_NAME]: 'sparkle-cli',
    },
  },
  async ({ metadata }) => {
    // metadata allows you to record the input and output of the
    // operation as well as other attributes.
    metadata.input = { key: 'value' };
    // Set custom attributes.
    metadata.attributes['custom.attribute'] = 'custom.value';

    // Your code to be traced goes here.
    try {
      const output = await somethingRisky();
      metadata.output = output;
      return output;
    } catch (e) {
      metadata.error = e;
      throw e;
    }
  },
);
```

In this example:

- `operation`: The operation type of the span, represented by the
  `GeminiCliOperation` enum.
- `metadata.input`: (Optional) An object containing the input data for the
  traced operation.
- `metadata.output`: (Optional) An object containing the output data from the
  traced operation.
- `metadata.attributes`: (Optional) A record of custom attributes to add to the
  span.
- `metadata.error`: (Optional) An error object to record if the operation fails.
