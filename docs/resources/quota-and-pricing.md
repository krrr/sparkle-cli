# Gemini CLI: Quotas and pricing

Gemini CLI offers a generous free tier that covers many individual developers'
use cases. For professional usage, or if you need increased quota, several
options are available depending on your authentication method.

For a high-level comparison of available subscriptions and to select the right
quota for your needs, see the [Plans page](https://geminicli.com/plans/).

## Overview

This article outlines the specific quotas and pricing applicable to Gemini CLI
when using different authentication methods.

The following table summarizes the available quotas and their respective limits:

| Authentication method | Tier / Subscription  | Maximum requests per user per day |
| :-------------------- | :------------------- | :-------------------------------- |
| **Gemini API key**    | Free tier (Unpaid)   | 250 requests                      |
|                       | Pay-as-you-go (Paid) | Varies                            |

Generally, there are two categories to choose from:

- Free Usage: Ideal for experimentation and light use.
- Pay-As-You-Go: The most flexible option for professional use, long-running
  tasks, or when you need full control over your usage.

Requests are limited per user per minute and are subject to the availability of
the service in times of high demand.

## Free usage

Access to Gemini CLI begins with a generous free tier, perfect for
experimentation and light use.

Your free usage is governed by the following limits, which depend on your
authorization type.

### Log in with Gemini API Key (unpaid)

If you are using a Gemini API key, you can also benefit from a free tier. This
includes:

- 250 maximum model requests / user / day
- Model requests to Flash model only.

Learn more at
[Gemini API Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits).

## Pay as you go

If you hit your daily request limits, the most flexible solution is to switch to
a pay-as-you-go model, where you pay for the specific amount of processing you
use. This is the recommended path for uninterrupted access.

To do this, log in using a Gemini API key.

### Gemini API key

Ideal for developers who want to quickly build applications with the Gemini
models. This is the most direct way to use the models.

- Quota: Varies by pricing tier.
- Cost: Varies by pricing tier and model/token usage.

Learn more at
[Gemini API Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits),
[Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)

It's important to highlight that when using an API key, you pay per token/call.
This can be more expensive for many small calls with few tokens, but it's the
only way to ensure your workflow isn't interrupted by reaching a limit on your
quota.

## Gemini for workspace plans

These plans currently apply only to the use of Gemini web-based products
provided by Google-based experiences (for example, the Gemini web app or the
Flow video editor). These plans do not apply to the API usage which powers the
Gemini CLI. Supporting these plans is under active consideration for future
support.

## Check usage and limits

You can check your current token usage and applicable limits using the
`/stats model` command. This command provides a snapshot of your current
session's token usage, as well as information about the limits associated with
your current quota.

For more information on the `/stats` command and its subcommands, see the
[Command Reference](../reference/commands.md#stats).

A summary of model usage is also presented on exit at the end of a session.

## Tips to avoid high costs

When using a pay-as-you-go plan, be mindful of your usage to avoid unexpected
costs.

- **Be selective with suggestions**: Before accepting a suggestion, especially
  for a computationally intensive task like refactoring a large codebase,
  consider if it's the most cost-effective approach.
- **Use precise prompts**: You are paying per call, so think about the most
  efficient way to get your desired result. A well-crafted prompt can often get
  you the answer you need in a single call, rather than multiple back-and-forth
  interactions.
- **Monitor your usage**: Use the `/stats model` command to track your token
  usage during a session. This can help you stay aware of your spending in real
  time.
