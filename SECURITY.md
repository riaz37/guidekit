# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x | Yes |

## Reporting a Vulnerability

If you discover a security vulnerability in GuideKit, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email the maintainers directly or use [GitHub Security Advisories](https://github.com/riaz37/guidekit/security/advisories/new) to report the issue privately.

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 5 business days
- **Fix or mitigation**: Dependent on severity, typically within 30 days

## Security Design

GuideKit is designed with security in mind:

- **API keys never reach the browser** -- all provider keys are stored server-side, accessed via short-lived JWT tokens
- **Token-based auth** -- session tokens expire (configurable, default 15 minutes) with automatic refresh at 80% TTL
- **Click safety** -- default deny-list blocks submit/reset/form clicks by the LLM agent
- **Privacy hooks** -- `onBeforeLLMCall` enables custom PII scrubbing before any data leaves the browser
- **DOM exclusion** -- `data-guidekit-ignore` attribute skips sensitive subtrees from scanning
- **XSS prevention** -- tooltip and message content rendered via `textContent`, never `innerHTML`
- **Input validation** -- configurable `maxMessageLength` (default 10,000 chars)
- **Concurrent request guard** -- prevents double-submission
