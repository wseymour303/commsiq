const COMMSIQ_QUERY = 'from:reportscheduler@motosnap.com subject:"todays comms" has:attachment filename:xlsx newer_than:2d';
const PROCESSED_KEY = 'COMMSIQ_PROCESSED_MESSAGE_IDS';
const MAX_PROCESSED_IDS = 250;
const MAX_ASSESSMENT_REQUESTS = 25;

function ingestMotoSnapReports() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log('Another CommsIQ Gmail ingestion run is already active.');
    return;
  }

  try {
    const props = PropertiesService.getScriptProperties();
    const endpoint = String(props.getProperty('COMMSIQ_INGEST_URL') || '').trim();
    const assessmentEndpoint = String(props.getProperty('COMMSIQ_ASSESS_URL') || '').trim();
    const secret = String(props.getProperty('COMMSIQ_INGEST_SECRET') || '').trim();

    if (!endpoint || !assessmentEndpoint || !secret) {
      throw new Error('Set COMMSIQ_INGEST_URL, COMMSIQ_ASSESS_URL, and COMMSIQ_INGEST_SECRET in Script Properties.');
    }

    const processed = new Set(readProcessedIds_(props));
    const threads = GmailApp.search(COMMSIQ_QUERY, 0, 50);
    let changed = false;

    for (const thread of threads) {
      for (const message of thread.getMessages()) {
        const messageId = message.getId();
        if (processed.has(messageId)) continue;
        if (!isMotoSnapReport_(message)) continue;

        const attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true })
          .filter(blob => /\.xlsx$/i.test(blob.getName()));

        if (!attachments.length) continue;

        let messageSucceeded = true;
        for (const attachment of attachments) {
          const response = UrlFetchApp.fetch(endpoint, {
            method: 'post',
            headers: {
              'x-commsiq-ingest-secret': secret,
              'x-gmail-message-id': messageId
            },
            payload: { file: attachment },
            muteHttpExceptions: true
          });

          const code = response.getResponseCode();
          if (code < 200 || code >= 300) {
            console.error(`CommsIQ ingest failed for ${messageId}: HTTP ${code} ${response.getContentText()}`);
            messageSucceeded = false;
            break;
          }

          let ingestResult;
          try {
            ingestResult = JSON.parse(response.getContentText());
          } catch (error) {
            console.error(`CommsIQ ingest returned invalid JSON for ${messageId}`, error);
            messageSucceeded = false;
            break;
          }

          const batchId = String(ingestResult.batchId || '').trim();
          if (!batchId) {
            console.error(`CommsIQ ingest returned no batchId for ${messageId}.`);
            messageSucceeded = false;
            break;
          }

          const assessmentResult = runAssessmentToCompletion_(assessmentEndpoint, secret, batchId, messageId);
          if (!assessmentResult.success) {
            messageSucceeded = false;
            break;
          }

          console.log(`CommsIQ processed ${messageId}: ${response.getContentText()} assessment=${assessmentResult.body}`);
        }

        if (messageSucceeded) {
          processed.add(messageId);
          changed = true;
        }
      }
    }

    if (changed) writeProcessedIds_(props, [...processed]);
  } finally {
    lock.releaseLock();
  }
}

function runAssessmentToCompletion_(endpoint, secret, batchId, messageId) {
  let lastBody = '';

  for (let attempt = 1; attempt <= MAX_ASSESSMENT_REQUESTS; attempt += 1) {
    const response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-commsiq-ingest-secret': secret
      },
      payload: JSON.stringify({ batchId }),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    lastBody = response.getContentText();
    if (code < 200 || code >= 300) {
      console.error(`CommsIQ AI assessment failed for ${messageId}: HTTP ${code} ${lastBody}`);
      return { success: false, body: lastBody };
    }

    let result;
    try {
      result = JSON.parse(lastBody);
    } catch (error) {
      console.error(`CommsIQ assessment returned invalid JSON for ${messageId}`, error);
      return { success: false, body: lastBody };
    }

    console.log(`CommsIQ assessment progress for ${messageId}: ${lastBody}`);

    if (result.complete === true || result.alreadyAssessed === true || result.superseded === true) {
      return { success: true, body: lastBody };
    }
  }

  console.error(`CommsIQ assessment did not complete within ${MAX_ASSESSMENT_REQUESTS} requests for ${messageId}.`);
  return { success: false, body: lastBody };
}

function setupCommsIqTrigger() {
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === 'ingestMotoSnapReports') ScriptApp.deleteTrigger(trigger);
  }

  ScriptApp.newTrigger('ingestMotoSnapReports')
    .timeBased()
    .everyMinutes(5)
    .create();

  ingestMotoSnapReports();
}

function resetCommsIqProcessedIds() {
  PropertiesService.getScriptProperties().deleteProperty(PROCESSED_KEY);
}

function isMotoSnapReport_(message) {
  const from = String(message.getFrom() || '').toLowerCase();
  const subject = String(message.getSubject() || '').trim().toLowerCase();
  return from.includes('reportscheduler@motosnap.com') && subject === 'todays comms';
}

function readProcessedIds_(props) {
  try {
    const value = JSON.parse(props.getProperty(PROCESSED_KEY) || '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch (error) {
    console.warn('Unable to read prior processed Gmail IDs', error);
    return [];
  }
}

function writeProcessedIds_(props, ids) {
  const compact = ids.slice(-MAX_PROCESSED_IDS);
  props.setProperty(PROCESSED_KEY, JSON.stringify(compact));
}
