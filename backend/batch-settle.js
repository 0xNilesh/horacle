import 'dotenv/config';

// Run this daily via cron or manually: node batch-settle.js
const API_URL = `http://localhost:${process.env.PORT || 3001}`;

async function run() {
  console.log('[Batch] Starting daily settlement...');

  const res = await fetch(`${API_URL}/api/batch-settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  const data = await res.json();
  console.log('[Batch] Result:', JSON.stringify(data, null, 2));

  if (data.success) {
    console.log(`[Batch] Settled ${data.settled} responders`);
  } else {
    console.error('[Batch] Failed:', data.error);
  }
}

run().catch(console.error);
