# Scheduled Agent Research Task

## Goal

Run a scheduled agent every Monday to research competitors using a saved todo template.

## Primitives

- Agent cronjob: scheduled OpenCode agent session.
- Cronjob todo templates: saved initial todo list.
- Agent chat handoff: asks user if clarification is needed.
- Distinct cronjob-agent message role: separates scheduled automation from normal assistant chat.

## Cronjob Definition

```json
{
  "name": "Weekly competitor research",
  "target_type": "prompt",
  "prompt": "Research competitor launches and summarize relevant changes for our product strategy.",
  "initial_todos": [
    "Find competitor launch announcements from the last 7 days.",
    "Summarize product changes and pricing changes.",
    "Identify changes relevant to our roadmap.",
    "Ask the user if any item needs deeper follow-up.",
    "Write the final summary."
  ],
  "cron_expression": "0 9 * * MON",
  "timezone": "Asia/Kolkata"
}
```

## Agent Prompt

```text
You are running a scheduled research task.
Follow the cronjob todo list exactly.
If clarification is needed, use askCronjobUser.
When finished, provide a concise final summary with links and confidence.
```

## Flow

```text
cronjob fires
  -> hidden agent session starts
  -> initial todo templates copy into runtime todos
  -> agent works through todo protocol
  -> agent asks user if needed
  -> user-visible chat uses cronjob_agent role metadata
  -> final summary is recorded
```

