// Archivo generado por la CLI de Supabase a partir de supabase/migrations: no editar a mano.
// Para regenerarlo (con `npx supabase start` corriendo):
//   npx supabase gen types typescript --local > packages/shared/src/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      analysis_signals: {
        Row: {
          analysis_id: string
          detected: boolean
          evidence: string | null
          points: number
          signal: Database["public"]["Enums"]["signal_key"]
        }
        Insert: {
          analysis_id: string
          detected: boolean
          evidence?: string | null
          points?: number
          signal: Database["public"]["Enums"]["signal_key"]
        }
        Update: {
          analysis_id?: string
          detected?: boolean
          evidence?: string | null
          points?: number
          signal?: Database["public"]["Enums"]["signal_key"]
        }
        Relationships: [
          {
            foreignKeyName: "analysis_signals_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "prospect_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      api_tokens: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          instagram_account_id: string
          kind: Database["public"]["Enums"]["token_kind"]
          last_used_at: string | null
          name: string
          owner_id: string
          revoked_at: string | null
          token_hash: string
          token_prefix: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          instagram_account_id: string
          kind: Database["public"]["Enums"]["token_kind"]
          last_used_at?: string | null
          name: string
          owner_id: string
          revoked_at?: string | null
          token_hash: string
          token_prefix: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          instagram_account_id?: string
          kind?: Database["public"]["Enums"]["token_kind"]
          last_used_at?: string | null
          name?: string
          owner_id?: string
          revoked_at?: string | null
          token_hash?: string
          token_prefix?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_tokens_instagram_account_fkey"
            columns: ["instagram_account_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "api_tokens_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          message_context: string | null
          name: string
          owner_id: string
          starts_at: string | null
          ticket_price: number | null
          updated_at: string
          venue: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          message_context?: string | null
          name: string
          owner_id: string
          starts_at?: string | null
          ticket_price?: number | null
          updated_at?: string
          venue?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          message_context?: string | null
          name?: string
          owner_id?: string
          starts_at?: string | null
          ticket_price?: number | null
          updated_at?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_scan_chunks: {
        Row: {
          chunk_index: number
          received_at: string
          row_count: number
          scan_id: string
        }
        Insert: {
          chunk_index: number
          received_at?: string
          row_count: number
          scan_id: string
        }
        Update: {
          chunk_index?: number
          received_at?: string
          row_count?: number
          scan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_scan_chunks_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "follow_scans"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_scans: {
        Row: {
          chunks_expected: number
          chunks_received: number
          finished_at: string | null
          followers_count: number
          following_count: number
          id: string
          instagram_account_id: string
          non_followers_count: number
          owner_id: string
          started_at: string
          status: Database["public"]["Enums"]["scan_status"]
        }
        Insert: {
          chunks_expected: number
          chunks_received?: number
          finished_at?: string | null
          followers_count?: number
          following_count?: number
          id?: string
          instagram_account_id: string
          non_followers_count?: number
          owner_id: string
          started_at?: string
          status?: Database["public"]["Enums"]["scan_status"]
        }
        Update: {
          chunks_expected?: number
          chunks_received?: number
          finished_at?: string | null
          followers_count?: number
          following_count?: number
          id?: string
          instagram_account_id?: string
          non_followers_count?: number
          owner_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["scan_status"]
        }
        Relationships: [
          {
            foreignKeyName: "follow_scans_instagram_account_fkey"
            columns: ["instagram_account_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "follow_scans_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      followed_accounts: {
        Row: {
          created_at: string
          follows_back: boolean
          full_name: string | null
          id: string
          ig_user_id: string
          instagram_account_id: string
          is_private: boolean
          is_protected: boolean
          is_verified: boolean
          last_post_at: string | null
          last_post_checked_at: string | null
          last_seen_scan_id: string | null
          owner_id: string
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          follows_back: boolean
          full_name?: string | null
          id?: string
          ig_user_id: string
          instagram_account_id: string
          is_private?: boolean
          is_protected?: boolean
          is_verified?: boolean
          last_post_at?: string | null
          last_post_checked_at?: string | null
          last_seen_scan_id?: string | null
          owner_id: string
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          follows_back?: boolean
          full_name?: string | null
          id?: string
          ig_user_id?: string
          instagram_account_id?: string
          is_private?: boolean
          is_protected?: boolean
          is_verified?: boolean
          last_post_at?: string | null
          last_post_checked_at?: string | null
          last_seen_scan_id?: string | null
          owner_id?: string
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "followed_accounts_instagram_account_fkey"
            columns: ["instagram_account_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "followed_accounts_last_seen_scan_fkey"
            columns: ["last_seen_scan_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "follow_scans"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "followed_accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      icebreakers: {
        Row: {
          analysis_id: string | null
          batch: number
          body: string
          created_at: string
          event_id: string | null
          id: string
          owner_id: string
          position: number
          prospect_id: string
          used_at: string | null
        }
        Insert: {
          analysis_id?: string | null
          batch?: number
          body: string
          created_at?: string
          event_id?: string | null
          id?: string
          owner_id: string
          position?: number
          prospect_id: string
          used_at?: string | null
        }
        Update: {
          analysis_id?: string | null
          batch?: number
          body?: string
          created_at?: string
          event_id?: string | null
          id?: string
          owner_id?: string
          position?: number
          prospect_id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "icebreakers_analysis_fkey"
            columns: ["analysis_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "prospect_analyses"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "icebreakers_event_fkey"
            columns: ["event_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "icebreakers_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "icebreakers_prospect_fkey"
            columns: ["prospect_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      instagram_account_usage: {
        Row: {
          account_id: string
          day: string
          profiles_visited: number
          unfollows: number
        }
        Insert: {
          account_id: string
          day: string
          profiles_visited?: number
          unfollows?: number
        }
        Update: {
          account_id?: string
          day?: string
          profiles_visited?: number
          unfollows?: number
        }
        Relationships: [
          {
            foreignKeyName: "instagram_account_usage_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_accounts: {
        Row: {
          created_at: string
          daily_profile_limit: number
          id: string
          last_error: string | null
          last_heartbeat_at: string | null
          max_delay_seconds: number
          min_delay_seconds: number
          owner_id: string
          paused_until: string | null
          role: Database["public"]["Enums"]["ig_account_role"]
          status: Database["public"]["Enums"]["ig_account_status"]
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          daily_profile_limit?: number
          id?: string
          last_error?: string | null
          last_heartbeat_at?: string | null
          max_delay_seconds?: number
          min_delay_seconds?: number
          owner_id: string
          paused_until?: string | null
          role: Database["public"]["Enums"]["ig_account_role"]
          status?: Database["public"]["Enums"]["ig_account_status"]
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          daily_profile_limit?: number
          id?: string
          last_error?: string | null
          last_heartbeat_at?: string | null
          max_delay_seconds?: number
          min_delay_seconds?: number
          owner_id?: string
          paused_until?: string | null
          role?: Database["public"]["Enums"]["ig_account_role"]
          status?: Database["public"]["Enums"]["ig_account_status"]
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      interactions: {
        Row: {
          amount: number | null
          created_at: string
          event_id: string | null
          from_status: Database["public"]["Enums"]["prospect_status"]
          icebreaker_id: string | null
          id: string
          note: string | null
          occurred_at: string
          owner_id: string
          prospect_id: string
          to_status: Database["public"]["Enums"]["prospect_status"]
          type: Database["public"]["Enums"]["interaction_type"]
        }
        Insert: {
          amount?: number | null
          created_at?: string
          event_id?: string | null
          from_status: Database["public"]["Enums"]["prospect_status"]
          icebreaker_id?: string | null
          id?: string
          note?: string | null
          occurred_at?: string
          owner_id: string
          prospect_id: string
          to_status: Database["public"]["Enums"]["prospect_status"]
          type: Database["public"]["Enums"]["interaction_type"]
        }
        Update: {
          amount?: number | null
          created_at?: string
          event_id?: string | null
          from_status?: Database["public"]["Enums"]["prospect_status"]
          icebreaker_id?: string | null
          id?: string
          note?: string | null
          occurred_at?: string
          owner_id?: string
          prospect_id?: string
          to_status?: Database["public"]["Enums"]["prospect_status"]
          type?: Database["public"]["Enums"]["interaction_type"]
        }
        Relationships: [
          {
            foreignKeyName: "interactions_event_fkey"
            columns: ["event_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "interactions_icebreaker_fkey"
            columns: ["icebreaker_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "icebreakers"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "interactions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_prospect_fkey"
            columns: ["prospect_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      profile_snapshots: {
        Row: {
          biography: string | null
          followers_count: number | null
          following_count: number | null
          id: string
          is_private: boolean
          job_item_id: string | null
          media_paths: string[]
          mutual_followers_count: number | null
          owner_id: string
          posts: NonNullable<Json>
          prospect_id: string
          scraped_at: string
        }
        Insert: {
          biography?: string | null
          followers_count?: number | null
          following_count?: number | null
          id?: string
          is_private?: boolean
          job_item_id?: string | null
          media_paths?: string[]
          mutual_followers_count?: number | null
          owner_id: string
          posts?: NonNullable<Json>
          prospect_id: string
          scraped_at?: string
        }
        Update: {
          biography?: string | null
          followers_count?: number | null
          following_count?: number | null
          id?: string
          is_private?: boolean
          job_item_id?: string | null
          media_paths?: string[]
          mutual_followers_count?: number | null
          owner_id?: string
          posts?: NonNullable<Json>
          prospect_id?: string
          scraped_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_snapshots_job_item_fkey"
            columns: ["job_item_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "scrape_job_items"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "profile_snapshots_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_snapshots_prospect_fkey"
            columns: ["prospect_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          daily_analysis_limit: number
          display_name: string
          id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_analysis_limit?: number
          display_name: string
          id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_analysis_limit?: number
          display_name?: string
          id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      prospect_analyses: {
        Row: {
          created_at: string
          id: string
          input_tokens: number
          interests: string[]
          model: string
          output_tokens: number
          owner_id: string
          prospect_id: string
          score: number
          scoring_version: number
          snapshot_id: string | null
          summary: string
        }
        Insert: {
          created_at?: string
          id?: string
          input_tokens?: number
          interests?: string[]
          model: string
          output_tokens?: number
          owner_id: string
          prospect_id: string
          score: number
          scoring_version: number
          snapshot_id?: string | null
          summary?: string
        }
        Update: {
          created_at?: string
          id?: string
          input_tokens?: number
          interests?: string[]
          model?: string
          output_tokens?: number
          owner_id?: string
          prospect_id?: string
          score?: number
          scoring_version?: number
          snapshot_id?: string | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_analyses_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_analyses_prospect_fkey"
            columns: ["prospect_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "prospect_analyses_snapshot_fkey"
            columns: ["snapshot_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "profile_snapshots"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      prospects: {
        Row: {
          biography: string | null
          created_at: string
          current_score: number | null
          do_not_contact: boolean
          do_not_contact_reason: string | null
          followers_count: number | null
          following_count: number | null
          full_name: string | null
          id: string
          ig_user_id: string | null
          ig_username: string
          is_private: boolean
          last_contacted_at: string | null
          last_scraped_at: string | null
          latest_analysis_id: string | null
          mutual_followers_count: number | null
          notes: string | null
          owner_id: string
          status: Database["public"]["Enums"]["prospect_status"]
          updated_at: string
        }
        Insert: {
          biography?: string | null
          created_at?: string
          current_score?: number | null
          do_not_contact?: boolean
          do_not_contact_reason?: string | null
          followers_count?: number | null
          following_count?: number | null
          full_name?: string | null
          id?: string
          ig_user_id?: string | null
          ig_username: string
          is_private?: boolean
          last_contacted_at?: string | null
          last_scraped_at?: string | null
          latest_analysis_id?: string | null
          mutual_followers_count?: number | null
          notes?: string | null
          owner_id: string
          status?: Database["public"]["Enums"]["prospect_status"]
          updated_at?: string
        }
        Update: {
          biography?: string | null
          created_at?: string
          current_score?: number | null
          do_not_contact?: boolean
          do_not_contact_reason?: string | null
          followers_count?: number | null
          following_count?: number | null
          full_name?: string | null
          id?: string
          ig_user_id?: string | null
          ig_username?: string
          is_private?: boolean
          last_contacted_at?: string | null
          last_scraped_at?: string | null
          latest_analysis_id?: string | null
          mutual_followers_count?: number | null
          notes?: string | null
          owner_id?: string
          status?: Database["public"]["Enums"]["prospect_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospects_latest_analysis_fkey"
            columns: ["latest_analysis_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "prospect_analyses"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "prospects_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_settings: {
        Row: {
          cordoba_points: number
          created_at: string
          mutuals_points: number
          mutuals_threshold: number
          nightlife_points: number
          owner_id: string
          university_points: number
          updated_at: string
          version: number
        }
        Insert: {
          cordoba_points?: number
          created_at?: string
          mutuals_points?: number
          mutuals_threshold?: number
          nightlife_points?: number
          owner_id: string
          university_points?: number
          updated_at?: string
          version?: number
        }
        Update: {
          cordoba_points?: number
          created_at?: string
          mutuals_points?: number
          mutuals_threshold?: number
          nightlife_points?: number
          owner_id?: string
          university_points?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "scoring_settings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scrape_job_items: {
        Row: {
          analysis_attempts: number
          attempts: number
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          job_id: string
          locked_at: string | null
          locked_by: string | null
          next_attempt_at: string
          owner_id: string
          prospect_id: string | null
          snapshot_id: string | null
          status: Database["public"]["Enums"]["item_status"]
          updated_at: string
          username: string
        }
        Insert: {
          analysis_attempts?: number
          attempts?: number
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          job_id: string
          locked_at?: string | null
          locked_by?: string | null
          next_attempt_at?: string
          owner_id: string
          prospect_id?: string | null
          snapshot_id?: string | null
          status?: Database["public"]["Enums"]["item_status"]
          updated_at?: string
          username: string
        }
        Update: {
          analysis_attempts?: number
          attempts?: number
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          job_id?: string
          locked_at?: string | null
          locked_by?: string | null
          next_attempt_at?: string
          owner_id?: string
          prospect_id?: string | null
          snapshot_id?: string | null
          status?: Database["public"]["Enums"]["item_status"]
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "scrape_job_items_job_fkey"
            columns: ["job_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "scrape_jobs"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "scrape_job_items_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrape_job_items_prospect_fkey"
            columns: ["prospect_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "prospects"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "scrape_job_items_snapshot_fkey"
            columns: ["snapshot_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "profile_snapshots"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      scrape_jobs: {
        Row: {
          created_at: string
          done_items: number
          event_id: string | null
          failed_items: number
          finished_at: string | null
          id: string
          instagram_account_id: string
          owner_id: string
          reanalyze_after_days: number
          skipped_items: number
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          total_items: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          done_items?: number
          event_id?: string | null
          failed_items?: number
          finished_at?: string | null
          id?: string
          instagram_account_id: string
          owner_id: string
          reanalyze_after_days?: number
          skipped_items?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          total_items?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          done_items?: number
          event_id?: string | null
          failed_items?: number
          finished_at?: string | null
          id?: string
          instagram_account_id?: string
          owner_id?: string
          reanalyze_after_days?: number
          skipped_items?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          total_items?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scrape_jobs_event_fkey"
            columns: ["event_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "scrape_jobs_instagram_account_fkey"
            columns: ["instagram_account_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "scrape_jobs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      unfollow_actions: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          ig_user_id: string
          instagram_account_id: string
          owner_id: string
          result: Database["public"]["Enums"]["unfollow_result"]
          username: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          ig_user_id: string
          instagram_account_id: string
          owner_id: string
          result: Database["public"]["Enums"]["unfollow_result"]
          username: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          ig_user_id?: string
          instagram_account_id?: string
          owner_id?: string
          result?: Database["public"]["Enums"]["unfollow_result"]
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "unfollow_actions_instagram_account_fkey"
            columns: ["instagram_account_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "unfollow_actions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_follow_scan_chunk: {
        Args: { p_chunk_index: number; p_rows: Json; p_scan_id: string }
        Returns: Json
      }
      cancel_scrape_job: {
        Args: { p_job_id: string; p_owner_id: string }
        Returns: Json
      }
      claim_analysis_item: { Args: { p_worker_id: string }; Returns: Json }
      claim_scrape_item: {
        Args: { p_account_id: string; p_worker_id: string }
        Returns: Json
      }
      clear_snapshot_media: {
        Args: { p_snapshot_ids: string[] }
        Returns: Json
      }
      complete_analysis: {
        Args: { p_item_id: string; p_result: Json; p_worker_id: string }
        Returns: Json
      }
      complete_follow_scan: { Args: { p_scan_id: string }; Returns: Json }
      fail_analysis_item: {
        Args: {
          p_item_id: string
          p_message: string
          p_retryable: boolean
          p_worker_id: string
        }
        Returns: Json
      }
      fail_scrape_item: {
        Args: {
          p_code: string
          p_item_id: string
          p_message: string
          p_worker_id: string
        }
        Returns: Json
      }
      get_unfollow_limits: { Args: { p_account_id: string }; Returns: Json }
      is_valid_timezone: { Args: { p_tz: string }; Returns: boolean }
      list_stale_media: {
        Args: { p_limit?: number; p_older_than?: string }
        Returns: Json
      }
      local_day: { Args: { p_at?: string; p_tz: string }; Returns: string }
      local_day_start: {
        Args: { p_at?: string; p_tz: string }
        Returns: string
      }
      record_interaction: {
        Args: {
          p_amount?: number
          p_event_id?: string
          p_icebreaker_id?: string
          p_note?: string
          p_occurred_at?: string
          p_owner_id: string
          p_prospect_id: string
          p_type: Database["public"]["Enums"]["interaction_type"]
        }
        Returns: Json
      }
      record_scrape_result: {
        Args: {
          p_item_id: string
          p_media_paths: string[]
          p_profile: Json
          p_worker_id: string
        }
        Returns: Json
      }
      record_unfollow: {
        Args: {
          p_account_id: string
          p_detail?: string
          p_ig_user_id: string
          p_result: Database["public"]["Enums"]["unfollow_result"]
          p_username: string
        }
        Returns: Json
      }
      refresh_job_progress: { Args: { p_job_id: string }; Returns: undefined }
      release_stale_locks: { Args: { p_timeout?: string }; Returns: Json }
      start_follow_scan: {
        Args: {
          p_account_id: string
          p_chunks_expected: number
          p_followers_count: number
          p_following_count: number
          p_non_followers_count: number
        }
        Returns: Json
      }
    }
    Enums: {
      ig_account_role: "scraper" | "main"
      ig_account_status: "active" | "paused" | "needs_login" | "blocked"
      interaction_type:
        | "message_sent"
        | "seen_no_reply"
        | "replied"
        | "ticket_purchased"
        | "guest_list"
        | "discarded"
        | "note"
      item_status:
        | "queued"
        | "scraping"
        | "scraped"
        | "analyzing"
        | "done"
        | "skipped"
        | "failed"
      job_status: "queued" | "running" | "completed" | "cancelled"
      prospect_status:
        | "new"
        | "contacted"
        | "seen"
        | "replied"
        | "bought_ticket"
        | "guest_list"
        | "discarded"
      scan_status: "uploading" | "completed" | "failed"
      signal_key:
        | "cordoba"
        | "local_university"
        | "nightlife"
        | "mutual_followers"
        | "possible_minor"
      token_kind: "scraper" | "extension"
      unfollow_result:
        | "unfollowed"
        | "follows_back"
        | "already_unfollowed"
        | "failed"
        | "rate_limited"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      ig_account_role: ["scraper", "main"],
      ig_account_status: ["active", "paused", "needs_login", "blocked"],
      interaction_type: [
        "message_sent",
        "seen_no_reply",
        "replied",
        "ticket_purchased",
        "guest_list",
        "discarded",
        "note",
      ],
      item_status: [
        "queued",
        "scraping",
        "scraped",
        "analyzing",
        "done",
        "skipped",
        "failed",
      ],
      job_status: ["queued", "running", "completed", "cancelled"],
      prospect_status: [
        "new",
        "contacted",
        "seen",
        "replied",
        "bought_ticket",
        "guest_list",
        "discarded",
      ],
      scan_status: ["uploading", "completed", "failed"],
      signal_key: [
        "cordoba",
        "local_university",
        "nightlife",
        "mutual_followers",
        "possible_minor",
      ],
      token_kind: ["scraper", "extension"],
      unfollow_result: [
        "unfollowed",
        "follows_back",
        "already_unfollowed",
        "failed",
        "rate_limited",
      ],
    },
  },
} as const

