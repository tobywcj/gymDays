// Shared DB types — mirrors public schema columns we actually read.

import type { AftLevel } from "./exercise-library";

export type ClientStatus = "Active" | "Resting" | "Flagged";
export type AgentType = "Progress" | "Strava Sync" | "Reminder" | "Research";

export type Trainer = {
  id: string;
  email: string;
  full_name: string | null;
};

export type ClientRow = {
  id: string;
  trainer_id?: string;
  auth_user_id?: string | null;
  name: string;
  goal: string | null;
  strava_athlete_id?: string | null;
  status: ClientStatus;
  created_at?: string;
  equipment?: unknown;
  schedule?: unknown;
  injury_history?: string | null;
  profile?: Record<string, unknown> | null;
  aft_level?: AftLevel | null;
};

// View-model for the dashboard table — keeps display strings (lastSession,
// strava: boolean) the existing UI already consumes.
export type ClientView = {
  id: string;
  name: string;
  goal: string;
  lastSession: string;
  strava: boolean;
  status: ClientStatus;
  aftLevel?: AftLevel | null;
};
