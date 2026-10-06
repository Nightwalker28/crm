---
name: roadmap
description: Use when planning future work, choosing the next slice, or checking whether a request fits Lynk's intended product sequence.
---

# Roadmap

## Current platform state

Lynk already has strong foundations for:
- modular CRM/ERP core
- tenant-aware access control and module configuration
- shared lists, saved views, filters, comments, timelines, notifications, and background jobs
- tasks, calendar/mail foundations, WhatsApp click-to-chat, website integrations, documents, and client pages

## Near-term sequence

1. finish production-readiness correctness around mail/calendar
2. continue website and WordPress integration follow-through
3. add custom client domains and client-facing branding
4. open money features intentionally:
   - invoice generator
   - then Stripe and PayPal payment links

## Later planned work

- richer finance/payment handoff
- additional external document providers such as S3/R2 and OneDrive
- notification preferences and later smart notification rules
- wider activity-timeline coverage as more modules gain stable source links
- deeper query-layer performance optimization
- broader action-permission coverage
- continued tenant-isolation hardening
- future custom modules only after the platform primitives are stable enough

## Intentionally deferred unless explicitly opened

- automated WhatsApp provider sending and inbound webhook handling
- payment links before invoice/payment work begins
- broad Gmail inbox reading without the required restricted-scope plan
- full custom module builder
- one-off platform duplicates when a shared primitive should exist

## Planning rule

Prefer the smallest complete slice that moves the active roadmap forward.
Do not open adjacent future work merely because the current code makes it tempting.

Keep this skill directional, not historical; completed work belongs in git history, release notes, or a human changelog, not here.
