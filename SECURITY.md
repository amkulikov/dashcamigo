# Security policy

dashcamigo reads recordings and GPS data locally in the browser. It has no
backend that receives those files, so security reports usually concern the
shipped web app or one of its client-side dependencies.

## Reporting a vulnerability

Please report suspected vulnerabilities privately rather than opening a public
issue. You can:

- open a private [GitHub Security Advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability),
  or
- email **feedback@dashcamigo.app**.

Include a description, steps to reproduce the problem, and the affected version
or commit. You should receive a response within a few days.

## Scope

In scope:

- XSS or injection in the app;
- unsafe handling of local files;
- dependency vulnerabilities that reach the browser;
- weaknesses in the app's Content Security Policy.

Out of scope:

- issues that require a modified or self-hosted deployment;
- the optional analytics and map services operated by third parties;
- behavior caused by a malicious browser extension.
