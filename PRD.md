# PRD: BlackBox

_AI concierge for customer service calls_

---

## 1. Product Summary

BlackBox is an AI concierge for customer service calls.

When something goes wrong — a canceled flight, a botched delivery, a broken order — the user opens BlackBox and explains what happened in their own words. BlackBox does everything that normally wastes the next 40 minutes of the user's life:

- Identifies which company to call
- Pulls the confirmation number, loyalty ID, payment method, and other identifying details from the user's email
- Dials the company
- Navigates the phone tree
- Waits on hold
- Detects when a human agent picks up

At that moment, BlackBox hands the phone to the user with a briefing card: what to say, in one paragraph, with every piece of information the agent will ask for pre-filled.

The user never digs through email while a hold-music timer counts up. They never repeat their name three times to three different AIs. They arrive at the call already prepared.

The MVP is built on **Butterbase** (AI, storage, database, RAG), **Neo4j** (email entity graph), and **RocketRide** (managed AI extraction pipeline). The demo scenario is a canceled United flight while the user is stranded at the airport.

---

## 2. Core Thesis

Customer service is broken for two reasons:

1. **The company's side is slow and hostile.** Phone trees, hold times, and pre-agent AI screening all exist to reduce the company's cost, not the user's time.
2. **The user's side is unprepared.** People don't have their confirmation number memorized, their credit card details in one place, or their loyalty account handy. When the human finally picks up, the user spends the first two minutes fumbling.

Existing tools try to fix problem #1 by having an AI wait on hold. That's table stakes now.

BlackBox fixes both. The AI waits on hold _and_ uses that time to assemble everything the human agent will ask for, so the call itself takes 90 seconds instead of 20 minutes.

The metaphor: BlackBox is the box between the user and the mess. Everything ugly — the tree, the hold, the extraction, the assembly — goes into the box. Out comes a briefed human on the line.

---

## 3. Problem

When something urgent breaks, users are in the worst possible state to navigate customer service:

- Stressed and time-pressured (stranded at airport, missed appointment, kids in the car)
- Missing information they need (confirmation buried in Expedia email, credit card in a wallet in another room, frequent flyer number never memorized)
- Facing a hostile pre-agent AI designed to deflect
- Facing an IVR designed to reduce call volume, not connect them to a human
- Facing hold times that make their existing situation worse

Once they finally reach a human, they've been drained of patience, they still don't have the information organized, and the conversation is longer and more frustrating than it needed to be.

The user's core pain is not "waiting on hold." It's "waiting on hold _and then_ being unprepared when the human picks up."

---

## 4. Target Users

**Primary user:** anyone facing a time-sensitive customer service problem where identifying information is scattered across their email — canceled flights, refund requests, order problems, account issues, warranty claims.

**Ideal first customer:** frequent travelers. High-frequency pain, high dollar value per incident, identity fragmented across airlines / OTAs / credit cards / loyalty programs.

**Demo user:** a traveler at the airport whose United flight was just canceled.

---

## 5. Product Goals

**MVP goals**

- User explains the problem in one sentence.
- System identifies the company to call and finds the right support number.
- System extracts all identity, booking, and payment details from user's email into a graph.
- System places the call, navigates the IVR, waits on hold.
- When a human answers, system hands the user a briefing card and connects the call.
- Everything the user sees while waiting is transparent and legible — no black-box spinner.

**Strategic goals**

- Demonstrate a novel wedge in customer service (arriving briefed, not just skipping hold).
- Prove Butterbase as an AI-native backend for agentic workflows.
- Prove Neo4j as the natural memory layer for personal-context AI agents.
- Create a demo with two "wow" moments: the live graph assembly, and the human picking up.

---

## 6. Non-Goals

For the hackathon MVP, BlackBox will NOT:

