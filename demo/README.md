# Northline Heating and Cooling: AI phone receptionist demo

A working after hours service line for an HVAC contractor. A caller rings, says
their furnace is dead, and by the time they hang up there is a job on the
dispatch board, a text on the on call technician's phone, and a confirmation
text on theirs. Everything on screen is driven by the real call.

This is a sales demo built to win the build, not the production system. The
domain rules live in `lib/config.ts` and the seven things the agent can do live
in `lib/tools.ts`. Those two files are the contract. Change the company in
`lib/config.ts` and the whole demo re-points at a different contractor.

## What the room sees

One screen, four panels: the call panel with a live transcript and an urgency
badge, the dispatch board for today and tomorrow with a column per technician,
the pipeline trace with timings, and a recovered revenue counter.

### The four scenes

1. **The emergency.** The owner says the furnace is dead and there is no heat.
   The agent triages it as an emergency, confirms the postcode is in the service
   area, asks the three qualifying questions, creates the customer, books a
   window tonight, texts the on call technician and texts the caller. The board
   fills in while they are still talking.
2. **Out of area.** A caller with a postcode outside the service map. The agent
   declines politely, offers to take a message, and writes nothing to dispatch.
   It proves the agent will not waste a technician's drive time.
3. **Missed call text back.** Ring the number and hang up before the agent picks
   up. A text arrives within seconds.
4. **The quote request.** A caller wants a price on a replacement system. The
   agent qualifies system age, what is being replaced and the property, logs an
   estimate request rather than a job, and never quotes a figure. It proves the
   agent knows the difference between work to dispatch and work to sell.

Then hand the owner the phone and let them try to break it. The Reset button
clears the board between attempts.

## Running locally with zero external services

No accounts, no Docker, no network. The database falls back to PGlite, Jobber
falls back to a mock customer book seeded with a believable week, and SMS falls
back to preview messages rendered on a phone mock up.

```
npm install
npm run seed
npm run dev
```

Open http://localhost:3000. The call button will be inert until you have a
Retell public key and agent id, but every panel is live and
`tests/demo-pipeline.http` drives the whole pipeline without a voice call.

To exercise the pipeline by hand, set `ALLOW_UNSIGNED_WEBHOOKS=true` in
`.env.local`, restart, and run `tests/demo-pipeline.http` top to bottom with the
VS Code REST Client extension. Set it back to `false` afterwards.

## Phase 1: Retell only, about twenty minutes

This is the whole demo. Jobber and Twilio are upgrades, not requirements.

1. **Create a Retell account** at https://retellai.com. It comes with $10 of
   free credit, which is roughly ninety minutes of calls on the cheap model.
   Add $20 if you expect heavy rehearsal.
2. **Copy both keys** from the dashboard under API Keys. The API key is a
   secret and does two jobs: the push script authenticates with it, and the
   webhook routes verify the `x-retell-signature` HMAC with it. The public key
   is for the browser call widget and is safe to ship to the browser.
3. **Pick a voice** in the dashboard under Voices and paste its id into
   `retell/demo-agent.json` in place of `<VOICE_ID>`.
4. **Deploy the app first**, because the push script needs the hostname. Render
   is set up for you: push to GitHub, then New > Blueprint pointed at
   `render.yaml`. Vercel also works and needs no config file, because this is a
   stock Next.js app. Note the hostname.
5. **Run the push script.** It creates the conversation flow, then the agent
   that references it, and writes both ids to `retell/.demo-ids.json` so a
   second run updates rather than duplicating.

   ```
   RETELL_API_KEY=key_... DEMO_HOST=hvac-demo.onrender.com npx tsx retell/push-demo-config.ts
   ```

   Add `--dry-run` to see what it would send. It prints the agent id at the end.
6. **Buy a Retell number**, about $2 a month, in the dashboard under Phone
   Numbers, and bind it to the agent the script just created. This is the quick
   path. The Twilio trunk in Phase 3 is cheaper per minute and is what the
   listing asks for, but it needs a verification queue.
7. **Set the environment variables** on the deploy: `RETELL_API_KEY`,
   `NEXT_PUBLIC_RETELL_PUBLIC_KEY`, `NEXT_PUBLIC_RETELL_AGENT_ID` from the
   script output, `NEXT_PUBLIC_DEMO_PHONE_NUMBER` in E.164, and
   `DEMO_TECHNICIAN_NUMBER` set to your own mobile so you can hold the page up
   in the room. Redeploy.
8. **Make one call.** Say "my furnace is dead and there's no heat". You should
   see the urgency badge flip, the pipeline light up step by step, and a job
   appear on the board.

## Phase 2: connecting Jobber

