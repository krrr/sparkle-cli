## Method

Obtain commit list:

```python
import requests

res = requests.get(
    "https://api.github.com/repos/google-gemini/gemini-cli/commits",
    params={"per_page": 30},
).json()

# 仅保留核心字段
commits = [
    {
        "sha": c["sha"][:7],
        "message": c["commit"]["message"],
        "author": c["commit"]["author"]["name"],
        "date": c["commit"]["author"]["date"],
    }
    for c in res
]
print(commits)
```

Obtain commit patch: https://github.com/google-gemini/gemini-cli/commit/{hash}.patch

Commit message format:
`<type>(<scope>): sync commit <hash> from upstream <upstream subject>`

Drop the upstream conventional prefix (e.g. `fix(core):`) because your own prefix
replaces it. Keep the rest of the subject verbatim, including the pull request number.

## State

Latest synchronized commit: 2ad220a // [SSR Agent] Issue Fix (24935): Force terminal
buffer rerender after exiting external editors (#28880)

## Skipped commits

Changes to removed features and its docs are ommited.

- 188e255
- 58ba199
- 783f6cb
- 812f7a2
- eaa3042
- 5dd4919
- 9a15c45
- 24cc26c

### skipped less important commits

## Postponed commits

- fa2f27a // 谷歌模型429重试
- c0d1924 // git命令安全加固
