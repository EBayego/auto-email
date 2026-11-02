export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      account_data_events: {
        Row: {
          action: string;
          created_at: string;
          id: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          created_at?: string;
          id?: string;
          user_id?: string | null;
        };
        Update: {
          action?: string;
          created_at?: string;
          id?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'account_data_events_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      account_deletion_requests: {
        Row: {
          attempts: number;
          completed_at: string | null;
          error_code: string | null;
          id: string;
          lease_expires_at: string | null;
          lease_id: string | null;
          next_attempt_at: string;
          phase: string;
          receipt_hash: string;
          requested_at: string;
          revocation: string;
          status: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          completed_at?: string | null;
          error_code?: string | null;
          id?: string;
          lease_expires_at?: string | null;
          lease_id?: string | null;
          next_attempt_at?: string;
          phase?: string;
          receipt_hash: string;
          requested_at?: string;
          revocation?: string;
          status?: string;
          user_id?: string | null;
        };
        Update: {
          attempts?: number;
          completed_at?: string | null;
          error_code?: string | null;
          id?: string;
          lease_expires_at?: string | null;
          lease_id?: string | null;
          next_attempt_at?: string;
          phase?: string;
          receipt_hash?: string;
          requested_at?: string;
          revocation?: string;
          status?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'account_deletion_requests_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      archived_drafts: {
        Row: {
          archived_at: string;
          gmail_account_id: string;
          id: string;
          sent: boolean;
          target_hash: string;
          thread_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          archived_at?: string;
          gmail_account_id: string;
          id: string;
          sent: boolean;
          target_hash: string;
          thread_id: string;
          user_id: string;
        };
        Update: {
          archived_at?: string;
          gmail_account_id?: string;
          id?: string;
          sent?: boolean;
          target_hash?: string;
          thread_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'archived_drafts_gmail_account_id_user_id_fkey';
            columns: ['gmail_account_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_accounts';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'archived_drafts_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      draft_generations: {
        Row: {
          created_at: string;
          delivery_envelope_hash: string | null;
          delivery_intent: Json | null;
          draft_id: string | null;
          draft_internet_message_id: string | null;
          draft_message_id: string | null;
          email_job_id: string | null;
          factual_validation: Json | null;
          generation_run_id: string | null;
          gmail_account_id: string;
          id: string;
          input_tokens: number;
          knowledge_revision: string | null;
          model: string;
          output_tokens: number;
          policy_revision: string | null;
          prompt_version: string;
          reason_code: string | null;
          reconciliation_checked_at: string | null;
          reconciliation_lease_expires_at: string | null;
          reconciliation_lease_id: string | null;
          reconciliation_next_at: string;
          reconciliation_result: string | null;
          sent_checked_at: string | null;
          sent_lease_expires_at: string | null;
          sent_lease_id: string | null;
          sent_next_check_at: string;
          sent_outcome: NonNullable<Json>;
          sources_used: NonNullable<Json>;
          status: string;
          style_revision: string;
          target_message_id: string;
          thread_id: string;
          updated_at: string;
          user_id: string;
          verified_at: string | null;
          warnings: string[];
          write_started_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          delivery_envelope_hash?: string | null;
          delivery_intent?: Json | null;
          draft_id?: string | null;
          draft_internet_message_id?: string | null;
          draft_message_id?: string | null;
          email_job_id?: string | null;
          factual_validation?: Json | null;
          generation_run_id?: string | null;
          gmail_account_id: string;
          id: string;
          input_tokens: number;
          knowledge_revision?: string | null;
          model: string;
          output_tokens: number;
          policy_revision?: string | null;
          prompt_version: string;
          reason_code?: string | null;
          reconciliation_checked_at?: string | null;
          reconciliation_lease_expires_at?: string | null;
          reconciliation_lease_id?: string | null;
          reconciliation_next_at?: string;
          reconciliation_result?: string | null;
          sent_checked_at?: string | null;
          sent_lease_expires_at?: string | null;
          sent_lease_id?: string | null;
          sent_next_check_at?: string;
          sent_outcome?: NonNullable<Json>;
          sources_used?: NonNullable<Json>;
          status?: string;
          style_revision: string;
          target_message_id: string;
          thread_id: string;
          updated_at?: string;
          user_id: string;
          verified_at?: string | null;
          warnings?: string[];
          write_started_at?: string | null;
        };
        Update: {
          created_at?: string;
          delivery_envelope_hash?: string | null;
          delivery_intent?: Json | null;
          draft_id?: string | null;
          draft_internet_message_id?: string | null;
          draft_message_id?: string | null;
          email_job_id?: string | null;
          factual_validation?: Json | null;
          generation_run_id?: string | null;
          gmail_account_id?: string;
          id?: string;
          input_tokens?: number;
          knowledge_revision?: string | null;
          model?: string;
          output_tokens?: number;
          policy_revision?: string | null;
          prompt_version?: string;
          reason_code?: string | null;
          reconciliation_checked_at?: string | null;
          reconciliation_lease_expires_at?: string | null;
          reconciliation_lease_id?: string | null;
          reconciliation_next_at?: string;
          reconciliation_result?: string | null;
          sent_checked_at?: string | null;
          sent_lease_expires_at?: string | null;
          sent_lease_id?: string | null;
          sent_next_check_at?: string;
          sent_outcome?: NonNullable<Json>;
          sources_used?: NonNullable<Json>;
          status?: string;
          style_revision?: string;
          target_message_id?: string;
          thread_id?: string;
          updated_at?: string;
          user_id?: string;
          verified_at?: string | null;
          warnings?: string[];
          write_started_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'draft_generation_job_fk';
            columns: ['email_job_id', 'user_id', 'gmail_account_id'];
            isOneToOne: false;
            referencedRelation: 'email_jobs';
            referencedColumns: ['id', 'user_id', 'gmail_account_id'];
          },
          {
            foreignKeyName: 'draft_generations_account_owner_fkey';
            columns: ['gmail_account_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_accounts';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'draft_generations_generation_run_owner_fk';
            columns: ['generation_run_id', 'user_id', 'gmail_account_id'];
            isOneToOne: false;
            referencedRelation: 'generation_runs';
            referencedColumns: ['id', 'user_id', 'gmail_account_id'];
          },
          {
            foreignKeyName: 'draft_generations_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      email_job_events: {
        Row: {
          email_job_id: string;
          from_status: string | null;
          gmail_account_id: string;
          id: number;
          occurred_at: string;
          reason_code: string | null;
          to_status: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          email_job_id: string;
          from_status?: string | null;
          gmail_account_id: string;
          id?: never;
          occurred_at?: string;
          reason_code?: string | null;
          to_status: string;
          user_id: string;
        };
        Update: {
          email_job_id?: string;
          from_status?: string | null;
          gmail_account_id?: string;
          id?: never;
          occurred_at?: string;
          reason_code?: string | null;
          to_status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'email_job_events_email_job_id_user_id_gmail_account_id_fkey';
            columns: ['email_job_id', 'user_id', 'gmail_account_id'];
            isOneToOne: false;
            referencedRelation: 'email_jobs';
            referencedColumns: ['id', 'user_id', 'gmail_account_id'];
          },
        ];
      };
      email_jobs: {
        Row: {
          attempt_count: number;
          available_at: string;
          classification: Json | null;
          classification_finished_at: string | null;
          classification_started_at: string | null;
          created_at: string;
          draft_id: string | null;
          finished_at: string | null;
          generation_finished_at: string | null;
          generation_started_at: string | null;
          gmail_account_id: string;
          id: string;
          lease_expires_at: string | null;
          lease_id: string | null;
          reason_code: string | null;
          started_at: string | null;
          status: string;
          target_message_id: string;
          thread_id: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          attempt_count?: number;
          available_at?: string;
          classification?: Json | null;
          classification_finished_at?: string | null;
          classification_started_at?: string | null;
          created_at?: string;
          draft_id?: string | null;
          finished_at?: string | null;
          generation_finished_at?: string | null;
          generation_started_at?: string | null;
          gmail_account_id: string;
          id?: string;
          lease_expires_at?: string | null;
          lease_id?: string | null;
          reason_code?: string | null;
          started_at?: string | null;
          status?: string;
          target_message_id: string;
          thread_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          attempt_count?: number;
          available_at?: string;
          classification?: Json | null;
          classification_finished_at?: string | null;
          classification_started_at?: string | null;
          created_at?: string;
          draft_id?: string | null;
          finished_at?: string | null;
          generation_finished_at?: string | null;
          generation_started_at?: string | null;
          gmail_account_id?: string;
          id?: string;
          lease_expires_at?: string | null;
          lease_id?: string | null;
          reason_code?: string | null;
          started_at?: string | null;
          status?: string;
          target_message_id?: string;
          thread_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'email_jobs_gmail_account_id_user_id_fkey';
            columns: ['gmail_account_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_accounts';
            referencedColumns: ['id', 'user_id'];
          },
        ];
      };
      feedback_events: {
        Row: {
          algorithm_version: string;
          attempts: number;
          created_at: string;
          draft_generation_id: string;
          generation_run_id: string | null;
          gmail_account_id: string;
          id: string;
          lease_expires_at: string | null;
          lease_id: string | null;
          metrics: Json | null;
          next_attempt_at: string;
          processed_at: string | null;
          reason_code: string | null;
          sent_at: string;
          sent_message_id: string;
          status: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          algorithm_version?: string;
          attempts?: number;
          created_at?: string;
          draft_generation_id: string;
          generation_run_id?: string | null;
          gmail_account_id: string;
          id?: string;
          lease_expires_at?: string | null;
          lease_id?: string | null;
          metrics?: Json | null;
          next_attempt_at?: string;
          processed_at?: string | null;
          reason_code?: string | null;
          sent_at: string;
          sent_message_id: string;
          status?: string;
          user_id: string;
        };
        Update: {
          algorithm_version?: string;
          attempts?: number;
          created_at?: string;
          draft_generation_id?: string;
          generation_run_id?: string | null;
          gmail_account_id?: string;
          id?: string;
          lease_expires_at?: string | null;
          lease_id?: string | null;
          metrics?: Json | null;
          next_attempt_at?: string;
          processed_at?: string | null;
          reason_code?: string | null;
          sent_at?: string;
          sent_message_id?: string;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'feedback_events_draft_generation_id_user_id_gmail_account__fkey';
            columns: ['draft_generation_id', 'user_id', 'gmail_account_id'];
            isOneToOne: false;
            referencedRelation: 'draft_generations';
            referencedColumns: ['id', 'user_id', 'gmail_account_id'];
          },
          {
            foreignKeyName: 'feedback_events_generation_run_id_user_id_gmail_account_id_fkey';
            columns: ['generation_run_id', 'user_id', 'gmail_account_id'];
            isOneToOne: false;
            referencedRelation: 'generation_runs';
            referencedColumns: ['id', 'user_id', 'gmail_account_id'];
          },
          {
            foreignKeyName: 'feedback_events_gmail_account_id_user_id_fkey';
            columns: ['gmail_account_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_accounts';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'feedback_events_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      generation_content_authorizations: {
        Row: {
          authorized_at: string;
          gmail_account_id: string;
          notice_version: string;
          retention_hours: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          authorized_at?: string;
          gmail_account_id: string;
          notice_version: string;
          retention_hours: number;
          user_id: string;
        };
        Update: {
          authorized_at?: string;
          gmail_account_id?: string;
          notice_version?: string;
          retention_hours?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'generation_content_authorizations_gmail_account_id_user_id_fkey';
            columns: ['gmail_account_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_accounts';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'generation_content_authorizations_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      generation_runs: {
        Row: {
          configuration: NonNullable<Json>;
          created_at: string;
          duration_ms: number;
          email_job_id: string | null;
          estimated_cost_usd: number | null;
          generation_version: number;
          gmail_account_id: string;
          id: string;
          input_tokens: number | null;
          model: string;
          model_calls: number | null;
          output_tokens: number | null;
          pricing: Json | null;
          sources_used: NonNullable<Json>;
          status: string;
          target_message_id: string;
          thread_id: string;
          user_id: string;
          warnings: string[];
        };
        ComputedFields: never;
        Insert: {
          configuration: NonNullable<Json>;
          created_at?: string;
          duration_ms: number;
          email_job_id?: string | null;
          estimated_cost_usd?: number | null;
          generation_version: number;
          gmail_account_id: string;
          id: string;
          input_tokens?: number | null;
          model: string;
          model_calls?: number | null;
          output_tokens?: number | null;
          pricing?: Json | null;
          sources_used?: NonNullable<Json>;
          status: string;
          target_message_id: string;
          thread_id: string;
          user_id: string;
          warnings?: string[];
        };
        Update: {
          configuration?: NonNullable<Json>;
          created_at?: string;
          duration_ms?: number;
          email_job_id?: string | null;
          estimated_cost_usd?: number | null;
          generation_version?: number;
          gmail_account_id?: string;
          id?: string;
          input_tokens?: number | null;
          model?: string;
          model_calls?: number | null;
          output_tokens?: number | null;
          pricing?: Json | null;
          sources_used?: NonNullable<Json>;
          status?: string;
          target_message_id?: string;
          thread_id?: string;
          user_id?: string;
          warnings?: string[];
        };
        Relationships: [
          {
            foreignKeyName: 'generation_runs_email_job_id_user_id_gmail_account_id_fkey';
            columns: ['email_job_id', 'user_id', 'gmail_account_id'];
            isOneToOne: false;
            referencedRelation: 'email_jobs';
            referencedColumns: ['id', 'user_id', 'gmail_account_id'];
          },
          {
            foreignKeyName: 'generation_runs_gmail_account_id_user_id_fkey';
            columns: ['gmail_account_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_accounts';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'generation_runs_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      generation_temporary_content: {
        Row: {
          body_text: string;
          created_at: string;
          expires_at: string;
          generation_run_id: string;
          gmail_account_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          body_text: string;
          created_at?: string;
          expires_at: string;
          generation_run_id: string;
          gmail_account_id: string;
          user_id: string;
        };
        Update: {
          body_text?: string;
          created_at?: string;
          expires_at?: string;
          generation_run_id?: string;
          gmail_account_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'generation_temporary_content_generation_run_id_user_id_gma_fkey';
            columns: ['generation_run_id', 'user_id', 'gmail_account_id'];
            isOneToOne: false;
            referencedRelation: 'generation_runs';
            referencedColumns: ['id', 'user_id', 'gmail_account_id'];
          },
          {
            foreignKeyName: 'generation_temporary_content_gmail_account_id_fkey';
            columns: ['gmail_account_id'];
            isOneToOne: false;
            referencedRelation: 'generation_content_authorizations';
            referencedColumns: ['gmail_account_id'];
          },
        ];
      };
      gmail_accounts: {
        Row: {
          access_token_expires_at: string | null;
          created_at: string;
          credential_version: string;
          email: string;
          encrypted_access_token: string | null;
          encrypted_refresh_token: string | null;
          id: string;
          last_sync_at: string | null;
          manual_processing_until: string | null;
          manual_sync_requested_at: string | null;
          next_sync_at: string;
          scope_set: string[];
          status: string;
          sync_lease_expires_at: string | null;
          sync_lease_id: string | null;
          sync_window_start_at: string | null;
          token_lease_expires_at: string | null;
          token_lease_id: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          access_token_expires_at?: string | null;
          created_at?: string;
          credential_version?: string;
          email: string;
          encrypted_access_token?: string | null;
          encrypted_refresh_token?: string | null;
          id?: string;
          last_sync_at?: string | null;
          manual_processing_until?: string | null;
          manual_sync_requested_at?: string | null;
          next_sync_at?: string;
          scope_set?: string[];
          status?: string;
          sync_lease_expires_at?: string | null;
          sync_lease_id?: string | null;
          sync_window_start_at?: string | null;
          token_lease_expires_at?: string | null;
          token_lease_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          access_token_expires_at?: string | null;
          created_at?: string;
          credential_version?: string;
          email?: string;
          encrypted_access_token?: string | null;
          encrypted_refresh_token?: string | null;
          id?: string;
          last_sync_at?: string | null;
          manual_processing_until?: string | null;
          manual_sync_requested_at?: string | null;
          next_sync_at?: string;
          scope_set?: string[];
          status?: string;
          sync_lease_expires_at?: string | null;
          sync_lease_id?: string | null;
          sync_window_start_at?: string | null;
          token_lease_expires_at?: string | null;
          token_lease_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'gmail_accounts_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      gmail_oauth_attempts: {
        Row: {
          code_verifier: string;
          credential_version: string | null;
          expires_at: string;
          session_id: string;
          state_hash: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          code_verifier: string;
          credential_version?: string | null;
          expires_at: string;
          session_id: string;
          state_hash: string;
          user_id: string;
        };
        Update: {
          code_verifier?: string;
          credential_version?: string | null;
          expires_at?: string;
          session_id?: string;
          state_hash?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'gmail_oauth_attempts_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      gmail_onboarding: {
        Row: {
          consent_revision: string;
          consent_version: string;
          consented_at: string;
          error_code: string | null;
          finished_at: string | null;
          gmail_account_id: string | null;
          lease_expires_at: string | null;
          lease_id: string | null;
          profile_revision: string | null;
          scanned: number;
          scope: NonNullable<Json>;
          selected: number;
          started_at: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          consent_revision?: string;
          consent_version: string;
          consented_at?: string;
          error_code?: string | null;
          finished_at?: string | null;
          gmail_account_id?: string | null;
          lease_expires_at?: string | null;
          lease_id?: string | null;
          profile_revision?: string | null;
          scanned?: number;
          scope: NonNullable<Json>;
          selected?: number;
          started_at?: string | null;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          consent_revision?: string;
          consent_version?: string;
          consented_at?: string;
          error_code?: string | null;
          finished_at?: string | null;
          gmail_account_id?: string | null;
          lease_expires_at?: string | null;
          lease_id?: string | null;
          profile_revision?: string | null;
          scanned?: number;
          scope?: NonNullable<Json>;
          selected?: number;
          started_at?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'gmail_onboarding_gmail_account_id_user_id_fkey';
            columns: ['gmail_account_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_accounts';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'gmail_onboarding_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      gmail_sync_messages: {
        Row: {
          detected_at: string;
          gmail_account_id: string;
          message_id: string;
          thread_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          detected_at?: string;
          gmail_account_id: string;
          message_id: string;
          thread_id: string;
          user_id: string;
        };
        Update: {
          detected_at?: string;
          gmail_account_id?: string;
          message_id?: string;
          thread_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'gmail_sync_messages_gmail_account_id_user_id_fkey';
            columns: ['gmail_account_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_accounts';
            referencedColumns: ['id', 'user_id'];
          },
        ];
      };
      knowledge_chunks: {
        Row: {
          content: string;
          created_at: string;
          document_id: string;
          end_offset: number;
          id: string;
          page_end: number | null;
          page_start: number | null;
          position: number;
          search_vector: unknown;
          section: string;
          start_offset: number;
          user_id: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          content: string;
          created_at?: string;
          document_id: string;
          end_offset: number;
          id?: string;
          page_end?: number | null;
          page_start?: number | null;
          position: number;
          search_vector?: never;
          section: string;
          start_offset: number;
          user_id: string;
          version: number;
        };
        Update: {
          content?: string;
          created_at?: string;
          document_id?: string;
          end_offset?: number;
          id?: string;
          page_end?: number | null;
          page_start?: number | null;
          position?: number;
          search_vector?: never;
          section?: string;
          start_offset?: number;
          user_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'knowledge_chunks_document_id_user_id_version_fkey';
            columns: ['document_id', 'user_id', 'version'];
            isOneToOne: false;
            referencedRelation: 'source_documents';
            referencedColumns: ['id', 'user_id', 'version'];
          },
        ];
      };
      knowledge_sources: {
        Row: {
          created_at: string;
          enabled: boolean;
          id: string;
          priority: number;
          title: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          enabled?: boolean;
          id?: string;
          priority?: number;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          id?: string;
          priority?: number;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'knowledge_sources_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      operational_alerts: {
        Row: {
          affected_count: number;
          delivered_at: string | null;
          delivery_attempts: number;
          delivery_lease: string | null;
          delivery_lease_until: string | null;
          first_seen_at: string;
          id: string;
          kind: string;
          last_seen_at: string;
          next_delivery_at: string;
          resolved_at: string | null;
          run_id: string | null;
          severity: string;
          stage: string;
          state: string;
        };
        ComputedFields: never;
        Insert: {
          affected_count: number;
          delivered_at?: string | null;
          delivery_attempts?: number;
          delivery_lease?: string | null;
          delivery_lease_until?: string | null;
          first_seen_at?: string;
          id?: string;
          kind: string;
          last_seen_at?: string;
          next_delivery_at?: string;
          resolved_at?: string | null;
          run_id?: string | null;
          severity: string;
          stage: string;
          state?: string;
        };
        Update: {
          affected_count?: number;
          delivered_at?: string | null;
          delivery_attempts?: number;
          delivery_lease?: string | null;
          delivery_lease_until?: string | null;
          first_seen_at?: string;
          id?: string;
          kind?: string;
          last_seen_at?: string;
          next_delivery_at?: string;
          resolved_at?: string | null;
          run_id?: string | null;
          severity?: string;
          stage?: string;
          state?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'operational_alerts_run_id_fkey';
            columns: ['run_id'];
            isOneToOne: false;
            referencedRelation: 'operational_runs';
            referencedColumns: ['id'];
          },
        ];
      };
      operational_monitor_state: {
        Row: {
          checked_at: string | null;
          installed_at: string;
          singleton: boolean;
        };
        ComputedFields: never;
        Insert: {
          checked_at?: string | null;
          installed_at?: string;
          singleton?: boolean;
        };
        Update: {
          checked_at?: string | null;
          installed_at?: string;
          singleton?: boolean;
        };
        Relationships: [];
      };
      operational_runs: {
        Row: {
          duration_ms: number | null;
          finished_at: string | null;
          heartbeat_at: string;
          id: string;
          stage: string;
          started_at: string;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          duration_ms?: number | null;
          finished_at?: string | null;
          heartbeat_at?: string;
          id: string;
          stage: string;
          started_at?: string;
          status?: string;
        };
        Update: {
          duration_ms?: number | null;
          finished_at?: string | null;
          heartbeat_at?: string;
          id?: string;
          stage?: string;
          started_at?: string;
          status?: string;
        };
        Relationships: [];
      };
      operational_spans: {
        Row: {
          created_at: string;
          duration_ms: number;
          estimated_cost_usd: number | null;
          id: string;
          input_tokens: number | null;
          outcome: string;
          output_tokens: number | null;
          reason_code: string | null;
          run_id: string;
          stage: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          duration_ms: number;
          estimated_cost_usd?: number | null;
          id: string;
          input_tokens?: number | null;
          outcome: string;
          output_tokens?: number | null;
          reason_code?: string | null;
          run_id: string;
          stage: string;
        };
        Update: {
          created_at?: string;
          duration_ms?: number;
          estimated_cost_usd?: number | null;
          id?: string;
          input_tokens?: number | null;
          outcome?: string;
          output_tokens?: number | null;
          reason_code?: string | null;
          run_id?: string;
          stage?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'operational_spans_run_id_fkey';
            columns: ['run_id'];
            isOneToOne: false;
            referencedRelation: 'operational_runs';
            referencedColumns: ['id'];
          },
        ];
      };
      privacy_authorizations: {
        Row: {
          accepted_at: string;
          notice_hash: string;
          notice_text: string;
          notice_version: string;
          user_id: string;
          withdrawn_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string;
          notice_hash: string;
          notice_text: string;
          notice_version: string;
          user_id: string;
          withdrawn_at?: string | null;
        };
        Update: {
          accepted_at?: string;
          notice_hash?: string;
          notice_text?: string;
          notice_version?: string;
          user_id?: string;
          withdrawn_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'privacy_authorizations_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      privacy_events: {
        Row: {
          action: string;
          created_at: string;
          id: string;
          notice_hash: string;
          notice_text: string;
          notice_version: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          created_at?: string;
          id?: string;
          notice_hash: string;
          notice_text: string;
          notice_version: string;
          user_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          id?: string;
          notice_hash?: string;
          notice_text?: string;
          notice_version?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'privacy_events_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      processing_runs: {
        Row: {
          created_at: string;
          drafts_created: number;
          error_code: string | null;
          error_count: number;
          finished_at: string | null;
          gmail_account_id: string;
          id: string;
          messages_detected: number;
          messages_processed: number;
          started_at: string;
          status: string;
          trigger_kind: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          drafts_created?: number;
          error_code?: string | null;
          error_count?: number;
          finished_at?: string | null;
          gmail_account_id: string;
          id?: string;
          messages_detected?: number;
          messages_processed?: number;
          started_at?: string;
          status?: string;
          trigger_kind?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          drafts_created?: number;
          error_code?: string | null;
          error_count?: number;
          finished_at?: string | null;
          gmail_account_id?: string;
          id?: string;
          messages_detected?: number;
          messages_processed?: number;
          started_at?: string;
          status?: string;
          trigger_kind?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'processing_runs_account_owner_fkey';
            columns: ['gmail_account_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_accounts';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'processing_runs_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      response_policy_events: {
        Row: {
          action: string;
          created_at: string;
          engine_version: string;
          evaluation_id: string;
          gmail_account_id: string;
          id: string;
          phase: string;
          policy_revision: string;
          reasons: string[];
          target_message_id: string;
          thread_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          created_at?: string;
          engine_version: string;
          evaluation_id: string;
          gmail_account_id: string;
          id?: string;
          phase: string;
          policy_revision: string;
          reasons: string[];
          target_message_id: string;
          thread_id: string;
          user_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          engine_version?: string;
          evaluation_id?: string;
          gmail_account_id?: string;
          id?: string;
          phase?: string;
          policy_revision?: string;
          reasons?: string[];
          target_message_id?: string;
          thread_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'response_policy_events_account_owner_fkey';
            columns: ['gmail_account_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_accounts';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'response_policy_events_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      response_validation_events: {
        Row: {
          created_at: string;
          evaluation_id: string;
          gmail_account_id: string;
          id: string;
          target_message_id: string;
          thread_id: string;
          user_id: string;
          validation: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          evaluation_id: string;
          gmail_account_id: string;
          id?: string;
          target_message_id: string;
          thread_id: string;
          user_id: string;
          validation: NonNullable<Json>;
        };
        Update: {
          created_at?: string;
          evaluation_id?: string;
          gmail_account_id?: string;
          id?: string;
          target_message_id?: string;
          thread_id?: string;
          user_id?: string;
          validation?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: 'response_validation_events_account_owner_fkey';
            columns: ['gmail_account_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_accounts';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'response_validation_events_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      source_document_texts: {
        Row: {
          document_id: string;
          normalized_text: string | null;
          text_content: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          document_id: string;
          normalized_text?: string | null;
          text_content: string;
          user_id: string;
        };
        Update: {
          document_id?: string;
          normalized_text?: string | null;
          text_content?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'source_document_texts_document_id_user_id_fkey';
            columns: ['document_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'source_documents';
            referencedColumns: ['id', 'user_id'];
          },
        ];
      };
      source_documents: {
        Row: {
          audience_key: string;
          audience_kind: string;
          byte_size: number;
          chunk_count: number;
          content_updated_at: string;
          error_code: string | null;
          has_file: boolean;
          id: string;
          index_hash: string | null;
          indexed_at: string | null;
          indexer_version: string | null;
          mime_type: string;
          name: string;
          sha256: string;
          source_id: string | null;
          status: string;
          text_length: number;
          updated_at: string;
          uploaded_at: string;
          user_id: string;
          valid_from: string | null;
          valid_until: string | null;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          audience_key?: string;
          audience_kind?: string;
          byte_size: number;
          chunk_count?: number;
          content_updated_at?: string;
          error_code?: string | null;
          has_file?: boolean;
          id?: string;
          index_hash?: string | null;
          indexed_at?: string | null;
          indexer_version?: string | null;
          mime_type: string;
          name: string;
          sha256: string;
          source_id?: string | null;
          status?: string;
          text_length?: number;
          updated_at?: string;
          uploaded_at?: string;
          user_id: string;
          valid_from?: string | null;
          valid_until?: string | null;
          version?: number;
        };
        Update: {
          audience_key?: string;
          audience_kind?: string;
          byte_size?: number;
          chunk_count?: number;
          content_updated_at?: string;
          error_code?: string | null;
          has_file?: boolean;
          id?: string;
          index_hash?: string | null;
          indexed_at?: string | null;
          indexer_version?: string | null;
          mime_type?: string;
          name?: string;
          sha256?: string;
          source_id?: string | null;
          status?: string;
          text_length?: number;
          updated_at?: string;
          uploaded_at?: string;
          user_id?: string;
          valid_from?: string | null;
          valid_until?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'source_documents_source_owner_fk';
            columns: ['source_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'knowledge_sources';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'source_documents_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      source_rule_sources: {
        Row: {
          ordinal: number;
          role: string;
          rule_id: string;
          source_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          ordinal: number;
          role: string;
          rule_id: string;
          source_id: string;
          user_id: string;
        };
        Update: {
          ordinal?: number;
          role?: string;
          rule_id?: string;
          source_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'source_rule_sources_rule_id_user_id_fkey';
            columns: ['rule_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'source_rules';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'source_rule_sources_source_id_user_id_fkey';
            columns: ['source_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'knowledge_sources';
            referencedColumns: ['id', 'user_id'];
          },
        ];
      };
      source_rules: {
        Row: {
          allow_email_history: boolean;
          created_at: string;
          enabled: boolean;
          id: string;
          intent_key: string;
          priority: number;
          terms: string[];
          title: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          allow_email_history?: boolean;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          intent_key: string;
          priority?: number;
          terms?: string[];
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          allow_email_history?: boolean;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          intent_key?: string;
          priority?: number;
          terms?: string[];
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'source_rules_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      style_learning_proposals: {
        Row: {
          applied_revision: string | null;
          applied_version: number | null;
          audiences: number;
          automatic: boolean;
          base_revision: string;
          base_version: number;
          before_profile: Json | null;
          category: string;
          created_at: string;
          days: number;
          decided_at: string | null;
          feature: string;
          feedback_ids: string[];
          first_feedback_at: string;
          general_revision: string;
          gmail_account_id: string;
          id: string;
          profile_id: string;
          reverted_revision: string | null;
          status: string;
          support: number;
          threads: number;
          total: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          applied_revision?: string | null;
          applied_version?: number | null;
          audiences: number;
          automatic?: boolean;
          base_revision: string;
          base_version: number;
          before_profile?: Json | null;
          category: string;
          created_at?: string;
          days: number;
          decided_at?: string | null;
          feature: string;
          feedback_ids: string[];
          first_feedback_at: string;
          general_revision: string;
          gmail_account_id: string;
          id?: string;
          profile_id: string;
          reverted_revision?: string | null;
          status?: string;
          support: number;
          threads: number;
          total: number;
          user_id: string;
        };
        Update: {
          applied_revision?: string | null;
          applied_version?: number | null;
          audiences?: number;
          automatic?: boolean;
          base_revision?: string;
          base_version?: number;
          before_profile?: Json | null;
          category?: string;
          created_at?: string;
          days?: number;
          decided_at?: string | null;
          feature?: string;
          feedback_ids?: string[];
          first_feedback_at?: string;
          general_revision?: string;
          gmail_account_id?: string;
          id?: string;
          profile_id?: string;
          reverted_revision?: string | null;
          status?: string;
          support?: number;
          threads?: number;
          total?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'style_learning_proposals_gmail_account_id_user_id_fkey';
            columns: ['gmail_account_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_accounts';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'style_learning_proposals_profile_id_user_id_gmail_account__fkey';
            columns: ['profile_id', 'user_id', 'gmail_account_id'];
            isOneToOne: false;
            referencedRelation: 'style_profiles';
            referencedColumns: ['id', 'user_id', 'gmail_account_id'];
          },
          {
            foreignKeyName: 'style_learning_proposals_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      style_learning_settings: {
        Row: {
          authorized_at: string | null;
          auto_remove_salutations: boolean;
          gmail_account_id: string;
          revision: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          authorized_at?: string | null;
          auto_remove_salutations?: boolean;
          gmail_account_id: string;
          revision?: string;
          user_id: string;
        };
        Update: {
          authorized_at?: string | null;
          auto_remove_salutations?: boolean;
          gmail_account_id?: string;
          revision?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'style_learning_settings_gmail_account_id_user_id_fkey';
            columns: ['gmail_account_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_accounts';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'style_learning_settings_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      style_preferences: {
        Row: {
          created_at: string;
          gmail_account_id: string;
          origin: string;
          preference_key: string;
          preference_value: string;
          revision: string;
          scope_key: string;
          scope_kind: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          gmail_account_id: string;
          origin?: string;
          preference_key: string;
          preference_value: string;
          revision?: string;
          scope_key?: string;
          scope_kind?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          gmail_account_id?: string;
          origin?: string;
          preference_key?: string;
          preference_value?: string;
          revision?: string;
          scope_key?: string;
          scope_kind?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'style_preferences_owner_fkey';
            columns: ['gmail_account_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_accounts';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'style_preferences_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      style_profiles: {
        Row: {
          context_evidence: NonNullable<Json>;
          created_at: string;
          generated_at: string;
          gmail_account_id: string;
          id: string;
          input_tokens: number;
          model: string;
          origin: string;
          output_tokens: number;
          parent_revision: string | null;
          profile: NonNullable<Json>;
          prompt_version: string;
          relationship_rule_revisions: string[];
          review_status: string;
          reviewed_at: string | null;
          revision: string;
          sample_size: number;
          scope_key: string;
          scope_kind: string;
          source_message_ids: string[];
          updated_at: string;
          user_id: string;
          version: number;
          warnings: string[];
        };
        ComputedFields: never;
        Insert: {
          context_evidence?: NonNullable<Json>;
          created_at?: string;
          generated_at?: string;
          gmail_account_id: string;
          id?: string;
          input_tokens: number;
          model: string;
          origin?: string;
          output_tokens: number;
          parent_revision?: string | null;
          profile: NonNullable<Json>;
          prompt_version: string;
          relationship_rule_revisions?: string[];
          review_status?: string;
          reviewed_at?: string | null;
          revision?: string;
          sample_size: number;
          scope_key?: string;
          scope_kind?: string;
          source_message_ids?: string[];
          updated_at?: string;
          user_id: string;
          version?: number;
          warnings?: string[];
        };
        Update: {
          context_evidence?: NonNullable<Json>;
          created_at?: string;
          generated_at?: string;
          gmail_account_id?: string;
          id?: string;
          input_tokens?: number;
          model?: string;
          origin?: string;
          output_tokens?: number;
          parent_revision?: string | null;
          profile?: NonNullable<Json>;
          prompt_version?: string;
          relationship_rule_revisions?: string[];
          review_status?: string;
          reviewed_at?: string | null;
          revision?: string;
          sample_size?: number;
          scope_key?: string;
          scope_kind?: string;
          source_message_ids?: string[];
          updated_at?: string;
          user_id?: string;
          version?: number;
          warnings?: string[];
        };
        Relationships: [
          {
            foreignKeyName: 'style_profiles_account_owner_fkey';
            columns: ['gmail_account_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_accounts';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'style_profiles_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      style_relationships: {
        Row: {
          category: string;
          created_at: string;
          gmail_account_id: string;
          match_key: string;
          match_kind: string;
          revision: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          category: string;
          created_at?: string;
          gmail_account_id: string;
          match_key: string;
          match_kind: string;
          revision?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          gmail_account_id?: string;
          match_key?: string;
          match_kind?: string;
          revision?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'style_relationships_owner_fkey';
            columns: ['gmail_account_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_accounts';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'style_relationships_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      user_settings: {
        Row: {
          allow_partial_knowledge_drafts: boolean;
          automation_enabled: boolean;
          classifier_excluded_addresses: string[];
          classifier_excluded_domains: string[];
          created_at: string;
          max_daily_drafts: number;
          poll_interval_seconds: number;
          processing_scope: string;
          response_policy: NonNullable<Json>;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          allow_partial_knowledge_drafts?: boolean;
          automation_enabled?: boolean;
          classifier_excluded_addresses?: string[];
          classifier_excluded_domains?: string[];
          created_at?: string;
          max_daily_drafts?: number;
          poll_interval_seconds?: number;
          processing_scope?: string;
          response_policy?: NonNullable<Json>;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          allow_partial_knowledge_drafts?: boolean;
          automation_enabled?: boolean;
          classifier_excluded_addresses?: string[];
          classifier_excluded_domains?: string[];
          created_at?: string;
          max_daily_drafts?: number;
          poll_interval_seconds?: number;
          processing_scope?: string;
          response_policy?: NonNullable<Json>;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_settings_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      users: {
        Row: {
          created_at: string;
          id: string;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      reply_comparison_daily: {
        Row: {
          average_edit_ratio: number | null;
          average_effort_ratio: number | null;
          average_similarity: number | null;
          compared: number | null;
          content_review: number | null;
          day: string | null;
          factual_review: number | null;
          gmail_account_id: string | null;
          learning_eligible: number | null;
          pending: number | null;
          skipped: number | null;
          style_only: number | null;
          total: number | null;
          unchanged: number | null;
          user_id: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: 'feedback_events_gmail_account_id_user_id_fkey';
            columns: ['gmail_account_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_accounts';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'feedback_events_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      acquire_provider_request: {
        Args: {
          p_account_id?: string;
          p_account_max_concurrent: number;
          p_account_requests_per_minute: number;
          p_lease_seconds: number;
          p_max_concurrent: number;
          p_provider: string;
          p_requests_per_minute: number;
          p_user_id?: string;
        };
        Returns: {
          lease_id: string;
          retry_after_ms: number;
        }[];
      };
      activity_job_summary: {
        Args: { p_job_id: string; p_user_id: string };
        Returns: Json;
      };
      advance_account_deletion: {
        Args: {
          p_error?: string;
          p_lease_id: string;
          p_phase: string;
          p_request_id: string;
          p_revocation: string;
        };
        Returns: boolean;
      };
      advance_email_job: {
        Args: {
          p_account_id: string;
          p_classification?: Json;
          p_draft_id?: string;
          p_expected_status: string;
          p_job_id: string;
          p_lease_id: string;
          p_reason_code?: string;
          p_status: string;
          p_user_id: string;
        };
        Returns: {
          attempt_count: number;
          available_at: string;
          classification: Json | null;
          classification_finished_at: string | null;
          classification_started_at: string | null;
          created_at: string;
          draft_id: string | null;
          finished_at: string | null;
          generation_finished_at: string | null;
          generation_started_at: string | null;
          gmail_account_id: string;
          id: string;
          lease_expires_at: string | null;
          lease_id: string | null;
          reason_code: string | null;
          started_at: string | null;
          status: string;
          target_message_id: string;
          thread_id: string;
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'email_jobs';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      advance_onboarding_analysis: {
        Args: {
          p_lease_id: string;
          p_phase: string;
          p_scanned: number;
          p_selected: number;
          p_user_id: string;
        };
        Returns: boolean;
      };
      analytics_period_totals: {
        Args: { p_from: string; p_to: string; p_user_id: string };
        Returns: Json;
      };
      analytics_reason_counts: {
        Args: {
          p_from: string;
          p_status: string;
          p_to: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      assign_document_source: {
        Args: {
          p_document_id: string;
          p_source_id?: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      begin_draft_write: {
        Args: {
          p_account_id: string;
          p_attempt_id: string;
          p_job_id?: string;
          p_lease_id?: string;
          p_target_message_id: string;
          p_thread_id: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      begin_source_document_deletion: {
        Args: { p_document_id: string; p_user_id: string };
        Returns: boolean;
      };
      check_operational_health: {
        Args: {
          p_repeated_errors?: number;
          p_stale_seconds?: number;
          p_window_seconds?: number;
        };
        Returns: Json;
      };
      claim_account_deletion: {
        Args: { p_request_id?: string };
        Returns: {
          attempts: number;
          completed_at: string | null;
          error_code: string | null;
          id: string;
          lease_expires_at: string | null;
          lease_id: string | null;
          next_attempt_at: string;
          phase: string;
          receipt_hash: string;
          requested_at: string;
          revocation: string;
          status: string;
          user_id: string | null;
        }[];
        SetofOptions: {
          from: '*';
          to: 'account_deletion_requests';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_draft_reconciliation: {
        Args: { p_lease_seconds?: number; p_limit?: number };
        Returns: {
          created_at: string;
          delivery_envelope_hash: string | null;
          delivery_intent: Json | null;
          draft_id: string | null;
          draft_internet_message_id: string | null;
          draft_message_id: string | null;
          email_job_id: string | null;
          factual_validation: Json | null;
          generation_run_id: string | null;
          gmail_account_id: string;
          id: string;
          input_tokens: number;
          knowledge_revision: string | null;
          model: string;
          output_tokens: number;
          policy_revision: string | null;
          prompt_version: string;
          reason_code: string | null;
          reconciliation_checked_at: string | null;
          reconciliation_lease_expires_at: string | null;
          reconciliation_lease_id: string | null;
          reconciliation_next_at: string;
          reconciliation_result: string | null;
          sent_checked_at: string | null;
          sent_lease_expires_at: string | null;
          sent_lease_id: string | null;
          sent_next_check_at: string;
          sent_outcome: NonNullable<Json>;
          sources_used: NonNullable<Json>;
          status: string;
          style_revision: string;
          target_message_id: string;
          thread_id: string;
          updated_at: string;
          user_id: string;
          verified_at: string | null;
          warnings: string[];
          write_started_at: string | null;
        }[];
        SetofOptions: {
          from: '*';
          to: 'draft_generations';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_email_job: {
        Args: { p_include_generation?: boolean; p_lease_seconds: number };
        Returns: {
          attempt_count: number;
          available_at: string;
          classification: Json | null;
          classification_finished_at: string | null;
          classification_started_at: string | null;
          created_at: string;
          draft_id: string | null;
          finished_at: string | null;
          generation_finished_at: string | null;
          generation_started_at: string | null;
          gmail_account_id: string;
          id: string;
          lease_expires_at: string | null;
          lease_id: string | null;
          reason_code: string | null;
          started_at: string | null;
          status: string;
          target_message_id: string;
          thread_id: string;
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'email_jobs';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_gmail_sync: {
        Args: {
          p_initial_lookback_seconds: number;
          p_lease_seconds: number;
          p_overlap_seconds: number;
        };
        Returns: {
          gmail_account_id: string;
          run_id: string;
          user_id: string;
          window_end_at: string;
          window_start_at: string;
        }[];
      };
      claim_onboarding_analysis: {
        Args: Record<PropertyKey, never>;
        Returns: {
          consent_revision: string;
          consent_version: string;
          consented_at: string;
          error_code: string | null;
          finished_at: string | null;
          gmail_account_id: string | null;
          lease_expires_at: string | null;
          lease_id: string | null;
          profile_revision: string | null;
          scanned: number;
          scope: NonNullable<Json>;
          selected: number;
          started_at: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'gmail_onboarding';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_operational_alerts: {
        Args: { p_limit?: number };
        Returns: {
          affected_count: number;
          delivered_at: string | null;
          delivery_attempts: number;
          delivery_lease: string | null;
          delivery_lease_until: string | null;
          first_seen_at: string;
          id: string;
          kind: string;
          last_seen_at: string;
          next_delivery_at: string;
          resolved_at: string | null;
          run_id: string | null;
          severity: string;
          stage: string;
          state: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'operational_alerts';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_reply_comparisons: {
        Args: { p_lease_seconds?: number; p_limit?: number };
        Returns: Json;
      };
      claim_sent_draft_tracking: {
        Args: { p_lease_seconds?: number; p_limit?: number };
        Returns: {
          created_at: string;
          delivery_envelope_hash: string | null;
          delivery_intent: Json | null;
          draft_id: string | null;
          draft_internet_message_id: string | null;
          draft_message_id: string | null;
          email_job_id: string | null;
          factual_validation: Json | null;
          generation_run_id: string | null;
          gmail_account_id: string;
          id: string;
          input_tokens: number;
          knowledge_revision: string | null;
          model: string;
          output_tokens: number;
          policy_revision: string | null;
          prompt_version: string;
          reason_code: string | null;
          reconciliation_checked_at: string | null;
          reconciliation_lease_expires_at: string | null;
          reconciliation_lease_id: string | null;
          reconciliation_next_at: string;
          reconciliation_result: string | null;
          sent_checked_at: string | null;
          sent_lease_expires_at: string | null;
          sent_lease_id: string | null;
          sent_next_check_at: string;
          sent_outcome: NonNullable<Json>;
          sources_used: NonNullable<Json>;
          status: string;
          style_revision: string;
          target_message_id: string;
          thread_id: string;
          updated_at: string;
          user_id: string;
          verified_at: string | null;
          warnings: string[];
          write_started_at: string | null;
        }[];
        SetofOptions: {
          from: '*';
          to: 'draft_generations';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      complete_indexed_source_document: {
        Args: {
          p_document_id: string;
          p_index: Json;
          p_text: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      complete_source_document: {
        Args: { p_document_id: string; p_text: string; p_user_id: string };
        Returns: boolean;
      };
      contain_security_incident: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      control_onboarding_analysis: {
        Args: { p_action: string; p_revision: string; p_user_id: string };
        Returns: boolean;
      };
      cooldown_provider_requests: {
        Args: {
          p_account_id?: string;
          p_delay_ms: number;
          p_provider: string;
          p_user_id?: string;
        };
        Returns: undefined;
      };
      daily_draft_usage: { Args: { p_user_id: string }; Returns: number };
      decide_style_learning: {
        Args: {
          p_account_id: string;
          p_action: string;
          p_automatic?: boolean;
          p_expected_revision: string;
          p_proposal_id: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      delete_knowledge_source_item: {
        Args: { p_id: string; p_kind: string; p_user_id: string };
        Returns: boolean;
      };
      delete_writing_identity: {
        Args: { p_user_id: string };
        Returns: boolean;
      };
      edit_writing_style: {
        Args: {
          p_account_id: string;
          p_action?: string;
          p_expected_revisions?: string[];
          p_general_revision: string;
          p_preferences?: Json;
          p_profile_revision?: string;
          p_reviewed?: boolean;
          p_scope_key: string;
          p_scope_kind: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      email_job_intervention_reason: {
        Args: { p_reason: string; p_status: string };
        Returns: boolean;
      };
      email_job_transition_allowed: {
        Args: { p_from: string; p_to: string };
        Returns: boolean;
      };
      enforce_privacy_configuration: {
        Args: { p_notice_hash?: string };
        Returns: boolean;
      };
      find_archived_draft: {
        Args: {
          p_account_id: string;
          p_target_message_id: string;
          p_user_id: string;
        };
        Returns: {
          id: string;
          sent: boolean;
          thread_id: string;
        }[];
      };
      finish_draft_reconciliation: {
        Args: {
          p_account_id: string;
          p_attempt_id: string;
          p_draft_id?: string;
          p_lease_id: string;
          p_message_id?: string;
          p_result: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      finish_gmail_sync: {
        Args: {
          p_account_id: string;
          p_error_code?: string;
          p_run_id: string;
          p_success: boolean;
          p_user_id: string;
        };
        Returns: boolean;
      };
      finish_onboarding_analysis: {
        Args: {
          p_error?: string;
          p_generation?: Json;
          p_lease_id: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      finish_operational_alert_delivery: {
        Args: { p_id: string; p_lease: string; p_success: boolean };
        Returns: boolean;
      };
      finish_operational_run: {
        Args: {
          p_duration_ms: number;
          p_failed: boolean;
          p_id: string;
          p_spans: Json;
        };
        Returns: boolean;
      };
      finish_reply_comparison: {
        Args: {
          p_account_id: string;
          p_feedback_id: string;
          p_lease_id: string;
          p_result: Json;
          p_user_id: string;
        };
        Returns: boolean;
      };
      finish_sent_draft_tracking: {
        Args: {
          p_account_id: string;
          p_attempt_id: string;
          p_draft_internet_message_id?: string;
          p_lease_id: string;
          p_outcome: Json;
          p_user_id: string;
        };
        Returns: boolean;
      };
      get_activity_detail: {
        Args: { p_job_id: string; p_user_id: string };
        Returns: Json;
      };
      get_activity_feed: {
        Args: {
          p_before?: string;
          p_before_id?: string;
          p_limit?: number;
          p_status?: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      get_analytics_dashboard: {
        Args: { p_as_of?: string; p_days?: number; p_user_id: string };
        Returns: Json;
      };
      get_automation_configuration: {
        Args: { p_user_id: string };
        Returns: Json;
      };
      get_knowledge_source_configuration: {
        Args: { p_user_id: string };
        Returns: Json;
      };
      get_response_policy: { Args: { p_user_id: string }; Returns: Json };
      get_style_learning: {
        Args: { p_account_id: string; p_user_id: string };
        Returns: Json;
      };
      gmail_execution_allowed: {
        Args: { p_account_id: string; p_user_id: string };
        Returns: boolean;
      };
      grant_privacy_authorization: {
        Args: {
          p_notice_hash: string;
          p_notice_text: string;
          p_user_id: string;
          p_version: string;
        };
        Returns: boolean;
      };
      load_reply_comparison_original: {
        Args: {
          p_account_id: string;
          p_feedback_id: string;
          p_lease_id: string;
          p_user_id: string;
        };
        Returns: string;
      };
      privacy_authorization_valid: {
        Args: { p_notice_hash?: string; p_user_id: string };
        Returns: boolean;
      };
      purge_account_audit: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      purge_account_data: {
        Args: { p_lease_id: string; p_request_id: string };
        Returns: boolean;
      };
      purge_generation_content: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      purge_operational_telemetry: {
        Args: { p_days?: number };
        Returns: undefined;
      };
      purge_private_data: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      raise_operational_alert: {
        Args: {
          p_count: number;
          p_kind: string;
          p_run_id?: string;
          p_stage: string;
        };
        Returns: undefined;
      };
      read_generation_content: {
        Args: { p_generation_run_id: string; p_user_id: string };
        Returns: string;
      };
      record_generation_run: {
        Args: {
          p_account_id: string;
          p_body_text?: string;
          p_configuration: Json;
          p_duration_ms: number;
          p_estimated_cost_usd?: number;
          p_id: string;
          p_input_tokens?: number;
          p_job_id?: string;
          p_model: string;
          p_model_calls?: number;
          p_output_tokens?: number;
          p_pricing: Json;
          p_sources_used: Json;
          p_status: string;
          p_target_message_id: string;
          p_thread_id: string;
          p_user_id: string;
          p_warnings: string[];
        };
        Returns: undefined;
      };
      record_gmail_sync_page: {
        Args: {
          p_account_id: string;
          p_messages: Json;
          p_run_id: string;
          p_user_id: string;
        };
        Returns: number;
      };
      recover_email_jobs: { Args: { p_limit?: number }; Returns: number };
      recover_erasure_request: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
      refresh_style_learning: { Args: { p_limit?: number }; Returns: number };
      release_provider_request: {
        Args: { p_account_id?: string; p_lease_id: string; p_user_id?: string };
        Returns: undefined;
      };
      release_security_hold: {
        Args: { p_reviewed: boolean };
        Returns: boolean;
      };
      renew_email_job: {
        Args: {
          p_account_id: string;
          p_job_id: string;
          p_lease_id: string;
          p_lease_seconds: number;
          p_user_id: string;
        };
        Returns: boolean;
      };
      renew_gmail_sync: {
        Args: {
          p_account_id: string;
          p_lease_seconds: number;
          p_run_id: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      replace_knowledge_index: {
        Args: {
          p_document_id: string;
          p_index: Json;
          p_sha256: string;
          p_text_hash: string;
          p_user_id: string;
          p_version: number;
        };
        Returns: boolean;
      };
      request_account_deletion: {
        Args: { p_receipt_hash: string; p_user_id: string };
        Returns: string;
      };
      request_manual_processing: {
        Args: { p_account_id: string; p_user_id: string };
        Returns: boolean;
      };
      reserve_source_document: {
        Args: {
          p_byte_size: number;
          p_mime_type: string;
          p_name: string;
          p_sha256: string;
          p_user_id: string;
        };
        Returns: {
          audience_key: string;
          audience_kind: string;
          byte_size: number;
          chunk_count: number;
          content_updated_at: string;
          error_code: string | null;
          has_file: boolean;
          id: string;
          index_hash: string | null;
          indexed_at: string | null;
          indexer_version: string | null;
          mime_type: string;
          name: string;
          sha256: string;
          source_id: string | null;
          status: string;
          text_length: number;
          updated_at: string;
          uploaded_at: string;
          user_id: string;
          valid_from: string | null;
          valid_until: string | null;
          version: number;
        };
        SetofOptions: {
          from: '*';
          to: 'source_documents';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      retry_email_job: {
        Args: { p_account_id: string; p_job_id: string; p_user_id: string };
        Returns: boolean;
      };
      save_knowledge_source: {
        Args: {
          p_enabled: boolean;
          p_priority: number;
          p_source_id?: string;
          p_title: string;
          p_user_id: string;
        };
        Returns: {
          created_at: string;
          enabled: boolean;
          id: string;
          priority: number;
          title: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'knowledge_sources';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      save_onboarding_consent: {
        Args: {
          p_consented: boolean;
          p_scope: Json;
          p_user_id: string;
          p_version: string;
        };
        Returns: boolean;
      };
      save_source_rule: {
        Args: {
          p_allow_email_history: boolean;
          p_enabled: boolean;
          p_excluded_ids: string[];
          p_fallback_ids: string[];
          p_intent: string;
          p_primary_ids: string[];
          p_priority: number;
          p_rule_id?: string;
          p_terms: string[];
          p_title: string;
          p_user_id: string;
        };
        Returns: {
          allow_email_history: boolean;
          created_at: string;
          enabled: boolean;
          id: string;
          intent_key: string;
          priority: number;
          terms: string[];
          title: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'source_rules';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      search_knowledge_chunks: {
        Args: {
          p_document_id?: string;
          p_limit?: number;
          p_query: string;
          p_user_id: string;
        };
        Returns: {
          chunk_id: string;
          content: string;
          document_id: string;
          document_name: string;
          end_offset: number;
          page_end: number;
          page_start: number;
          position: number;
          rank: number;
          section: string;
          start_offset: number;
          version: number;
        }[];
      };
      search_knowledge_context_chunks:
        | {
            Args: {
              p_limit?: number;
              p_query: string;
              p_revision: string;
              p_source_ids: string[];
              p_user_id: string;
            };
            Returns: {
              chunk_id: string;
              content: string;
              document_id: string;
              document_name: string;
              document_updated_at: string;
              end_offset: number;
              page_end: number;
              page_start: number;
              position: number;
              rank: number;
              section: string;
              source_id: string;
              source_title: string;
              start_offset: number;
              valid_from: string;
              valid_until: string;
              version: number;
            }[];
          }
        | {
            Args: {
              p_limit: number;
              p_query: string;
              p_recipient: string;
              p_revision: string;
              p_source_ids: string[];
              p_user_id: string;
            };
            Returns: {
              audience_key: string;
              audience_kind: string;
              chunk_id: string;
              content: string;
              document_id: string;
              document_name: string;
              document_updated_at: string;
              end_offset: number;
              page_end: number;
              page_start: number;
              position: number;
              rank: number;
              section: string;
              source_id: string;
              source_title: string;
              start_offset: number;
              valid_from: string;
              valid_until: string;
              version: number;
            }[];
          };
      search_knowledge_source_chunks: {
        Args: {
          p_limit?: number;
          p_query: string;
          p_revision: string;
          p_source_ids: string[];
          p_user_id: string;
        };
        Returns: {
          chunk_id: string;
          content: string;
          document_id: string;
          document_name: string;
          end_offset: number;
          page_end: number;
          page_start: number;
          position: number;
          rank: number;
          section: string;
          source_id: string;
          source_title: string;
          start_offset: number;
          version: number;
        }[];
      };
      security_access_allowed: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      set_automation_configuration: {
        Args: { p_revision: string; p_settings: Json; p_user_id: string };
        Returns: Json;
      };
      set_automation_settings: {
        Args: {
          p_daily_limit: number;
          p_enabled: boolean;
          p_poll_seconds: number;
          p_user_id: string;
        };
        Returns: boolean;
      };
      set_document_audience: {
        Args: {
          p_document_id: string;
          p_key: string;
          p_kind: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      set_document_validity: {
        Args: {
          p_document_id: string;
          p_user_id: string;
          p_valid_from?: string;
          p_valid_until?: string;
        };
        Returns: boolean;
      };
      set_generation_retention: {
        Args: {
          p_account_id: string;
          p_enabled: boolean;
          p_notice_version?: string;
          p_retention_hours?: number;
          p_user_id: string;
        };
        Returns: undefined;
      };
      set_gmail_processing_paused: {
        Args: { p_account_id: string; p_paused: boolean; p_user_id: string };
        Returns: boolean;
      };
      set_knowledge_sufficiency_preferences: {
        Args: { p_allow_partial_drafts: boolean; p_user_id: string };
        Returns: boolean;
      };
      set_response_policy: {
        Args: { p_settings: Json; p_user_id: string };
        Returns: boolean;
      };
      set_style_learning_settings: {
        Args: {
          p_account_id: string;
          p_enabled: boolean;
          p_expected_revision?: string;
          p_notice_version?: string;
          p_user_id: string;
        };
        Returns: undefined;
      };
      stop_account_work: {
        Args: { p_reason: string; p_user_id: string };
        Returns: undefined;
      };
      style_learning_evidence: {
        Args: { p_category: string; p_feature: string; p_profile_id: string };
        Returns: Json;
      };
      style_learning_evidence_valid: {
        Args: { p_evidence: Json; p_general: boolean };
        Returns: boolean;
      };
      style_learning_phrases: {
        Args: { p_category: string; p_feature: string; p_language: string };
        Returns: Json;
      };
      style_learning_profile_current: {
        Args: {
          p_general: Omit<
            Database['public']['Tables']['style_profiles']['Row'],
            Database['public']['Tables']['style_profiles']['ComputedFields']
          >;
          p_profile: Omit<
            Database['public']['Tables']['style_profiles']['Row'],
            Database['public']['Tables']['style_profiles']['ComputedFields']
          >;
        };
        Returns: boolean;
      };
      valid_classifier_exclusions: {
        Args: { p_addresses: string[]; p_domains: string[] };
        Returns: boolean;
      };
      valid_email_job_classification: {
        Args: { p_value: Json };
        Returns: boolean;
      };
      valid_factual_validation: { Args: { p_value: Json }; Returns: boolean };
      valid_onboarding_scope: { Args: { value: Json }; Returns: boolean };
      valid_reply_sources: { Args: { p_sources: Json }; Returns: boolean };
      valid_response_policy: { Args: { p_settings: Json }; Returns: boolean };
      valid_response_policy_evaluation: {
        Args: { p_value: Json };
        Returns: boolean;
      };
      valid_style_profile_sources: {
        Args: { expected: number; ids: string[]; legacy: boolean };
        Returns: boolean;
      };
      valid_style_scope: {
        Args: { key: string; kind: string };
        Returns: boolean;
      };
      withdraw_privacy_authorization: {
        Args: { p_user_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
