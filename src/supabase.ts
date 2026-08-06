import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://znmquzzdzkprwqngqssh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_eFn8MqSWi1C2a7eNmPec8g_1FjAyy3T";

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Salva um payload (SDP Offer ou Answer) atrelado a um código curto.
 * Usa a coluna 'offer' como um campo genérico de texto longo (KV Store).
 */
export async function savePayload(id: string, payload: string): Promise<void> {
  const { error } = await supabase.from('sessoes').insert([{ id, offer: payload }]);
  if (error) {
    console.warn('Erro ao inserir payload no Supabase (tentando upsert):', error.message);
    await supabase.from('sessoes').upsert([{ id, offer: payload }]);
  }
}

/**
 * Busca o payload (SDP) atrelado a um código curto e o DELETA imediatamente.
 * Retorna null se não encontrar.
 */
export async function fetchAndDeletePayload(id: string): Promise<string | null> {
  // Busca o registro
  const { data, error } = await supabase.from('sessoes').select('offer').eq('id', id).single();
  
  if (error || !data || !data.offer) {
    return null;
  }

  const payload = data.offer;

  // Deleta IMEDIATAMENTE para não deixar rastros (Ponte Cega)
  try {
    await supabase.from('sessoes').delete().eq('id', id);
  } catch (e) {
    console.warn('Erro ao auto-destruir registro de payload:', e);
  }

  return payload;
}

/**
 * Deleta imediatamente a linha da sessão no Supabase para destruir metadados
 */
export async function deleteSessionRecord(sessionId: string): Promise<void> {
  try {
    await supabase.from('sessoes').delete().eq('id', sessionId);
  } catch (e) {
    console.warn('Erro ao auto-destruir registro de sessão:', e);
  }
}

/**
 * Limpeza preventiva de payloads antigos (TTL de 10 minutos)
 */
export async function cleanupStaleSessions(): Promise<void> {
  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await supabase.from('sessoes').delete().lt('created_at', tenMinutesAgo);
  } catch (e) {
    // Ignora silenciosamente
  }
}
