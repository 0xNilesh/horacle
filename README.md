# Horacle — The Human Oracle

> Every human is an oracle. Your knowledge, your location, your eyes — monetized in real-time.

## What is Horacle?

**Horacle = Human + Oracle.** In a world of AI hallucinations and stale reviews, the most reliable source of truth is a verified human who's physically there.

Horacle turns every person into a real-time oracle. Go Live at any location, and you become the ground truth for that place. When someone asks "Is the beach crowded?" or "Did the food truck show up?" — you're the oracle. You answer in 10 seconds, you earn $0.05. The knowledge lives in you, not in a database.

**The internet has data oracles. Blockchains have price oracles. Horacle is the human oracle.**

No app answers "what's happening at a place right now." Google reviews are months old. ChatGPT guesses. Horacle connects you with verified humans — real oracles — who are at the location RIGHT NOW. Verified by World ID. Paid via Circle nanopayments. Gasless.

### How It Works

**For the Asker:**
1. Type a question: "Is the beach crowded right now?"
2. Pick a location (your GPS or search any place)
3. Horacle finds verified humans within 300m of that location
4. Someone replies in ~10 seconds
5. You pay $0.05 via Circle nanopayments (gasless)

**For the Earner:**
1. Tap "Start Earning" at any location
2. Background location tracking keeps you discoverable (even with app closed)
3. Get push notifications when someone asks nearby
4. Reply in 10 seconds, earn $0.05 instantly
5. $0.05 for 8 seconds of effort = $22.50/hr equivalent

## Tech Stack

| Layer | Tech | Purpose |
|-------|------|---------|
| Mobile App | React Native + Expo | Cross-platform native app |
| Identity | World ID 4.0 | Proof of unique human — prevents bots farming payments |
| Wallet | Dynamic SDK | Embedded wallet creation + transaction signing |
| Payments | Circle x402 Nanopayments | Gasless $0.05 micropayments on World Chain Sepolia |
| Location | expo-location | Background GPS tracking every 15 seconds |
| Geospatial | Supabase + PostGIS | Find live users within 300m via `ST_DWithin` |
| Push | Firebase + Expo Notifications | Notify nearby humans when a question is asked |
| Backend | Express + Node.js | x402-protected endpoints, payment settlement |

## Architecture

```
┌──────────────────────────────────────────────────┐
│            Expo React Native App                  │
│  ┌──────┐ ┌──────┐ ┌─────┐ ┌────────┐ ┌───────┐│
│  │ Earn │ │Inbox │ │ Ask │ │Activity│ │Profile││
│  └──────┘ └──────┘ └─────┘ └────────┘ └───────┘│
│  Background Location · Push Notifications        │
│  World ID (IDKit) · Dynamic Wallet · x402 Signer│
└───────────────────────┬──────────────────────────┘
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
   ┌────────────┐ ┌──────────┐ ┌──────────┐
   │ Supabase   │ │ Express  │ │ Circle   │
   │ + PostGIS  │ │ Backend  │ │ Gateway  │
   │            │ │ (x402)   │ │ (USDC)   │
   └────────────┘ └──────────┘ └──────────┘
```

## Key Flows

### World ID Verification
- Bridge protocol with AES-GCM encryption (pure JS via `@noble/ciphers`)
- Deep links to World App for biometric verification
- Proof verified via World's v4 API (`developer.world.org/api/v4/verify`)
- One unique human per account — prevents sybil farming

### Go Live + Background Location
- `expo-location` `startLocationUpdatesAsync()` tracks GPS every 15 seconds
- Works even when app is closed (Android foreground service)
- Location upserted to Supabase `user_locations` table
- PostGIS `ST_DWithin()` finds live users within radius

### Query + Payment Flow
```
Asker asks question
  → App signs EIP-712 payment (Dynamic wallet, gasless)
  → Sends to x402-protected backend endpoint
  → Circle Gateway settles payment
  → PostGIS finds nearby live users
  → Push notification sent via Firebase/Expo
  → First responder answers, earns $0.05
  → Asker sees answer with rating option
```

