<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Support ticket triage

Roles:

- Specialist

The caller (Boss) supplies one support ticket as text. This workflow returns a routing decision; it does not create or send a ticket.
At the start, Captain shall relay the complete original ticket to Specialist in quotes (`>`).
Specialist shall inspect only the supplied ticket and any later Boss replies, then report one of these four outcomes: needs Boss reply, urgent, ordinary, or rejected.

If the affected service is not identified, Specialist shall ask Boss which service is affected and shall classify no urgency yet. Captain shall suspend the workflow with Specialist's complete question.
After Boss replies, Captain shall relay the original ticket and all Boss replies to the same Specialist in quotes (`>`), and Specialist shall apply the classification rules again. A reply that still fails to identify the service leads to another question.

Once the affected service is identified, a request concerning a service explicitly described in the ticket as retired is rejected. Otherwise, if the ticket states that the service is unavailable and that no workaround exists, it is urgent. Every other ticket with an identified service is ordinary.
Each classification requires affirmative support in the supplied text; no outcome depends on a fixed presentation format of Specialist's reply.

A completed triage returns exactly one result containing the full original ticket, its classification, and one destination string.
When Specialist classifies the ticket as urgent, the workflow shall finish successfully with destination `incident-queue`.
When Specialist classifies the ticket as urgent, the workflow shall finish successfully with destination `standard-queue`.
When Specialist classifies the ticket as ordinary, the workflow shall finish successfully with destination `standard-queue`.
When Specialist classifies the ticket as rejected, the workflow shall finish with a rejection result whose destination is `none` and whose reason explains that the service is retired.
No classification changes the original ticket text.
