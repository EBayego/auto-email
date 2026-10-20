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
      draft_generations: {
        Row: {
          created_at: string;
          draft_id: string | null;
          draft_message_id: string | null;
          gmail_account_id: string;
          id: string;
          input_tokens: number;
          model: string;
          output_tokens: number;
          prompt_version: string;
          reason_code: string | null;
          status: string;
          style_revision: string;
          target_message_id: string;
          thread_id: string;
          updated_at: string;
          user_id: string;
          verified_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          draft_id?: string | null;
          draft_message_id?: string | null;
          gmail_account_id: string;
          id: string;
          input_tokens: number;
          model: string;
          output_tokens: number;
          prompt_version: string;
          reason_code?: string | null;
          status?: string;
          style_revision: string;
          target_message_id: string;
          thread_id: string;
          updated_at?: string;
          user_id: string;
          verified_at?: string | null;
        };
        Update: {
          created_at?: string;
          draft_id?: string | null;
          draft_message_id?: string | null;
          gmail_account_id?: string;
          id?: string;
          input_tokens?: number;
          model?: string;
          output_tokens?: number;
          prompt_version?: string;
          reason_code?: string | null;
          status?: string;
          style_revision?: string;
          target_message_id?: string;
          thread_id?: string;
          updated_at?: string;
          user_id?: string;
          verified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'draft_generations_account_owner_fkey';
            columns: ['gmail_account_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'gmail_accounts';
            referencedColumns: ['id', 'user_id'];
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
          scope_set: string[];
          status: string;
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
          scope_set?: string[];
          status?: string;
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
          scope_set?: string[];
          status?: string;
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
          automation_enabled: boolean;
          created_at: string;
          max_daily_drafts: number;
          poll_interval_seconds: number;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          automation_enabled?: boolean;
          created_at?: string;
          max_daily_drafts?: number;
          poll_interval_seconds?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          automation_enabled?: boolean;
          created_at?: string;
          max_daily_drafts?: number;
          poll_interval_seconds?: number;
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
      [_ in never]: never;
    };
    Functions: {
      valid_style_profile_sources: {
        Args: { expected: number; ids: string[]; legacy: boolean };
        Returns: boolean;
      };
      valid_style_scope: {
        Args: { key: string; kind: string };
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