### Circle x402 Nanopayments
- Asker deposits USDC into Circle Gateway (one-time)
- Questions trigger EIP-3009 `TransferWithAuthorization` signature
- `GatewayWalletBatched` scheme on World Chain Sepolia
- Backend uses `createGatewayMiddleware` for x402 verification + settlement
- Responder earnings tracked in DB, batch settled daily

## Setup

### Prerequisites
- Node.js v20+
- Android phone with World App installed
- Expo account (for dev builds)

### Install
```bash
cd horacle
npm install

# Generate pool wallet for payments
npx tsx scripts/generate-wallets.ts
```

### Environment Variables

**App (`.env`):**
```
EXPO_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
EXPO_PUBLIC_APP_ID=app_xxx           # World Developer Portal
EXPO_PUBLIC_RP_ID=rp_xxx             # World ID 4.0
EXPO_PUBLIC_DYNAMIC_ENV_ID=xxx       # Dynamic dashboard
EXPO_PUBLIC_POOL_WALLET=0x...        # Pool wallet address
EXPO_PUBLIC_API_URL=http://IP:3001   # Backend URL
```

**Backend (`backend/.env`):**
```
POOL_PRIVATE_KEY=0x...               # Pool wallet private key
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
PORT=3001
```

### Database
Run `scripts/setup-db.sql` in Supabase SQL Editor to create all tables, PostGIS functions, and indexes.

### Run
```bash
# Terminal 1 — Backend
cd backend && node index.js

# Terminal 2 — App
npx expo start --dev-client
```

### Build APK
```bash
eas build --profile development --platform android
```

## Bounty Eligibility

| Track | Prize | Integration |
|-------|-------|------------|
| **World ID 4.0** | $8,000 | Every user verified via World ID — system breaks without it (bots farm payments). Proof validated on backend via v4 API. |
| **Circle Nanopayments** | $6,000 | $0.05 per answer via x402 on World Chain Sepolia. EIP-3009 signed by user's wallet, settled by Circle Gateway. Gasless. |
| **Dynamic Mobile** | $1,667 | Embedded wallet in React Native. Wallet creation, USDC transfers, EIP-712 signing, Gateway deposits. |

## Project Structure

```
horacle/
├── app/
│   ├── (auth)/verify.tsx      # World ID verification + wallet connection
│   ├── (tabs)/
│   │   ├── index.tsx          # Earn — Go Live, stats, location
│   │   ├── inbox.tsx          # Incoming questions to answer
│   │   ├── ask.tsx            # Ask questions with location search
│   │   ├── activity.tsx       # My Questions / My Answers
│   │   └── profile.tsx        # Wallet, balance, settings
│   ├── answer/[queryId].tsx   # Answer screen (from notification)
│   └── _layout.tsx            # Root layout, auth routing, Dynamic WebView
├── lib/
│   ├── worldid.ts             # World ID bridge protocol
│   ├── dynamic.ts             # Dynamic wallet client
│   ├── payment.ts             # x402 payment signing
│   ├── queries.ts             # Question CRUD + push notifications
│   ├── location.ts            # GPS tracking
│   ├── geocode.ts             # Place search + reverse geocode
│   ├── auth.ts                # User auth persistence
│   ├── supabase.ts            # Database client
│   └── wallet.ts              # Wallet management
├── tasks/
│   └── location-task.ts       # Background location → Supabase
├── backend/
│   ├── index.js               # Express + x402 middleware
│   └── batch-settle.js        # Daily responder payout cron
└── scripts/
    ├── setup-db.sql           # Full PostGIS schema
    └── generate-wallets.ts    # Pool wallet generator
```

---

*"The internet has data oracles. Blockchains have price oracles. We built the human oracle."*

## Built at ETHGlobal Cannes 2026