Optional for the demo and impressive when it works, because you can put the real
Jobber tab next to the board and switch to it once so nobody thinks the board is
a mock. The demo runs perfectly well on the mock until this is ready.

1. **Create the free test account** at https://www.getjobber.com/developer-sign-up.
   It is a ninety day environment pre-loaded with sample data, no card needed.
   Jobber will extend it if you email api-support@getjobber.com.
2. **Create the Developer Center account** at developer.getjobber.com/signup.
   This is a separate account from the test environment.
3. **Create a Draft app** in the Developer Center. A Draft app can connect to up
   to five paying Jobber accounts, so no App Review is needed for one client.
4. **Scope names are only visible in the Developer Center UI.** They are not in
   the public docs and you cannot guess them. Open the app's scope screen, tick
   what you need for clients, requests, jobs and scheduled items, and read the
   exact names off that page.
5. **Use Test in GraphiQL** on the app to get a token and confirm your queries.
   Check whether `schedulingAvailability` is reachable while you are in there.
   If it is, the drive time optimisation is a genuinely good demo moment. If it
   is not, the computed open slots look identical to the client.
6. **Obtain a refresh token** through the OAuth authorization code flow against
   the test account, and paste it into `JOBBER_REFRESH_TOKEN`.
7. **Set the three variables**: `JOBBER_CLIENT_ID`, `JOBBER_CLIENT_SECRET` and
   `JOBBER_REFRESH_TOKEN`. With all three present the demo switches to the live
   Jobber gateway automatically. `/api/config` reports which mode it is in.
8. **`JOBBER_MODE=mock` forces the mock back on** even with real credentials in
   place. Use it for every rehearsal, so a Jobber outage or an expired token
   cannot spoil a live demo, and only clear it when you are ready to show the
   real account.

Three warnings worth reading twice:

- **Test in GraphiQL invalidates live refresh tokens for that app.** Never press
  it against the app a client integration is running on. If you do, the demo
  will fail with an invalid grant until you redo the OAuth flow.
- **`clientCreate` permanently stamps your app name into Jobber's Lead Source
  field** on every client it creates. Jobber users cannot edit it and it cannot
  be undone. Tell the client before go live, not after.
- **Refresh token rotation is on by default.** Jobber hands back a new refresh
  token on every exchange and invalidates the old one. Set
  `JOBBER_REFRESH_TOKEN_SINK` to a writable path so the new token is stored, and
  remember that on Render only `/tmp` is writable and it is wiped on restart.

Pin `JOBBER_API_VERSION` to an explicit date, `2026-05-12` by default, rather
than letting the header default. Every mutation asks for `userErrors` and checks
it, because Jobber returns failures as HTTP 200.

## Phase 3: adding Twilio

Bringing your own Twilio trunk removes Retell's per minute telephony surcharge
and is what the listing asks for. Start it early, because two steps involve a
queue.

1. **Upgrade the Twilio account with $20.** The free trial forbids custom
   message bodies and only calls pre-verified numbers, which makes a scripted
   receptionist demo impossible.
2. **Buy a toll free number**, about $2.15 a month. Do not buy a US local
   number: sending SMS from an unregistered local number is blocked outright and
   you are still billed, and A2P 10DLC registration costs $19 to $59 plus a
   monthly fee and takes 5 to 10 business days.
3. **Submit toll free verification immediately.** It is free and takes about
   three business days. Until it clears the number can take calls but cannot
   send SMS.
4. **Create an Elastic SIP Trunk** in the Twilio console. Retell has no
   termination address of its own, so set the origination SIP URI to
   `sip:sip.retellai.com` and secure the termination side with an IP allowlist
   of Retell's SBC range `18.98.16.120/30`.
5. **Move the toll free number onto that trunk.**
6. **Import the number into Retell** with `POST /import-phone-number`, passing
   the Twilio termination URI, which always ends in `.pstn.twilio.com`, and bind
   it to the agent.
7. **Set the three variables**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and
   `TWILIO_FROM_NUMBER`. With all three present the SMS layer switches from
   preview to live and the technician page and the caller confirmation go out as
   real texts. With any of them missing it stays in preview and renders on the
   phone mock up, which is still a perfectly good demo.

## Before the demo

Run through this every time. Most of it takes two minutes.

- [ ] Open the site and wait for it to paint. A free Render instance spins down
      after about fifteen minutes idle and takes roughly fifty seconds to wake.
      Retell's tool webhook times out at 15000 ms, so a cold instance fails the
      first tool call and the agent falls back to taking a message.
- [ ] Press Reset so the board shows the seeded week and nothing else.
- [ ] Check `/api/config`: `retell.configured` true, and the Jobber and SMS
      modes are the ones you intend to show.
