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
      crawl_jobs: {
        Row: {
          created_at: string
          error: string | null
          id: string
          pages_found: number
          pages_indexed: number
          site_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          pages_found?: number
          pages_indexed?: number
          site_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          pages_found?: number
          pages_indexed?: number
          site_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crawl_jobs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      page_analytics: {
        Row: {
          avg_time_on_page: number
          bounce_rate: number
          conversion_rate: number
          conversions: number
          created_at: string
          fetched_at: string
          id: string
          page_path: string
          pageviews: number
          period_end: string
          period_start: string
          sessions: number
          site_id: string
          updated_at: string
        }
        Insert: {
          avg_time_on_page?: number
          bounce_rate?: number
          conversion_rate?: number
          conversions?: number
          created_at?: string
          fetched_at?: string
          id?: string
          page_path: string
          pageviews?: number
          period_end: string
          period_start: string
          sessions?: number
          site_id: string
          updated_at?: string
        }
        Update: {
          avg_time_on_page?: number
          bounce_rate?: number
          conversion_rate?: number
          conversions?: number
          created_at?: string
          fetched_at?: string
          id?: string
          page_path?: string
          pageviews?: number
          period_end?: string
          period_start?: string
          sessions?: number
          site_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_analytics_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      pages: {
        Row: {
          content: string | null
          created_at: string
          embedding: string | null
          id: string
          last_indexed_at: string
          meta_description: string | null
          schema_data: Json | null
          site_id: string
          title: string | null
          updated_at: string
          url: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          embedding?: string | null
          id?: string
          last_indexed_at?: string
          meta_description?: string | null
          schema_data?: Json | null
          site_id: string
          title?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          content?: string | null
          created_at?: string
          embedding?: string | null
          id?: string
          last_indexed_at?: string
          meta_description?: string | null
          schema_data?: Json | null
          site_id?: string
          title?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "pages_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      search_clicks: {
        Row: {
          click_count: number
          created_at: string
          id: string
          last_clicked_at: string
          page_url: string
          query: string
          site_id: string
        }
        Insert: {
          click_count?: number
          created_at?: string
          id?: string
          last_clicked_at?: string
          page_url: string
          query: string
          site_id: string
        }
        Update: {
          click_count?: number
          created_at?: string
          id?: string
          last_clicked_at?: string
          page_url?: string
          query?: string
          site_id?: string
        }
        Relationships: []
      }
      search_logs: {
        Row: {
          clicked: boolean
          created_at: string
          id: string
          language: string | null
          query: string
          response_ms: number | null
          results_count: number
          site_id: string
        }
        Insert: {
          clicked?: boolean
          created_at?: string
          id?: string
          language?: string | null
          query: string
          response_ms?: number | null
          results_count?: number
          site_id: string
        }
        Update: {
          clicked?: boolean
          created_at?: string
          id?: string
          language?: string | null
          query?: string
          response_ms?: number | null
          results_count?: number
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_logs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      search_synonyms: {
        Row: {
          confidence: number
          created_at: string
          id: string
          query_from: string
          query_to: string
          site_id: string
          times_used: number
          updated_at: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          id?: string
          query_from: string
          query_to: string
          site_id: string
          times_used?: number
          updated_at?: string
        }
        Update: {
          confidence?: number
          created_at?: string
          id?: string
          query_from?: string
          query_to?: string
          site_id?: string
          times_used?: number
          updated_at?: string
        }
        Relationships: []
      }
      sites: {
        Row: {
          api_key: string
          brand_bg_color: string | null
          brand_color: string | null
          brand_font: string | null
          created_at: string
          domain: string
          ga_property_id: string | null
          id: string
          is_active: boolean
          last_crawled_at: string | null
          name: string
          page_count: number
          sitemap_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key?: string
          brand_bg_color?: string | null
          brand_color?: string | null
          brand_font?: string | null
          created_at?: string
          domain: string
          ga_property_id?: string | null
          id?: string
          is_active?: boolean
          last_crawled_at?: string | null
          name: string
          page_count?: number
          sitemap_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string
          brand_bg_color?: string | null
          brand_color?: string | null
          brand_font?: string | null
          created_at?: string
          domain?: string
          ga_property_id?: string | null
          id?: string
          is_active?: boolean
          last_crawled_at?: string | null
          name?: string
          page_count?: number
          sitemap_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