- Speak on the user's behalf to the human agent.
- Impersonate the user at any point in the call.
- Store or transmit full credit card numbers (only last-4 and brand).
- Support every airline or every customer-service scenario. Demo is United, canceled flight.
- Do live outbound dialing on stage. The IVR audio is pre-recorded (see §12).
- Ship a production-hardened Gmail integration. Demo uses a seeded mock inbox.
- Handle non-English calls or non-US phone systems.

---

## 7. Architecture

Three services, each doing what it's best at: Butterbase (runtime), Neo4j (memory), and RocketRide (the extraction pipeline that turns raw email into structured entities).

### 7.1 Butterbase — agent runtime + storage

**AI Integration** — the agent brain. Understands the user's initial complaint, drives IVR navigation decisions in real time, generates the final briefing card. OpenAI-compatible gateway.

**Database** — call session state, user profile, extraction job status, IVR decision log, final briefing card. Standard Postgres with the auto-generated Data API.

**File Storage** — call recording, IVR audio snippets, boarding pass PDFs and receipts pulled from email attachments. Presigned URLs.

**RAG** — corpus of company IVR maps and rebooking policies. Answers questions like "how do I reach a human at United?" and "what's United's policy for weather-related cancellations?" This is what makes the IVR navigation accurate rather than guessed.

### 7.2 Neo4j — email entity graph

The user's inbox is ingested, entities and relationships are extracted by the AI, and the graph is stored in Neo4j. At briefing time, a single Cypher query assembles the full dossier.

**Nodes:** `Person`, `Email`, `Booking`, `Flight`, `Airline`, `LoyaltyAccount`, `PaymentMethod`, `Airport`, `Attachment`.

**Edges:** `SENT_BY`, `MENTIONS`, `INCLUDES`, `PAID_WITH`, `HAS_LOYALTY`, `DEPARTS_FROM`, `CONNECTED_TO`, `FORWARDED_FROM`, `COMPANION_OF`.

**Example briefing query:**

```cypher
MATCH (u:Person {id: $user})-[:HAS_BOOKING]->(b:Booking)-[:INCLUDES]->(f:Flight {status: 'canceled'})
MATCH (u)-[:HAS_LOYALTY]->(l:LoyaltyAccount {airline: f.airline})
MATCH (b)-[:PAID_WITH]->(p:PaymentMethod)
RETURN b.pnr, f.number, f.date, l.number, p.brand, p.last4
```

One query returns the entire briefing.

### 7.3 Why two backends

Butterbase is the runtime: it stores app state, drives the agent, and holds the phone-call artifacts. Neo4j is the memory: it holds the user's fragmented identity across dozens of emails.

Email retrieval here is not a search problem, it's a traversal problem. Vector search would find each fragment (booking, loyalty, payment) individually and hope the LLM stitches them. The graph makes the stitching explicit, traceable, and demoable on screen.

### 7.4 RocketRide — managed extraction pipeline

The email-to-entities extraction runs as a **RocketRide** pipeline rather than inline LLM calls. Each raw email is fed to a `.pipe` pipeline (`chat` source → `llm` node → `response_answers`) that returns **structured JSON entities** (person, booking, flight, loyalty, payment). Those entities are what get merged into the Neo4j graph.

This makes the division of AI labor clean and each service load-bearing:

- **RocketRide** owns the **ingestion brain** — the batch extraction pipeline over the inbox.
- **Butterbase AI** owns the **real-time agent** — complaint→intent detection and live IVR navigation decisions, plus RAG.
- **Neo4j** owns the **assembled memory** — the stitched-together identity graph.

The pipeline is started once at service startup and reused for all emails (RocketRide pipelines are stateful and expensive to spin up per-request).

---

## 8. User Flow

