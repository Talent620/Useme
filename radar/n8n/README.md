# Warstwa n8n — orkiestracja i human-in-the-loop

n8n spina harmonogram, kanały dostarczania i akceptacje człowieka. Trzy workflowy MVP:

### 1. `crawl-scheduler` (cron co 15 min)
`Cron → HTTP Request (POST /api/ingest dla każdego źródła) → IF (nowe leady > 0) → Webhook do digest`

Alternatywnie woła bezpośrednio workera (BullMQ) przez Redis.

### 2. `lead-digest` (cron 8:00 i 16:00)
`Cron → HTTP (GET /api/leads?tenantId=…&status=NEW&min=60) → Function (render HTML) → Resend/Email → Update status=SENT`

Każdy tenant dostaje skondensowany digest najlepszych leadów dnia.

### 3. `auto-outreach` (PRO/AGENCY, opcjonalny)
`Webhook (nowy lead score>80) → OpenAI (przepisz draft w tonie klienta) → Human approval (n8n Wait/Approve) → Send → Update status`

Human-in-the-loop bramka pilnuje jakości zanim wiadomość wyjdzie.

## Konfiguracja
- `OPENAI_API_KEY`, `RESEND_API_KEY`, `SLACK_WEBHOOK_URL` jako credentiale n8n.
- Webhooki z `web` (np. `lead.created`) trafiają do n8n endpointów.
- Eksport workflowów trzymamy jako JSON w tym katalogu (`*.workflow.json`) i wersjonujemy.
