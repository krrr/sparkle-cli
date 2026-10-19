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

Latest synchronized commit: 46f68b9 // 集成测试修复 TypeScript strict-null 报错

## Skipped commits

- 188e255
- 58ba199
- 783f6cb
- 812f7a2
- eaa3042
- 5dd4919
- 9a15c45

## Postponed commits

- fa2f27a // 谷歌模型429重试
- c0d1924 // git命令安全加固
