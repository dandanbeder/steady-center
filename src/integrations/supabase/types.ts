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
      action_items: {
        Row: {
          business_id: string | null
          created_at: string
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
      businesses: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          owner_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
      calendars: {
        Row: {
          business_id: string | null
          color: string
          created_at: string
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
      events: {
        Row: {
          all_day: boolean
          business_id: string | null
          calendar_id: string
          created_at: string
          description: string | null
          end_at: string
          external_id: string | null
          id: string
          location: string | null
          owner_id: string
          source: string
          start_at: string
          title: string
        }
        Insert: {
          all_day?: boolean
          business_id?: string | null
          calendar_id: string
          created_at?: string
          description?: string | null
          end_at: string
          external_id?: string | null
          id?: string
          location?: string | null
          owner_id: string
          source?: string
          start_at: string
          title: string
        }
        Update: {
          all_day?: boolean
          business_id?: string | null
          calendar_id?: string
          created_at?: string
          description?: string | null
          end_at?: string
          external_id?: string | null
          id?: string
          location?: string | null
          owner_id?: string
          source?: string
          start_at?: string
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
      folders: {
        Row: {
          business_id: string
          color: string
          created_at: string
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          business_id: string
          color?: string
          created_at?: string
          id?: string
          name: string
          owner_id: string
        }
        Update: {
          business_id?: string
          color?: string
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "folders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      lists: {
        Row: {
          created_at: string
          folder_id: string
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          folder_id: string
          id?: string
          name: string
          owner_id: string
        }
        Update: {
          created_at?: string
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
      meetings: {
        Row: {
          audio_path: string | null
          business_id: string | null
          created_at: string
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
      notes: {
        Row: {
          body: string
          business_id: string | null
          created_at: string
          folder_id: string | null
          id: string
          owner_id: string
          source: string
          title: string
        }
        Insert: {
          body?: string
          business_id?: string | null
          created_at?: string
          folder_id?: string | null
          id?: string
          owner_id: string
          source?: string
          title?: string
        }
        Update: {
          body?: string
          business_id?: string | null
          created_at?: string
          folder_id?: string | null
          id?: string
          owner_id?: string
          source?: string
          title?: string
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
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          timezone: string
          updated_at: string
          weekly_review_day: number
          weekly_review_enabled: boolean
          weekly_review_hour: number
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          timezone?: string
          updated_at?: string
          weekly_review_day?: number
          weekly_review_enabled?: boolean
          weekly_review_hour?: number
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          timezone?: string
          updated_at?: string
          weekly_review_day?: number
          weekly_review_enabled?: boolean
          weekly_review_hour?: number
        }
        Relationships: []
      }
      reminders: {
        Row: {
          channel: string
          created_at: string
          id: string
          last_error: string | null
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
          last_error?: string | null
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
          last_error?: string | null
          owner_id?: string
          ref_id?: string
          ref_type?: string
          remind_at?: string
          sent?: boolean
          sent_at?: string | null
        }
        Relationships: []
      }
      tasks: {
        Row: {
          business_id: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          list_id: string
          owner_id: string
          parent_task_id: string | null
          position: number
          priority: Database["public"]["Enums"]["task_priority"]
          status: Database["public"]["Enums"]["task_status"]
          title: string
        }
        Insert: {
          business_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          list_id: string
          owner_id: string
          parent_task_id?: string | null
          position?: number
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title: string
        }
        Update: {
          business_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          list_id?: string
          owner_id?: string
          parent_task_id?: string | null
          position?: number
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
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
        ]
      }
      weekly_reports: {
        Row: {
          business_id: string | null
          created_at: string
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
      [_ in never]: never
    }
    Enums: {
      task_priority: "urgent" | "high" | "normal" | "low"
      task_status: "todo" | "in_progress" | "review" | "done"
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
      task_priority: ["urgent", "high", "normal", "low"],
      task_status: ["todo", "in_progress", "review", "done"],
    },
  },
} as const