1. **User opens BlackBox.** Text box: _"What's going on?"_
2. **User types:** _"I'm at SFO, my United flight to Chicago just got canceled and I need to rebook."_
3. **AI identifies the intent and the company.** United Airlines, flight rebooking.
4. **Email ingestion begins in parallel.** The RocketRide extraction pipeline parses each email into structured entities, which populate the Neo4j graph. Visible on screen: graph nodes appearing.
5. **System retrieves United's IVR map from Butterbase RAG.** Knows the path to a human agent: `press 1 → 2 → 0 → say "agent"`.
6. **System places the call.** Phone UI shows dialing, ringing, connected.
7. **System navigates the IVR.** IVR audio plays, AI decides which key to press based on the recorded prompts. On-screen log shows each decision.
8. **System waits on hold.** Hold music plays. In parallel, the briefing card assembles on screen from the Neo4j query: PNR, flight number, cancellation reason, frequent flyer number, payment method.
9. **Human agent picks up.** _("Thanks for calling United, this is Sarah.")_
10. **Handoff.** Phone UI pulses green. Briefing card slides to front of screen with a suggested opening line. User reads it, agent has everything they need.

---

## 9. Demo Scenario

**Setup:** the demo runs against a seeded mock inbox containing ~15 realistic emails:

- United booking confirmation for flight UA1234 SFO → ORD
- Expedia itinerary forwarded from spouse
- United MileagePlus welcome email with frequent flyer number
- Chase credit card statement showing the flight charge
- Yesterday's automated cancellation notice
- Plus decoys (unrelated bookings, old flights, promotional emails) so the graph traversal has to actually discriminate

**Opening frame:** the user is at an airport gate (staged mock UI). A canceled-flight notification just came in.

**User action:** types _"My United flight to Chicago just got canceled and I need to rebook."_

**On-screen during 60-second call:**

- **Left panel:** phone UI, IVR playback, key-press indicators
- **Center panel:** Neo4j graph assembling in real time
- **Right panel:** briefing card populating field by field
- **Bottom strip:** agent reasoning log

**Climax:** hold music cuts. Human voice: _"Thanks for calling United, this is Sarah, how can I help you?"_ Briefing card flies to front. Suggested opening:

> _"Hi Sarah, I'm on booking ABC123, flight UA1234 from SFO to ORD today. It was canceled — I need to rebook. My MileagePlus number is 1234567 and I paid with the Chase card ending 4242."_

**Demo ends here.** Two-second hold on the briefing card. Cut to closing line.

---

## 10. Data Model

### 10.1 Butterbase tables

**`sessions`**

| Field            | Type        | Description                                               |
| ---------------- | ----------- | --------------------------------------------------------- |
| id               | uuid        | Session ID                                                |
| user_id          | uuid        | User                                                      |
| user_input       | text        | Original complaint                                        |
| detected_company | text        | Identified target company                                 |
| detected_intent  | text        | e.g. `rebook_flight`, `refund_request`                    |
| status           | text        | `extracting` / `dialing` / `on_hold` / `handoff` / `done` |
| created_at       | timestamptz |                                                           |

**`ivr_decisions`**

| Field       | Type        | Description                  |
| ----------- | ----------- | ---------------------------- |
| id          | uuid        |                              |
| session_id  | uuid        |                              |
| prompt_text | text        | IVR prompt heard             |
| decision    | text        | Key pressed or phrase spoken |
| reasoning   | text        | AI justification             |
| timestamp   | timestamptz |                              |

**`briefing_cards`**

| Field             | Type        | Description          |
| ----------------- | ----------- | -------------------- |
| id                | uuid        |                      |
| session_id        | uuid        |                      |
| card_json         | jsonb       | Assembled dossier    |
| suggested_opening | text        | Line for user to say |
| created_at        | timestamptz |                      |

**`call_artifacts`**

| Field             | Type | Description                             |
| ----------------- | ---- | --------------------------------------- |
| id                | uuid |                                         |
| session_id        | uuid |                                         |
| artifact_type     | text | `recording`, `boarding_pass`, `receipt` |
| storage_object_id | text | Butterbase Storage reference            |

### 10.2 Neo4j schema

Documented in §7.2. Ingestion is an LLM extraction pipeline: each email is parsed for entities, and nodes/edges are merged into the graph.

---

## 11. Briefing Card Schema

