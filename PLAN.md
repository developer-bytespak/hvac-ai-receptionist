# Job 2: AI Voice Receptionist for an HVAC Company

Stack: Retell AI + Twilio + n8n, booking into Jobber.
Deliverable for now: a demo that wins the build, not the production system.
Budget in the listing: $2,000 to $8,000 build plus $500 to $2,000 a month retainer.

---

## 0. Read this before you bid

**Jobber already sells an AI receptionist.** "Receptionist, powered by Jobber AI" has been
generally available since 18 August 2025. It answers calls 24/7, books into the Jobber
calendar, recognises returning clients by caller id, does missed-call text-back, and
transfers to a human. It costs $29 a month for 30 conversations, then $0.79 per extra
conversation, and it is free and unlimited on Jobber's Plus plan.

Source: https://www.getjobber.com/features/ai-receptionist/ and
https://www.prnewswire.com/news-releases/jobber-launches-ai-powered-receptionist-to-answer-calls-and-texts-for-busy-home-service-businesses-302531125.html

Any proposal that says "Jobber cannot answer your phone" is wrong and a sharp owner will
catch it. The bid has to survive that fact. It can, because the native product is a
general-purpose receptionist and this job asks for six things it does not do well:

| What the listing asks for | Jobber native | A custom build |
|---|---|---|
| Emergency triage, no heat or no AC, in winter or a heat wave | Generic intent handling | Trade-specific triage that ranks urgency and changes the script |
| Service area check by postcode before booking | Not offered | A real check against their service map, with a polite decline out of area |
| Transfer to the on-call technician, with an escalation ladder | Transfer to a human | Rota-aware routing, retry, and fall back to a callback task |
| Quote requests qualified with HVAC questions, system age, brand, symptom | Generic message capture | Structured qualification written into the job |
| Custom SMS and email follow-up, review requests, reminders | Basic | Full sequences in n8n, tuned monthly |
| Monthly monitoring, call review and iteration | None, it is software you buy | The retainer in this listing |

There is also a volume argument. At 30 conversations the native product costs $29. A
contractor missing a quarter of inbound calls is well past that. At 300 conversations a
month the native product is roughly $242 unless they move to the $399 Plus plan. Do not
lead with price, lead with triage and routing, but know the numbers.

One timing note. Jobber Now 2026 runs 23 and 24 September 2026 and is trailed as their
biggest announcement of the year. Check what ships there before you send a proposal.

---

## 1. What to buy, and what it costs

Nothing here is expensive. The whole demo runs under $30 plus call minutes.

### Buy before you start

| Item | Cost | Why, and when to buy it |
|---|---|---|
| Twilio account upgrade | **$20 minimum balance** | Buy first. The free trial forbids custom message bodies, which makes a scripted receptionist demo impossible, and it only calls up to five pre-verified numbers. |
| Twilio toll-free number | **$2.15 a month** | Buy on day one. Toll-free verification is free and reviewed in about three business days. |
| Retell AI account | **$0**, $10 free credit | Covers roughly 90 minutes of demo calls on the cheap model. Add $20 if you expect heavy rehearsal. |

### Do not buy

| Item | Why not |
|---|---|
| A US local number for SMS | Sending SMS from an unregistered local number is blocked outright, and you are still billed. Registration costs $19 to $59 plus a monthly fee and takes 5 to 10 business days. Toll-free is free and takes three days. |
| A2P 10DLC brand and campaign | Only needed if the client insists on a local number. Leave it for the production build, paid by the client. |
| A Jobber subscription | See the Jobber section. Aim to use a developer test account. If the client is already on Jobber, use their sandbox, not your wallet. |
| Any paid hosting | Vercel and Render free tiers carry the demo, as they did for the dental build. |

### Running cost per call

| Line item | Per minute |
|---|---|
| Retell voice infrastructure | $0.055 |
| Text to speech, standard voice | $0.015 |
| Language model, GPT 4.1 | $0.045 |
| Twilio toll-free inbound | $0.022 |
| Retell telephony surcharge when you bring your own Twilio trunk | $0.000 |
| **Total** | **about $0.137** |

