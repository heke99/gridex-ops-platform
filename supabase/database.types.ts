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
      actor_registry_conflicts: {
        Row: {
          actor_id: string | null
          company_id: string | null
          conflict_fingerprint: string | null
          conflict_type: string
          created_at: string
          current_data: Json
          grid_owner_id: string | null
          id: string
          import_item_id: string | null
          import_run_id: string | null
          incoming_data: Json
          message: string
          metadata: Json
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          supplier_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          actor_id?: string | null
          company_id?: string | null
          conflict_fingerprint?: string | null
          conflict_type: string
          created_at?: string
          current_data?: Json
          grid_owner_id?: string | null
          id?: string
          import_item_id?: string | null
          import_run_id?: string | null
          incoming_data?: Json
          message: string
          metadata?: Json
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          supplier_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          actor_id?: string | null
          company_id?: string | null
          conflict_fingerprint?: string | null
          conflict_type?: string
          created_at?: string
          current_data?: Json
          grid_owner_id?: string | null
          id?: string
          import_item_id?: string | null
          import_run_id?: string | null
          incoming_data?: Json
          message?: string
          metadata?: Json
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          supplier_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "actor_registry_conflicts_import_item_id_fkey"
            columns: ["import_item_id"]
            isOneToOne: false
            referencedRelation: "actor_registry_import_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actor_registry_conflicts_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "actor_registry_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      actor_registry_import_items: {
        Row: {
          applied_at: string | null
          certificates: Json
          company_id: string | null
          created_at: string
          error_message: string | null
          id: string
          import_run_id: string
          match_confidence: string | null
          match_reason: string | null
          match_status: string
          matched_actor_id: string | null
          normalized_ediel_id: string | null
          normalized_eic: string | null
          normalized_name: string | null
          normalized_org_no: string | null
          normalized_payload: Json
          raw_payload: Json
          review_reason: string | null
          review_required: boolean
          roles: string[]
          routes: Json
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          certificates?: Json
          company_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          import_run_id: string
          match_confidence?: string | null
          match_reason?: string | null
          match_status?: string
          matched_actor_id?: string | null
          normalized_ediel_id?: string | null
          normalized_eic?: string | null
          normalized_name?: string | null
          normalized_org_no?: string | null
          normalized_payload?: Json
          raw_payload?: Json
          review_reason?: string | null
          review_required?: boolean
          roles?: string[]
          routes?: Json
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          certificates?: Json
          company_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          import_run_id?: string
          match_confidence?: string | null
          match_reason?: string | null
          match_status?: string
          matched_actor_id?: string | null
          normalized_ediel_id?: string | null
          normalized_eic?: string | null
          normalized_name?: string | null
          normalized_org_no?: string | null
          normalized_payload?: Json
          raw_payload?: Json
          review_reason?: string | null
          review_required?: boolean
          roles?: string[]
          routes?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "actor_registry_import_items_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "actor_registry_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      actor_registry_import_runs: {
        Row: {
          company_id: string | null
          conflict_count: number
          created_at: string
          created_count: number
          error_count: number
          finished_at: string | null
          id: string
          metadata: Json
          source: string
          source_filename: string | null
          source_hash: string
          started_at: string
          status: string
          total_records: number
          unchanged_count: number
          updated_at: string
          updated_count: number
          uploaded_by: string | null
        }
        Insert: {
          company_id?: string | null
          conflict_count?: number
          created_at?: string
          created_count?: number
          error_count?: number
          finished_at?: string | null
          id?: string
          metadata?: Json
          source: string
          source_filename?: string | null
          source_hash: string
          started_at?: string
          status?: string
          total_records?: number
          unchanged_count?: number
          updated_at?: string
          updated_count?: number
          uploaded_by?: string | null
        }
        Update: {
          company_id?: string | null
          conflict_count?: number
          created_at?: string
          created_count?: number
          error_count?: number
          finished_at?: string | null
          id?: string
          metadata?: Json
          source?: string
          source_filename?: string | null
          source_hash?: string
          started_at?: string
          status?: string
          total_records?: number
          unchanged_count?: number
          updated_at?: string
          updated_count?: number
          uploaded_by?: string | null
        }
        Relationships: []
      }
      actor_test_attempt_evidence: {
        Row: {
          attempt_id: string
          company_id: string
          configuration_snapshot_id: string
          correlation_snapshot: Json
          created_at: string
          ediel_message_id: string
          evidence_role: string
          id: string
          message_hash: string
          source_message_id: string | null
          test_run_id: string
          transport_status_snapshot: string
        }
        Insert: {
          attempt_id: string
          company_id: string
          configuration_snapshot_id: string
          correlation_snapshot?: Json
          created_at?: string
          ediel_message_id: string
          evidence_role: string
          id?: string
          message_hash: string
          source_message_id?: string | null
          test_run_id: string
          transport_status_snapshot: string
        }
        Update: {
          attempt_id?: string
          company_id?: string
          configuration_snapshot_id?: string
          correlation_snapshot?: Json
          created_at?: string
          ediel_message_id?: string
          evidence_role?: string
          id?: string
          message_hash?: string
          source_message_id?: string | null
          test_run_id?: string
          transport_status_snapshot?: string
        }
        Relationships: [
          {
            foreignKeyName: "actor_test_attempt_evidence_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "actor_test_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "actor_test_current_results_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_attempt_fk"
            columns: ["company_id", "attempt_id"]
            isOneToOne: false
            referencedRelation: "actor_test_attempts"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_attempt_fk"
            columns: ["company_id", "attempt_id"]
            isOneToOne: false
            referencedRelation: "actor_test_current_results_v"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_actor_testing_status_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_dashboard_summary_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_company_operations_statistics_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_contract_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_effective_legal_sources_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_email_dispatch_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "platform_go_live_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_contract_offer_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_customer_intake_tracking_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_event_mail_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_website_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_message_fk"
            columns: ["company_id", "ediel_message_id"]
            isOneToOne: false
            referencedRelation: "ediel_message_ack_state_v"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_message_fk"
            columns: ["company_id", "ediel_message_id"]
            isOneToOne: false
            referencedRelation: "ediel_messages"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_message_fk"
            columns: ["company_id", "ediel_message_id"]
            isOneToOne: false
            referencedRelation: "ediel_overdue_message_acks_v"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_run_fk"
            columns: ["company_id", "test_run_id"]
            isOneToOne: false
            referencedRelation: "ediel_test_runs"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_source_message_fk"
            columns: ["company_id", "source_message_id"]
            isOneToOne: false
            referencedRelation: "ediel_message_ack_state_v"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_source_message_fk"
            columns: ["company_id", "source_message_id"]
            isOneToOne: false
            referencedRelation: "ediel_messages"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_company_source_message_fk"
            columns: ["company_id", "source_message_id"]
            isOneToOne: false
            referencedRelation: "ediel_overdue_message_acks_v"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "actor_test_attempt_evidence_configuration_snapshot_id_fkey"
            columns: ["configuration_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ediel_configuration_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      actor_test_attempts: {
        Row: {
          actor_role: string
          company_id: string
          completed_at: string | null
          configuration_hash: string
          configuration_snapshot_id: string
          created_at: string
          created_by: string | null
          engine_version: string | null
          environment_type: Database["public"]["Enums"]["ediel_environment_type"]
          evidence_digest: string | null
          failure_code: string | null
          failure_details: Json
          id: string
          machine_verified: boolean
          message_family: string
          message_variant: string | null
          role_code: string
          rulebook_version: string
          setup_package: string
          started_at: string
          status: string
          test_case_code: string
          test_run_id: string
          test_suite: string
        }
        Insert: {
          actor_role: string
          company_id: string
          completed_at?: string | null
          configuration_hash: string
          configuration_snapshot_id: string
          created_at?: string
          created_by?: string | null
          engine_version?: string | null
          environment_type: Database["public"]["Enums"]["ediel_environment_type"]
          evidence_digest?: string | null
          failure_code?: string | null
          failure_details?: Json
          id?: string
          machine_verified?: boolean
          message_family: string
          message_variant?: string | null
          role_code: string
          rulebook_version: string
          setup_package: string
          started_at: string
          status: string
          test_case_code: string
          test_run_id: string
          test_suite: string
        }
        Update: {
          actor_role?: string
          company_id?: string
          completed_at?: string | null
          configuration_hash?: string
          configuration_snapshot_id?: string
          created_at?: string
          created_by?: string | null
          engine_version?: string | null
          environment_type?: Database["public"]["Enums"]["ediel_environment_type"]
          evidence_digest?: string | null
          failure_code?: string | null
          failure_details?: Json
          id?: string
          machine_verified?: boolean
          message_family?: string
          message_variant?: string | null
          role_code?: string
          rulebook_version?: string
          setup_package?: string
          started_at?: string
          status?: string
          test_case_code?: string
          test_run_id?: string
          test_suite?: string
        }
        Relationships: [
          {
            foreignKeyName: "actor_test_attempts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actor_test_attempts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_actor_testing_status_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_dashboard_summary_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_company_operations_statistics_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_contract_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_effective_legal_sources_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_email_dispatch_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "platform_go_live_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_contract_offer_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_customer_intake_tracking_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_event_mail_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_website_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_attempts_company_run_fk"
            columns: ["company_id", "test_run_id"]
            isOneToOne: false
            referencedRelation: "ediel_test_runs"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "actor_test_attempts_configuration_snapshot_id_fkey"
            columns: ["configuration_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ediel_configuration_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      actor_test_manual_attestations: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          attempt_id: string | null
          company_id: string
          created_at: string
          decision_reason: string | null
          evidence_reference: string
          id: string
          reason: string
          requested_at: string
          requested_by: string
          status: string
          test_case_code: string
          test_run_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          attempt_id?: string | null
          company_id: string
          created_at?: string
          decision_reason?: string | null
          evidence_reference: string
          id?: string
          reason: string
          requested_at?: string
          requested_by: string
          status?: string
          test_case_code: string
          test_run_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          attempt_id?: string | null
          company_id?: string
          created_at?: string
          decision_reason?: string | null
          evidence_reference?: string
          id?: string
          reason?: string
          requested_at?: string
          requested_by?: string
          status?: string
          test_case_code?: string
          test_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "actor_test_manual_attestations_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "actor_test_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actor_test_manual_attestations_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "actor_test_current_results_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actor_test_manual_attestations_company_attempt_fk"
            columns: ["company_id", "attempt_id"]
            isOneToOne: false
            referencedRelation: "actor_test_attempts"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "actor_test_manual_attestations_company_attempt_fk"
            columns: ["company_id", "attempt_id"]
            isOneToOne: false
            referencedRelation: "actor_test_current_results_v"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "actor_test_manual_attestations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actor_test_manual_attestations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_actor_testing_status_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_manual_attestations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_dashboard_summary_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_manual_attestations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_company_operations_statistics_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_manual_attestations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_contract_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_manual_attestations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_effective_legal_sources_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_manual_attestations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_email_dispatch_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_manual_attestations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "platform_go_live_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_manual_attestations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_contract_offer_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_manual_attestations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_customer_intake_tracking_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_manual_attestations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_event_mail_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_manual_attestations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_website_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_manual_attestations_company_run_fk"
            columns: ["company_id", "test_run_id"]
            isOneToOne: false
            referencedRelation: "ediel_test_runs"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      actor_test_results: {
        Row: {
          aperak_message_id: string | null
          company_id: string
          configuration_hash: string | null
          configuration_snapshot_id: string | null
          contrl_message_id: string | null
          created_at: string
          created_by: string | null
          direction: string | null
          ediel_test_run_id: string | null
          evidence: Json
          failure_reason: string | null
          id: string
          is_stale: boolean
          latest_run_at: string | null
          message_code: string | null
          message_family: string | null
          package_key: string | null
          passed_at: string | null
          portal_status: string | null
          raw_payload: string | null
          stale_reason: string | null
          status: string
          test_id: string | null
          test_key: string
          test_name: string | null
          updated_at: string
          updated_by: string | null
          utilts_err_message_id: string | null
        }
        Insert: {
          aperak_message_id?: string | null
          company_id: string
          configuration_hash?: string | null
          configuration_snapshot_id?: string | null
          contrl_message_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string | null
          ediel_test_run_id?: string | null
          evidence?: Json
          failure_reason?: string | null
          id?: string
          is_stale?: boolean
          latest_run_at?: string | null
          message_code?: string | null
          message_family?: string | null
          package_key?: string | null
          passed_at?: string | null
          portal_status?: string | null
          raw_payload?: string | null
          stale_reason?: string | null
          status?: string
          test_id?: string | null
          test_key: string
          test_name?: string | null
          updated_at?: string
          updated_by?: string | null
          utilts_err_message_id?: string | null
        }
        Update: {
          aperak_message_id?: string | null
          company_id?: string
          configuration_hash?: string | null
          configuration_snapshot_id?: string | null
          contrl_message_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string | null
          ediel_test_run_id?: string | null
          evidence?: Json
          failure_reason?: string | null
          id?: string
          is_stale?: boolean
          latest_run_at?: string | null
          message_code?: string | null
          message_family?: string | null
          package_key?: string | null
          passed_at?: string | null
          portal_status?: string | null
          raw_payload?: string | null
          stale_reason?: string | null
          status?: string
          test_id?: string | null
          test_key?: string
          test_name?: string | null
          updated_at?: string
          updated_by?: string | null
          utilts_err_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_actor_testing_status_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_dashboard_summary_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_company_operations_statistics_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_contract_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_effective_legal_sources_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_email_dispatch_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "platform_go_live_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_contract_offer_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_customer_intake_tracking_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_event_mail_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_website_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_configuration_snapshot_id_fkey"
            columns: ["configuration_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ediel_configuration_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_users: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          metadata: Json
          role: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          role?: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          role?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      admin_users_audit_events: {
        Row: {
          action: string
          actor_user_id: string | null
          admin_user_id: string | null
          created_at: string
          id: string
          new_row: Json | null
          old_row: Json | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          admin_user_id?: string | null
          created_at?: string
          id?: string
          new_row?: Json | null
          old_row?: Json | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          admin_user_id?: string | null
          created_at?: string
          id?: string
          new_row?: Json | null
          old_row?: Json | null
        }
        Relationships: []
      }
      ai_list_discrepancies: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          company_id: string
          created_at: string
          current_values: Json
          discrepancy_type: string
          id: string
          import_id: string
          import_row_id: string
          imported_values: Json
          proposed_values: Json
          resolution: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          company_id: string
          created_at?: string
          current_values?: Json
          discrepancy_type: string
          id?: string
          import_id: string
          import_row_id: string
          imported_values?: Json
          proposed_values?: Json
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          company_id?: string
          created_at?: string
          current_values?: Json
          discrepancy_type?: string
          id?: string
          import_id?: string
          import_row_id?: string
          imported_values?: Json
          proposed_values?: Json
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_actor_testing_status_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_dashboard_summary_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_company_operations_statistics_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_contract_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_effective_legal_sources_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_email_dispatch_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "platform_go_live_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_contract_offer_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_customer_intake_tracking_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_event_mail_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_website_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "ai_list_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_import_row_id_fkey"
            columns: ["import_row_id"]
            isOneToOne: false
            referencedRelation: "ai_list_import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_list_import_rows: {
        Row: {
          company_id: string
          created_at: string
          discrepancy_reasons: string[]
          id: string
          import_id: string
          match_status: string
          matched_customer_id: string | null
          matched_customer_site_id: string | null
          matched_metering_point_id: string | null
          metering_point_external_id: string | null
          raw_columns: Json
          row_number: number
        }
        Insert: {
          company_id: string
          created_at?: string
          discrepancy_reasons?: string[]
          id?: string
          import_id: string
          match_status?: string
          matched_customer_id?: string | null
          matched_customer_site_id?: string | null
          matched_metering_point_id?: string | null
          metering_point_external_id?: string | null
          raw_columns?: Json
          row_number: number
        }
        Update: {
          company_id?: string
          created_at?: string
          discrepancy_reasons?: string[]
          id?: string
          import_id?: string
          match_status?: string
          matched_customer_id?: string | null
          matched_customer_site_id?: string | null
          matched_metering_point_id?: string | null
          metering_point_external_id?: string | null
          raw_columns?: Json
          row_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_actor_testing_status_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_dashboard_summary_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_company_operations_statistics_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_contract_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_effective_legal_sources_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_email_dispatch_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "platform_go_live_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_contract_offer_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_customer_intake_tracking_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_event_mail_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_website_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "ai_list_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_matched_customer_id_fkey"
            columns: ["matched_customer_id"]
            isOneToOne: false
            referencedRelation: "company_customer_list_summary_v"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_matched_customer_id_fkey"
            columns: ["matched_customer_id"]
            isOneToOne: false
            referencedRelation: "customer_ops_master_readiness_v"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_matched_customer_id_fkey"
            columns: ["matched_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_matched_customer_id_fkey"
            columns: ["matched_customer_id"]
            isOneToOne: false
            referencedRelation: "gridex_data_cleanup_customer_candidates_v"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_matched_customer_site_id_fkey"
            columns: ["matched_customer_site_id"]
            isOneToOne: false
            referencedRelation: "c        referencedRelation: "company_dashboard_summary_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_company_operations_statistics_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_contract_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_effective_legal_sources_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_email_dispatch_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "platform_go_live_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_contract_offer_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_customer_intake_tracking_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_event_mail_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_website_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actor_test_results_configuration_snapshot_id_fkey"
            columns: ["configuration_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ediel_configuration_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_users: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          metadata: Json
          role: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          role?: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          role?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      admin_users_audit_events: {
        Row: {
          action: string
          actor_user_id: string | null
          admin_user_id: string | null
          created_at: string
          id: string
          new_row: Json | null
          old_row: Json | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          admin_user_id?: string | null
          created_at?: string
          id?: string
          new_row?: Json | null
          old_row?: Json | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          admin_user_id?: string | null
          created_at?: string
          id?: string
          new_row?: Json | null
          old_row?: Json | null
        }
        Relationships: []
      }
      ai_list_discrepancies: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          company_id: string
          created_at: string
          current_values: Json
          discrepancy_type: string
          id: string
          import_id: string
          import_row_id: string
          imported_values: Json
          proposed_values: Json
          resolution: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          company_id: string
          created_at?: string
          current_values?: Json
          discrepancy_type: string
          id?: string
          import_id: string
          import_row_id: string
          imported_values?: Json
          proposed_values?: Json
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          company_id?: string
          created_at?: string
          current_values?: Json
          discrepancy_type?: string
          id?: string
          import_id?: string
          import_row_id?: string
          imported_values?: Json
          proposed_values?: Json
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_actor_testing_status_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_dashboard_summary_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_company_operations_statistics_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_contract_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_effective_legal_sources_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_email_dispatch_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "platform_go_live_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_contract_offer_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_customer_intake_tracking_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_event_mail_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_website_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "ai_list_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_list_discrepancies_import_row_id_fkey"
            columns: ["import_row_id"]
            isOneToOne: false
            referencedRelation: "ai_list_import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_list_import_rows: {
        Row: {
          company_id: string
          created_at: string
          discrepancy_reasons: string[]
          id: string
          import_id: string
          match_status: string
          matched_customer_id: string | null
          matched_customer_site_id: string | null
          matched_metering_point_id: string | null
          metering_point_external_id: string | null
          raw_columns: Json
          row_number: number
        }
        Insert: {
          company_id: string
          created_at?: string
          discrepancy_reasons?: string[]
          id?: string
          import_id: string
          match_status?: string
          matched_customer_id?: string | null
          matched_customer_site_id?: string | null
          matched_metering_point_id?: string | null
          metering_point_external_id?: string | null
          raw_columns?: Json
          row_number: number
        }
        Update: {
          company_id?: string
          created_at?: string
          discrepancy_reasons?: string[]
          id?: string
          import_id?: string
          match_status?: string
          matched_customer_id?: string | null
          matched_customer_site_id?: string | null
          matched_metering_point_id?: string | null
          metering_point_external_id?: string | null
          raw_columns?: Json
          row_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_actor_testing_status_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_dashboard_summary_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_company_operations_statistics_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_contract_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_effective_legal_sources_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "gridex_tenant_email_dispatch_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "platform_go_live_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_contract_offer_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_customer_intake_tracking_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_event_mail_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "tenant_website_readiness_v"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "ai_list_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_matched_customer_id_fkey"
            columns: ["matched_customer_id"]
            isOneToOne: false
            referencedRelation: "company_customer_list_summary_v"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_matched_customer_id_fkey"
            columns: ["matched_customer_id"]
            isOneToOne: false
            referencedRelation: "customer_ops_master_readiness_v"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_matched_customer_id_fkey"
            columns: ["matched_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_matched_customer_id_fkey"
            columns: ["matched_customer_id"]
            isOneToOne: false
            referencedRelation: "gridex_data_cleanup_customer_candidates_v"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "ai_list_import_rows_matched_customer_site_id_fkey"
            columns: ["matched_customer_site_id"]
            isOneToOne: false
            referencedRelation: "c