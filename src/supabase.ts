import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://znmquzzdzkprwqngqssh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_eFn8MqSWi1C2a7eNmPec8g_1FjAyy3T";

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface SessionData {
  id: string;
  offer?: string | null;
  answer?: string | null;
  created_at?: string;
}

/**
 * Receptor: cria uma nova sessão vazia na tabela "sessoes"
 */
export async function createReceiverSession(sessionId: string): Promise<void> {
  const { error } = await supabase.from('sessoes').insert([{ id: sessionId }]);
  if (error) {
    console.warn('Erro ao inserir sessão no Supabase (tentando upsert):', error.message);
    await supabase.from('sessoes').upsert([{ id: sessionId }]);
  }
}

/**
 * Transmissor: grava a oferta SDP (offer) na sessão correspondente
 */
export async function sendOfferToSession(sessionId: string, offerSdp: string): Promise<void> {
  const { data, error } = await supabase
    .from('sessoes')
    .update({ offer: offerSdp })
    .eq('id', sessionId)
    .select('id');
    
  if (error) {
    throw new Error('Falha ao enviar oferta para a sessão: ' + error.message);
  }

  if (!data || data.length === 0) {
    throw new Error('Sessão não encontrada. Verifique o código digitado no Receptor.');
  }
}

/**
 * Receptor: grava a resposta SDP (answer) na sessão correspondente
 */
export async function sendAnswerToSession(sessionId: string, answerSdp: string): Promise<void> {
  const { error } = await supabase
    .from('sessoes')
    .update({ answer: answerSdp })
    .eq('id', sessionId);

  if (error) {
    throw new Error('Falha ao enviar resposta para a sessão: ' + error.message);
  }
}

/**
 * Receptor: deleta imediatamente a linha da sessão no Supabase para destruir metadados
 */
export async function deleteSessionRecord(sessionId: string): Promise<void> {
  try {
    await supabase.from('sessoes').delete().eq('id', sessionId);
  } catch (e) {
    console.warn('Erro ao auto-destruir registro de sessão:', e);
  }
}
