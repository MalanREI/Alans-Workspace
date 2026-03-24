export type SiteProject = {
  id: string;
  name: string;
  client: string;
  location: string;
  status: "active" | "completed" | "on-hold";
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SiteMilestone = {
  id: string;
  project_id: string;
  name: string;
  milestone_date: string | null;
  scheduled_date: string | null;
  is_spacer: boolean;
  sort_order: number;
  created_at: string;
};

export type SiteReport = {
  id: string;
  project_id: string;
  observation_date: string;
  rep_name: string;
  overall_status: "on_track" | "risk" | "behind";
  public_share_token: string;
  pdf_storage_path: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // joined
  site_projects?: SiteProject;
};

export type SiteReportMilestone = {
  id: string;
  report_id: string;
  milestone_id: string | null;
  milestone_name: string;
  milestone_date: string | null;
  scheduled_date: string | null;
  is_spacer: boolean;
  status: "on_track" | "risk" | "behind" | "completed" | "not_started";
  completed_date: string | null;
  comments: string | null;
  sort_order: number;
};

export type SiteReportItem = {
  id: string;
  project_id: string;
  report_id: string;
  type: "highlight" | "recommendation" | "risk" | "escalation";
  item_name: string;
  status: string;
  comments: string;
  recommendation_date: string | null;
  created_at: string;
  // joined
  site_reports?: {
    observation_date: string;
    rep_name: string;
    overall_status: string;
  };
};

export type FullReport = SiteReport & {
  site_projects: SiteProject;
  site_report_milestones: SiteReportMilestone[];
  site_report_items: SiteReportItem[];
};

// Form state types (client-side only)
export type MilestoneFormEntry = {
  localId: string;
  milestone_id: string | null;
  is_spacer: boolean;
  milestone_name: string;
  milestone_date: string;
  scheduled_date: string;
  status: SiteReportMilestone["status"];
  completed_date: string;
  comments: string;
  sort_order: number;
};

export type ItemFormEntry = {
  localId: string;
  item_name: string;
  status: string;
  comments: string;
  recommendation_date: string;
  originalComments: string;
  aiPolished: boolean;
  polishing: boolean;
};
