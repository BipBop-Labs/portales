# Portales

Portales is an agent-first map of websites. It contains Markdown playbooks, not scraper implementations.

An agent starts at a website's `AGENTS.md`, recognizes the current page using linked page cards, and follows a flow one verified step at a time. The browser remains the execution surface.

## Start here

- [Repository instructions](AGENTS.md)
- [Knowledge architecture](docs/ARCHITECTURE.md)
- [Markdown conventions](docs/CONVENTIONS.md)
- [Learning a website](docs/RESEARCH-FIRST.md)
- [Security boundaries](docs/SECURITY.md)
- [Adding a website](docs/ADDING-A-WEBSITE.md)

## Websites

- [BCI Pyme](websites/bci-pyme/AGENTS.md)
- [SAG digital entry declaration](websites/sag/AGENTS.md)

## Principle

Observe once, document the page, replay deterministically, and add code only when a browser-use limitation has been demonstrated. Never make an agent guess a selector, option, transition, or success condition.
