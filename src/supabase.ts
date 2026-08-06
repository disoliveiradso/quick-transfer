import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://znmquzzdzkprwqngqssh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_eFn8MqSWi1C2a7eNmPec8g_1FjAyy3T";

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Salva um payload (SDP Offer ou Answer) atrelado a um código curto.
 * Usa UPSERT para garantir que o dado seja salvo mesmo se já existir um registro com o mesmo ID.
 * Lança exceção se falhar para que o chamador possa exibir um erro ao usuário.
 */
export async function savePayload(id: string, payload: string): Promise<void> {
  // Tenta DELETE primeiro para garantir registro limpo
  await supabase.from('sessoes').delete().eq('id', id);

  const { error } = await supabase.from('sessoes').insert([{ id, offer: payload }]);
  if (error) {
    // Fallback: tenta upsert caso o DELETE não tenha funcionado
    const { error: upsertError } = await supabase
      .from('sessoes')
      .upsert([{ id, offer: payload }], { onConflict: 'id' });

    if (upsertError) {
      throw new Error(
        `Falha ao salvar código de pareamento no servidor. Verifique sua conexão com a internet.\n\nDetalhes: ${upsertError.message}`
      );
    }
  }
}

/**
 * Busca o payload (SDP) atrelado a um código curto e o DELETA imediatamente.
 * Faz até `maxRetries` tentativas com intervalo de `retryDelayMs` ms entre elas.
 * Retorna null somente se o código não for encontrado após todas as tentativas.
 */
export async function fetchAndDeletePayload(
  id: string,
  maxRetries: number = 4,
  retryDelayMs: number = 1000
): Promise<string | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { data, error } = await supabase
      .from('sessoes')
      .select('offer')
      .eq('id', id)
      .maybeSingle();

    if (!error && data && data.offer) {
      const payload = data.offer as string;

      // Deleta IMEDIATAMENTE para não deixar rastros (Ponte Cega)
      try {
        await supabase.from('sessoes').delete().eq('id', id);
      } catch (e) {
        console.warn('Aviso: falha ao auto-destruir registro de payload:', e);
      }

      return payload;
    }

    // Erro de rede/Supabase (não apenas "não encontrado")
    if (error && error.code !== 'PGRST116') {
      console.warn(`[Supabase] Tentativa ${attempt}/${maxRetries} falhou:`, error.message);
    }

    // Aguarda antes de tentar novamente (exceto na última tentativa)
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }

  return null;
}

/**
 * Deleta imediatamente a linha da sessão no Supabase para destruir metadados.
 * Falha silenciosamente pois é uma operação de limpeza.
 */
export async function deleteSessionRecord(sessionId: string): Promise<void> {
  try {
    await supabase.from('sessoes').delete().eq('id', sessionId);
  } catch (e) {
    console.warn('Aviso: falha ao auto-destruir registro de sessão:', e);
  }
}

/**
 * Limpeza preventiva de payloads antigos (TTL de 10 minutos).
 */
export async function cleanupStaleSessions(): Promise<void> {
  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await supabase.from('sessoes').delete().lt('created_at', tenMinutesAgo);
  } catch (e) {
    // Ignora silenciosamente
  }
}
