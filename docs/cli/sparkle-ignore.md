# Ignoring files

This document provides an overview of the Sparkle Ignore (`.sparkleignore`)
feature of Sparkle CLI.

Sparkle CLI includes the ability to automatically ignore files, similar to
`.gitignore`. Adding paths to your `.sparkleignore` file will exclude them from
tools that support this feature, although they will still be visible to other
services (such as Git).

## How it works

When you add a path to your `.sparkleignore` file, tools that respect this file
will exclude matching files and directories from their operations. For example,
when you use the `@` command to share files, any paths in your `.sparkleignore`
file will be automatically excluded.

For the most part, `.sparkleignore` follows the conventions of `.gitignore`
files:

- Blank lines and lines starting with `#` are ignored.
- Standard glob patterns are supported (such as `*`, `?`, and `[]`).
- Putting a `/` at the end will only match directories.
- Putting a `/` at the beginning anchors the path relative to the
  `.sparkleignore` file.
- `!` negates a pattern.

You can update your `.sparkleignore` file at any time. To apply the changes, you
must restart your Sparkle CLI session.

## How to use `.sparkleignore`

To enable `.sparkleignore`:

1. Create a file named `.sparkleignore` in the root of your project directory.

To add a file or directory to `.sparkleignore`:

1. Open your `.sparkleignore` file.
2. Add the path or file you want to ignore, for example: `/archive/` or
   `apikeys.txt`.

### `.sparkleignore` examples

You can use `.sparkleignore` to ignore directories and files:

```
# Exclude your /packages/ directory and all subdirectories
/packages/

# Exclude your apikeys.txt file
apikeys.txt
```

You can use wildcards in your `.sparkleignore` file with `*`:

```
# Exclude all .md files
*.md
```

Finally, you can exclude files and directories from exclusion with `!`:

```
# Exclude all .md files except README.md
*.md
!README.md
```

To remove paths from your `.sparkleignore` file, delete the relevant lines.