A five minute emergency call costs about 69 cents. Fifty rehearsal calls cost about $35.

Source for Twilio prices: https://www.twilio.com/en-us/voice/pricing/us and
https://www.twilio.com/en-us/sms/pricing/us
Source for Retell prices: https://www.retellai.com/pricing

---

## 2. Telephony setup, the order that avoids waiting

Do these on day one because two of them involve a queue.

1. Upgrade Twilio, add $20.
2. Buy a toll-free number, $2.15.
3. Submit toll-free verification immediately. Free, about three business days. Until it
   clears the number can take calls but cannot send SMS.
4. Create an Elastic SIP Trunk in the Twilio console. Retell has no termination address of
   its own, so set the origination SIP URI to `sip:sip.retellai.com` and secure the
   termination side with an IP allowlist of Retell's SBC range `18.98.16.120/30`.
5. Move the toll-free number onto that trunk.
6. Import the number into Retell with `POST /import-phone-number`, passing the Twilio
   termination URI, which always ends in `.pstn.twilio.com`.

Source: https://docs.retellai.com/deploy/custom-telephony and
https://docs.retellai.com/api-references/import-phone-number

Bringing your own Twilio trunk removes Retell's $0.015 per minute telephony charge, and it
is what the listing asks for, so do it this way rather than buying a Retell number.

---

## 3. Jobber integration

### The good news for a demo

Jobber gives developers a **free account with a 90 day test environment pre-loaded with
sample data**. That means the demo can create real clients and real jobs in a real Jobber
account, and you can show the Jobber web interface beside the call. The client provides
nothing.

Sources: https://developer.getjobber.com/docs/getting_started/ and
https://help.getjobber.com/en/articles/developer-center/

### What is confirmed

| Item | Detail |
|---|---|
| Endpoint | `https://api.getjobber.com/api/graphql` |
| Auth | OAuth 2.0 authorization code grant. You get a client id and secret when you create the app. |
| Version header | `X-JOBBER-GRAPHQL-VERSION`, pin an explicit date rather than defaulting |
| Rate limits | About 2,500 requests per 5 minutes per app and account, plus a GraphQL query cost budget in points |
| Create, read, update, delete | Clients, requests, jobs, quotes, assessments. Assessments carry scheduling fields for start time, end time and duration. |
| Error handling | Always request `userErrors` on a mutation and check it. An empty array means success. |

### Yes, the API can book a real time slot

This was the open question and it is settled. `jobCreate` takes scheduling inline, so the
agent can put a technician on the calendar at a specific time:

```
jobCreate(input: JobCreateAttributes!)
  propertyId!         required
  invoicing!          required, JobInvoicingAttributes
  scheduling {        createVisits: true
                      startTime / endTime
                      assignedTo: [userId]
                      notifyTeam: true }
  arrivalWindow { durationInMinutes }
  title, instructions, notes, lineItems, requestId, quoteId
```

Or use `manualVisits` for explicit per-visit start and end times and assignees. Additional
visits go on an existing job with `visitCreate(jobId, input)`, and rescheduling is
`visitEditSchedule` and `visitEditAssignedUsers`.

The data model, in the order the agent will use it:

| Object | Meaning |
|---|---|
| Client | The caller. Create with `clientCreate`, which also takes phones, emails and properties inline. |
| Property | The service address. Inline on client create, or `propertyCreate`. |
| Request | Someone asking for work. Can carry an Assessment, which is the "come out and quote it" visit. |
| Quote | The estimate. |
| Job | Scheduled work. Contains Visits. |
| Visit | One trip to the property. An unscheduled visit has null start and end. |

Notes are per-object, not generic: `clientCreateNote`, `jobCreateNote`, `requestCreateNote`.
There is no `noteCreate`.

### The one real constraint to design around

**Availability is the weak spot.** A `schedulingAvailability` query exists in the schema and
looks perfect, it even returns drive times between jobs, but it is absent from the public
docs and its payload carries subscription errors, which suggests it is gated behind a paid
Jobber feature. Do not build the demo on it.

