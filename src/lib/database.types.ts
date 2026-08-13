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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ai_conversations: {
        Row: {
          created_at: string
          id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_messages: {
        Row: {
          content: string | null
          conversation_id: string
          created_at: string
          id: number
          model: string | null
          provider: Database["public"]["Enums"]["ai_provider"] | null
          role: Database["public"]["Enums"]["ai_message_role"]
          tool_args: Json | null
          tool_name: string | null
          tool_result: Json | null
          user_id: string
        }
        Insert: {
          content?: string | null
          conversation_id: string
          created_at?: string
          id?: never
          model?: string | null
          provider?: Database["public"]["Enums"]["ai_provider"] | null
          role: Database["public"]["Enums"]["ai_message_role"]
          tool_args?: Json | null
          tool_name?: string | null
          tool_result?: Json | null
          user_id: string
        }
        Update: {
          content?: string | null
          conversation_id?: string
          created_at?: string
          id?: never
          model?: string | null
          provider?: Database["public"]["Enums"]["ai_provider"] | null
          role?: Database["public"]["Enums"]["ai_message_role"]
          tool_args?: Json | null
          tool_name?: string | null
          tool_result?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_reports: {
        Row: {
          content_md: string
          created_at: string
          created_by: string
          id: string
          model: string
          params: Json
          provider: Database["public"]["Enums"]["ai_provider"]
          report_month: string
          title: string
        }
        Insert: {
          content_md: string
          created_at?: string
          created_by: string
          id?: string
          model: string
          params?: Json
          provider: Database["public"]["Enums"]["ai_provider"]
          report_month: string
          title: string
        }
        Update: {
          content_md?: string
          created_at?: string
          created_by?: string
          id?: string
          model?: string
          params?: Json
          provider?: Database["public"]["Enums"]["ai_provider"]
          report_month?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage: {
        Row: {
          completion_tokens: number
          conversation_id: string | null
          created_at: string
          duration_ms: number | null
          est_cost_usd: number | null
          id: number
          model: string
          prompt_tokens: number
          provider: Database["public"]["Enums"]["ai_provider"]
          request_kind: Database["public"]["Enums"]["ai_request_kind"]
          status: string
          tool_call_count: number
          user_id: string
        }
        Insert: {
          completion_tokens?: number
          conversation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          est_cost_usd?: number | null
          id?: never
          model: string
          prompt_tokens?: number
          provider: Database["public"]["Enums"]["ai_provider"]
          request_kind: Database["public"]["Enums"]["ai_request_kind"]
          status?: string
          tool_call_count?: number
          user_id: string
        }
        Update: {
          completion_tokens?: number
          conversation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          est_cost_usd?: number | null
          id?: never
          model?: string
          prompt_tokens?: number
          provider?: Database["public"]["Enums"]["ai_provider"]
          request_kind?: Database["public"]["Enums"]["ai_request_kind"]
          status?: string
          tool_call_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          created_at: string
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          created_at?: string
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: Database["public"]["Enums"]["user_role"] | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: number
          ip: string | null
          metadata: Json
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: never
          ip?: string | null
          metadata?: Json
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: never
          ip?: string | null
          metadata?: Json
          user_agent?: string | null
        }
        Relationships: []
      }
      commission_schemes: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          model_id: string | null
          model_percent: number
          notes: string | null
          operator_percent: number
          platform_account_id: string | null
          studio_percent: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          model_id?: string | null
          model_percent: number
          notes?: string | null
          operator_percent: number
          platform_account_id?: string | null
          studio_percent: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          model_id?: string | null
          model_percent?: number
          notes?: string | null
          operator_percent?: number
          platform_account_id?: string | null
          studio_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "commission_schemes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_schemes_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_schemes_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_compliance_summary"
            referencedColumns: ["model_id"]
          },
          {
            foreignKeyName: "commission_schemes_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_schemes_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_my_model"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_schemes_platform_account_id_fkey"
            columns: ["platform_account_id"]
            isOneToOne: false
            referencedRelation: "platform_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_tiers: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          min_amount: number
          model_percent: number
          operator_percent: number
          scheme_id: string
          studio_percent: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          min_amount: number
          model_percent: number
          operator_percent: number
          scheme_id: string
          studio_percent: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          min_amount?: number
          model_percent?: number
          operator_percent?: number
          scheme_id?: string
          studio_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "commission_tiers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_tiers_scheme_id_fkey"
            columns: ["scheme_id"]
            isOneToOne: false
            referencedRelation: "commission_schemes"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_categories: {
        Row: {
          ai_enabled: boolean
          created_at: string
          description: string | null
          description_ru: string | null
          id: string
          name: string
          name_ru: string | null
          slug: string
          sort: number
        }
        Insert: {
          ai_enabled?: boolean
          created_at?: string
          description?: string | null
          description_ru?: string | null
          id?: string
          name: string
          name_ru?: string | null
          slug: string
          sort?: number
        }
        Update: {
          ai_enabled?: boolean
          created_at?: string
          description?: string | null
          description_ru?: string | null
          id?: string
          name?: string
          name_ru?: string | null
          slug?: string
          sort?: number
        }
        Relationships: []
      }
      doc_extractions: {
        Row: {
          confidence: number | null
          created_at: string
          created_by: string | null
          id: string
          kind: Database["public"]["Enums"]["doc_extraction_kind"]
          last_error: string | null
          model: string | null
          payload: Json
          provider: Database["public"]["Enums"]["ai_provider"] | null
          result: Json | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_id: string
          source_kind: Database["public"]["Enums"]["doc_source_kind"]
          state: Database["public"]["Enums"]["doc_extraction_state"]
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["doc_extraction_kind"]
          last_error?: string | null
          model?: string | null
          payload: Json
          provider?: Database["public"]["Enums"]["ai_provider"] | null
          result?: Json | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id: string
          source_kind: Database["public"]["Enums"]["doc_source_kind"]
          state?: Database["public"]["Enums"]["doc_extraction_state"]
        }
        Update: {
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["doc_extraction_kind"]
          last_error?: string | null
          model?: string | null
          payload?: Json
          provider?: Database["public"]["Enums"]["ai_provider"] | null
          result?: Json | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id?: string
          source_kind?: Database["public"]["Enums"]["doc_source_kind"]
          state?: Database["public"]["Enums"]["doc_extraction_state"]
        }
        Relationships: [
          {
            foreignKeyName: "doc_extractions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doc_extractions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      document_share_views: {
        Row: {
          id: number
          ip_hash: string | null
          share_id: string
          user_agent: string | null
          viewed_at: string
        }
        Insert: {
          id?: never
          ip_hash?: string | null
          share_id: string
          user_agent?: string | null
          viewed_at?: string
        }
        Update: {
          id?: never
          ip_hash?: string | null
          share_id?: string
          user_agent?: string | null
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_share_views_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "document_shares"
            referencedColumns: ["id"]
          },
        ]
      }
      document_shares: {
        Row: {
          created_at: string
          created_by: string
          document_id: string
          expires_at: string
          id: string
          last_viewed_at: string | null
          max_views: number | null
          recipient_label: string | null
          revoked_at: string | null
          revoked_by: string | null
          token_hash: string
          token_prefix: string
          view_count: number
        }
        Insert: {
          created_at?: string
          created_by: string
          document_id: string
          expires_at: string
          id?: string
          last_viewed_at?: string | null
          max_views?: number | null
          recipient_label?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          token_hash: string
          token_prefix: string
          view_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          document_id?: string
          expires_at?: string
          id?: string
          last_viewed_at?: string | null
          max_views?: number | null
          recipient_label?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          token_hash?: string
          token_prefix?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_shares_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_shares_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_shares_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "v_document_compliance"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "document_shares_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          ai_analysis_opt_in: boolean
          ai_key_figures: Json | null
          ai_status: Database["public"]["Enums"]["ai_review_status"]
          ai_summary: string | null
          analysed_at: string | null
          analysed_provider: Database["public"]["Enums"]["ai_provider"] | null
          created_at: string
          doc_type: Database["public"]["Enums"]["document_type"]
          expires_at: string | null
          file_name: string
          file_size_bytes: number
          id: string
          is_archived: boolean
          issued_date: string | null
          mime_type: string
          model_id: string
          notes: string | null
          sha256: string | null
          storage_path: string
          title: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          ai_analysis_opt_in?: boolean
          ai_key_figures?: Json | null
          ai_status?: Database["public"]["Enums"]["ai_review_status"]
          ai_summary?: string | null
          analysed_at?: string | null
          analysed_provider?: Database["public"]["Enums"]["ai_provider"] | null
          created_at?: string
          doc_type: Database["public"]["Enums"]["document_type"]
          expires_at?: string | null
          file_name: string
          file_size_bytes: number
          id?: string
          is_archived?: boolean
          issued_date?: string | null
          mime_type: string
          model_id: string
          notes?: string | null
          sha256?: string | null
          storage_path: string
          title: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          ai_analysis_opt_in?: boolean
          ai_key_figures?: Json | null
          ai_status?: Database["public"]["Enums"]["ai_review_status"]
          ai_summary?: string | null
          analysed_at?: string | null
          analysed_provider?: Database["public"]["Enums"]["ai_provider"] | null
          created_at?: string
          doc_type?: Database["public"]["Enums"]["document_type"]
          expires_at?: string | null
          file_name?: string
          file_size_bytes?: number
          id?: string
          is_archived?: boolean
          issued_date?: string | null
          mime_type?: string
          model_id?: string
          notes?: string | null
          sha256?: string | null
          storage_path?: string
          title?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_compliance_summary"
            referencedColumns: ["model_id"]
          },
          {
            foreignKeyName: "documents_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_my_model"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      earnings: {
        Row: {
          created_at: string
          currency: string
          entered_by: string
          gross_amount: number
          id: string
          model_id: string
          net_amount: number
          period_end: string
          period_start: string
          platform_account_id: string
          platform_fee_amount: number
          source: Database["public"]["Enums"]["entry_source"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          entered_by: string
          gross_amount: number
          id?: string
          model_id: string
          net_amount: number
          period_end: string
          period_start: string
          platform_account_id: string
          platform_fee_amount?: number
          source?: Database["public"]["Enums"]["entry_source"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          entered_by?: string
          gross_amount?: number
          id?: string
          model_id?: string
          net_amount?: number
          period_end?: string
          period_start?: string
          platform_account_id?: string
          platform_fee_amount?: number
          source?: Database["public"]["Enums"]["entry_source"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "earnings_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earnings_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earnings_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_compliance_summary"
            referencedColumns: ["model_id"]
          },
          {
            foreignKeyName: "earnings_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earnings_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_my_model"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earnings_platform_account_id_fkey"
            columns: ["platform_account_id"]
            isOneToOne: false
            referencedRelation: "platform_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      embeddings: {
        Row: {
          content: string
          content_hash: string
          embedded_at: string
          embedding: string
          embedding_model: string
          id: string
          model_id: string | null
          operator_id: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["embedding_source"]
        }
        Insert: {
          content: string
          content_hash: string
          embedded_at?: string
          embedding: string
          embedding_model: string
          id?: string
          model_id?: string | null
          operator_id?: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["embedding_source"]
        }
        Update: {
          content?: string
          content_hash?: string
          embedded_at?: string
          embedding?: string
          embedding_model?: string
          id?: string
          model_id?: string | null
          operator_id?: string | null
          source_id?: string
          source_type?: Database["public"]["Enums"]["embedding_source"]
        }
        Relationships: [
          {
            foreignKeyName: "embeddings_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embeddings_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_compliance_summary"
            referencedColumns: ["model_id"]
          },
          {
            foreignKeyName: "embeddings_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embeddings_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_my_model"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embeddings_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embeddings_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "v_my_operator"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "embeddings_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "v_operator_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          created_by: string
          currency: string
          description: string | null
          id: string
          incurred_on: string
          library_file_id: string | null
          source: Database["public"]["Enums"]["entry_source"]
          updated_at: string
          vendor: string
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string
          created_by: string
          currency?: string
          description?: string | null
          id?: string
          incurred_on: string
          library_file_id?: string | null
          source?: Database["public"]["Enums"]["entry_source"]
          updated_at?: string
          vendor: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          description?: string | null
          id?: string
          incurred_on?: string
          library_file_id?: string | null
          source?: Database["public"]["Enums"]["entry_source"]
          updated_at?: string
          vendor?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_library_file_id_fkey"
            columns: ["library_file_id"]
            isOneToOne: false
            referencedRelation: "library_files"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_snapshots: {
        Row: {
          generated_at: string
          generated_by: string | null
          id: string
          method: string
          model_id: string | null
          params: Json
          platform_id: string | null
          predicted_net: number
          target_month: string
        }
        Insert: {
          generated_at?: string
          generated_by?: string | null
          id?: string
          method?: string
          model_id?: string | null
          params?: Json
          platform_id?: string | null
          predicted_net: number
          target_month: string
        }
        Update: {
          generated_at?: string
          generated_by?: string | null
          id?: string
          method?: string
          model_id?: string | null
          params?: Json
          platform_id?: string | null
          predicted_net?: number
          target_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "forecast_snapshots_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_snapshots_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_snapshots_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_compliance_summary"
            referencedColumns: ["model_id"]
          },
          {
            foreignKeyName: "forecast_snapshots_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_snapshots_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_my_model"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_snapshots_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
        ]
      }
      hermes_approvals: {
        Row: {
          action_type: string
          attempt_count: number
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decided_via: string | null
          decision_note: string | null
          executed_at: string | null
          execution_result: Json
          expires_at: string | null
          id: string
          idempotency_key: string
          job_name: string | null
          last_error: string | null
          next_attempt_at: string | null
          payload: Json
          preview: Json
          required_role: Database["public"]["Enums"]["user_role"]
          risk_reason: string | null
          run_id: string | null
          state: Database["public"]["Enums"]["hermes_approval_state"]
          tier: Database["public"]["Enums"]["hermes_action_tier"]
          updated_at: string
        }
        Insert: {
          action_type: string
          attempt_count?: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_via?: string | null
          decision_note?: string | null
          executed_at?: string | null
          execution_result?: Json
          expires_at?: string | null
          id?: string
          idempotency_key: string
          job_name?: string | null
          last_error?: string | null
          next_attempt_at?: string | null
          payload?: Json
          preview?: Json
          required_role: Database["public"]["Enums"]["user_role"]
          risk_reason?: string | null
          run_id?: string | null
          state?: Database["public"]["Enums"]["hermes_approval_state"]
          tier: Database["public"]["Enums"]["hermes_action_tier"]
          updated_at?: string
        }
        Update: {
          action_type?: string
          attempt_count?: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_via?: string | null
          decision_note?: string | null
          executed_at?: string | null
          execution_result?: Json
          expires_at?: string | null
          id?: string
          idempotency_key?: string
          job_name?: string | null
          last_error?: string | null
          next_attempt_at?: string | null
          payload?: Json
          preview?: Json
          required_role?: Database["public"]["Enums"]["user_role"]
          risk_reason?: string | null
          run_id?: string | null
          state?: Database["public"]["Enums"]["hermes_approval_state"]
          tier?: Database["public"]["Enums"]["hermes_action_tier"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hermes_approvals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hermes_channels: {
        Row: {
          channel_type: string
          created_at: string
          external_id: string
          id: string
          is_active: boolean
          profile_id: string
          verified: boolean
        }
        Insert: {
          channel_type?: string
          created_at?: string
          external_id: string
          id?: string
          is_active?: boolean
          profile_id: string
          verified?: boolean
        }
        Update: {
          channel_type?: string
          created_at?: string
          external_id?: string
          id?: string
          is_active?: boolean
          profile_id?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "hermes_channels_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hermes_job_runs: {
        Row: {
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          id: number
          job_name: string
          outcome: string | null
          started_at: string
          status: string
        }
        Insert: {
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: never
          job_name: string
          outcome?: string | null
          started_at?: string
          status: string
        }
        Update: {
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: never
          job_name?: string
          outcome?: string | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      hermes_messages: {
        Row: {
          body: string | null
          channel_type: string
          created_at: string
          direction: string
          external_message_id: string | null
          id: number
          msg_type: string | null
          update_id: number | null
        }
        Insert: {
          body?: string | null
          channel_type?: string
          created_at?: string
          direction: string
          external_message_id?: string | null
          id?: never
          msg_type?: string | null
          update_id?: number | null
        }
        Update: {
          body?: string | null
          channel_type?: string
          created_at?: string
          direction?: string
          external_message_id?: string | null
          id?: never
          msg_type?: string | null
          update_id?: number | null
        }
        Relationships: []
      }
      hermes_pairing_codes: {
        Row: {
          code: string
          created_at: string
          expected_username: string | null
          expires_at: string
          profile_id: string
          used_at: string | null
        }
        Insert: {
          code: string
          created_at?: string
          expected_username?: string | null
          expires_at: string
          profile_id: string
          used_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          expected_username?: string | null
          expires_at?: string
          profile_id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hermes_pairing_codes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hermes_policy: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      hermes_runs: {
        Row: {
          cost_usd: number
          error: string | null
          finished_at: string | null
          id: string
          iterations: number
          job_name: string | null
          model: string | null
          started_at: string
          status: string
          tokens_in: number
          tokens_out: number
          trigger: string | null
        }
        Insert: {
          cost_usd?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          iterations?: number
          job_name?: string | null
          model?: string | null
          started_at?: string
          status?: string
          tokens_in?: number
          tokens_out?: number
          trigger?: string | null
        }
        Update: {
          cost_usd?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          iterations?: number
          job_name?: string | null
          model?: string | null
          started_at?: string
          status?: string
          tokens_in?: number
          tokens_out?: number
          trigger?: string | null
        }
        Relationships: []
      }
      hermes_sessions: {
        Row: {
          channel_id: string
          conversation_state: Json
          id: string
          last_inbound_at: string | null
          updated_at: string
        }
        Insert: {
          channel_id: string
          conversation_state?: Json
          id?: string
          last_inbound_at?: string | null
          updated_at?: string
        }
        Update: {
          channel_id?: string
          conversation_state?: Json
          id?: string
          last_inbound_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hermes_sessions_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: true
            referencedRelation: "hermes_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      hermes_tool_calls: {
        Row: {
          args: Json | null
          created_at: string
          id: number
          run_id: string | null
          status: string
          tool_name: string
        }
        Insert: {
          args?: Json | null
          created_at?: string
          id?: never
          run_id?: string | null
          status?: string
          tool_name: string
        }
        Update: {
          args?: Json | null
          created_at?: string
          id?: never
          run_id?: string | null
          status?: string
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "hermes_tool_calls_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "hermes_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          model_id: string | null
          operator_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["invitation_status"]
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          model_id?: string | null
          operator_id?: string | null
          role: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          model_id?: string | null
          operator_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_compliance_summary"
            referencedColumns: ["model_id"]
          },
          {
            foreignKeyName: "invitations_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_my_model"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "v_my_operator"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "v_operator_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          amount: number
          commission_scheme_id: string | null
          created_at: string
          created_by: string
          currency: string
          description: string | null
          earning_id: string | null
          entry_type: Database["public"]["Enums"]["ledger_entry_type"]
          id: number
          payee_id: string
          payee_type: Database["public"]["Enums"]["payee_type"]
          payout_id: string | null
          period_end: string | null
          period_start: string | null
        }
        Insert: {
          amount: number
          commission_scheme_id?: string | null
          created_at?: string
          created_by: string
          currency?: string
          description?: string | null
          earning_id?: string | null
          entry_type: Database["public"]["Enums"]["ledger_entry_type"]
          id?: never
          payee_id: string
          payee_type: Database["public"]["Enums"]["payee_type"]
          payout_id?: string | null
          period_end?: string | null
          period_start?: string | null
        }
        Update: {
          amount?: number
          commission_scheme_id?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          description?: string | null
          earning_id?: string | null
          entry_type?: Database["public"]["Enums"]["ledger_entry_type"]
          id?: never
          payee_id?: string
          payee_type?: Database["public"]["Enums"]["payee_type"]
          payout_id?: string | null
          period_end?: string | null
          period_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_commission_scheme_id_fkey"
            columns: ["commission_scheme_id"]
            isOneToOne: false
            referencedRelation: "commission_schemes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_earning_id_fkey"
            columns: ["earning_id"]
            isOneToOne: false
            referencedRelation: "earnings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "v_payout_history"
            referencedColumns: ["payout_id"]
          },
        ]
      }
      library_files: {
        Row: {
          ai_confidence: number | null
          ai_exempt: boolean
          ai_key_figures: Json | null
          ai_rationale: string | null
          ai_status: Database["public"]["Enums"]["ai_review_status"]
          ai_suggested_category_id: string | null
          ai_summary: string | null
          category_id: string | null
          classified_at: string | null
          classified_provider: Database["public"]["Enums"]["ai_provider"] | null
          created_at: string
          folder_path: string
          id: string
          mime_type: string | null
          name: string
          sha256: string | null
          size_bytes: number | null
          storage_path: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_exempt?: boolean
          ai_key_figures?: Json | null
          ai_rationale?: string | null
          ai_status?: Database["public"]["Enums"]["ai_review_status"]
          ai_suggested_category_id?: string | null
          ai_summary?: string | null
          category_id?: string | null
          classified_at?: string | null
          classified_provider?:
            | Database["public"]["Enums"]["ai_provider"]
            | null
          created_at?: string
          folder_path?: string
          id?: string
          mime_type?: string | null
          name: string
          sha256?: string | null
          size_bytes?: number | null
          storage_path: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          ai_confidence?: number | null
          ai_exempt?: boolean
          ai_key_figures?: Json | null
          ai_rationale?: string | null
          ai_status?: Database["public"]["Enums"]["ai_review_status"]
          ai_suggested_category_id?: string | null
          ai_summary?: string | null
          category_id?: string | null
          classified_at?: string | null
          classified_provider?:
            | Database["public"]["Enums"]["ai_provider"]
            | null
          created_at?: string
          folder_path?: string
          id?: string
          mime_type?: string | null
          name?: string
          sha256?: string | null
          size_bytes?: number | null
          storage_path?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_files_ai_suggested_category_id_fkey"
            columns: ["ai_suggested_category_id"]
            isOneToOne: false
            referencedRelation: "doc_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_files_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "doc_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      models: {
        Row: {
          commission_percent: number
          country: string | null
          created_at: string
          created_by: string
          date_of_birth: string
          email: string | null
          id: string
          legal_name: string
          notes: string | null
          payment_details: Json | null
          phone: string | null
          profile_id: string | null
          stage_name: string
          start_date: string | null
          status: Database["public"]["Enums"]["model_status"]
          updated_at: string
        }
        Insert: {
          commission_percent: number
          country?: string | null
          created_at?: string
          created_by: string
          date_of_birth: string
          email?: string | null
          id?: string
          legal_name: string
          notes?: string | null
          payment_details?: Json | null
          phone?: string | null
          profile_id?: string | null
          stage_name: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["model_status"]
          updated_at?: string
        }
        Update: {
          commission_percent?: number
          country?: string | null
          created_at?: string
          created_by?: string
          date_of_birth?: string
          email?: string | null
          id?: string
          legal_name?: string
          notes?: string | null
          payment_details?: Json | null
          phone?: string | null
          profile_id?: string | null
          stage_name?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["model_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "models_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "models_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_assignments: {
        Row: {
          assigned_from: string
          assigned_to: string | null
          created_at: string
          created_by: string
          id: string
          model_id: string
          notes: string | null
          operator_id: string
          pool_share_percent: number
        }
        Insert: {
          assigned_from: string
          assigned_to?: string | null
          created_at?: string
          created_by: string
          id?: string
          model_id: string
          notes?: string | null
          operator_id: string
          pool_share_percent?: number
        }
        Update: {
          assigned_from?: string
          assigned_to?: string | null
          created_at?: string
          created_by?: string
          id?: string
          model_id?: string
          notes?: string | null
          operator_id?: string
          pool_share_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "operator_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_assignments_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_assignments_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_compliance_summary"
            referencedColumns: ["model_id"]
          },
          {
            foreignKeyName: "operator_assignments_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_assignments_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_my_model"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_assignments_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_assignments_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "v_my_operator"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_assignments_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "v_operator_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      operators: {
        Row: {
          country: string | null
          created_at: string
          created_by: string
          display_name: string
          email: string | null
          id: string
          legal_name: string
          notes: string | null
          payment_details: Json | null
          phone: string | null
          profile_id: string | null
          staff_role: Database["public"]["Enums"]["staff_role"]
          start_date: string | null
          status: Database["public"]["Enums"]["model_status"]
          updated_at: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          created_by: string
          display_name: string
          email?: string | null
          id?: string
          legal_name: string
          notes?: string | null
          payment_details?: Json | null
          phone?: string | null
          profile_id?: string | null
          staff_role?: Database["public"]["Enums"]["staff_role"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["model_status"]
          updated_at?: string
        }
        Update: {
          country?: string | null
          created_at?: string
          created_by?: string
          display_name?: string
          email?: string | null
          id?: string
          legal_name?: string
          notes?: string | null
          payment_details?: Json | null
          phone?: string | null
          profile_id?: string | null
          staff_role?: Database["public"]["Enums"]["staff_role"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["model_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operators_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operators_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          approved_by: string | null
          created_at: string
          created_by: string
          currency: string
          deductions: number
          gross_amount: number
          id: string
          net_amount: number
          notes: string | null
          paid_at: string | null
          payee_id: string
          payee_type: Database["public"]["Enums"]["payee_type"]
          payment_method: string | null
          period_end: string
          period_start: string
          reference: string | null
          status: Database["public"]["Enums"]["payout_status"]
          studio_fee_amount: number
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          created_by: string
          currency?: string
          deductions?: number
          gross_amount: number
          id?: string
          net_amount: number
          notes?: string | null
          paid_at?: string | null
          payee_id: string
          payee_type: Database["public"]["Enums"]["payee_type"]
          payment_method?: string | null
          period_end: string
          period_start: string
          reference?: string | null
          status?: Database["public"]["Enums"]["payout_status"]
          studio_fee_amount?: number
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          deductions?: number
          gross_amount?: number
          id?: string
          net_amount?: number
          notes?: string | null
          paid_at?: string | null
          payee_id?: string
          payee_type?: Database["public"]["Enums"]["payee_type"]
          payment_method?: string | null
          period_end?: string
          period_start?: string
          reference?: string | null
          status?: Database["public"]["Enums"]["payout_status"]
          studio_fee_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_accounts: {
        Row: {
          created_at: string
          id: string
          model_id: string
          platform_fee_percent: number | null
          platform_id: string
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          id?: string
          model_id: string
          platform_fee_percent?: number | null
          platform_id: string
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          model_id?: string
          platform_fee_percent?: number | null
          platform_id?: string
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_accounts_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_accounts_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_compliance_summary"
            referencedColumns: ["model_id"]
          },
          {
            foreignKeyName: "platform_accounts_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_accounts_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_my_model"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_accounts_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
        ]
      }
      platforms: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          website_url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          website_url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          website_url?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          deactivated_at: string | null
          email: string
          full_name: string
          id: string
          locale: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["user_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deactivated_at?: string | null
          email: string
          full_name: string
          id: string
          locale?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deactivated_at?: string | null
          email?: string
          full_name?: string
          id?: string
          locale?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Relationships: []
      }
      share_rate_limits: {
        Row: {
          ip_hash: string
          request_count: number
          window_start: string
        }
        Insert: {
          ip_hash: string
          request_count?: number
          window_start: string
        }
        Update: {
          ip_hash?: string
          request_count?: number
          window_start?: string
        }
        Relationships: []
      }
      work_sessions: {
        Row: {
          created_at: string
          currency: string
          duration_minutes: number | null
          ended_at: string | null
          entered_by: string
          gross_earnings: number
          id: string
          model_id: string
          notes: string | null
          platform_account_id: string
          source: Database["public"]["Enums"]["entry_source"]
          started_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          duration_minutes?: number | null
          ended_at?: string | null
          entered_by: string
          gross_earnings?: number
          id?: string
          model_id: string
          notes?: string | null
          platform_account_id: string
          source?: Database["public"]["Enums"]["entry_source"]
          started_at: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          duration_minutes?: number | null
          ended_at?: string | null
          entered_by?: string
          gross_earnings?: number
          id?: string
          model_id?: string
          notes?: string | null
          platform_account_id?: string
          source?: Database["public"]["Enums"]["entry_source"]
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_sessions_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_sessions_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_sessions_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_compliance_summary"
            referencedColumns: ["model_id"]
          },
          {
            foreignKeyName: "work_sessions_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_sessions_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_my_model"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_sessions_platform_account_id_fkey"
            columns: ["platform_account_id"]
            isOneToOne: false
            referencedRelation: "platform_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_document_compliance: {
        Row: {
          doc_type: Database["public"]["Enums"]["document_type"] | null
          document_id: string | null
          expires_at: string | null
          model_id: string | null
          status: string | null
          title: string | null
        }
        Insert: {
          doc_type?: Database["public"]["Enums"]["document_type"] | null
          document_id?: string | null
          expires_at?: string | null
          model_id?: string | null
          status?: never
          title?: string | null
        }
        Update: {
          doc_type?: Database["public"]["Enums"]["document_type"] | null
          document_id?: string | null
          expires_at?: string | null
          model_id?: string | null
          status?: never
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_compliance_summary"
            referencedColumns: ["model_id"]
          },
          {
            foreignKeyName: "documents_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_my_model"
            referencedColumns: ["id"]
          },
        ]
      }
      v_earnings_forecast: {
        Row: {
          model_id: string | null
          platform_id: string | null
          predicted_net: number | null
          target_month: string | null
        }
        Relationships: []
      }
      v_earnings_monthly: {
        Row: {
          gross_amount: number | null
          model_id: string | null
          month: string | null
          net_amount: number | null
          platform_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "earnings_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earnings_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_compliance_summary"
            referencedColumns: ["model_id"]
          },
          {
            foreignKeyName: "earnings_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earnings_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_my_model"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_accounts_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
        ]
      }
      v_earnings_share_by_model: {
        Row: {
          model_id: string | null
          month: string | null
          net_amount: number | null
          share_percent: number | null
          stage_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "earnings_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earnings_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_compliance_summary"
            referencedColumns: ["model_id"]
          },
          {
            foreignKeyName: "earnings_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earnings_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_my_model"
            referencedColumns: ["id"]
          },
        ]
      }
      v_earnings_share_by_platform: {
        Row: {
          month: string | null
          net_amount: number | null
          platform_id: string | null
          platform_name: string | null
          share_percent: number | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_accounts_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
        ]
      }
      v_forecast_accuracy: {
        Row: {
          actual_net: number | null
          error_amount: number | null
          error_percent: number | null
          model_id: string | null
          predicted_net: number | null
          rolling_mape: number | null
          target_month: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forecast_snapshots_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_snapshots_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_compliance_summary"
            referencedColumns: ["model_id"]
          },
          {
            foreignKeyName: "forecast_snapshots_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_snapshots_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_my_model"
            referencedColumns: ["id"]
          },
        ]
      }
      v_model_compliance_summary: {
        Row: {
          expired_count: number | null
          expiring_count: number | null
          model_id: string | null
          stage_name: string | null
          valid_count: number | null
        }
        Relationships: []
      }
      v_model_directory: {
        Row: {
          id: string | null
          stage_name: string | null
        }
        Insert: {
          id?: string | null
          stage_name?: string | null
        }
        Update: {
          id?: string | null
          stage_name?: string | null
        }
        Relationships: []
      }
      v_my_model: {
        Row: {
          commission_percent: number | null
          country: string | null
          email: string | null
          id: string | null
          phone: string | null
          stage_name: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["model_status"] | null
        }
        Insert: {
          commission_percent?: number | null
          country?: string | null
          email?: string | null
          id?: string | null
          phone?: string | null
          stage_name?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["model_status"] | null
        }
        Update: {
          commission_percent?: number | null
          country?: string | null
          email?: string | null
          id?: string | null
          phone?: string | null
          stage_name?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["model_status"] | null
        }
        Relationships: []
      }
      v_my_operator: {
        Row: {
          country: string | null
          display_name: string | null
          email: string | null
          id: string | null
          phone: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["model_status"] | null
        }
        Insert: {
          country?: string | null
          display_name?: string | null
          email?: string | null
          id?: string | null
          phone?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["model_status"] | null
        }
        Update: {
          country?: string | null
          display_name?: string | null
          email?: string | null
          id?: string | null
          phone?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["model_status"] | null
        }
        Relationships: []
      }
      v_operator_directory: {
        Row: {
          display_name: string | null
          id: string | null
        }
        Insert: {
          display_name?: string | null
          id?: string | null
        }
        Update: {
          display_name?: string | null
          id?: string | null
        }
        Relationships: []
      }
      v_payee_balances: {
        Row: {
          balance: number | null
          currency: string | null
          display_name: string | null
          payee_id: string | null
          payee_type: Database["public"]["Enums"]["payee_type"] | null
        }
        Relationships: []
      }
      v_payout_history: {
        Row: {
          currency: string | null
          net_amount: number | null
          paid_at: string | null
          payee_id: string | null
          payee_name: string | null
          payee_type: Database["public"]["Enums"]["payee_type"] | null
          payout_id: string | null
          period_end: string | null
          period_start: string | null
          status: Database["public"]["Enums"]["payout_status"] | null
        }
        Relationships: []
      }
      v_sessions_hours_monthly: {
        Row: {
          hours: number | null
          model_id: string | null
          month: string | null
          session_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "work_sessions_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_sessions_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_compliance_summary"
            referencedColumns: ["model_id"]
          },
          {
            foreignKeyName: "work_sessions_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_model_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_sessions_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "v_my_model"
            referencedColumns: ["id"]
          },
        ]
      }
      v_split_distribution: {
        Row: {
          amount: number | null
          bucket: string | null
          month: string | null
          share_percent: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      decide_approval: {
        Args: {
          p_actor?: string
          p_id: string
          p_note?: string
          p_verdict: string
          p_via?: string
        }
        Returns: {
          action_type: string
          attempt_count: number
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decided_via: string | null
          decision_note: string | null
          executed_at: string | null
          execution_result: Json
          expires_at: string | null
          id: string
          idempotency_key: string
          job_name: string | null
          last_error: string | null
          next_attempt_at: string | null
          payload: Json
          preview: Json
          required_role: Database["public"]["Enums"]["user_role"]
          risk_reason: string | null
          run_id: string | null
          state: Database["public"]["Enums"]["hermes_approval_state"]
          tier: Database["public"]["Enums"]["hermes_action_tier"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "hermes_approvals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fn_agent_generate_earning_shares: {
        Args: {
          p_approver: string
          p_period_end: string
          p_period_start: string
        }
        Returns: {
          posted_count: number
          skipped_count: number
        }[]
      }
      fn_agent_snapshot_forecast: {
        Args: { p_approver: string; p_months_ahead: number }
        Returns: number
      }
      fn_compliance_counts: {
        Args: never
        Returns: {
          expired_count: number
          expiring_count: number
          valid_count: number
        }[]
      }
      fn_earnings_summary: {
        Args: { p_from: string; p_group_by?: string; p_to: string }
        Returns: {
          gross_amount: number
          group_key: string
          net_amount: number
        }[]
      }
      fn_forecast: {
        Args: { p_months_ahead?: number }
        Returns: {
          model_id: string
          platform_id: string
          predicted_net: number
          target_month: string
        }[]
      }
      fn_generate_earning_shares: {
        Args: { p_period_end: string; p_period_start: string }
        Returns: {
          posted_count: number
          skipped_count: number
        }[]
      }
      fn_hours_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          hours: number
          model_id: string
          session_count: number
        }[]
      }
      fn_payee_statement: {
        Args: {
          p_from: string
          p_payee_id: string
          p_payee_type: Database["public"]["Enums"]["payee_type"]
          p_to: string
        }
        Returns: {
          amount: number
          commission_scheme_id: string
          currency: string
          description: string
          earning_id: string
          entry_date: string
          entry_id: number
          entry_type: Database["public"]["Enums"]["ledger_entry_type"]
          line_type: string
          payout_id: string
          running_balance: number
        }[]
      }
      fn_payout_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          payout_count: number
          status: Database["public"]["Enums"]["payout_status"]
          total_net: number
        }[]
      }
      fn_semantic_search: {
        Args: {
          p_embedding: string
          p_source_types?: Database["public"]["Enums"]["embedding_source"][]
          p_top_k?: number
        }
        Returns: {
          similarity: number
          snippet: string
          source_type: Database["public"]["Enums"]["embedding_source"]
          subject_name: string
        }[]
      }
      fn_set_commission_tiers: {
        Args: { p_scheme_id: string; p_tiers: Json }
        Returns: number
      }
      fn_snapshot_forecast: {
        Args: { p_months_ahead?: number }
        Returns: number
      }
      hermes_claim_job: {
        Args: { p_day: string; p_job: string }
        Returns: boolean
      }
      hermes_incr_policy_number: {
        Args: { p_delta: number; p_description?: string; p_key: string }
        Returns: number
      }
      hermes_role_satisfies: {
        Args: {
          p_actor: Database["public"]["Enums"]["user_role"]
          p_required: Database["public"]["Enums"]["user_role"]
        }
        Returns: boolean
      }
      is_aal2: { Args: never; Returns: boolean }
      is_active_profile: { Args: never; Returns: boolean }
      my_model_id: { Args: never; Returns: string }
      my_operator_id: { Args: never; Returns: string }
      profile_fields_unchanged: {
        Args: {
          p_id: string
          p_role: Database["public"]["Enums"]["user_role"]
          p_status: Database["public"]["Enums"]["user_status"]
        }
        Returns: boolean
      }
      write_audit: {
        Args: {
          p_action: string
          p_entity_id: string
          p_entity_type: string
          p_metadata?: Json
        }
        Returns: undefined
      }
      write_audit_as: {
        Args: {
          p_action: string
          p_actor: string
          p_entity_id: string
          p_entity_type: string
          p_metadata?: Json
        }
        Returns: undefined
      }
    }
    Enums: {
      account_status: "active" | "suspended" | "closed"
      ai_message_role: "user" | "assistant" | "tool"
      ai_provider: "moonshot" | "zhipu"
      ai_request_kind:
        | "chat"
        | "embedding"
        | "report"
        | "classify"
        | "analyse"
        | "agent"
        | "extract"
      ai_review_status:
        | "pending"
        | "suggested"
        | "confirmed"
        | "overridden"
        | "skipped"
        | "failed"
      doc_extraction_kind:
        | "earnings"
        | "sessions"
        | "expenses"
        | "document_meta"
      doc_extraction_state: "proposed" | "applied" | "dismissed" | "failed"
      doc_source_kind: "library_file" | "document"
      document_type:
        | "government_id"
        | "passport"
        | "contract"
        | "model_release"
        | "consent_form"
        | "tax_form"
        | "other"
      embedding_source:
        | "model_note"
        | "operator_note"
        | "platform"
        | "document_meta"
      entry_source: "manual" | "import"
      hermes_action_tier: "automatic" | "approval" | "human_only"
      hermes_approval_state:
        | "pending"
        | "approved"
        | "rejected"
        | "executed"
        | "failed"
        | "expired"
        | "cancelled"
      invitation_status: "pending" | "accepted" | "expired" | "revoked"
      ledger_entry_type:
        | "earning_share"
        | "adjustment"
        | "deduction"
        | "payout_settlement"
      model_status: "active" | "inactive" | "on_leave" | "terminated"
      payee_type: "model" | "operator"
      payout_status: "pending" | "approved" | "paid" | "cancelled"
      staff_role: "operator" | "coach" | "team_leader"
      user_role: "super_admin" | "manager" | "model" | "finance" | "operator"
      user_status: "invited" | "active" | "deactivated"
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
      account_status: ["active", "suspended", "closed"],
      ai_message_role: ["user", "assistant", "tool"],
      ai_provider: ["moonshot", "zhipu"],
      ai_request_kind: [
        "chat",
        "embedding",
        "report",
        "classify",
        "analyse",
        "agent",
        "extract",
      ],
      ai_review_status: [
        "pending",
        "suggested",
        "confirmed",
        "overridden",
        "skipped",
        "failed",
      ],
      doc_extraction_kind: [
        "earnings",
        "sessions",
        "expenses",
        "document_meta",
      ],
      doc_extraction_state: ["proposed", "applied", "dismissed", "failed"],
      doc_source_kind: ["library_file", "document"],
      document_type: [
        "government_id",
        "passport",
        "contract",
        "model_release",
        "consent_form",
        "tax_form",
        "other",
      ],
      embedding_source: [
        "model_note",
        "operator_note",
        "platform",
        "document_meta",
      ],
      entry_source: ["manual", "import"],
      hermes_action_tier: ["automatic", "approval", "human_only"],
      hermes_approval_state: [
        "pending",
        "approved",
        "rejected",
        "executed",
        "failed",
        "expired",
        "cancelled",
      ],
      invitation_status: ["pending", "accepted", "expired", "revoked"],
      ledger_entry_type: [
        "earning_share",
        "adjustment",
        "deduction",
        "payout_settlement",
      ],
      model_status: ["active", "inactive", "on_leave", "terminated"],
      payee_type: ["model", "operator"],
      payout_status: ["pending", "approved", "paid", "cancelled"],
      staff_role: ["operator", "coach", "team_leader"],
      user_role: ["super_admin", "manager", "model", "finance", "operator"],
      user_status: ["invited", "active", "deactivated"],
    },
  },
} as const

type PublicSchema = Database["public"];

export type DbFunctions = PublicSchema["Functions"];
export type FunctionArgs<T extends keyof DbFunctions> = DbFunctions[T]["Args"];
export type FunctionReturns<T extends keyof DbFunctions> = DbFunctions[T]["Returns"];
export type TableName = keyof PublicSchema["Tables"];
export type ViewName = keyof PublicSchema["Views"];

export type Profile = PublicSchema["Tables"]["profiles"]["Row"];
export type ModelRow = PublicSchema["Tables"]["models"]["Row"];
export type OperatorRow = PublicSchema["Tables"]["operators"]["Row"];
export type PlatformRow = PublicSchema["Tables"]["platforms"]["Row"];
export type PlatformAccountRow = PublicSchema["Tables"]["platform_accounts"]["Row"];
export type WorkSessionRow = PublicSchema["Tables"]["work_sessions"]["Row"];
export type EarningRow = PublicSchema["Tables"]["earnings"]["Row"];
export type OperatorAssignmentRow = PublicSchema["Tables"]["operator_assignments"]["Row"];
export type CommissionSchemeRow = PublicSchema["Tables"]["commission_schemes"]["Row"];
export type LedgerEntryRow = PublicSchema["Tables"]["ledger_entries"]["Row"];
export type PayoutRow = PublicSchema["Tables"]["payouts"]["Row"];
export type ForecastSnapshotRow = PublicSchema["Tables"]["forecast_snapshots"]["Row"];
export type DocumentRow = PublicSchema["Tables"]["documents"]["Row"];
export type DocumentShareRow = PublicSchema["Tables"]["document_shares"]["Row"];
export type AuditLogRow = PublicSchema["Tables"]["audit_log"]["Row"];
export type InvitationRow = PublicSchema["Tables"]["invitations"]["Row"];
export type AppSettingRow = PublicSchema["Tables"]["app_settings"]["Row"];
export type LibraryFileRow = PublicSchema["Tables"]["library_files"]["Row"];
export type DocCategoryRow = PublicSchema["Tables"]["doc_categories"]["Row"];
export type AiConversationRow = PublicSchema["Tables"]["ai_conversations"]["Row"];
export type AiMessageRow = PublicSchema["Tables"]["ai_messages"]["Row"];
export type AiUsageRow = PublicSchema["Tables"]["ai_usage"]["Row"];
export type AiReportRow = PublicSchema["Tables"]["ai_reports"]["Row"];
export type EmbeddingRow = PublicSchema["Tables"]["embeddings"]["Row"];

export type HermesApprovalRow = PublicSchema["Tables"]["hermes_approvals"]["Row"];
export type HermesRunRow = PublicSchema["Tables"]["hermes_runs"]["Row"];
export type HermesJobRunRow = PublicSchema["Tables"]["hermes_job_runs"]["Row"];
export type HermesChannelRow = PublicSchema["Tables"]["hermes_channels"]["Row"];

export type CommissionTierRow = PublicSchema["Tables"]["commission_tiers"]["Row"];
