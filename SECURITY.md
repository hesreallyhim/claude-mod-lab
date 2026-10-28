# Security policy

## Report a vulnerability

Please use [GitHub's private vulnerability reporting](https://github.com/hesreallyhim/claude-mod-lab/security/advisories/new) for suspected vulnerabilities in claude-mod-lab. Do not disclose vulnerability details in a public issue or pull request before a fix or disclosure plan is agreed.

Include the affected lab version or commit, Claude Code version and client, operating system, steps to reproduce, and the potential impact. A minimal proof of concept is helpful. Use test data and remove credentials, private conversation content, and other sensitive information.

We will use the private report to discuss reproduction, a fix, and disclosure. This is a maintainer-run project; there is no guaranteed response or resolution time.

## Versions

Security fixes target the latest release. Older releases do not have a separate security maintenance schedule. If you discover a vulnerability in an older version, please report it even if you cannot check the latest release.

## Project boundaries

Mods execute code in a Claude Code session and can access capabilities exposed by its mod API. Install and run only mods you trust; the lab is not a security sandbox for untrusted plugins.

Report vulnerabilities in the Explorer, launcher, bundled mods, or this project's handling of session data here. For issues in Claude Code itself, use [Anthropic's security reporting process](https://www.anthropic.com/responsible-disclosure-policy). If you are unsure where an issue belongs, describe that uncertainty in the private report.