```json
{
    "company": "United Airlines",
    "user_intent": "Rebook canceled flight",
    "identity": {
        "name": "Jamie Chen",
        "loyalty_program": "MileagePlus",
        "loyalty_number": "1234567"
    },
    "booking": {
        "pnr": "ABC123",
        "flight_number": "UA1234",
        "route": "SFO → ORD",
        "date": "2026-07-07",
        "status": "canceled"
    },
    "payment": {
        "brand": "Chase Sapphire Preferred",
        "last4": "4242"
    },
    "context": {
        "user_location": "SFO airport",
        "urgency": "same-day rebooking needed"
    },
    "suggested_opening": "Hi, I'm on booking ABC123, flight UA1234 from SFO to ORD today. It was canceled — I need to rebook. My MileagePlus number is 1234567 and I paid with the Chase card ending 4242."
}
```

---

## 12. Recording & Playback (Demo Mechanics)

The phone call audio is pre-recorded. Everything else on stage is live.

**What's recorded**

- Real United IVR captured from an actual call (recorded in a one-party-consent state).
- Hold music and pre-agent AI prompts.
- A "human agent" opening line (recorded by a team member playing Sarah).

**What's live**

- Neo4j graph queries and visualization.
- AI decisions about which IVR option to select (driven by real LLM calls, matched to the recording).
- Briefing card assembly from the graph.
- Reasoning log.

**Transparency:** the pitch acknowledges upfront that the phone audio is recorded because live-dialing United on stage is not viable. Everything else is provably live. This is a credibility signal, not a weakness — trying to pass off recorded audio as live is what would sink the demo.

**One working path for MVP:** the AI's IVR decisions are matched to the single recorded audio branch. If time allows, record 2–3 branches so the AI can genuinely choose. If not, one path, working reliably.

**Backup:** a full screen recording of a successful run is queued in a second tab. If any live component breaks, cut to the recording, acknowledge the network hiccup, keep pitching.

---

## 13. Functional Requirements

**P0**

- User can enter a natural-language complaint.
- System identifies the target company and intent.
- System ingests a mock inbox and builds the Neo4j graph.
- Cypher query returns the full dossier for the demo scenario.
- Butterbase RAG returns the correct IVR path for United.
- Phone UI plays recorded IVR and shows AI navigation decisions in real time.
- Briefing card assembles visibly on screen.
- Human-picks-up moment triggers card handoff.

**P1**

- Real Gmail OAuth ingestion (in addition to mock).
- Multiple IVR branches recorded so AI has genuine choice.
- Graph visualization is animated (nodes light up as extraction happens).
- User can edit the briefing card before handoff.

**P2**

- Live outbound dialing via Twilio (post-hackathon).
- Multi-company support (Delta, American, hotels, banks, ISPs).
- Post-call summary and follow-up scheduling.
- Mobile app version.

---

## 14. UI Requirements

**Home screen**

- One text input: _"What's going on?"_
- Recent sessions list.

**Live call screen (the money shot)**

- Left third: phone UI, current IVR prompt, key-press indicators.
- Middle third: live Neo4j graph, nodes and edges lighting up.
- Right third: briefing card assembling field by field.
- Bottom strip: agent reasoning log, scrolling.

**Handoff moment**

- Briefing card slides to front, phone UI pulses green.
- Suggested opening line in large text.
- Buttons: _"End call"_ and _"I've got it from here."_

---

## 15. Success Metrics

**Hackathon**

- Demo runs end-to-end without visible failure.
- Both wow moments (graph assembly + human pickup) land in the room.
- Judges can articulate the value prop back in one sentence.
- Butterbase and Neo4j both feel _load-bearing_, not decorative.

**Product (post-hackathon)**

- Median time-to-briefed-human under 3 minutes.
- Median call length after handoff under 5 minutes.
- User-reported stress reduction score.
- Percentage of calls resolved on first try.

---

## 16. Security & Privacy

