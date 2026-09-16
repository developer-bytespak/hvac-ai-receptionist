/**
 * Demo database schema.
 *
 * The demo_* tables stand in for Jobber when the mock gateway is active. The
 * call_events, pipeline_events and outbound_messages tables are ours either
 * way, because the contractor wants a record of what the agent did regardless
 * of where the job landed.
 *
 * Kept as a TypeScript string so it bundles into serverless functions with no
 * file system access at runtime.
 */

export const SCHEMA_SQL = `
-- ---------- stand-in for Jobber ----------

create table if not exists demo_clients (
  id               text primary key,
  first_name       text not null,
  last_name        text not null,
  phone            text not null,
  email            text,
  property_id      text not null,
  street1          text not null,
  city             text not null,
  province         text not null default 'IL',
  postal_code      text not null,
  created_by_agent boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists demo_clients_phone on demo_clients (phone);

create table if not exists demo_jobs (
  id               text primary key,
  client_id        text not null,
  property_id      text not null,
  title            text not null,
  instructions     text,
  job_type_id      text not null,
  urgency          text not null,
  created_by_agent boolean not null default false,
  created_at       timestamptz not null default now()
);

create table if not exists demo_visits (
  id               text primary key,
  job_id           text not null,
  client_id        text not null,
  technician_id    text not null,
  title            text not null,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  urgency          text not null default 'routine',
  status           text not null default 'scheduled',
  created_by_agent boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists demo_visits_starts_at on demo_visits (starts_at);

create table if not exists demo_requests (
  id         text primary key,
  client_id  text not null,
  property_id text not null,
  title      text not null,
  details    text,
  status     text not null default 'new',
  created_at timestamptz not null default now()
);

create table if not exists demo_notes (
  id         bigserial primary key,
  client_id  text not null,
  message    text not null,
  created_at timestamptz not null default now()
);

-- ---------- ours, regardless of where the job lands ----------

create table if not exists call_events (
  id            bigserial primary key,
  occurred_at   timestamptz not null default now(),
  call_id       text not null,
  action        text not null,
  outcome       text not null,
  urgency       text,
  detail        jsonb
);
create index if not exists call_events_call_id on call_events (call_id);

create table if not exists pipeline_events (
  id          bigserial primary key,
  occurred_at timestamptz not null default now(),
  call_id     text not null,
  step        text not null,
  status      text not null,          -- running, ok, warn, error
  detail      text,
  duration_ms integer
);
create index if not exists pipeline_events_call_id on pipeline_events (call_id);

-- Every text the agent would send. While Twilio is not connected these are
-- queued rather than sent, and the demo shows them on a phone mock up.
create table if not exists outbound_messages (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  call_id     text,
  to_number   text not null,
  to_label    text not null,          -- caller or technician
  body        text not null,
  channel     text not null default 'sms',
  status      text not null default 'queued',  -- queued, sent, failed
  provider    text not null default 'preview', -- preview or twilio
  provider_id text,
  error       text
);
create index if not exists outbound_messages_created_at on outbound_messages (created_at);

-- Messages the agent took because it could not book: out of area, nobody free
-- to transfer to, or a caller who wanted a call back. The office works this
-- list in the morning.
create table if not exists callback_queue (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  call_id      text not null,
  caller_name  text not null,
  caller_phone text not null,
  town         text,
  reason       text not null,
  note         text,
  handled_at   timestamptz
);
create index if not exists callback_queue_created_at on callback_queue (created_at);

create table if not exists demo_calls (
  call_id     text primary key,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  channel     text not null default 'web',
  from_number text,
  urgency     text,
  outcome     text,
  after_hours boolean not null default false,
  booked      boolean not null default false,
  ticket_value numeric(10,2),
  summary     text
);
`;

export const TRUNCATE_SQL = `
truncate table pipeline_events, call_events, outbound_messages, callback_queue, demo_calls,
               demo_notes, demo_requests, demo_visits, demo_jobs, demo_clients
  restart identity cascade;
`;
