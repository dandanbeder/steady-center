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
      access_requests: {
        Row: {
          business_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          invitation_id: string | null
          message: string | null
          proposed_role: Database["public"]["Enums"]["membership_role"]
          requester_user_id: string
          status: string
        }
        Insert: {
          business_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          invitation_id?: string | null
          message?: string | null
          proposed_role?: Database["public"]["Enums"]["membership_role"]
          requester_user_id: string
          status?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          invitation_id?: string | null
          message?: string | null
          proposed_role?: Database["public"]["Enums"]["membership_role"]
          requester_user_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_requests_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "invitations"
            referencedColumns: ["id"]
          },
        ]
      }
      account_credits: {
        Row: {
          account_user_id: string
          allowance_credits: number
          created_at: string
          credit_balance: number
          current_cycle_end: string | null
          current_cycle_start: string | null
          id: string
          updated_at: string
        }
        Insert: {
          account_user_id: string
          allowance_credits?: number
          created_at?: string
          credit_balance?: number
          current_cycle_end?: string | null
          current_cycle_start?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          account_user_id?: string
          allowance_credits?: number
          created_at?: string
          credit_balance?: number
          current_cycle_end?: string | null
          current_cycle_start?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      account_usage: {
        Row: {
          businesses_count: number
          calendar_connections_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          businesses_count?: number
          calendar_connections_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          businesses_count?: number
          calendar_connections_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      action_items: {
        Row: {
          business_id: string | null
          created_at: string
          created_by: string | null
          done: boolean
          due_at: string | null
          id: string
          owner_id: string
          owner_label: string | null
          source_id: string | null
          source_type: string
          task_id: string | null
          text: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          created_by?: string | null
          done?: boolean
          due_at?: string | null
          id?: string
          owner_id: string
          owner_label?: string | null
          source_id?: string | null
          source_type?: string
          task_id?: string | null
          text: string
        }
        Update: {
          business_id?: string | null
          created_at?: string
          created_by?: string | null
          done?: boolean
          due_at?: string | null
          id?: string
          owner_id?: string
          owner_label?: string | null
          source_id?: string | null
          source_type?: string
          task_id?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_access_log: {
        Row: {
          admin_id: string
          created_at: string
          ended_at: string | null
          id: string
          mode: string
          reason: string
          started_at: string
          target_user_id: string
        }
        Insert: {
          admin_id: string
          created_at?: string
          ended_at?: string | null
          id?: string
          mode?: string
          reason: string
          started_at?: string
          target_user_id: string
        }
        Update: {
          admin_id?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          mode?: string
          reason?: string
          started_at?: string
          target_user_id?: string
        }
        Relationships: []
      }
      admin_audit_log: {
        Row: {
          action: string
          admin_id: string
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          reason: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          admin_id: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          reason?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          reason?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      admin_user_notes: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          pinned: boolean
          target_user_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          pinned?: boolean
          target_user_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          pinned?: boolean
          target_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_prefs: {
        Row: {
          coach_style: string
          created_at: string
          model: string
          monthly_cap_cents: number
          summary_length: string
          tone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          coach_style?: string
          created_at?: string
          model?: string
          monthly_cap_cents?: number
          summary_length?: string
          tone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          coach_style?: string
          created_at?: string
          model?: string
          monthly_cap_cents?: number
          summary_length?: string
          tone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_usage: {
        Row: {
          actions: number
          cents: number
          created_at: string
          id: string
          month: string
          tokens: number
          updated_at: string
          user_id: string
        }
        Insert: {
          actions?: number
          cents?: number
          created_at?: string
          id?: string
          month: string
          tokens?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          actions?: number
          cents?: number
          created_at?: string
          id?: string
          month?: string
          tokens?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      analytics_daily_metrics: {
        Row: {
          accounts_created: number
          ai_actions: number
          calendars_connected: number
          dau: number
          day: string
          logins: number
          mau: number
          meetings_created: number
          notes_created: number
          payment_failed: number
          refreshed_at: string
          signups: number
          subscription_canceled: number
          tasks_created: number
          trial_converted: number
          trial_started: number
          wau: number
        }
        Insert: {
          accounts_created?: number
          ai_actions?: number
          calendars_connected?: number
          dau?: number
          day: string
          logins?: number
          mau?: number
          meetings_created?: number
          notes_created?: number
          payment_failed?: number
          refreshed_at?: string
          signups?: number
          subscription_canceled?: number
          tasks_created?: number
          trial_converted?: number
          trial_started?: number
          wau?: number
        }
        Update: {
          accounts_created?: number
          ai_actions?: number
          calendars_connected?: number
          dau?: number
          day?: string
          logins?: number
          mau?: number
          meetings_created?: number
          notes_created?: number
          payment_failed?: number
          refreshed_at?: string
          signups?: number
          subscription_canceled?: number
          tasks_created?: number
          trial_converted?: number
          trial_started?: number
          wau?: number
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          account_id: string | null
          created_at: string
          id: string
          metadata: Json
          type: string
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          type: string
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_subscription_snapshots: {
        Row: {
          annual_subs: number
          canceled: number
          day: string
          free_users: number
          monthly_subs: number
          mrr_pro_cents: number
          mrr_team_cents: number
          mrr_total_cents: number
          past_due: number
          pro_users: number
          refreshed_at: string
          team_seats_sold: number
          team_users: number
          trialing: number
        }
        Insert: {
          annual_subs?: number
          canceled?: number
          day: string
          free_users?: number
          monthly_subs?: number
          mrr_pro_cents?: number
          mrr_team_cents?: number
          mrr_total_cents?: number
          past_due?: number
          pro_users?: number
          refreshed_at?: string
          team_seats_sold?: number
          team_users?: number
          trialing?: number
        }
        Update: {
          annual_subs?: number
          canceled?: number
          day?: string
          free_users?: number
          monthly_subs?: number
          mrr_pro_cents?: number
          mrr_team_cents?: number
          mrr_total_cents?: number
          past_due?: number
          pro_users?: number
          refreshed_at?: string
          team_seats_sold?: number
          team_users?: number
          trialing?: number
        }
        Relationships: []
      }
      announcement_dismissals: {
        Row: {
          announcement_id: string
          dismissed_at: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          dismissed_at?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          dismissed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_dismissals_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          active: boolean
          audience: Json
          body: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          kind: string
          level: string
          published_at: string | null
          source: string
          source_flag_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          audience?: Json
          body?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          kind?: string
          level?: string
          published_at?: string | null
          source?: string
          source_flag_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          audience?: Json
          body?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          kind?: string
          level?: string
          published_at?: string | null
          source?: string
          source_flag_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_source_flag_id_fkey"
            columns: ["source_flag_id"]
            isOneToOne: false
            referencedRelation: "feature_flags"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_actions: {
        Row: {
          action_type: string
          business_id: string | null
          created_at: string
          id: string
          payload: Json
          result_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          action_type: string
          business_id?: string | null
          created_at?: string
          id?: string
          payload?: Json
          result_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          action_type?: string
          business_id?: string | null
          created_at?: string
          id?: string
          payload?: Json
          result_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_actions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          archived_at: string | null
          color: string
          created_at: string
          created_by: string | null
          id: string
          logo_url: string | null
          name: string
          owner_id: string
          priority_labels: Json
          read_only: boolean
          sort_order: number
          task_statuses: Json
        }
        Insert: {
          archived_at?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          logo_url?: string | null
          name: string
          owner_id: string
          priority_labels?: Json
          read_only?: boolean
          sort_order?: number
          task_statuses?: Json
        }
        Update: {
          archived_at?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          owner_id?: string
          priority_labels?: Json
          read_only?: boolean
          sort_order?: number
          task_statuses?: Json
        }
        Relationships: []
      }
      calendars: {
        Row: {
          business_id: string | null
          color: string
          created_at: string
          created_by: string | null
          external_id: string | null
          id: string
          last_synced_at: string | null
          name: string
          owner_id: string
          provider: string
          read_only: boolean
          sync_token: string | null
        }
        Insert: {
          business_id?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          external_id?: string | null
          id?: string
          last_synced_at?: string | null
          name: string
          owner_id: string
          provider?: string
          read_only?: boolean
          sync_token?: string | null
        }
        Update: {
          business_id?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          external_id?: string | null
          id?: string
          last_synced_at?: string | null
          name?: string
          owner_id?: string
          provider?: string
          read_only?: boolean
          sync_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendars_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_mentions: {
        Row: {
          comment_id: string
          created_at: string
          id: string
          mentioned_user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          id?: string
          mentioned_user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          id?: string
          mentioned_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_mentions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string
          body: string
          business_id: string | null
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          parent_id: string
          parent_owner_id: string | null
          parent_type: string
        }
        Insert: {
          author_id: string
          body: string
          business_id?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          parent_id: string
          parent_owner_id?: string | null
          parent_type: string
        }
        Update: {
          author_id?: string
          body?: string
          business_id?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          parent_id?: string
          parent_owner_id?: string | null
          parent_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_pulses: {
        Row: {
          at_risk_count: number
          capacity_hours: number
          confirmed_focus_at: string | null
          created_at: string
          email_sent_at: string | null
          focus_3: Json
          generated_at: string | null
          id: string
          kind: string
          meetings_json: Json
          overdue_count: number
          owner_id: string
          pulse_date: string
          scheduled_hours: number
          summary_text: string | null
          updated_at: string
        }
        Insert: {
          at_risk_count?: number
          capacity_hours?: number
          confirmed_focus_at?: string | null
          created_at?: string
          email_sent_at?: string | null
          focus_3?: Json
          generated_at?: string | null
          id?: string
          kind: string
          meetings_json?: Json
          overdue_count?: number
          owner_id: string
          pulse_date: string
          scheduled_hours?: number
          summary_text?: string | null
          updated_at?: string
        }
        Update: {
          at_risk_count?: number
          capacity_hours?: number
          confirmed_focus_at?: string | null
          created_at?: string
          email_sent_at?: string | null
          focus_3?: Json
          generated_at?: string | null
          id?: string
          kind?: string
          meetings_json?: Json
          overdue_count?: number
          owner_id?: string
          pulse_date?: string
          scheduled_hours?: number
          summary_text?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          id: string
          token: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          token: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          token?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          all_day: boolean
          business_id: string | null
          calendar_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          end_at: string
          external_id: string | null
          id: string
          is_meeting: boolean
          location: string | null
          owner_id: string
          recurrence_end: string | null
          recurrence_rule: string | null
          source: string
          start_at: string
          sync_error: string | null
          sync_status: string
          title: string
        }
        Insert: {
          all_day?: boolean
          business_id?: string | null
          calendar_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          end_at: string
          external_id?: string | null
          id?: string
          is_meeting?: boolean
          location?: string | null
          owner_id: string
          recurrence_end?: string | null
          recurrence_rule?: string | null
          source?: string
          start_at: string
          sync_error?: string | null
          sync_status?: string
          title: string
        }
        Update: {
          all_day?: boolean
          business_id?: string | null
          calendar_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          end_at?: string
          external_id?: string | null
          id?: string
          is_meeting?: boolean
          location?: string | null
          owner_id?: string
          recurrence_end?: string | null
          recurrence_rule?: string | null
          source?: string
          start_at?: string
          sync_error?: string | null
          sync_status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "calendars"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string
          description: string
          enabled: boolean
          id: string
          key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      folders: {
        Row: {
          business_id: string
          color: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          name: string
          owner_id: string
          parent_folder_id: string | null
        }
        Insert: {
          business_id: string
          color?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          owner_id: string
          parent_folder_id?: string | null
        }
        Update: {
          business_id?: string
          color?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          owner_id?: string
          parent_folder_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "folders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folders_parent_folder_id_fkey"
            columns: ["parent_folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_items: {
        Row: {
          accepted_at: string | null
          ai_processed_at: string | null
          ai_raw: Json | null
          created_at: string
          dismissed_at: string | null
          id: string
          owner_id: string
          raw_text: string
          resulting_ref_id: string | null
          resulting_ref_type: string | null
          source: string
          status: string
          suggested_body: string | null
          suggested_business_id: string | null
          suggested_due_at: string | null
          suggested_folder_id: string | null
          suggested_list_id: string | null
          suggested_priority: string | null
          suggested_title: string | null
          suggested_type: string | null
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          ai_processed_at?: string | null
          ai_raw?: Json | null
          created_at?: string
          dismissed_at?: string | null
          id?: string
          owner_id: string
          raw_text: string
          resulting_ref_id?: string | null
          resulting_ref_type?: string | null
          source?: string
          status?: string
          suggested_body?: string | null
          suggested_business_id?: string | null
          suggested_due_at?: string | null
          suggested_folder_id?: string | null
          suggested_list_id?: string | null
          suggested_priority?: string | null
          suggested_title?: string | null
          suggested_type?: string | null
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          ai_processed_at?: string | null
          ai_raw?: Json | null
          created_at?: string
          dismissed_at?: string | null
          id?: string
          owner_id?: string
          raw_text?: string
          resulting_ref_id?: string | null
          resulting_ref_type?: string | null
          source?: string
          status?: string
          suggested_body?: string | null
          suggested_business_id?: string | null
          suggested_due_at?: string | null
          suggested_folder_id?: string | null
          suggested_list_id?: string | null
          suggested_priority?: string | null
          suggested_title?: string | null
          suggested_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_items_suggested_business_id_fkey"
            columns: ["suggested_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_items_suggested_folder_id_fkey"
            columns: ["suggested_folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_items_suggested_list_id_fkey"
            columns: ["suggested_list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          business_id: string
          created_at: string
          expires_at: string
          id: string
          invited_by: string
          invited_email: string
          proposed_role: Database["public"]["Enums"]["membership_role"]
          status: string
          token: string
        }
        Insert: {
          business_id: string
          created_at?: string
          expires_at?: string
          id?: string
          invited_by: string
          invited_email: string
          proposed_role: Database["public"]["Enums"]["membership_role"]
          status?: string
          token?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          invited_by?: string
          invited_email?: string
          proposed_role?: Database["public"]["Enums"]["membership_role"]
          status?: string
          token?: string
        }
        Relationships: []
      }
      item_tags: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          item_id: string
          item_type: string
          notified_at: string | null
          tagged_email: string
          tagged_user_id: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          item_id: string
          item_type: string
          notified_at?: string | null
          tagged_email: string
          tagged_user_id?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          item_id?: string
          item_type?: string
          notified_at?: string | null
          tagged_email?: string
          tagged_user_id?: string | null
        }
        Relationships: []
      }
      journal_access_grants: {
        Row: {
          admin_id: string
          created_at: string
          expires_at: string | null
          id: string
          mode: string
          reason: string
          requested_at: string
          responded_at: string | null
          revoked_at: string | null
          revoked_by: string | null
          status: string
          target_user_id: string
          updated_at: string
        }
        Insert: {
          admin_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          mode?: string
          reason: string
          requested_at?: string
          responded_at?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          target_user_id: string
          updated_at?: string
        }
        Update: {
          admin_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          mode?: string
          reason?: string
          requested_at?: string
          responded_at?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          target_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      journal_access_log: {
        Row: {
          accessed_at: string
          action: string
          admin_id: string
          grant_id: string
          id: string
          note_id: string | null
          target_user_id: string
        }
        Insert: {
          accessed_at?: string
          action?: string
          admin_id: string
          grant_id: string
          id?: string
          note_id?: string | null
          target_user_id: string
        }
        Update: {
          accessed_at?: string
          action?: string
          admin_id?: string
          grant_id?: string
          id?: string
          note_id?: string | null
          target_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_access_log_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "journal_access_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_meta: {
        Row: {
          created_at: string
          mood: number | null
          note_id: string
          owner_id: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          mood?: number | null
          note_id: string
          owner_id: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          mood?: number | null
          note_id?: string
          owner_id?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_meta_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: true
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      lists: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          folder_id: string
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          folder_id: string
          id?: string
          name: string
          owner_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          folder_id?: string
          id?: string
          name?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lists_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
        ]
      }
      login_history: {
        Row: {
          event: string
          id: string
          ip: string | null
          occurred_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          event?: string
          id?: string
          ip?: string | null
          occurred_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          event?: string
          id?: string
          ip?: string | null
          occurred_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      meetings: {
        Row: {
          audio_path: string | null
          business_id: string | null
          created_at: string
          created_by: string | null
          decisions: Json
          event_id: string | null
          id: string
          keep_recording: boolean
          owner_id: string
          platform: string
          summary: string
          title: string
          transcript: string
        }
        Insert: {
          audio_path?: string | null
          business_id?: string | null
          created_at?: string
          created_by?: string | null
          decisions?: Json
          event_id?: string | null
          id?: string
          keep_recording?: boolean
          owner_id: string
          platform?: string
          summary?: string
          title?: string
          transcript?: string
        }
        Update: {
          audio_path?: string | null
          business_id?: string | null
          created_at?: string
          created_by?: string | null
          decisions?: Json
          event_id?: string | null
          id?: string
          keep_recording?: boolean
          owner_id?: string
          platform?: string
          summary?: string
          title?: string
          transcript?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          business_id: string
          created_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["membership_role"]
          status: Database["public"]["Enums"]["membership_status"]
          user_id: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          user_id?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memberships_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      ms_oauth_tokens: {
        Row: {
          access_token: string
          account_email: string | null
          created_at: string
          expires_at: string
          needs_reconnect: boolean
          refresh_token: string
          scope: string | null
          tenant_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          account_email?: string | null
          created_at?: string
          expires_at: string
          needs_reconnect?: boolean
          refresh_token: string
          scope?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          account_email?: string | null
          created_at?: string
          expires_at?: string
          needs_reconnect?: boolean
          refresh_token?: string
          scope?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ms_subscriptions: {
        Row: {
          calendar_id: string
          client_state: string
          created_at: string
          expires_at: string
          id: string
          resource: string
          subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          calendar_id: string
          client_state: string
          created_at?: string
          expires_at: string
          id?: string
          resource: string
          subscription_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          calendar_id?: string
          client_state?: string
          created_at?: string
          expires_at?: string
          id?: string
          resource?: string
          subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ms_subscriptions_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "calendars"
            referencedColumns: ["id"]
          },
        ]
      }
      note_attachments: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          extracted_text: string | null
          file_name: string
          id: string
          mime_type: string | null
          note_id: string
          size_bytes: number | null
          storage_path: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          extracted_text?: string | null
          file_name: string
          id?: string
          mime_type?: string | null
          note_id: string
          size_bytes?: number | null
          storage_path: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          extracted_text?: string | null
          file_name?: string
          id?: string
          mime_type?: string | null
          note_id?: string
          size_bytes?: number | null
          storage_path?: string
        }
        Relationships: []
      }
      note_links: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          from_note_id: string
          id: string
          to_id: string
          to_type: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          from_note_id: string
          id?: string
          to_id: string
          to_type: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          from_note_id?: string
          id?: string
          to_id?: string
          to_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_links_from_note_id_fkey"
            columns: ["from_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          body: string
          business_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          folder_id: string | null
          id: string
          linked_event_id: string | null
          linked_meeting_id: string | null
          note_type: string
          owner_id: string
          pinned: boolean
          source: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          business_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          folder_id?: string | null
          id?: string
          linked_event_id?: string | null
          linked_meeting_id?: string | null
          note_type?: string
          owner_id: string
          pinned?: boolean
          source?: string
          title?: string
          updated_at?: string
        }
        Update: {
          body?: string
          business_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          folder_id?: string | null
          id?: string
          linked_event_id?: string | null
          linked_meeting_id?: string | null
          note_type?: string
          owner_id?: string
          pinned?: boolean
          source?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          channels: Json
          created_at: string
          events: Json
          quiet_enabled: boolean
          quiet_end: number
          quiet_start: number
          updated_at: string
          user_id: string
        }
        Insert: {
          channels?: Json
          created_at?: string
          events?: Json
          quiet_enabled?: boolean
          quiet_end?: number
          quiet_start?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          channels?: Json
          created_at?: string
          events?: Json
          quiet_enabled?: boolean
          quiet_end?: number
          quiet_start?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          business_id: string | null
          created_at: string
          id: string
          kind: string
          link: string | null
          read_at: string | null
          ref_id: string | null
          ref_type: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          business_id?: string | null
          created_at?: string
          id?: string
          kind: string
          link?: string | null
          read_at?: string | null
          ref_id?: string | null
          ref_type?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          business_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          read_at?: string | null
          ref_id?: string | null
          ref_type?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      outcomes: {
        Row: {
          business_id: string | null
          created_at: string
          description: string | null
          id: string
          metric_current: number | null
          metric_name: string | null
          metric_target: number | null
          metric_unit: string | null
          name: string
          owner_id: string
          status: Database["public"]["Enums"]["outcome_status"]
          success_statement: string | null
          target_date: string | null
          updated_at: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          metric_current?: number | null
          metric_name?: string | null
          metric_target?: number | null
          metric_unit?: string | null
          name: string
          owner_id: string
          status?: Database["public"]["Enums"]["outcome_status"]
          success_statement?: string | null
          target_date?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          metric_current?: number | null
          metric_name?: string | null
          metric_target?: number | null
          metric_unit?: string | null
          name?: string
          owner_id?: string
          status?: Database["public"]["Enums"]["outcome_status"]
          success_statement?: string | null
          target_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outcomes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      password_reset_attempts: {
        Row: {
          attempted_at: string
          email_hash: string
          id: string
        }
        Insert: {
          attempted_at?: string
          email_hash: string
          id?: string
        }
        Update: {
          attempted_at?: string
          email_hash?: string
          id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          daily_capacity_hours: number
          default_calendar_view: string
          deletion_requested_by: string | null
          deletion_scheduled_at: string | null
          density: string
          font_size: string
          full_name: string | null
          hear_about_us: string | null
          id: string
          is_protected_primary: boolean
          journal_lock_enabled: boolean
          journal_lock_hash: string | null
          journal_lock_updated_at: string | null
          marketing_opt_in: boolean
          marketing_opt_in_at: string | null
          must_change_password: boolean
          onboarding_completed_at: string | null
          organisation: string | null
          phone: string | null
          platform_pulse_cadence: string
          platform_pulse_last_sent_at: string | null
          platform_role: Database["public"]["Enums"]["platform_role"]
          reduced_motion: boolean
          role_title: string | null
          status: Database["public"]["Enums"]["user_status"]
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          suspended_message: string | null
          suspended_reason: string | null
          terms_accepted_at: string | null
          theme: string
          timezone: string
          updated_at: string
          weekly_review_day: number
          weekly_review_enabled: boolean
          weekly_review_hour: number
          welcome_email_sent_at: string | null
          work_days: number[]
          work_end_hour: number
          work_start_hour: number
        }
        Insert: {
          created_at?: string
          daily_capacity_hours?: number
          default_calendar_view?: string
          deletion_requested_by?: string | null
          deletion_scheduled_at?: string | null
          density?: string
          font_size?: string
          full_name?: string | null
          hear_about_us?: string | null
          id: string
          is_protected_primary?: boolean
          journal_lock_enabled?: boolean
          journal_lock_hash?: string | null
          journal_lock_updated_at?: string | null
          marketing_opt_in?: boolean
          marketing_opt_in_at?: string | null
          must_change_password?: boolean
          onboarding_completed_at?: string | null
          organisation?: string | null
          phone?: string | null
          platform_pulse_cadence?: string
          platform_pulse_last_sent_at?: string | null
          platform_role?: Database["public"]["Enums"]["platform_role"]
          reduced_motion?: boolean
          role_title?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          suspended_message?: string | null
          suspended_reason?: string | null
          terms_accepted_at?: string | null
          theme?: string
          timezone?: string
          updated_at?: string
          weekly_review_day?: number
          weekly_review_enabled?: boolean
          weekly_review_hour?: number
          welcome_email_sent_at?: string | null
          work_days?: number[]
          work_end_hour?: number
          work_start_hour?: number
        }
        Update: {
          created_at?: string
          daily_capacity_hours?: number
          default_calendar_view?: string
          deletion_requested_by?: string | null
          deletion_scheduled_at?: string | null
          density?: string
          font_size?: string
          full_name?: string | null
          hear_about_us?: string | null
          id?: string
          is_protected_primary?: boolean
          journal_lock_enabled?: boolean
          journal_lock_hash?: string | null
          journal_lock_updated_at?: string | null
          marketing_opt_in?: boolean
          marketing_opt_in_at?: string | null
          must_change_password?: boolean
          onboarding_completed_at?: string | null
          organisation?: string | null
          phone?: string | null
          platform_pulse_cadence?: string
          platform_pulse_last_sent_at?: string | null
          platform_role?: Database["public"]["Enums"]["platform_role"]
          reduced_motion?: boolean
          role_title?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          suspended_message?: string | null
          suspended_reason?: string | null
          terms_accepted_at?: string | null
          theme?: string
          timezone?: string
          updated_at?: string
          weekly_review_day?: number
          weekly_review_enabled?: boolean
          weekly_review_hour?: number
          welcome_email_sent_at?: string | null
          work_days?: number[]
          work_end_hour?: number
          work_start_hour?: number
        }
        Relationships: []
      }
      reminders: {
        Row: {
          channel: string
          created_at: string
          id: string
          kind: string
          last_error: string | null
          lead_minutes: number | null
          owner_id: string
          ref_id: string
          ref_type: string
          remind_at: string
          sent: boolean
          sent_at: string | null
        }
        Insert: {
          channel?: string
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          lead_minutes?: number | null
          owner_id: string
          ref_id: string
          ref_type: string
          remind_at: string
          sent?: boolean
          sent_at?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          lead_minutes?: number | null
          owner_id?: string
          ref_id?: string
          ref_type?: string
          remind_at?: string
          sent?: boolean
          sent_at?: string | null
        }
        Relationships: []
      }
      shares: {
        Row: {
          created_at: string
          details: Json
          granted_by: string | null
          grantee_user_id: string
          id: string
          resource_id: string
          resource_type: string
          role: string
        }
        Insert: {
          created_at?: string
          details?: Json
          granted_by?: string | null
          grantee_user_id: string
          id?: string
          resource_id: string
          resource_type: string
          role: string
        }
        Update: {
          created_at?: string
          details?: Json
          granted_by?: string | null
          grantee_user_id?: string
          id?: string
          resource_id?: string
          resource_type?: string
          role?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          billing_cycle: string
          cancel_at_period_end: boolean | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          paddle_customer_id: string
          paddle_subscription_id: string
          past_due_since: string | null
          price_id: string
          product_id: string
          quantity: number
          status: string
          trial_end: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          billing_cycle?: string
          cancel_at_period_end?: boolean | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          paddle_customer_id: string
          paddle_subscription_id: string
          past_due_since?: string | null
          price_id: string
          product_id: string
          quantity?: number
          status?: string
          trial_end?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          billing_cycle?: string
          cancel_at_period_end?: boolean | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          paddle_customer_id?: string
          paddle_subscription_id?: string
          past_due_since?: string | null
          price_id?: string
          product_id?: string
          quantity?: number
          status?: string
          trial_end?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      task_assignment_history: {
        Row: {
          business_id: string | null
          changed_at: string
          changed_by: string | null
          from_assignee: string | null
          id: string
          task_id: string
          to_assignee: string | null
        }
        Insert: {
          business_id?: string | null
          changed_at?: string
          changed_by?: string | null
          from_assignee?: string | null
          id?: string
          task_id: string
          to_assignee?: string | null
        }
        Update: {
          business_id?: string | null
          changed_at?: string
          changed_by?: string | null
          from_assignee?: string | null
          id?: string
          task_id?: string
          to_assignee?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_assignment_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_stages: {
        Row: {
          color: string
          created_at: string
          id: string
          is_terminal: boolean
          kind: string
          list_id: string
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_terminal?: boolean
          kind?: string
          list_id: string
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_terminal?: boolean
          kind?: string
          list_id?: string
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_stages_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      task_status_history: {
        Row: {
          business_id: string | null
          changed_at: string
          changed_by: string | null
          from_status: Database["public"]["Enums"]["task_status"] | null
          id: string
          task_id: string
          to_status: Database["public"]["Enums"]["task_status"]
        }
        Insert: {
          business_id?: string | null
          changed_at?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["task_status"] | null
          id?: string
          task_id: string
          to_status: Database["public"]["Enums"]["task_status"]
        }
        Update: {
          business_id?: string | null
          changed_at?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["task_status"] | null
          id?: string
          task_id?: string
          to_status?: Database["public"]["Enums"]["task_status"]
        }
        Relationships: []
      }
      task_views: {
        Row: {
          collapsed_groups: string[]
          column_order: string[]
          created_at: string
          filters: Json
          group_by: string
          id: string
          is_default: boolean
          is_shared: boolean
          list_id: string
          name: string
          owner_id: string
          pinned: boolean
          position: number
          sort: Json
          updated_at: string
          view: string
        }
        Insert: {
          collapsed_groups?: string[]
          column_order?: string[]
          created_at?: string
          filters?: Json
          group_by?: string
          id?: string
          is_default?: boolean
          is_shared?: boolean
          list_id: string
          name: string
          owner_id: string
          pinned?: boolean
          position?: number
          sort?: Json
          updated_at?: string
          view?: string
        }
        Update: {
          collapsed_groups?: string[]
          column_order?: string[]
          created_at?: string
          filters?: Json
          group_by?: string
          id?: string
          is_default?: boolean
          is_shared?: boolean
          list_id?: string
          name?: string
          owner_id?: string
          pinned?: boolean
          position?: number
          sort?: Json
          updated_at?: string
          view?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_views_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          assignee_id: string | null
          business_id: string | null
          committed_week: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          due_at: string | null
          id: string
          list_id: string | null
          outcome_id: string | null
          owner_id: string
          parent_task_id: string | null
          position: number
          priority: Database["public"]["Enums"]["task_priority"]
          recurrence_anchor: string | null
          recurrence_rule: string | null
          source_note_id: string | null
          source_type: string | null
          stage_id: string | null
          stage_position: number
          status: Database["public"]["Enums"]["task_status"]
          status_changed_at: string
          title: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          assignee_id?: string | null
          business_id?: string | null
          committed_week?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          list_id?: string | null
          outcome_id?: string | null
          owner_id: string
          parent_task_id?: string | null
          position?: number
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence_anchor?: string | null
          recurrence_rule?: string | null
          source_note_id?: string | null
          source_type?: string | null
          stage_id?: string | null
          stage_position?: number
          status?: Database["public"]["Enums"]["task_status"]
          status_changed_at?: string
          title: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          assignee_id?: string | null
          business_id?: string | null
          committed_week?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          list_id?: string | null
          outcome_id?: string | null
          owner_id?: string
          parent_task_id?: string | null
          position?: number
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence_anchor?: string | null
          recurrence_rule?: string | null
          source_note_id?: string | null
          source_type?: string | null
          stage_id?: string | null
          stage_position?: number
          status?: Database["public"]["Enums"]["task_status"]
          status_changed_at?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_outcome_id_fkey"
            columns: ["outcome_id"]
            isOneToOne: false
            referencedRelation: "outcomes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_source_note_id_fkey"
            columns: ["source_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "task_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      team_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          business_id: string
          created_at: string
          id: string
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          business_id: string
          created_at?: string
          id?: string
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          business_id?: string
          created_at?: string
          id?: string
          target_user_id?: string | null
        }
        Relationships: []
      }
      templates: {
        Row: {
          body: string
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          name: string
          updated_at: string
        }
        Insert: {
          body?: string
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          name: string
          updated_at?: string
        }
        Update: {
          body?: string
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      time_entries: {
        Row: {
          business_id: string | null
          created_at: string
          ended_at: string | null
          id: string
          minutes: number
          note: string | null
          source: string
          started_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          minutes?: number
          note?: string | null
          source?: string
          started_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          business_id?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          minutes?: number
          note?: string | null
          source?: string
          started_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_entitlement_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          key: string
          note: string | null
          user_id: string
          value: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key: string
          note?: string | null
          user_id: string
          value?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key?: string
          note?: string | null
          user_id?: string
          value?: number
        }
        Relationships: []
      }
      user_feature_flag_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          expires_at: string | null
          flag_key: string
          id: string
          reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled: boolean
          expires_at?: string | null
          flag_key: string
          id?: string
          reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          expires_at?: string | null
          flag_key?: string
          id?: string
          reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_list_views: {
        Row: {
          collapsed_groups: Json
          column_order: Json
          created_at: string
          filters: Json
          group_by: string
          id: string
          list_id: string
          sort: Json
          updated_at: string
          user_id: string
          view: string
        }
        Insert: {
          collapsed_groups?: Json
          column_order?: Json
          created_at?: string
          filters?: Json
          group_by?: string
          id?: string
          list_id: string
          sort?: Json
          updated_at?: string
          user_id: string
          view?: string
        }
        Update: {
          collapsed_groups?: Json
          column_order?: Json
          created_at?: string
          filters?: Json
          group_by?: string
          id?: string
          list_id?: string
          sort?: Json
          updated_at?: string
          user_id?: string
          view?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_list_views_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_goals: {
        Row: {
          business_id: string | null
          carried_from: string | null
          created_at: string
          current_value: number
          description: string | null
          id: string
          metric_type: Database["public"]["Enums"]["goal_metric_type"]
          status: Database["public"]["Enums"]["goal_status"]
          target_value: number | null
          title: string
          updated_at: string
          user_id: string
          week_end: string
          week_start: string
        }
        Insert: {
          business_id?: string | null
          carried_from?: string | null
          created_at?: string
          current_value?: number
          description?: string | null
          id?: string
          metric_type?: Database["public"]["Enums"]["goal_metric_type"]
          status?: Database["public"]["Enums"]["goal_status"]
          target_value?: number | null
          title: string
          updated_at?: string
          user_id: string
          week_end: string
          week_start: string
        }
        Update: {
          business_id?: string | null
          carried_from?: string | null
          created_at?: string
          current_value?: number
          description?: string | null
          id?: string
          metric_type?: Database["public"]["Enums"]["goal_metric_type"]
          status?: Database["public"]["Enums"]["goal_status"]
          target_value?: number | null
          title?: string
          updated_at?: string
          user_id?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      weekly_reports: {
        Row: {
          business_id: string | null
          created_at: string
          created_by: string | null
          id: string
          metrics: Json
          narrative: Json
          owner_id: string
          week_end: string
          week_start: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          metrics?: Json
          narrative?: Json
          owner_id: string
          week_end: string
          week_start: string
        }
        Update: {
          business_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          metrics?: Json
          narrative?: Json
          owner_id?: string
          week_end?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_reports_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bump_account_usage: {
        Args: { p_biz: number; p_cal: number; p_user: string }
        Returns: undefined
      }
      business_for_list: { Args: { p_list_id: string }; Returns: string }
      can_access: {
        Args: { _id: string; _min_role: string; _type: string; _user: string }
        Returns: boolean
      }
      current_membership_role: { Args: { p_business: string }; Returns: string }
      empty_my_trash: {
        Args: never
        Returns: {
          storage_paths: string[]
        }[]
      }
      expire_journal_access_grants: { Args: never; Returns: number }
      get_or_create_unsubscribe_token: {
        Args: { p_user_id: string }
        Returns: string
      }
      has_active_journal_grant: {
        Args: { _admin_id: string; _mode?: string; _target_user_id: string }
        Returns: boolean
      }
      has_active_readonly_session: { Args: never; Returns: boolean }
      has_active_subscription: {
        Args: { check_env?: string; user_uuid: string }
        Returns: boolean
      }
      is_member: {
        Args: { p_business: string; p_min_role: string }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      is_sub_active: {
        Args: { p_period_end: string; p_status: string }
        Returns: boolean
      }
      is_tagged: {
        Args: { p_item_id: string; p_item_type: string }
        Returns: boolean
      }
      is_user_under_active_readonly_support_session: {
        Args: { _user_id: string }
        Returns: boolean
      }
      is_user_under_active_support_session: {
        Args: { _user_id: string }
        Returns: boolean
      }
      list_business_members: {
        Args: { p_business: string }
        Returns: {
          business_id: string
          created_at: string
          email: string
          full_name: string
          has_pending_invite: boolean
          id: string
          invited_email: string
          role: string
          status: string
          user_id: string
        }[]
      }
      list_trash: {
        Args: never
        Returns: {
          business_id: string
          deleted_at: string
          id: string
          kind: string
          meta: Json
          parent_id: string
          title: string
        }[]
      }
      log_analytics_event: {
        Args: {
          p_account_id: string
          p_metadata?: Json
          p_type: string
          p_user_id: string
        }
        Returns: undefined
      }
      paid_seat_count: { Args: { p_business: string }; Returns: number }
      plan_limits: {
        Args: { p_user: string }
        Returns: {
          ai_allowance_credits: number
          max_businesses: number
          max_calendar_connections: number
          paid_seats: number
          quantity: number
          sharing_enabled: boolean
          team_features_enabled: boolean
          tier: string
        }[]
      }
      purge_trash: {
        Args: never
        Returns: {
          storage_paths: string[]
        }[]
      }
      realtime_comments_can_subscribe: {
        Args: { _topic: string }
        Returns: boolean
      }
      refresh_analytics_for_day: { Args: { p_day: string }; Returns: undefined }
      refresh_subscription_snapshot_for_day: {
        Args: { p_day: string }
        Returns: undefined
      }
      resolve_comment_parent: {
        Args: { p_id: string; p_type: string }
        Returns: Record<string, unknown>
      }
      resource_business: {
        Args: { _id: string; _type: string }
        Returns: string
      }
      resource_owner: { Args: { _id: string; _type: string }; Returns: string }
      role_rank: { Args: { _role: string }; Returns: number }
      seed_default_task_stages: {
        Args: { p_list_id: string }
        Returns: undefined
      }
      transfer_team_ownership: {
        Args: { p_business: string; p_new_owner: string }
        Returns: undefined
      }
      user_effective_plan: {
        Args: { p_user: string }
        Returns: {
          billing_cycle: string
          current_period_end: string
          quantity: number
          status: string
          tier: string
          trial_end: string
        }[]
      }
      user_in_audience: {
        Args: { _audience: Json; _user: string }
        Returns: boolean
      }
    }
    Enums: {
      goal_metric_type: "tasks_completed" | "hours" | "custom"
      goal_status: "open" | "met" | "missed"
      membership_role: "owner" | "admin" | "member" | "commenter" | "viewer"
      membership_status: "active" | "invited"
      outcome_status:
        | "active"
        | "achieved"
        | "archived"
        | "not_started"
        | "in_progress"
        | "at_risk"
      platform_role: "user" | "superadmin"
      subscription_status: "trial" | "active" | "canceled" | "past_due" | "none"
      task_priority: "urgent" | "high" | "normal" | "low"
      task_status: "todo" | "in_progress" | "review" | "done"
      user_status: "active" | "suspended"
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
      goal_metric_type: ["tasks_completed", "hours", "custom"],
      goal_status: ["open", "met", "missed"],
      membership_role: ["owner", "admin", "member", "commenter", "viewer"],
      membership_status: ["active", "invited"],
      outcome_status: [
        "active",
        "achieved",
        "archived",
        "not_started",
        "in_progress",
        "at_risk",
      ],
      platform_role: ["user", "superadmin"],
      subscription_status: ["trial", "active", "canceled", "past_due", "none"],
      task_priority: ["urgent", "high", "normal", "low"],
      task_status: ["todo", "in_progress", "review", "done"],
      user_status: ["active", "suspended"],
    },
  },
} as const
