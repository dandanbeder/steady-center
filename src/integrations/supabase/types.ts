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
      ai_prefs: {
        Row: {
          created_at: string
          model: string
          monthly_cap_cents: number
          summary_length: string
          tone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          model?: string
          monthly_cap_cents?: number
          summary_length?: string
          tone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
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
          cents: number
          created_at: string
          id: string
          month: string
          tokens: number
          updated_at: string
          user_id: string
        }
        Insert: {
          cents?: number
          created_at?: string
          id?: string
          month: string
          tokens?: number
          updated_at?: string
          user_id: string
        }
        Update: {
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
      announcements: {
        Row: {
          active: boolean
          body: string
          created_at: string
          created_by: string | null
          id: string
          level: string
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          level?: string
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          level?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
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
          color: string
          created_at: string
          created_by: string | null
          id: string
          logo_url: string | null
          name: string
          owner_id: string
          priority_labels: Json
          task_statuses: Json
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          logo_url?: string | null
          name: string
          owner_id: string
          priority_labels?: Json
          task_statuses?: Json
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          owner_id?: string
          priority_labels?: Json
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
      lists: {
        Row: {
          created_at: string
          created_by: string | null
          folder_id: string
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          folder_id: string
          id?: string
          name: string
          owner_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
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
          density: string
          font_size: string
          full_name: string | null
          hear_about_us: string | null
          id: string
          marketing_opt_in: boolean
          marketing_opt_in_at: string | null
          onboarding_completed_at: string | null
          organisation: string | null
          phone: string | null
          platform_role: Database["public"]["Enums"]["platform_role"]
          reduced_motion: boolean
          role_title: string | null
          status: Database["public"]["Enums"]["user_status"]
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          terms_accepted_at: string | null
          theme: string
          timezone: string
          updated_at: string
          weekly_review_day: number
          weekly_review_enabled: boolean
          weekly_review_hour: number
          work_days: number[]
          work_end_hour: number
          work_start_hour: number
        }
        Insert: {
          created_at?: string
          daily_capacity_hours?: number
          default_calendar_view?: string
          density?: string
          font_size?: string
          full_name?: string | null
          hear_about_us?: string | null
          id: string
          marketing_opt_in?: boolean
          marketing_opt_in_at?: string | null
          onboarding_completed_at?: string | null
          organisation?: string | null
          phone?: string | null
          platform_role?: Database["public"]["Enums"]["platform_role"]
          reduced_motion?: boolean
          role_title?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          terms_accepted_at?: string | null
          theme?: string
          timezone?: string
          updated_at?: string
          weekly_review_day?: number
          weekly_review_enabled?: boolean
          weekly_review_hour?: number
          work_days?: number[]
          work_end_hour?: number
          work_start_hour?: number
        }
        Update: {
          created_at?: string
          daily_capacity_hours?: number
          default_calendar_view?: string
          density?: string
          font_size?: string
          full_name?: string | null
          hear_about_us?: string | null
          id?: string
          marketing_opt_in?: boolean
          marketing_opt_in_at?: string | null
          onboarding_completed_at?: string | null
          organisation?: string | null
          phone?: string | null
          platform_role?: Database["public"]["Enums"]["platform_role"]
          reduced_motion?: boolean
          role_title?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          terms_accepted_at?: string | null
          theme?: string
          timezone?: string
          updated_at?: string
          weekly_review_day?: number
          weekly_review_enabled?: boolean
          weekly_review_hour?: number
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
      tasks: {
        Row: {
          business_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string | null
          id: string
          list_id: string
          owner_id: string
          parent_task_id: string | null
          position: number
          priority: Database["public"]["Enums"]["task_priority"]
          recurrence_anchor: string | null
          recurrence_rule: string | null
          source_note_id: string | null
          source_type: string | null
          status: Database["public"]["Enums"]["task_status"]
          status_changed_at: string
          title: string
        }
        Insert: {
          business_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          list_id: string
          owner_id: string
          parent_task_id?: string | null
          position?: number
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence_anchor?: string | null
          recurrence_rule?: string | null
          source_note_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          status_changed_at?: string
          title: string
        }
        Update: {
          business_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          list_id?: string
          owner_id?: string
          parent_task_id?: string | null
          position?: number
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence_anchor?: string | null
          recurrence_rule?: string | null
          source_note_id?: string | null
          source_type?: string | null
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
        ]
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
      business_for_list: { Args: { p_list_id: string }; Returns: string }
      current_membership_role: { Args: { p_business: string }; Returns: string }
      get_or_create_unsubscribe_token: {
        Args: { p_user_id: string }
        Returns: string
      }
      has_active_readonly_session: { Args: never; Returns: boolean }
      is_member: {
        Args: { p_business: string; p_min_role: string }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      is_tagged: {
        Args: { p_item_id: string; p_item_type: string }
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
    }
    Enums: {
      goal_metric_type: "tasks_completed" | "hours" | "custom"
      goal_status: "open" | "met" | "missed"
      membership_role: "owner" | "admin" | "member" | "commenter" | "viewer"
      membership_status: "active" | "invited"
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
      platform_role: ["user", "superadmin"],
      subscription_status: ["trial", "active", "canceled", "past_due", "none"],
      task_priority: ["urgent", "high", "normal", "low"],
      task_status: ["todo", "in_progress", "review", "done"],
      user_status: ["active", "suspended"],
    },
  },
} as const
