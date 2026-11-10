# Security Policy

## Reporting a vulnerability

**Please report security vulnerabilities privately, never in a public place.** Even a low-severity report becomes a roadmap for attackers once it is public.

Email security@strikta.dev with:

1. A description of the vulnerability and its impact
2. Reproduction steps, and the affected Strikta Pro version or versions
3. Optionally, a suggested fix

Reports are private: only the Strikta Pro maintainer sees them until a fix ships. The maintainer can then coordinate the fix with you, request a CVE, and publish an advisory once the patched release is out.

Acknowledgement target: **within 5 business days**. Single-maintainer project, so this is best-effort, not an SLA.

## What is in scope

Strikta Pro as it ships:

- The `strikta_pro` Python package: the Pro Console backend, its licence verification and the `strikta-pro` command
- The Pro Console web app compiled into the package
- The Strikta Pro container image

## What is out of scope

- Vulnerabilities in the Strikta engine: report them to the engine as its own security policy describes.
- Vulnerabilities in `starlette`, `uvicorn`, `cryptography` and other dependencies: those go to the dependency authors.
- Misconfiguration in a user's own deployment, such as exposing the Console beyond the machine without access controls. The maintainer is happy to clarify deploy guidance but cannot triage these as Strikta Pro bugs.

## Disclosure timeline

Once a fix is available, the maintainer will:

1. Ship a patch release
2. Publish an advisory with credit (if you wanted credit)
3. Note the advisory in the release notes for the next user-facing release

The patched release is the public-disclosure trigger. Please do not publish your own write-up before the advisory goes live.

## Actively exploited vulnerabilities

Mightreya AB, the manufacturer of Strikta Pro, reports actively exploited vulnerabilities and severe incidents affecting Strikta Pro as Article 14 of the EU Cyber Resilience Act (Regulation (EU) 2024/2847) requires, through ENISA's Single Reporting Platform to CERT-SE, Sweden's coordinating CSIRT: an early warning within 24 hours, a notification within 72 hours and a final report within the CRA deadlines, and it informs affected users.

## Supported versions

Security fixes ship as security releases. Every licence that has not been revoked, including a lapsed one, can install them for the support period in SUPPORT-PERIOD. A security release is built from the latest version, so it also brings the features released since; no feature or compatibility update is promised after a lapse. Feature releases need a current licence (Licence Terms, section 7).

## Credit

If you would like to be credited in the advisory, please include a name and (optionally) a website / handle in your report. Anonymous reports are fine too.
