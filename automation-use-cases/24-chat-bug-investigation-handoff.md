# Chat Bug Investigation Handoff

Investigate a bug directly from a user's TeamCopilot chat and ask another teammate only if the investigation needs their input.

This is not a workflow. The original chat agent owns the whole flow, uses normal codebase tools to investigate, and calls the agent-facing `askUser` tool only when it decides another human is needed.

## User Request

```text
Investigate why invoice sync is failing on staging. Ping Priya if you need more context from billing.
```

## Primitives Used

- Normal chat agent session: owns the investigation and final answer.
- `getCurrentUser`: identifies the user who asked for the investigation.
- `search_users`: resolves "Priya" to a TeamCopilot user id.
- Codebase tools: search files, read files, inspect diffs, run tests, and inspect logs if available.
- `askUser`: asks Priya for structured input only if the agent decides it is necessary.
- `answer_user_request`: lets Priya's agent send the structured answer back to the original blocked chat session.

## Agent Tool Calls

The original chat agent first resolves context:

```ts
const requester = getCurrentUser();

const users = search_users({ query: "Priya billing" });
const priya = users[0];
```

Then it investigates normally:

```text
rg -n "invoice sync|InvoiceSync|syncInvoices|billing" .
read relevant files
run targeted tests if safe
inspect recent logs if the repo exposes them
```

If the agent has enough evidence, it answers directly:

```text
The failure is caused by staging invoices missing external_customer_id.
The sync worker treats that as retryable, so the job loops instead of dead-lettering.
I found this in src/billing/invoiceSync.ts and confirmed the failing path with the invoice sync test.
```

If the agent needs human context, it calls `askUser`:

```ts
askUser({
  user_id: priya.id,
  instruction_to_agent: `
    The original requester is ${requester.name} (${requester.email}).

    Ask Priya for billing context needed to finish this bug investigation.

    Bug:
    Invoice sync is failing on staging.

    Current findings:
    - The sync worker retries invoices when external_customer_id is missing.
    - The staging failures all appear to involve migrated billing accounts.
    - I need to know whether migrated accounts are expected to have external_customer_id populated before invoice sync runs.

    Ask Priya:
    "For migrated billing accounts on staging, should external_customer_id already be populated before invoice sync runs? If not, what field should invoice sync use instead?"

    Return only the structured answer matching the schema.
  `,
  schema: {
    type: "object",
    required: ["answer", "confidence", "follow_up_needed"],
    properties: {
      answer: { type: "string" },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      follow_up_needed: { type: "boolean" }
    }
  }
})
```

## Platform Behavior

```text
original chat agent calls askUser
  -> TeamCopilot creates automation_user_requests row
  -> caller_type = "chat_session"
  -> caller_id = original chat session id
  -> original chat session status = waiting_for_user
  -> Priya receives or opens an agent chat with the question
  -> Priya replies in her chat
  -> Priya's agent calls answer_user_request with structured data
  -> TeamCopilot validates the data against the askUser schema
  -> TeamCopilot appends the structured answer into the original OpenCode session
  -> original agent resumes investigation
  -> original agent replies to the requester
```

## Resume Message

When Priya replies, TeamCopilot resumes the original agent session with a system message like:

```json
{
  "type": "user_request_answer",
  "request_id": "req_123",
  "from_user_id": "user_priya",
  "data": {
    "answer": "Migrated accounts may not have external_customer_id yet. Invoice sync should use billing_account.legacy_customer_ref during the migration window.",
    "confidence": "high",
    "follow_up_needed": false
  }
}
```

The original agent then continues from the same investigation context and gives the requester a final answer:

```text
Priya confirmed that migrated staging accounts may not have external_customer_id yet.
The bug is in the invoice sync lookup path: it should fall back to billing_account.legacy_customer_ref during the migration window.
I would patch src/billing/invoiceSync.ts to use the fallback and add a regression test for migrated accounts.
```

## Why This Is Not A Workflow

The user asked for a one-off investigation in chat. There is no reusable schedule, webhook, or repeatable workflow package to approve. The conditional "ping Priya if necessary" is just agent reasoning plus `askUser`.

If the same task becomes recurring, the agent can later turn it into a workflow or cronjob with the same decision pattern:

```text
run_agent investigates
  -> structured result says whether human input is needed
  -> Python if statement calls tc.ask_user only when needed
```
