# Knowledge architecture

## Unit of knowledge

Portales models three things:

```text
website instructions -> page cards -> flows
```

- A **website instruction file** is the mandatory entry point and safety boundary.
- A **page card** describes how to recognize and navigate one page.
- A **flow** composes page cards into a deterministic outcome without duplicating their details.

## Repository shape

```text
websites/<site>/
├── AGENTS.md
├── pages/
│   └── <page>.md
└── flows/
    └── <flow>.md
```

Shared guidance lives under `docs/`. Runtime data lives outside the repository.

## Why Markdown

Portal behavior changes faster than bespoke automation remains reliable. Concise linked Markdown lets an agent inspect the real page, reason from current evidence, and stop safely when the page changes. Code is justified only after a concrete browser-use limitation is observed repeatedly and a small helper can hide it.

## Private runtime state

A run may privately retain opaque aliases, fresh browser references, download descriptors, and verification notes. It must not persist them in this repository. Page cards describe the shape of runtime evidence, never live values.