- [ ] Confirm `ALLOW_UNSIGNED_WEBHOOKS` is `false`, so the signature check runs
      and the pipeline shows it passing.
- [ ] Make one real call end to end and then press Reset again. Warming the
      instance and proving the audio path is the same action.
- [ ] Set `JOBBER_MODE=mock` unless you are deliberately showing the real Jobber
      account.
- [ ] Put `DEMO_TECHNICIAN_NUMBER` on a phone you can hold up, and silence
      everything else on it.
- [ ] Have `tests/demo-pipeline.http` open in a second window as the fallback.
- [ ] Check the Retell credit balance. Fifty rehearsal calls cost about $35.

## The four minute demo script

**0:00 to 0:20, the setup.** One sentence, no credentials. "This is your service
line at eight in the evening in October. Watch the right hand side while I
call."

**0:20 to 1:40, scene one, the emergency.** Call the number. Say: "my furnace is
dead and there's no heat." Let the agent triage it. Give the postcode 60004.
Answer the three qualifying questions. Give a name and a street. Take the first
window it offers. While the caller is still talking, point at three things and
nothing else: the badge going to EMERGENCY, the job landing on the board, and
the text arriving on the technician's phone in your hand. Do not narrate the
pipeline panel, let them find it.

**1:40 to 2:20, scene two, out of area.** Call again and give a Lincoln Park
postcode, 60614. The agent declines politely and offers a message. Say one line:
"Nothing went to dispatch. Your technicians never get sent to Lincoln Park."

**2:20 to 2:50, scene three, the missed call.** Ring the number and hang up
before it answers. Hold up the phone when the text arrives. Say nothing.

**2:50 to 3:40, scene four, the quote.** Call and ask what a new furnace would
cost. Let the agent refuse to give a number, qualify the system age and the
property, and log it as an estimate. Say: "It did not quote a price, and it did
not send a technician to a sales job. It knows the difference."

**3:40 to 4:00, hand them the phone.** "Try to break it." Then press Reset
between attempts. Close on the recovered revenue panel and the retainer, not on
the technology.

## Troubleshooting

**Every webhook returns 401, or the pipeline shows a signature failure.** The
`RETELL_API_KEY` on the server is not the key that created the agent. Retell
signs with the API key, so a key rotation or a second workspace breaks it. Copy
the key again from the dashboard, set it on the deploy, redeploy. As a last
resort during a demo, set `ALLOW_UNSIGNED_WEBHOOKS=true`, which downgrades the
check to a warning and keeps the call working. Set it back afterwards.

**No audio on a browser call.** Check `NEXT_PUBLIC_RETELL_PUBLIC_KEY` and
`NEXT_PUBLIC_RETELL_AGENT_ID` are both set on the deploy and that the page was
rebuilt after they were set, because `NEXT_PUBLIC_` values are baked in at build
time. Check the browser has microphone permission and that you are on HTTPS.
If the phone number is the problem instead, confirm the number is bound to the
agent in the Retell dashboard and that the agent is published.

**The first tool call of the call fails and the agent takes a message.** Cold
start. The instance had spun down and took longer than the 15000 ms tool timeout
to answer. Open the site, wait for it to paint, and call again. Upgrade off the
free instance type if the demo cannot tolerate the risk.

**Jobber returns invalid grant, or every write fails.** The refresh token has
rotated and the stored one is stale, or someone pressed Test in GraphiQL on that
app, which invalidates live refresh tokens. Redo the OAuth flow, paste the new
refresh token, and make sure `JOBBER_REFRESH_TOKEN_SINK` points somewhere
writable. If it is demo day and this is not working, set `JOBBER_MODE=mock` and
carry on: the mock board is indistinguishable to the audience.

**Texts still say preview.** All three of `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER` must be present, and the check is
all or nothing. `/api/config` reports `integrations.sms.mode`. If all three are
set and Twilio rejects the send, toll free verification has probably not cleared
yet. It takes about three business days and the number can take calls the whole
time.

## Files

- `lib/config.ts`, the company, service area, technicians, triage rules and job
  types. The only file to edit when re-pointing the demo.
- `lib/tools.ts`, the seven things the agent can do and nothing else.
- `retell/demo-agent.json`, the Create Agent request body.
- `retell/demo-flow.json`, the Create Conversation Flow request body.
- `retell/push-demo-config.ts`, pushes both, in that order, and prints the agent
  id.
- `tests/demo-pipeline.http`, the whole pipeline without a voice call.
- `render.yaml`, the Render blueprint.

There is no `vercel.json`, and none is needed. This is a stock Next.js app, so
Vercel detects the framework, the build command and the output directory on its
own. Add one only if you later need a region pin, a cron, or a custom function
timeout.
