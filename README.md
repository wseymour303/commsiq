# CommunicationIQ

Mobile-first Next.js 16.3 manager dashboard for Emich Automotive customer communication intelligence.

## Stack
- Next.js 16.3.3
- React 19.2.7
- Tailwind CSS 4.3
- Supabase JS 2.112.4
- Existing AutomotiveIQ Supabase project / RLS membership model

## Run
1. Copy `.env.example` to `.env.local`.
2. Add the AutomotiveIQ publishable Supabase key.
3. `npm install`
4. `npm run dev`

The UI renders a useful preview dataset if there is no authenticated Supabase session or no live communication state yet. When authenticated, it queries `communication_customer_state`, `communication_ai_assessments`, and `communication_events` for the configured rooftop.

## Production next steps
- Add AutomotiveIQ login/session UI or mount inside the existing auth shell.
- Wire action assignment/completion to `communication_action_items`.
- Add Conversations, Team, Insights, and Ingestion pages.
- Trigger AI assessment after each completed ingestion batch.