Instead compute open slots yourself, which is reliable and needs no special access:

- `scheduledItems` with a date range and a list of team members returns everything already
  on their day, visits, assessments, tasks and events.
- `visits` filtered by start and end range, for a narrower read.
- `users` exposes `availableForScheduling`.

Check `schedulingAvailability` in GraphiQL on day one. If it works, use it and show the
drive-time optimisation, which is a genuinely impressive demo moment. If it does not, the
computed version looks identical to the client.

A second constraint: **you cannot create a free floating appointment.** A visit must belong
to a job, an assessment must belong to a request, and `jobCreate` requires an invoicing
configuration. So the booking tool always creates a client, then a job, then the visit.

### Access, approval and cost

All good news:

- **Developer account is free and self serve** at developer.getjobber.com/signup.
- **A free Jobber test account with sample data** at getjobber.com/developer-sign-up. Ninety
  days, no card, and Jobber will extend it if you email api-support@getjobber.com.
- **No app review is needed to connect to a real customer.** A Draft app can connect to up
  to five paying Jobber accounts. For one HVAC client that is the whole answer, and the
  Custom Integration track means you may never face App Review at all.
- **The developer pays Jobber nothing.** Note you cannot charge through their marketplace by
  default, so bill the client directly, which this job does anyway.

Three gotchas worth knowing before you write code:

1. **`clientCreate` permanently stamps your app name into Jobber's Lead Source field** on
   every client it creates, and Jobber users cannot edit it. Irreversible. Mention it to the
   client before go-live rather than after.
2. **Test in GraphiQL invalidates live refresh tokens** for that app. Never run it against
   the production app once a client integration is live.
3. **Webhooks are configured by hand in the Developer Center**, not through the API, and you
   must acknowledge within one second or Jobber may disable them. Queue the work, ack
   immediately. Payloads are thin, just ids, so you re-query for the object.

Technical facts to pin down in code: endpoint `https://api.getjobber.com/api/graphql`,
`X-JOBBER-GRAPHQL-VERSION` header pinned to `2026-05-12`, access tokens last 60 minutes,
refresh token rotation is on by default so store the new refresh token every time, rate
limits are 2,500 requests per 5 minutes plus a 10,000 point query budget refilling at 500
per second, and every mutation must request `userErrors` and check it because failures come
back as HTTP 200.

One item to confirm with Jobber before quoting the production build: whether raw API access
is gated by the client's plan tier. The app marketplace appears on all four plans, but
tokens are revoked on plan downgrade, so ask api-support@getjobber.com what tier the client
needs. Their plans run from $29 to $599 a month depending on tier and user count.

---

## 4. The demo

Same shape as the dental build, which is already proven, with the panels re-pointed at what
an HVAC owner cares about. The dental demo sold compliance. This one sells money recovered
and calls that never get dropped.

### One screen, four panels

1. **Call panel.** A large button for a browser call, plus the real toll-free number so the
   owner can ring it from their own mobile in the room. Live transcript, and an urgency
   badge that flips to EMERGENCY the moment the caller says no heat.

2. **Dispatch board.** Today and tomorrow, one column per technician, already populated
   from the seeded Jobber sandbox. The new job animates in when the AI creates it, colour
   coded by urgency. Keep the real Jobber tab open and switch to it once, so nobody thinks
   the board is a mock.

3. **Pipeline.** The trace lighting up: call answered, intent classified, urgency triaged,
   service area checked, caller qualified, client created in Jobber, job created, on-call
   technician texted, caller sent a confirmation. Each with timings.

4. **Recovered revenue.** Calls answered after hours, jobs created, average ticket applied,
   and a running total of revenue that would otherwise have gone to whoever answered first.
   This is the panel the owner will stare at.

### Four scenes, about four minutes

