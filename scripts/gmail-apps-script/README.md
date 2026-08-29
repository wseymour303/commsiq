# Gmail → CommsIQ report + AI intelligence bridge

This Google Apps Script runs inside the Gmail account that receives the MotoSnap report. It searches for the hourly `todays comms` email from `reportscheduler@motosnap.com`, sends each `.xlsx` attachment to CommsIQ, then triggers AI assessment for the completed ingest batch.

A Gmail message is marked processed only after both ingestion and AI assessment succeed. If assessment fails after a successful ingest, the next trigger safely reuses the existing batch and retries the AI step.

CommsIQ also treats the Gmail message ID as an idempotency key, so repeated server requests do not import the report twice.

## CommsIQ environment variables

Add these server-only environment variables to the CommsIQ deployment:

```text
COMMSIQ_INGEST_SECRET=<long random secret>
OPENAI_API_KEY=<server-only OpenAI API key>
COMMUNICATIONIQ_AI_MODEL=gpt-5.6-luna
```

`COMMUNICATIONIQ_AI_MODEL` is optional; `gpt-5.6-luna` is the cost-sensitive default. Do not prefix these secrets with `NEXT_PUBLIC_`.

## Create/update the Apps Script

1. Open https://script.google.com while signed into the Gmail account that receives the report.
2. Open the existing `CommsIQ Gmail Ingest` project or create it if needed.
3. Replace `Code.gs` with the repository `Code.gs` file in this folder.
4. Open **Project Settings → Script Properties** and set:
   - `COMMSIQ_INGEST_URL` = `https://<your-commsiq-domain>/api/ingest/gmail`
   - `COMMSIQ_ASSESS_URL` = `https://<your-commsiq-domain>/api/assess/run`
   - `COMMSIQ_INGEST_SECRET` = the exact same secret configured on the CommsIQ server.
5. Run `setupCommsIqTrigger` once from the Apps Script editor.
6. Approve the requested Gmail and external-request permissions if prompted.

`setupCommsIqTrigger` creates a five-minute time trigger and immediately runs one check.

## Operational behavior

The script searches the previous two days for messages matching:

```text
from:reportscheduler@motosnap.com subject:"todays comms" has:attachment filename:xlsx newer_than:2d
```

Only messages whose sender and subject also pass the explicit code check are processed. Successful Gmail message IDs are retained in Script Properties (latest 250 IDs). Failed ingestion or AI requests are not marked processed and retry on the next trigger.

The AI endpoint scores the customer/lead identities touched by the ingest batch and writes a new assessment snapshot to `communication_ai_assessments`. Manager Radar already loads the latest assessment per customer.

## Troubleshooting

- Apps Script **Executions** shows ingestion and AI response errors.
- CommsIQ stores every successful import in `communication_ingest_batches` with `source = gmail_apps_script` and the Gmail message ID in `source_message_id`.
- AI snapshots are stored in `communication_ai_assessments` with the configured model name.
- Run `resetCommsIqProcessedIds` only if you intentionally want the Apps Script to reconsider prior messages. Server-side Gmail idempotency still prevents completed reports from being duplicated.
