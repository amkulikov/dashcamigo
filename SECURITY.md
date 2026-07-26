# Security policy

dashcamigo is a **static, no-backend web application**. There is no server that
receives user data: video files and GPS coordinates are read locally in the
browser through the File API and never leave the machine. The attack surface is
therefore the shipped client bundle and its dependency chain.

## Reporting a vulnerability

Report suspected vulnerabilities privately, not as a public issue:

- Open a private [GitHub Security Advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
  on this repository, or
- email **feedback@dashcamigo.app**.

Include a description, reproduction steps, and the affected version/commit.
Expect a response within a few days.

## Scope

In scope: XSS or injection in the app, unsafe handling of local files, a
dependency vulnerability that reaches the client, CSP weaknesses.

Out of scope: findings that require a modified/self-hosted deployment, the
optional third-party analytics/tile services (their own providers own that
surface), and anything depending on a malicious browser extension.
