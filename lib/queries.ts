import { supabase } from './supabase';
import { getCurrentLocation } from './location';

export interface Query {
  id: string;
  asker_id: string;
  question: string;
  status: 'open' | 'answered' | 'expired';
  budget_usdc: number;
  answer: string | null;
  responder_id: string | null;
  response_time_ms: number | null;
  rating: string | null;
  created_at: string;
  expires_at: string;
}

export interface NearbyResponder {
  user_id: string;
  wallet_address: string;
  push_token: string;
  reputation_score: number;
  distance_m: number;
}

/**
 * Ask a question — finds nearby live responders and notifies them
 */
export async function askQuestion(
  askerId: string,
  question: string,
  lat: number,
  lng: number,
  budgetUsdc: number = 0.05
): Promise<{ query?: Query; responders?: number; error?: string }> {
  // 1. Find live responders nearby
  const { data: responders, error: findError } = await supabase.rpc(
    'find_live_responders',
    { p_lng: lng, p_lat: lat, p_radius_m: 300 }
  );

  if (findError) {
    return { error: `Could not find responders: ${findError.message}` };
  }

  console.log(`[Query] Searching at lat=${lat}, lng=${lng}, radius=1000m`);
  console.log('[Query] Found responders:', JSON.stringify(responders));

  // 2. Always create the query — even if no one is nearby right now
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min expiry (longer so someone can find it later)

  const { data: query, error: insertError } = await supabase.rpc('create_query', {
    p_asker_id: askerId,
    p_question: question,
    p_lng: lng,
    p_lat: lat,
    p_budget_usdc: budgetUsdc,
    p_expires_at: expiresAt,
  });

  if (insertError) {
    return { error: `Could not create query: ${insertError.message}` };
  }

  const responderList = (responders || []) as NearbyResponder[];

  // 3. Send push notifications if anyone is nearby
  let notifiedCount = 0;
  if (responderList.length > 0) {
    notifiedCount = await notifyResponders(
      responderList,
      query as string,
      question,
      budgetUsdc
    );
  }

  console.log(`[Query] Created query ${query}, found ${responderList.length} responders, notified ${notifiedCount}`);

  return {
    query: { id: query, question, status: 'open', asker_id: askerId, budget_usdc: budgetUsdc, answer: null, responder_id: null, response_time_ms: null, rating: null, created_at: new Date().toISOString(), expires_at: expiresAt },
    responders: responderList.length,
  };
}

/**
 * Send push notifications to nearby responders via Expo push service
 */
async function notifyResponders(
  responders: NearbyResponder[],
  queryId: string,
  question: string,
  budget: number
): Promise<number> {
  const messages = responders
    .filter((r) => r.push_token)
    .map((r) => ({
      to: r.push_token,
      title: `💰 Quick $${budget.toFixed(2)}`,
      body: question.length > 80 ? question.slice(0, 77) + '...' : question,
      data: { queryId, type: 'query' },
      sound: 'default' as const,
      priority: 'high' as const,
    }));

  if (messages.length === 0) return 0;

  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      console.error('[Push] Failed:', await res.text());
      return 0;
    }

    const result = await res.json();
    console.log(`[Push] Sent to ${messages.length} responders, response:`, JSON.stringify(result));
    return messages.length;
  } catch (err) {
    console.error('[Push] Error:', err);
    return 0;
  }
}

/**
 * Submit an answer to a query (first-responder-wins)
 */
export async function answerQuery(
  queryId: string,
  responderId: string,
  answer: string
): Promise<{ success: boolean; error?: string }> {
  // Check if query is still open
  const { data: query, error: fetchError } = await supabase
    .from('queries')
    .select('status, created_at')
    .eq('id', queryId)
    .single();

  if (fetchError || !query) {
    return { success: false, error: 'Query not found' };
  }

  if (query.status !== 'open') {
    return { success: false, error: 'Someone already answered this one' };
  }

  // Calculate response time
  const responseTimeMs = Date.now() - new Date(query.created_at).getTime();

  // Update query with answer (first-responder-wins via status check)
  const { error: updateError } = await supabase
    .from('queries')
    .update({
      answer,
      responder_id: responderId,
      status: 'answered',
      response_time_ms: responseTimeMs,
    })
    .eq('id', queryId)
    .eq('status', 'open'); // Only update if still open — prevents race conditions

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  // Payment happens when the ASKER's app gets the answer
  // (the asker's wallet signs the tx, not the responder's)
  // This is triggered from the Ask tab when polling detects an answer

  // Update responder stats (even if payment fails)
  await supabase.rpc('increment_responder_stats', { p_user_id: responderId });

  return { success: true };
}

/**
 * Rate an answer
 */
export async function rateAnswer(
  queryId: string,
  rating: 'helpful' | 'not_helpful'
): Promise<void> {
  const { data: query } = await supabase
    .from('queries')
    .select('responder_id')
    .eq('id', queryId)
    .single();

  // Update query rating
  await supabase
    .from('queries')
    .update({ rating })
    .eq('id', queryId);

  // Update responder reputation
  if (query?.responder_id) {
    await supabase.rpc('update_reputation', {
      p_user_id: query.responder_id,
      p_rating: rating,
    });
  }
}

/**
 * Poll for answer on a query
 */
export async function pollQuery(queryId: string): Promise<Query | null> {
  const { data } = await supabase
    .from('queries')
    .select('*')
    .eq('id', queryId)
    .single();

  return data;
}
