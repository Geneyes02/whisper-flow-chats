/** Server boundaries for native encrypted attachments.
 *
 * The server learns conversation membership, a random object path, and
 * ciphertext size. It never receives filename, MIME type, attachment key,
 * nonce, caption, or plaintext bytes.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const ConversationId = z.string().uuid();

async function requireConversationMember(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Not a conversation member");
}

export const createNativeEncryptedAttachmentUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        conversationId: ConversationId,
        ciphertextSize: z
          .number()
          .int()
          .positive()
          .max(100 * 1024 * 1024),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireConversationMember(context.supabase, data.conversationId, context.userId);
    const storagePath = `${data.conversationId}/${crypto.randomUUID()}.bin`;
    const { data: signed, error } = await context.supabase.storage
      .from("chat-media")
      .createSignedUploadUrl(storagePath);
    if (error || !signed)
      throw new Error(error?.message ?? "Could not create encrypted upload URL");
    return {
      storagePath,
      token: signed.token,
      // Kept for clients that prefer fetch; uploadToSignedUrl should use token.
      signedUrl: signed.signedUrl,
    };
  });

export const signNativeEncryptedAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        conversationId: ConversationId,
        storagePath: z.string().min(1).max(1024),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireConversationMember(context.supabase, data.conversationId, context.userId);
    const expectedPrefix = `${data.conversationId}/`;
    if (!data.storagePath.startsWith(expectedPrefix) || !data.storagePath.endsWith(".bin")) {
      throw new Error("Encrypted attachment path does not belong to this conversation");
    }
    const { data: signed, error } = await context.supabase.storage
      .from("chat-media")
      .createSignedUrl(data.storagePath, 60);
    if (error || !signed) throw new Error(error?.message ?? "Could not sign encrypted attachment");
    return { signedUrl: signed.signedUrl };
  });
