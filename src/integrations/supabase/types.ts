export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_private: {
        Row: {
          created_at: string
          deleted_at: string | null
          locale: string | null
          marketing_opt_in: boolean
          notification_preferences: Json
          onboarding_completed_at: string | null
          phone_number: string | null
          privacy_preferences: Json
          recovery_email: string | null
          status: Database["public"]["Enums"]["account_status"]
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          locale?: string | null
          marketing_opt_in?: boolean
          notification_preferences?: Json
          onboarding_completed_at?: string | null
          phone_number?: string | null
          privacy_preferences?: Json
          recovery_email?: string | null
          status?: Database["public"]["Enums"]["account_status"]
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          locale?: string | null
          marketing_opt_in?: boolean
          notification_preferences?: Json
          onboarding_completed_at?: string | null
          phone_number?: string | null
          privacy_preferences?: Json
          recovery_email?: string | null
          status?: Database["public"]["Enums"]["account_status"]
          timezone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          ip_hash: string | null
          metadata: Json
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_hash?: string | null
          metadata?: Json
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_hash?: string | null
          metadata?: Json
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
          reason: string | null
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
          reason?: string | null
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
          reason?: string | null
        }
        Relationships: []
      }
      channels: {
        Row: {
          allowed_role_ids: string[]
          community_id: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          is_private: boolean
          kind: Database["public"]["Enums"]["channel_kind"]
          name: string
          position: number
          slug: string
          updated_at: string
        }
        Insert: {
          allowed_role_ids?: string[]
          community_id: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_private?: boolean
          kind?: Database["public"]["Enums"]["channel_kind"]
          name: string
          position?: number
          slug: string
          updated_at?: string
        }
        Update: {
          allowed_role_ids?: string[]
          community_id?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_private?: boolean
          kind?: Database["public"]["Enums"]["channel_kind"]
          name?: string
          position?: number
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channels_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      communities: {
        Row: {
          avatar_url: string | null
          banner_url: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          member_count: number
          name: string
          slug: string | null
          updated_at: string
          visibility: Database["public"]["Enums"]["community_visibility"]
        }
        Insert: {
          avatar_url?: string | null
          banner_url?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          member_count?: number
          name: string
          slug?: string | null
          updated_at?: string
          visibility?: Database["public"]["Enums"]["community_visibility"]
        }
        Update: {
          avatar_url?: string | null
          banner_url?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          member_count?: number
          name?: string
          slug?: string | null
          updated_at?: string
          visibility?: Database["public"]["Enums"]["community_visibility"]
        }
        Relationships: []
      }
      community_members: {
        Row: {
          banned_at: string | null
          community_id: string
          created_at: string
          id: string
          is_owner: boolean
          joined_at: string
          left_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          banned_at?: string | null
          community_id: string
          created_at?: string
          id?: string
          is_owner?: boolean
          joined_at?: string
          left_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          banned_at?: string | null
          community_id?: string
          created_at?: string
          id?: string
          is_owner?: boolean
          joined_at?: string
          left_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_members_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
        ]
      }
      community_role_assignments: {
        Row: {
          assigned_at: string
          community_id: string
          id: string
          role_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          community_id: string
          id?: string
          role_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          community_id?: string
          id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_role_assignments_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_role_assignments_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "community_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      community_roles: {
        Row: {
          color: string | null
          community_id: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          permissions: Json
          position: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          community_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          permissions?: Json
          position?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          community_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          permissions?: Json
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_roles_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          contact_user_id: string
          created_at: string
          id: string
          is_favorite: boolean
          nickname: string | null
          owner_id: string
          updated_at: string
        }
        Insert: {
          contact_user_id: string
          created_at?: string
          id?: string
          is_favorite?: boolean
          nickname?: string | null
          owner_id: string
          updated_at?: string
        }
        Update: {
          contact_user_id?: string
          created_at?: string
          id?: string
          is_favorite?: boolean
          nickname?: string | null
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversation_invites: {
        Row: {
          code: string
          conversation_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          max_uses: number | null
          revoked_at: string | null
          uses: number
        }
        Insert: {
          code: string
          conversation_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          revoked_at?: string | null
          uses?: number
        }
        Update: {
          code?: string
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          revoked_at?: string | null
          uses?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversation_invites_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_members: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          is_archived: boolean
          is_favorite: boolean
          is_pinned: boolean
          joined_at: string
          last_read_message_id: string | null
          left_at: string | null
          muted_until: string | null
          notification_level: string
          role: Database["public"]["Enums"]["conversation_member_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          is_archived?: boolean
          is_favorite?: boolean
          is_pinned?: boolean
          joined_at?: string
          last_read_message_id?: string | null
          left_at?: string | null
          muted_until?: string | null
          notification_level?: string
          role?: Database["public"]["Enums"]["conversation_member_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          is_archived?: boolean
          is_favorite?: boolean
          is_pinned?: boolean
          joined_at?: string
          last_read_message_id?: string | null
          left_at?: string | null
          muted_until?: string | null
          notification_level?: string
          role?: Database["public"]["Enums"]["conversation_member_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          avatar_url: string | null
          community_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          disappearing_seconds: number | null
          id: string
          last_message_at: string | null
          title: string | null
          type: Database["public"]["Enums"]["conversation_type"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          community_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          disappearing_seconds?: number | null
          id?: string
          last_message_at?: string | null
          title?: string | null
          type: Database["public"]["Enums"]["conversation_type"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          community_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          disappearing_seconds?: number | null
          id?: string
          last_message_at?: string | null
          title?: string | null
          type?: Database["public"]["Enums"]["conversation_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          created_at: string
          crypto_version: number
          device_public_id: string | null
          fingerprint: string | null
          id: string
          identity_key_signature: string | null
          key_algorithm: string | null
          key_version: number
          last_active_at: string | null
          last_prekey_upload_at: string | null
          local_key_wrap_algo: string | null
          name: string
          platform: Database["public"]["Enums"]["device_platform"]
          public_ed25519_key: string | null
          public_identity_key: string | null
          public_signed_prekey: string | null
          registered_at: string
          revoked_at: string | null
          signed_prekey_signature: string | null
          status: Database["public"]["Enums"]["device_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          crypto_version?: number
          device_public_id?: string | null
          fingerprint?: string | null
          id?: string
          identity_key_signature?: string | null
          key_algorithm?: string | null
          key_version?: number
          last_active_at?: string | null
          last_prekey_upload_at?: string | null
          local_key_wrap_algo?: string | null
          name: string
          platform: Database["public"]["Enums"]["device_platform"]
          public_ed25519_key?: string | null
          public_identity_key?: string | null
          public_signed_prekey?: string | null
          registered_at?: string
          revoked_at?: string | null
          signed_prekey_signature?: string | null
          status?: Database["public"]["Enums"]["device_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          crypto_version?: number
          device_public_id?: string | null
          fingerprint?: string | null
          id?: string
          identity_key_signature?: string | null
          key_algorithm?: string | null
          key_version?: number
          last_active_at?: string | null
          last_prekey_upload_at?: string | null
          local_key_wrap_algo?: string | null
          name?: string
          platform?: Database["public"]["Enums"]["device_platform"]
          public_ed25519_key?: string | null
          public_identity_key?: string | null
          public_signed_prekey?: string | null
          registered_at?: string
          revoked_at?: string | null
          signed_prekey_signature?: string | null
          status?: Database["public"]["Enums"]["device_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      identity_change_events: {
        Row: {
          created_at: string
          device_id: string
          id: string
          new_public_identity_key: string
          previous_public_identity_key: string | null
          reason: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          new_public_identity_key: string
          previous_public_identity_key?: string | null
          reason?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          new_public_identity_key?: string
          previous_public_identity_key?: string | null
          reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_change_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      message_attachments: {
        Row: {
          created_at: string
          duration_seconds: number | null
          encrypted_metadata: string | null
          encrypted_metadata_nonce: string | null
          encryption_algorithm: string | null
          encryption_key_ref: string | null
          height: number | null
          id: string
          message_id: string
          mime_hint: string | null
          size_bytes: number | null
          storage_bucket: string
          storage_path: string
          width: number | null
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          encrypted_metadata?: string | null
          encrypted_metadata_nonce?: string | null
          encryption_algorithm?: string | null
          encryption_key_ref?: string | null
          height?: number | null
          id?: string
          message_id: string
          mime_hint?: string | null
          size_bytes?: number | null
          storage_bucket?: string
          storage_path: string
          width?: number | null
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          encrypted_metadata?: string | null
          encrypted_metadata_nonce?: string | null
          encryption_algorithm?: string | null
          encryption_key_ref?: string | null
          height?: number | null
          id?: string
          message_id?: string
          mime_hint?: string | null
          size_bytes?: number | null
          storage_bucket?: string
          storage_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_envelopes: {
        Row: {
          ciphertext: string
          ciphertext_algorithm: string | null
          ciphertext_nonce: string | null
          ciphertext_version: number
          created_at: string
          delivered_at: string | null
          id: string
          message_id: string
          recipient_device_id: string
          recipient_user_id: string
        }
        Insert: {
          ciphertext: string
          ciphertext_algorithm?: string | null
          ciphertext_nonce?: string | null
          ciphertext_version?: number
          created_at?: string
          delivered_at?: string | null
          id?: string
          message_id: string
          recipient_device_id: string
          recipient_user_id: string
        }
        Update: {
          ciphertext?: string
          ciphertext_algorithm?: string | null
          ciphertext_nonce?: string | null
          ciphertext_version?: number
          created_at?: string
          delivered_at?: string | null
          id?: string
          message_id?: string
          recipient_device_id?: string
          recipient_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_envelopes_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_envelopes_recipient_device_id_fkey"
            columns: ["recipient_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_receipts: {
        Row: {
          delivered_at: string | null
          id: string
          message_id: string
          read_at: string | null
          state: Database["public"]["Enums"]["delivery_state"]
          updated_at: string
          user_id: string
        }
        Insert: {
          delivered_at?: string | null
          id?: string
          message_id: string
          read_at?: string | null
          state?: Database["public"]["Enums"]["delivery_state"]
          updated_at?: string
          user_id: string
        }
        Update: {
          delivered_at?: string | null
          id?: string
          message_id?: string
          read_at?: string | null
          state?: Database["public"]["Enums"]["delivery_state"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_receipts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          ciphertext: string | null
          ciphertext_algorithm: string | null
          ciphertext_nonce: string | null
          ciphertext_version: number
          content_type: Database["public"]["Enums"]["message_content_type"]
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          expires_at: string | null
          forwarded_from_conversation_id: string | null
          forwarded_from_message_id: string | null
          has_attachments: boolean
          id: string
          is_pinned: boolean
          mention_user_ids: string[]
          reply_to_message_id: string | null
          scheduled_for: string | null
          sender_device_id: string | null
          sender_id: string | null
          status: Database["public"]["Enums"]["message_status"]
          thread_root_id: string | null
          updated_at: string
        }
        Insert: {
          ciphertext?: string | null
          ciphertext_algorithm?: string | null
          ciphertext_nonce?: string | null
          ciphertext_version?: number
          content_type?: Database["public"]["Enums"]["message_content_type"]
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          expires_at?: string | null
          forwarded_from_conversation_id?: string | null
          forwarded_from_message_id?: string | null
          has_attachments?: boolean
          id?: string
          is_pinned?: boolean
          mention_user_ids?: string[]
          reply_to_message_id?: string | null
          scheduled_for?: string | null
          sender_device_id?: string | null
          sender_id?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          thread_root_id?: string | null
          updated_at?: string
        }
        Update: {
          ciphertext?: string | null
          ciphertext_algorithm?: string | null
          ciphertext_nonce?: string | null
          ciphertext_version?: number
          content_type?: Database["public"]["Enums"]["message_content_type"]
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          expires_at?: string | null
          forwarded_from_conversation_id?: string | null
          forwarded_from_message_id?: string | null
          has_attachments?: boolean
          id?: string
          is_pinned?: boolean
          mention_user_ids?: string[]
          reply_to_message_id?: string | null
          scheduled_for?: string | null
          sender_device_id?: string | null
          sender_id?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          thread_root_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_forwarded_from_conversation_id_fkey"
            columns: ["forwarded_from_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_forwarded_from_message_id_fkey"
            columns: ["forwarded_from_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_device_id_fkey"
            columns: ["sender_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_thread_root_id_fkey"
            columns: ["thread_root_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      one_time_prekeys: {
        Row: {
          algorithm: string
          created_at: string
          device_id: string
          id: string
          key_id: number
          public_key: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          algorithm?: string
          created_at?: string
          device_id: string
          id?: string
          key_id: number
          public_key: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          algorithm?: string
          created_at?: string
          device_id?: string
          id?: string
          key_id?: number
          public_key?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "one_time_prekeys_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          banner_url: string | null
          bio: string | null
          created_at: string
          deleted_at: string | null
          discoverable: boolean
          display_name: string | null
          id: string
          is_bot: boolean
          is_verified: boolean
          last_seen_at: string | null
          status_emoji: string | null
          status_text: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          banner_url?: string | null
          bio?: string | null
          created_at?: string
          deleted_at?: string | null
          discoverable?: boolean
          display_name?: string | null
          id: string
          is_bot?: boolean
          is_verified?: boolean
          last_seen_at?: string | null
          status_emoji?: string | null
          status_text?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          banner_url?: string | null
          bio?: string | null
          created_at?: string
          deleted_at?: string | null
          discoverable?: boolean
          display_name?: string | null
          id?: string
          is_bot?: boolean
          is_verified?: boolean
          last_seen_at?: string | null
          status_emoji?: string | null
          status_text?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          reason: string
          reporter_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["report_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["report_target"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reporter_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["report_target"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reporter_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_id?: string
          target_type?: Database["public"]["Enums"]["report_target"]
          updated_at?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          created_at: string
          device_id: string
          id: string
          ip_hash: string | null
          last_seen_at: string
          location_hint: string | null
          revoked_at: string | null
          started_at: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          ip_hash?: string | null
          last_seen_at?: string
          location_hint?: string | null
          revoked_at?: string | null
          started_at?: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          ip_hash?: string | null
          last_seen_at?: string
          location_hint?: string | null
          revoked_at?: string | null
          started_at?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          granted_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          granted_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          granted_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      usernames: {
        Row: {
          released_at: string | null
          reserved_at: string
          user_id: string
          username: string
        }
        Insert: {
          released_at?: string | null
          reserved_at?: string
          user_id: string
          username: string
        }
        Update: {
          released_at?: string | null
          reserved_at?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_prekey_bundle: {
        Args: { target_user: string }
        Returns: {
          crypto_version: number
          device_id: string
          identity_key_signature: string
          key_algorithm: string
          key_version: number
          one_time_prekey: string
          one_time_prekey_id: string
          one_time_prekey_key_id: number
          public_ed25519_key: string
          public_identity_key: string
          public_signed_prekey: string
          signed_prekey_signature: string
          user_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_community_member: {
        Args: { _community_id: string; _user_id: string }
        Returns: boolean
      }
      is_conversation_member: {
        Args: { _conversation_id: string; _user_id: string }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      account_status: "active" | "suspended" | "deactivated" | "deleted"
      app_role: "user" | "support" | "moderator" | "admin"
      channel_kind: "text" | "voice" | "announcement"
      community_visibility: "public" | "private" | "invite_only"
      conversation_member_role: "owner" | "admin" | "moderator" | "member"
      conversation_type: "direct" | "group" | "channel"
      delivery_state: "pending" | "delivered" | "read" | "failed"
      device_platform: "ios" | "android" | "macos" | "windows" | "linux" | "web"
      device_status: "pending" | "active" | "inactive" | "revoked"
      message_content_type:
        | "text"
        | "image"
        | "video"
        | "audio"
        | "voice"
        | "file"
        | "contact"
        | "location"
        | "sticker"
        | "gif"
        | "poll"
        | "system"
      message_status:
        | "pending"
        | "sent"
        | "delivered"
        | "failed"
        | "edited"
        | "deleted"
      report_status: "open" | "reviewing" | "resolved" | "dismissed"
      report_target:
        | "user"
        | "message"
        | "conversation"
        | "community"
        | "channel"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_status: ["active", "suspended", "deactivated", "deleted"],
      app_role: ["user", "support", "moderator", "admin"],
      channel_kind: ["text", "voice", "announcement"],
      community_visibility: ["public", "private", "invite_only"],
      conversation_member_role: ["owner", "admin", "moderator", "member"],
      conversation_type: ["direct", "group", "channel"],
      delivery_state: ["pending", "delivered", "read", "failed"],
      device_platform: ["ios", "android", "macos", "windows", "linux", "web"],
      device_status: ["pending", "active", "inactive", "revoked"],
      message_content_type: [
        "text",
        "image",
        "video",
        "audio",
        "voice",
        "file",
        "contact",
        "location",
        "sticker",
        "gif",
        "poll",
        "system",
      ],
      message_status: [
        "pending",
        "sent",
        "delivered",
        "failed",
        "edited",
        "deleted",
      ],
      report_status: ["open", "reviewing", "resolved", "dismissed"],
      report_target: [
        "user",
        "message",
        "conversation",
        "community",
        "channel",
      ],
    },
  },
} as const
