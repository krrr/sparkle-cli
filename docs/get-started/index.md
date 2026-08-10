# Get started with Sparkle CLI

Welcome to Sparkle CLI! This guide will help you install, configure, and start
using Sparkle CLI to enhance your workflow right from your terminal.

## Quickstart: Install, authenticate, configure, and use Sparkle CLI

Sparkle CLI brings the power of advanced language models directly to your
command line interface. As an AI-powered assistant, Sparkle CLI can help you
with a variety of tasks, from understanding and generating code to reviewing and
editing documents.

## Install

The standard method to install and run Sparkle CLI uses `npm`:

```bash
npm install -g sparkle-cli
```

Once Sparkle CLI is installed, run Sparkle CLI from your command line:

```bash
sparkle
```

For more installation options, see
[Sparkle CLI Installation](./installation.mdx).

## Authenticate

To begin using Sparkle CLI, you must authenticate with a Gemini API key:

1. Obtain your API key from
   [Google AI Studio](https://aistudio.google.com/app/apikey).

2. Set the `GEMINI_API_KEY` environment variable:

   ```bash
   export GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
   ```

3. Run Sparkle CLI after installation:

   ```bash
   sparkle
   ```

4. Select **Use Gemini API key**.

For more information, see
[Sparkle CLI Authentication Setup](./authentication.mdx).

## Configure

Sparkle CLI offers several ways to configure its behavior, including environment
variables, command-line arguments, and settings files.

To explore your configuration options, see
[Sparkle CLI Configuration](../reference/configuration.md).

## Use

Once installed and authenticated, you can start using Sparkle CLI by issuing
commands and prompts in your terminal. Ask it to generate code, explain files,
and more.

<!-- prettier-ignore -->
> [!NOTE]
> These examples demonstrate potential capabilities. Your actual
> results can vary based on the model used and your project environment.

### Rename your photographs based on content

You can use Sparkle CLI to automate file management tasks that require visual
analysis. In this example, Sparkle CLI renames images based on their actual
subject matter.

Scenario: You have a folder containing the following files:

```bash
photos/photo1.png
photos/photo2.png
photos/photo3.png
```

Give Sparkle the following prompt:

```cli
Rename the photos in my "photos" directory based on their contents.
```

Result: Sparkle asks for permission to rename your files.

Select **Allow once** and your files are renamed:

```bash
photos/yellow_flowers.png
photos/antique_dresser.png
photos/green_android_robot.png
```

### Explain a repository by reading its code

Sparkle CLI is effective for rapid codebase exploration. The following example
shows how to ask Sparkle CLI to fetch, analyze, and summarize a remote project.

Scenario: You want to understand how a popular open-source utility works by
inspecting its code, not just its README.

Give Sparkle CLI the following prompt:

```cli
Clone the 'chalk' repository from https://github.com/chalk/chalk, read its key source files, and explain how it works.
```

Result: Sparkle performs a sequence of actions to answer your request.

1.  First, it asks for permission to run `git clone` to download the repository.
2.  Next, it finds the important source files and asks for permission to read
    them.
3.  Finally, after analyzing the code, it provides a summary.

Sparkle CLI returns an explanation based on the actual source code:

```markdown
The `chalk` library is a popular npm package for styling terminal output with
colors. After analyzing the source code, here's how it works:

- **Core functionality:** The main file sets up a chainable API. Each color or
  modifier (like `bold` or `italic`) is a getter that appends the corresponding
  ANSI escape code to an internal stack.

- **Chainable API:** When you call `chalk.red.bold('Hello')`, you are accessing
  getters. The `red` getter adds the red color code, and the `bold` getter adds
  the bold code.

- **Output generation:** When the chain is treated as a string (for example, in
  `console.log`), a final `toString()` method is called. This method joins all
  the stored ANSI codes, wraps them around the input string ('Hello'), and adds
  a reset code at the end. This produces the final, styled string that the
  terminal can render.
```

### Combine two spreadsheets into one spreadsheet

Sparkle CLI can process and transform data across multiple files. Use this
capability to merge reports or reformat data sets without manual copying.

Scenario: You have two .csv files: `Revenue - 2023.csv` and
`Revenue - 2024.csv`. Each file contains monthly revenue figures.

Give Sparkle CLI the following prompt:

```cli
Combine the two .csv files into a single .csv file, with each year a different column.
```

Result: Sparkle CLI reads each file and then asks for permission to write a new
file. Provide your permission and Sparkle CLI provides the combined data:

```csv
Month,2023,2024
January,0,1000
February,0,1200
March,0,2400
April,900,500
May,1000,800
June,1000,900
July,1200,1000
August,1800,400
September,2000,2000
October,2400,3400
November,3400,1800
December,2100,9000
```

### Run unit tests

Sparkle CLI can generate boilerplate code and tests based on your existing
implementation. This example demonstrates how to request code coverage for a
JavaScript component.

Scenario: You've written a simple login page. You wish to write unit tests to
ensure that your login page has code coverage.

Give Sparkle CLI the following prompt:

```cli
Write unit tests for Login.js.
```

Result: Sparkle CLI asks for permission to write a new file and creates a test
for your login page.

## Check usage and quota

You can check your current token usage and quota information using the
`/stats model` command. This command provides a snapshot of your current
session's token usage, as well as your overall quota and usage for the supported
models.

For more information on the `/stats` command and its subcommands, see the
[Command Reference](../reference/commands.md#stats).

## Next steps

- Follow the [File management](../cli/tutorials/file-management.md) guide to
  start working with your codebase.
- See [Shell commands](../cli/tutorials/shell-commands.md) to learn about
  terminal integration.