**Scene one, the emergency.** The owner calls and says the furnace is dead and there is no
heat. The agent triages it as an emergency, confirms the postcode is in the service area,
asks the three qualifying questions that matter, creates the client and the job in Jobber
marked urgent, texts the on-call technician, and texts the caller a confirmation. The
dispatch board fills in while they are still talking.

**Scene two, out of area.** A caller with a postcode outside the service map. The agent
declines politely, offers to take a message, and logs nothing to dispatch. It shows the
owner the agent will not waste a technician's drive time.

**Scene three, missed call text back.** Ring the number and hang up before the agent picks
up. A text arrives within seconds. Simple, and every owner recognises the pain.

**Scene four, the quote request.** A caller wants a price on a replacement system. The
agent qualifies system age, brand, symptom and property type, creates a request rather than
a job, and flags it for a sales follow up. It shows the agent knows the difference between
work to dispatch and work to sell.

### Then hand them the phone

The strongest close is letting the owner call the number and try to break it. Have a reset
button that clears the board between attempts.

---

## 5. Build plan, five to six working days

Roughly 70 percent of the dental demo is reusable: the Next.js app, the Retell web call
hook, the polling state endpoint, the signature-verified tool webhook, the pipeline panel
and the reset flow. What changes is the domain logic, the Jobber client, and two of the
four panels.

| Day | Work |
|---|---|
| 1 | Upgrade Twilio, buy the toll-free number, submit verification. Create the Jobber developer account and the free test environment. In GraphiQL, confirm the scopes you need and whether `schedulingAvailability` is reachable. Create the Retell account. |
| 2 | Fork the dental demo scaffold. Swap the domain config to an HVAC contractor: service area postcodes, technicians, job types, urgency rules, price bands. Build the Jobber client: OAuth, rotating refresh tokens, version header, `userErrors` checking on every mutation. |
| 3 | Tool handlers: classify urgency, check service area, match an existing client before creating one (duplicate prevention is an explicit Jobber review criterion), compute open slots from `scheduledItems`, create the job with an inline scheduled visit, notify the on-call technician, log a callback. Each writes a pipeline step and an outcome row. |
| 4 | Retell conversation flow: greeting, emergency triage branch, service area gate, qualification, booking, transfer to on-call, voicemail and spam paths. Wire the SIP trunk and import the number. |
| 5 | The two new panels: dispatch board and recovered revenue. Missed-call text-back workflow. SMS confirmations once toll-free verification clears. |
| 6 | Rehearse the four scenes end to end, at least twenty calls. Failure paths: Jobber unreachable, out of area, caller hangs up mid-booking, spam call. Deploy to Vercel with Render as standby. |

### What ships alongside the demo

- A 60 second recording of a flagship emergency call. The listing explicitly recommends
  attaching one to proposals.
- The n8n workflow exports for the production build. The demo pipeline runs as app routes
  because a self-hosted server that can die mid-demo is not worth the fidelity, but the
  client is buying an n8n build and should see the workflows.
- A one page failure-path document: what happens when Jobber is unreachable, when the
  technician does not answer, when the caller is out of area, when the call is spam. The
  listing asks for failure-path evidence and almost nobody provides it.

---

## 6. Positioning notes

- Lead with the recording, not with credentials. The listing says the buyer is
  non-technical and a demo beats credentials.
- Do not quote a ServiceTitan build. Their API is restricted. Quote Housecall Pro only if
  the client is already on their top plan.
- Use the contractor's own call logs for the value argument rather than borrowed industry
  statistics. Most of the alarming missed-call numbers in this market trace back to vendors
  citing each other, and a sharp buyer can debunk them. Their own data cannot be argued
  with.
- If you need a published number, trade businesses book about 38 percent of inbound calls,
  and every 5 percent improvement is worth roughly $100,000 a year to a 5 to 14 technician
  shop. Source: https://www.servicetitan.com/blog/data-call-booking-rates
  Average HVAC repair ticket is about $350 and a replacement about $7,500. Source:
  https://www.angi.com/articles/how-much-hvac-repair-cost.htm
- Always attach the monitoring and iteration retainer as a line item. It is the difference
  between this and a product they could buy for $29 a month.

