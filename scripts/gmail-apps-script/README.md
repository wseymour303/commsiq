# Gmail → CommsIQ hourly report bridge

This Google Apps Script runs inside the Gmail account that receives the MotoSnap report. It searches for the hourly `todays comms` email from `reportscheduler@motosnap.com`, sends each `.xlsx` attachment to CommsIQ, and remembers processed Gmail message IDs locally so normal trigger retries do not resend old messages.

CommsIQ also treats the Gmail message ID as an idempotency key, so a repeated server request returns the existing completed batch instead of importing the report twice.

## CommsIQ environment variable

Add this server-only environment variable to the CommsIQ deployment:

```text
COMMSIQ_INGEST_SECRET=<long random secret>
```

Do not prefix it with `NEXT_PUBLIC_`.

## Create the Apps Script

1. Open https://script.google.com while signed into the Gmail account that receives the report.
2. Create a new project named `CommsIQ Gmail Ingest`.
3. Replace the default `Code.gs` with the repository `Code.gs` file in this folder.
4. Open **Project Settings → Script Properties** and add:
   - `COMMSIQ_INGEST_URL` = `https://<your-commsiq-domain>/api/ingest/gmail`
   - `COMMSIQ_INGEST_SECRET` = the exact same secret configured on the CommsIQ server.
5. Run `setupCommsIqTrigger` once from the Apps Script editor.
6. Approve the requested Gmail and external-request permissions.

`setupCommsIqTrigger` creates a five-minute time trigger and immediately runs one ingestion check.

## Operational behavior

The script searches the previous two days for messages matching:

```text
from:reportscheduler@motosnap.com subject:"todays comms" has:attachment filename:xlsx newer_than:2d
```

Only messages whose sender and subject also pass the explicit code check are processed. Successful Gmail message IDs are retained in Script Properties (latest 250 IDs). Failed requests are not marked processed and will retry on the next trigger.

## Troubleshooting

- Apps Script **Executions** shows trigger failures and response errors.
- CommsIQ stores every successful import in `communication_ingest_batches` with `source = gmail_apps_script` and the Gmail message ID in `source_message_id`.
- Run `resetCommsIqProcessedIds` only if you intentionally want the Apps Script to reconsider prior messages. Server-side Gmail message idempotency still prevents completed reports from being duplicated.