- Only last-4 of payment methods is stored or displayed. Full PAN is never extracted or transmitted.
- Sensitive fields in the briefing card can be redacted by the user before handoff.
- The AI never speaks to the human agent on the user's behalf; it disconnects at handoff.
- Email data is scoped per user (single-tenant graph).
- Call recordings are user-owned and deletable.
- For the MVP demo: no real user data. Seeded mock inbox only.

---

## 17. Hackathon Build Plan

**Day 1 morning — foundation**

- Butterbase setup: DB schema, storage buckets, RAG collection.
- Neo4j setup: schema, empty graph.
- Mock inbox: write 15 realistic emails as JSON fixtures.
- Record real United IVR call.

**Day 1 afternoon — extraction pipeline**

- Email → entity extraction (RocketRide `.pipe` pipeline, structured-JSON output).
- Entity → Neo4j nodes and edges.
- Cypher query for briefing dossier.
- Verify: single query returns full dossier from seeded inbox.

**Day 1 evening — RAG + agent**

- Populate RAG with United IVR map and rebooking policy.
- Agent decides IVR navigation from recorded prompt text.
- Wire agent decisions to phone UI.

**Day 2 morning — frontend**

- Three-panel live call screen.
- Graph visualization (D3 or Neo4j Bloom embed).
- Briefing card component.
- Handoff moment animation.

**Day 2 afternoon — integration + polish**

- End-to-end demo pass.
- Rehearse timing against recorded audio.
- Backup: full screen recording as fallback.
- Rehearse pitch (opener, closer, transitions).

**Cut ruthlessly if time runs short:** graph animation, edit-briefing-card, multi-branch IVR, real Gmail OAuth. Keep: end-to-end path from complaint to briefing card, plus the human-pickup moment.

---

## 18. Demo Script

**Opening (15 sec)**

> "You're at the airport. Your flight just got canceled. You call the airline. Forty minutes of hold music, an AI that asks you the same question three times, and by the time a human picks up, you're digging through your email for a confirmation number you can't find. This is BlackBox."

**Setup (10 sec)**

> "The user is stranded at SFO. Their United flight to Chicago just got canceled. Watch what happens."

**Live demo (~60 sec)**

- User types the complaint. System starts dialing.
- Narrate graph assembly: _"BlackBox is pulling booking, loyalty, and payment details from the inbox in real time. Each of these came from a different email."_
- Narrate IVR: _"It's navigating the phone tree using a policy corpus it retrieved from our knowledge base."_
- Narrate hold: _"While it waits, the briefing card is filling in."_
- Human picks up. Briefing card slides forward. Pause two seconds.

**Closer (15 sec)**

> "Instead of 40 minutes of hold music and a fumbling opening, the user is on the phone with a briefed human in 90 seconds. Butterbase runs the agent and the call. Neo4j is the user's memory. That's BlackBox."

---

## 19. Positioning

**One-liner:** BlackBox is an AI concierge that gets you to a briefed human.

**Short pitch:** When something breaks and you have to call customer service, BlackBox does the ugly work — identifies the company, finds your booking details in your email, navigates the phone tree, and waits on hold. When a human picks up, you get a briefing card with everything the agent will ask for, already assembled.

**Butterbase + Neo4j + RocketRide pitch:** BlackBox is an agentic product with three services that each earn their spot. Butterbase runs the runtime — AI, storage, database, RAG. Neo4j runs the memory — the user's fragmented identity, reassembled as a graph. RocketRide runs the ingestion — the extraction pipeline that turns raw email into structured entities. None is decorative. The demo shows all three doing load-bearing work in real time.

---

## 20. Open Questions

- Should the briefing card be editable by the user before handoff, or read-only for MVP?
- How much of the recorded IVR should the AI genuinely navigate (branching) vs. follow a fixed path?
- Post-hackathon: is the primary distribution a mobile app, a browser extension, or an SMS bot? These are meaningfully different products.
- What's the second demo scenario worth building for post-hackathon? Cable/internet outage feels like the strongest analog — same pattern of fragmented identity and hostile IVR.
